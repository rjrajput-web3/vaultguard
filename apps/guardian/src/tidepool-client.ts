/**
 * TidePool testnet Intents client — VAULTRY's NEAR-leg TESTNET quote/execution path.
 *
 * TidePool (https://www.usetidepool.tech) is a community-built, 1Click
 * API-compatible TESTNET SANDBOX for NEAR Intents. It runs the genuine
 * unmodified Intents verifier contract on NEAR testnet:
 *   verifier: verifier.tidepool-sandbox.testnet (on-chain code hash verified)
 *   maker:    maker.tidepool-sandbox.testnet
 *
 * ⚠️  TESTNET ONLY. Tokens are valueless. This module MUST NEVER be used for
 * mainnet: every exported function asserts the testnet base URL and rejects
 * any mainnet-looking input. Mainnet intents remain the 1Click path
 * (oneclick-client.ts) — RHEA stays the primary mainnet quote source.
 *
 * Endpoints are 1Click v0-compatible: same /tokens, /quote, /status shapes.
 * No signup, no API key. Faucet: POST /v0/faucet {"accountId","mode"}.
 */

const TIDEPOOL_BASE = "https://www.usetidepool.tech/v0";

export interface TidePoolToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price?: number;
  contractAddress?: string;
}

export interface TidePoolQuoteParams {
  originAsset: string; // e.g. nep141:usdc.tidepool-sandbox.testnet
  destinationAsset: string; // e.g. nep141:wnear.tidepool-sandbox.testnet
  amount: string; // base units, EXACT_INPUT
  slippageBps?: number; // default 50
  /** Live runs only: recipient on the destination chain. */
  recipient: string;
  /** Live runs only: refund address on the origin chain. */
  refundTo: string;
  /** dry:true = read-only quote, no deposit address, no funds can move. */
  dry?: boolean;
  timeoutMs?: number;
}

export interface TidePoolQuote {
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  amountOutUsd?: string;
  timeEstimate?: number;
}

export interface TidePoolLiveQuote extends TidePoolQuote {
  /** Per-quote deposit address. ONLY present on live (dry:false) quotes. */
  depositAddress: string;
  orderId?: string;
  correlationId?: string;
}

interface TidePoolQuoteResponse {
  quote: TidePoolQuote & { depositAddress?: string; deadline?: string };
  quoteRequest: Record<string, unknown>;
  signature: string;
  timestamp: string;
  correlationId?: string;
  orderId?: string;
  message?: string;
}

export interface FaucetDrip {
  assetId: string;
  symbol: string;
  amount: string;
}

export interface TidePoolStatus {
  status: string; // PENDING | PROCESSING | SUCCESS | FAILED | REFUNDED ...
  depositAddress?: string;
  swapDetails?: {
    nearTxHashes?: string[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** Hard guard: TidePool is testnet-only. Refuse anything mainnet-shaped. */
export function assertTestnetOnly(label: string, ...values: string[]): void {
  for (const v of values) {
    const s = String(v ?? "").toLowerCase();
    if (/\bmainnet\b/.test(s) || /\.near$/.test(s) || s === "near") {
      throw new Error(
        `TidePool TESTNET guard: refusing mainnet-shaped value for ${label}: ${v}`,
      );
    }
    if (!s.includes("testnet") && !s.includes(".tp-omft.testnet")) {
      throw new Error(
        `TidePool TESTNET guard: value for ${label} is not testnet-shaped: ${v}`,
      );
    }
  }
}

let tokenCache: TidePoolToken[] | null = null;
let tokenCacheAt = 0;
const TOKEN_CACHE_TTL_MS = 10 * 60 * 1000;

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

/** Public token list (no auth). Cached for 10 minutes. */
export async function fetchTidePoolTokens(timeoutMs = 30000): Promise<TidePoolToken[]> {
  if (tokenCache && Date.now() - tokenCacheAt < TOKEN_CACHE_TTL_MS) return tokenCache;
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetch(`${TIDEPOOL_BASE}/tokens`, { signal });
    if (!res.ok) throw new Error(`TidePool tokens HTTP ${res.status}`);
    const data = (await res.json()) as TidePoolToken[];
    if (!Array.isArray(data) || data.length === 0) throw new Error("TidePool tokens: empty list");
    tokenCache = data;
    tokenCacheAt = Date.now();
    return data;
  } finally {
    done();
  }
}

/** Resolve a TidePool assetId by symbol + blockchain (case-insensitive). No hardcoding. */
export async function resolveTidePoolAsset(
  symbol: string,
  blockchain: string,
  timeoutMs = 30000,
): Promise<TidePoolToken> {
  const tokens = await fetchTidePoolTokens(timeoutMs);
  const hit = tokens.find(
    (t) =>
      t.symbol.toUpperCase() === symbol.toUpperCase() &&
      t.blockchain.toLowerCase() === blockchain.toLowerCase(),
  );
  if (!hit) throw new Error(`TidePool: ${symbol} not found on ${blockchain}`);
  assertTestnetOnly("assetId", hit.assetId);
  return hit;
}

/**
 * Quote. dry:true (default) is read-only: no deposit address, no funds move.
 * dry:false returns a depositAddress and starts a real testnet swap intent —
 * the caller MUST route it through the Route Guardian before depositing.
 */
export async function fetchTidePoolQuote(
  params: TidePoolQuoteParams,
): Promise<TidePoolQuote | TidePoolLiveQuote> {
  assertTestnetOnly("originAsset", params.originAsset);
  assertTestnetOnly("destinationAsset", params.destinationAsset);
  const dry = params.dry !== false;
  if (!dry) {
    assertTestnetOnly("recipient", params.recipient);
    assertTestnetOnly("refundTo", params.refundTo);
  }
  const timeoutMs = params.timeoutMs ?? 60000;
  const { signal, done } = withTimeout(timeoutMs);
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const body = {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: params.slippageBps ?? 50,
    originAsset: params.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    refundTo: params.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: params.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline,
  };
  try {
    const res = await fetch(`${TIDEPOOL_BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = (await res.json()) as TidePoolQuoteResponse;
    if (!res.ok || !data.quote) {
      throw new Error(`TidePool quote failed: HTTP ${res.status} ${data.message ?? "no quote"}`);
    }
    if (!dry) {
      // Real responses nest depositAddress inside quote (verified 2026-11-02).
      const depositAddress = data.quote.depositAddress;
      if (!depositAddress) {
        throw new Error("TidePool live quote returned no depositAddress — refusing to proceed");
      }
      return {
        ...data.quote,
        depositAddress,
        orderId: data.orderId,
        correlationId: data.correlationId,
      };
    }
    return data.quote;
  } finally {
    done();
  }
}

/**
 * Faucet drip. mode "intents" credits the intents (verifier ledger) balance;
 * mode "wallet" credits the plain wallet. Rate-limited: 1 drip/account/hour.
 */
export async function tidePoolFaucet(
  accountId: string,
  mode: "wallet" | "intents" = "intents",
  timeoutMs = 60000,
): Promise<FaucetDrip[]> {
  assertTestnetOnly("accountId", accountId);
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetch(`${TIDEPOOL_BASE}/faucet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, mode }),
      signal,
    });
    const data = (await res.json()) as { drips?: FaucetDrip[]; message?: string };
    if (!res.ok || !Array.isArray(data.drips)) {
      throw new Error(`TidePool faucet failed: HTTP ${res.status} ${data.message ?? "no drips"}`);
    }
    return data.drips;
  } finally {
    done();
  }
}

/** Poll swap status by deposit address (or order id). */
export async function fetchTidePoolStatus(
  depositAddressOrOrderId: string,
  timeoutMs = 30000,
): Promise<TidePoolStatus> {
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetch(
      `${TIDEPOOL_BASE}/status?depositAddress=${encodeURIComponent(depositAddressOrOrderId)}`,
      { signal },
    );
    if (!res.ok) throw new Error(`TidePool status HTTP ${res.status}`);
    return (await res.json()) as TidePoolStatus;
  } finally {
    done();
  }
}
