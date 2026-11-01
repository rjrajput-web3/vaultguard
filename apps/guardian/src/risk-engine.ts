/**
 * VAULTGUARD risk engine — normalize a RHEA SDK Quote and score it 0-100.
 *
 * Never blind swaps: a verdict of BLOCKED (score > 65) means the guardian
 * must NOT execute through that quote. CAUTION requires human or policy
 * review. SAFE may proceed through the policy engine + contract checks.
 */
import type { Quote, RouteSummary } from "@rhea-finance/cross-chain-aggregation-dex";

export interface NormalizedRoute {
  router: string;
  market?: string;
  amountOut: string; // base units
  minAmountOut: string; // base units
  impliedSlippagePct: number;
}

export interface NormalizedQuote {
  quoteId?: string;
  fromChain: string;
  toChain: string;
  tokenIn: string; // "chain:address"
  tokenOut: string; // "chain:address"
  amountIn: string; // base units
  estimatedOut: string; // base units
  minAmountOut: string; // base units
  /** (estimatedOut - minAmountOut) / estimatedOut * 100 — the SDK's own slippage floor. */
  slippagePct: number;
  router: string;
  alternatives: NormalizedRoute[];
  receivedAt: number;
}

function assetKey(chain: string, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

function impliedSlippage(amountOut: string, minAmountOut: string): number {
  try {
    const out = BigInt(amountOut);
    const min = BigInt(minAmountOut);
    if (out <= 0n) return 100;
    const diff = out - min;
    // Basis-point-safe math, then to percent.
    const bps = (diff * 10000n) / out;
    return Number(bps) / 100;
  } catch {
    return 100; // unparseable amounts are maximally risky
  }
}

function normalizeRoute(r: RouteSummary): NormalizedRoute {
  return {
    router: r.router,
    market: r.market,
    amountOut: r.amountOut,
    minAmountOut: r.minAmountOut,
    impliedSlippagePct: impliedSlippage(r.amountOut, r.minAmountOut),
  };
}

export function normalizeQuote(quote: Quote): NormalizedQuote {
  return {
    quoteId: quote.id,
    fromChain: String(quote.fromChain),
    toChain: String(quote.toChain),
    tokenIn: assetKey(String(quote.fromChain), quote.tokenIn.address),
    tokenOut: assetKey(String(quote.toChain), quote.tokenOut.address),
    amountIn: quote.amountIn,
    estimatedOut: quote.estimatedOut,
    minAmountOut: quote.minAmountOut,
    slippagePct: impliedSlippage(quote.estimatedOut, quote.minAmountOut),
    router: quote.route.router,
    alternatives: (quote.alternatives ?? []).map(normalizeRoute),
    receivedAt: quote.receivedAt,
  };
}

export type RiskVerdict = "SAFE" | "CAUTION" | "BLOCKED";

export interface RiskComponent {
  name: string;
  weight: number; // 0..1
  value: number; // 0..100
  detail: string;
}

export interface RiskReport {
  score: number; // 0..100 (higher = riskier)
  verdict: RiskVerdict;
  components: RiskComponent[];
  /** true when the quote must not execute automatically. */
  autoExecuteAllowed: boolean;
}

export interface RiskOptions {
  /** Hard slippage ceiling in % — above this the quote is always BLOCKED. Default 5. */
  maxSlippagePct?: number;
  /** CAUTION threshold (inclusive). Default 35. */
  cautionAt?: number;
  /** BLOCKED threshold (exclusive). Default 65. */
  blockedAbove?: number;
  /** When true, fee estimation assumes a ~1:1 pegged pair (stablecoin hedges). */
  peggedPair?: boolean;
  decimalsIn?: number;
  decimalsOut?: number;
}

/** Linear 0->100 ramp between lo (0 risk) and hi (100 risk). */
function ramp(value: number, lo: number, hi: number): number {
  if (value <= lo) return 0;
  if (value >= hi) return 100;
  return ((value - lo) / (hi - lo)) * 100;
}

/**
 * Fee estimate from the quote itself: for a pegged pair, whatever of the
 * input value is not reflected in estimatedOut is fees + price impact.
 * Without an oracle price this is a conservative upper bound, not exact —
 * the oracle price-vs-market check (Pyth/Chainlink) lands in the next phase.
 */
function estimateFeePct(
  amountIn: string,
  estimatedOut: string,
  decimalsIn: number,
  decimalsOut: number,
): { feePct: number; reliable: boolean } {
  try {
    const inB = BigInt(amountIn);
    const outB = BigInt(estimatedOut);
    if (inB <= 0n || outB <= 0n) return { feePct: 100, reliable: false };
    const inHuman = Number(inB) / 10 ** decimalsIn;
    const outHuman = Number(outB) / 10 ** decimalsOut;
    if (!isFinite(inHuman) || !isFinite(outHuman) || inHuman <= 0) {
      return { feePct: 100, reliable: false };
    }
    const retained = Math.min(1, outHuman / inHuman);
    return { feePct: Math.max(0, (1 - retained) * 100), reliable: true };
  } catch {
    return { feePct: 100, reliable: false };
  }
}

export function scoreRisk(nq: NormalizedQuote, opts: RiskOptions = {}): RiskReport {
  const maxSlippagePct = opts.maxSlippagePct ?? 5;
  const cautionAt = opts.cautionAt ?? 35;
  const blockedAbove = opts.blockedAbove ?? 65;

  const components: RiskComponent[] = [];

  // 1. Slippage (40%) — the SDK's own implied slippage is our hard signal.
  const slippageValue = ramp(nq.slippagePct, 0.3, maxSlippagePct);
  components.push({
    name: "slippage",
    weight: 0.4,
    value: slippageValue,
    detail: `implied slippage ${nq.slippagePct.toFixed(3)}% (ceiling ${maxSlippagePct}%)`,
  });

  // 2. Fee / value-leak estimate (20%).
  let feeValue = 50;
  let feeDetail = "fee estimate unavailable — treated as moderate risk";
  if (opts.peggedPair && opts.decimalsIn != null && opts.decimalsOut != null) {
    const { feePct, reliable } = estimateFeePct(
      nq.amountIn,
      nq.estimatedOut,
      opts.decimalsIn,
      opts.decimalsOut,
    );
    feeValue = reliable ? ramp(feePct, 0.2, 3) : 75;
    feeDetail = reliable
      ? `value retained ${(100 - feePct).toFixed(2)}% on pegged pair (fees+impact ~${feePct.toFixed(2)}%)`
      : "unparseable amounts — fee unestimable";
  }
  components.push({ name: "fee", weight: 0.2, value: feeValue, detail: feeDetail });

  // 3. Route redundancy (15%) — no fallback route is itself a risk.
  const altCount = nq.alternatives.length;
  const routeValue = altCount === 0 ? 60 : altCount <= 2 ? 30 : 10;
  components.push({
    name: "route-redundancy",
    weight: 0.15,
    value: routeValue,
    detail: `${altCount} alternative route(s) available for fallback`,
  });

  // 4. Primary-route divergence (25%) — a primary far better than every
  // alternative is a fragile outlier; a primary far worse means mis-routing.
  let divValue = 20;
  let divDetail = "no alternatives to compare against";
  if (altCount > 0) {
    try {
      const primary = BigInt(nq.estimatedOut);
      const bestAlt = nq.alternatives
        .map((a) => BigInt(a.amountOut))
        .reduce((m, v) => (v > m ? v : m), 0n);
      if (primary > 0n) {
        const divergence = (Number(primary - bestAlt) * 100) / Number(primary);
        divValue = ramp(Math.abs(divergence), 0.5, 4);
        divDetail = `primary vs best alternative divergence ${divergence.toFixed(2)}%`;
      }
    } catch {
      divValue = 50;
      divDetail = "unparseable amounts in alternative comparison";
    }
  }
  components.push({ name: "route-divergence", weight: 0.25, value: divValue, detail: divDetail });

  let score = components.reduce((s, c) => s + c.weight * c.value, 0);
  score = Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;

  let verdict: RiskVerdict;
  if (nq.slippagePct > maxSlippagePct || score > blockedAbove) {
    verdict = "BLOCKED";
  } else if (score >= cautionAt) {
    verdict = "CAUTION";
  } else {
    verdict = "SAFE";
  }

  return {
    score,
    verdict,
    components,
    autoExecuteAllowed: verdict === "SAFE",
  };
}

/** Convenience: normalize + score in one step. */
export function analyzeQuote(quote: Quote, opts: RiskOptions = {}): {
  normalized: NormalizedQuote;
  report: RiskReport;
} {
  const normalized = normalizeQuote(quote);
  return { normalized, report: scoreRisk(normalized, opts) };
}
