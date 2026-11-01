/**
 * VAULTGUARD live quote loop — Phase A.
 *
 * Polls quotes for the demo pair on an interval. Source priority:
 *   1. RHEA (primary — full router set + alternatives[] for guardian fallback)
 *   2. NEAR Intents 1Click (fallback — dry-run quotes, no key, no funds move)
 *
 * Every quote, from either source, is normalized to NormalizedQuote and
 * scored by the risk engine. The loop NEVER executes a swap — it only
 * produces risk reports for the depeg flow and the demo UI.
 */
import type { Quote } from "@rhea-finance/cross-chain-aggregation-dex";
import { createRheaClient, getRheaJwt } from "./rhea-client";
import {
  scoreRisk,
  type NormalizedQuote,
  type RiskOptions,
  type RiskReport,
} from "./risk-engine";
import {
  fetchOneClickQuote,
  resolveOneClickAsset,
  type OneClickQuote,
} from "./oneclick-client";
import { evaluatePolicy, type PolicyCheck, type VaultPolicy } from "./policy";

export type QuoteSource = "rhea" | "oneclick";

export interface QuoteLoopParams {
  /** RHEA from-chain, e.g. "8453" (Base). */
  fromChain: string;
  /** RHEA to-chain, e.g. "near". */
  toChain: string;
  /** 1Click blockchain names for asset resolution, e.g. "base" / "near". */
  fromBlockchain: string;
  toBlockchain: string;
  symbolIn?: string; // default "USDC"
  symbolOut?: string; // default "USDC"
  amountIn: string; // base units, default "1000000" (1.0 USDC)
  slippageBps?: number; // default 50
  /** Dry-run placeholder recipient on the destination chain (must be valid). */
  dryRecipient: string;
  /** Dry-run refund address on the origin chain. */
  dryRefundTo: string;
  /** Per-source timeout ms. Default 30000. */
  sourceTimeoutMs?: number;
  riskOpts?: RiskOptions;
  /** RHEA router ids to exclude from quote selection (guardian fallback). */
  excludeDexs?: string[];
  /** Vault policy — when set, each tick carries a policyCheck verdict. */
  policy?: VaultPolicy;
  /** USDC-equivalent already spent today (human units), for the daily cap. */
  spentTodayHuman?: number;
  /** Decimals of the input asset for policy math. Default 6. */
  decimalsIn?: number;
}

export interface QuoteTick {
  at: number;
  source: QuoteSource;
  healthy: boolean;
  normalized?: NormalizedQuote;
  report?: RiskReport;
  /** Policy verdict on the quoted route (present when params.policy set). */
  policyCheck?: PolicyCheck;
  latencyMs: number;
  error?: string;
  /** Which sources were tried, in order. */
  attempted: QuoteSource[];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** RHEA API chain id -> token-list registry id (EVM chains use their chain id). */
const REGISTRY_IDS: Record<string, number> = {
  near: 900001,
  solana: 501,
  tron: 195,
  sui: 784,
  btc: 900002,
  zcash: 900010,
  aptos: 900012,
};

function registryId(apiChain: string): number {
  return REGISTRY_IDS[apiChain] ?? Number(apiChain);
}

async function resolveRheaAssets(
  client: ReturnType<typeof createRheaClient>,
  symbolIn: string,
  symbolOut: string,
  fromChain: string,
  toChain: string,
): Promise<{ inAddr: string; inDec: number; outAddr: string; outDec: number }> {
  const fromRows = await client.getFromTokens({ chainId: Number(fromChain) });
  // getCrossChainToTokens takes the DESTINATION chain's registry id.
  const toRows = await client.getCrossChainToTokens({ chainId: registryId(toChain) });
  const hitIn = fromRows.find(
    (r) => r.symbol?.toUpperCase() === symbolIn.toUpperCase() && String(r.chain) === fromChain,
  );
  // Destination rows carry the destination chain context; match by symbol and
  // prefer entries whose address/assetId references the destination chain.
  const toPool = toRows.filter((r) => r.symbol?.toUpperCase() === symbolOut.toUpperCase());
  const hitOut =
    toPool.find((r) => (r.address ?? "").toLowerCase().includes(toChain.toLowerCase())) ??
    toPool[0];
  if (!hitIn) throw new Error(`RHEA: ${symbolIn} not found for chain ${fromChain}`);
  if (!hitOut) throw new Error(`RHEA: ${symbolOut} not found for chain ${toChain}`);
  return {
    inAddr: hitIn.address,
    inDec: hitIn.decimals ?? 6,
    outAddr: hitOut.address,
    outDec: hitOut.decimals ?? 6,
  };
}

/** RHEA SDK quote (primary). Throws on any failure — the loop falls back. */
async function fetchRheaQuote(params: QuoteLoopParams): Promise<Quote> {
  getRheaJwt(); // throws a clear error when the JWT is absent
  const client = createRheaClient();
  const symbolIn = params.symbolIn ?? "USDC";
  const symbolOut = params.symbolOut ?? "USDC";
  const { inAddr, inDec, outAddr, outDec } = await resolveRheaAssets(
    client, symbolIn, symbolOut, params.fromChain, params.toChain,
  );
  return client.quote({
    fromChain: params.fromChain as `${number}`,
    toChain: params.toChain as "near",
    tokenIn: { chain: params.fromChain as `${number}`, address: inAddr, symbol: symbolIn, decimals: inDec },
    tokenOut: { chain: params.toChain as "near", address: outAddr, symbol: symbolOut, decimals: outDec },
    amountIn: params.amountIn,
    slippageBps: params.slippageBps ?? 50,
    sender: params.dryRefundTo,
    ...(params.excludeDexs && params.excludeDexs.length > 0
      ? { excludeDexs: params.excludeDexs }
      : {}),
  });
}

/**
 * Normalize a 1Click dry-run quote into the risk engine's NormalizedQuote.
 * 1Click is NEAR Intents under the hood: router "nearintents", single
 * aggregated route (no alternatives list — redundancy is scored accordingly).
 */
export function normalizeOneClickQuote(
  q: OneClickQuote,
  ctx: {
    fromChain: string;
    toChain: string;
    tokenInAddr: string;
    tokenOutAddr: string;
    amountIn: string;
    decimalsIn: number;
    decimalsOut: number;
  },
): NormalizedQuote {
  const slippagePct = (() => {
    try {
      const out = BigInt(q.amountOut);
      const min = BigInt(q.minAmountOut);
      if (out <= 0n) return 100;
      return Number(((out - min) * 10000n) / out) / 100;
    } catch {
      return 100;
    }
  })();
  return {
    fromChain: ctx.fromChain,
    toChain: ctx.toChain,
    tokenIn: `${ctx.fromChain}:${ctx.tokenInAddr.toLowerCase()}`,
    tokenOut: `${ctx.toChain}:${ctx.tokenOutAddr.toLowerCase()}`,
    amountIn: ctx.amountIn,
    estimatedOut: q.amountOut,
    minAmountOut: q.minAmountOut,
    slippagePct,
    router: "nearintents",
    alternatives: [],
    receivedAt: Date.now(),
  };
}

/** 1Click dry-run quote (fallback). Throws on any failure. */
async function fetchOneClickNormalized(params: QuoteLoopParams): Promise<NormalizedQuote> {
  const symbolIn = params.symbolIn ?? "USDC";
  const symbolOut = params.symbolOut ?? "USDC";
  const [assetIn, assetOut] = await Promise.all([
    resolveOneClickAsset(symbolIn, params.fromBlockchain),
    resolveOneClickAsset(symbolOut, params.toBlockchain),
  ]);
  const q = await fetchOneClickQuote({
    originAsset: assetIn.assetId,
    destinationAsset: assetOut.assetId,
    amount: params.amountIn,
    slippageBps: params.slippageBps ?? 50,
    recipient: params.dryRecipient,
    refundTo: params.dryRefundTo,
    timeoutMs: params.sourceTimeoutMs ?? 60000,
  });
  return normalizeOneClickQuote(q, {
    fromChain: params.fromChain,
    toChain: params.toChain,
    tokenInAddr: assetIn.contractAddress ?? assetIn.assetId,
    tokenOutAddr: assetOut.contractAddress ?? assetOut.assetId,
    amountIn: params.amountIn,
    decimalsIn: assetIn.decimals,
    decimalsOut: assetOut.decimals,
  });
}

/** Evaluate the vault policy against a normalized quote, when a policy is set. */
function checkPolicy(
  params: QuoteLoopParams,
  normalized: NormalizedQuote,
): PolicyCheck | undefined {
  if (!params.policy) return undefined;
  return evaluatePolicy(normalized, params.policy, {
    spentTodayHuman: params.spentTodayHuman ?? 0,
    decimalsIn: params.decimalsIn ?? 6,
  });
}

/**
 * One loop iteration: RHEA first, 1Click on any RHEA failure.
 * Never throws — failures are reported as unhealthy ticks.
 */
export async function runQuoteIteration(params: QuoteLoopParams): Promise<QuoteTick> {
  const at = Date.now();
  const attempted: QuoteSource[] = [];
  const timeoutMs = params.sourceTimeoutMs ?? 30000;
  const riskOpts: RiskOptions = {
    peggedPair: true, // demo pair is USDC->USDC
    decimalsIn: 6,
    decimalsOut: 6,
    ...(params.riskOpts ?? {}),
  };

  // 1. RHEA primary.
  attempted.push("rhea");
  const rheaStart = Date.now();
  try {
    // Dynamic import keeps the RHEA SDK out of the fallback path entirely.
    const { normalizeQuote } = await import("./risk-engine");
    const sdkQuote = await withTimeout(fetchRheaQuote(params), timeoutMs, "RHEA quote");
    const normalized = normalizeQuote(sdkQuote);
    const report = scoreRisk(normalized, riskOpts);
    return {
      at, source: "rhea", healthy: true, normalized, report,
      policyCheck: checkPolicy(params, normalized),
      latencyMs: Date.now() - rheaStart, attempted,
    };
  } catch (err) {
    const rheaError = err instanceof Error ? err.message : String(err);
    // 2. 1Click fallback.
    attempted.push("oneclick");
    const ocStart = Date.now();
    try {
      const normalized = await withTimeout(
        fetchOneClickNormalized(params), timeoutMs * 2, "1Click quote",
      );
      const report = scoreRisk(normalized, riskOpts);
      return {
        at, source: "oneclick", healthy: true, normalized, report,
        policyCheck: checkPolicy(params, normalized),
        latencyMs: Date.now() - ocStart, attempted,
        error: `rhea failed (${rheaError.slice(0, 120)}), fell back to 1Click`,
      };
    } catch (err2) {
      const ocError = err2 instanceof Error ? err2.message : String(err2);
      return {
        at, source: "oneclick", healthy: false,
        latencyMs: Date.now() - ocStart, attempted,
        error: `rhea failed (${rheaError.slice(0, 100)}); 1Click failed (${ocError.slice(0, 100)})`,
      };
    }
  }
}

/**
 * Polling daemon. Calls onTick for every iteration (healthy or not) and
 * never throws out — the loop survives individual failures.
 */
export function pollQuoteLoop(
  params: QuoteLoopParams,
  intervalMs: number,
  onTick: (tick: QuoteTick) => void | Promise<void>,
): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const loop = async () => {
    if (stopped) return;
    try {
      await onTick(await runQuoteIteration(params));
    } catch {
      // onTick itself failed — swallow to keep the loop alive.
    }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  };
  timer = setTimeout(loop, 0);
  return { stop: () => { stopped = true; if (timer) clearTimeout(timer); } };
}
