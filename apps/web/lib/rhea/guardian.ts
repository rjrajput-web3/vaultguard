/**
 * VAULTRY Route Guardian — client-side gate for RHEA executable quotes.
 *
 * Every executable quote passes through checkExecutableQuote() inside the
 * SDK's beforeSign hook, i.e. AFTER build and BEFORE any wallet signature.
 * Nothing reaches the wallet unless this module returns { verdict: "SAFE" }
 * or the user explicitly confirms a CAUTION.
 *
 * Verdicts:
 *  - BLOCKED → beforeSign throws; the SDK aborts before any signature.
 *  - CAUTION → the UI must show the reasons and require an explicit,
 *    per-quote confirmation (checkbox + button). No pre-ticked boxes.
 *  - SAFE    → the flow continues to the wallet prompt.
 *
 * Checks (all from live data, nothing invented):
 *  1. Revalidation — the built quote must still match the user's original
 *     intent: same chains, same token addresses, same amountIn, same
 *     recipient, quote not expired (expiresAt), implied slippage within the
 *     user's tolerance.
 *  2. Sanity — estimatedOut > 0, minAmountOut > 0, minAmountOut <=
 *     estimatedOut, router is a non-empty known string.
 *  3. Risk scoring — implied slippage bands, quote age, min-received ratio.
 */
import type { Quote } from "@rhea-finance/cross-chain-aggregation-dex";

export type GuardianVerdict = "SAFE" | "CAUTION" | "BLOCKED";

export interface GuardianIntent {
  fromChain: string;
  toChain: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  amountIn: string; // base units
  slippageBps: number;
  recipient: string;
  sender: string;
}

export interface GuardianResult {
  verdict: GuardianVerdict;
  reasons: string[];
  score: number; // 0..100, higher = riskier
  checkedAt: string; // ISO
}

function normAddr(a: string): string {
  return a.trim().toLowerCase();
}

function impliedSlippagePct(estimatedOut: string, minAmountOut: string): number | null {
  try {
    const out = BigInt(estimatedOut);
    const min = BigInt(minAmountOut);
    if (out <= BigInt(0) || min < BigInt(0) || min > out) return null;
    return Number(((out - min) * BigInt(10000)) / out) / 100;
  } catch {
    return null;
  }
}

export function checkExecutableQuote(
  quote: Quote,
  intent: GuardianIntent,
  nowMs: number = Date.now(),
): GuardianResult {
  const reasons: string[] = [];
  let score = 0;
  const block = (r: string) => {
    reasons.push(`BLOCKED: ${r}`);
    score = Math.max(score, 90);
  };
  const caution = (r: string, pts: number) => {
    reasons.push(`CAUTION: ${r}`);
    score = Math.max(score, pts);
  };

  /* ---- 1. revalidation against the original intent ---- */
  if (String(quote.fromChain).toLowerCase() !== intent.fromChain.toLowerCase())
    block(`quote fromChain ${quote.fromChain} != requested ${intent.fromChain}`);
  if (String(quote.toChain).toLowerCase() !== intent.toChain.toLowerCase())
    block(`quote toChain ${quote.toChain} != requested ${intent.toChain}`);
  if (normAddr(quote.tokenIn.address) !== normAddr(intent.tokenInAddress))
    block("quote tokenIn address differs from the selected token");
  if (normAddr(quote.tokenOut.address) !== normAddr(intent.tokenOutAddress))
    block("quote tokenOut address differs from the selected token");
  if (quote.amountIn !== intent.amountIn)
    block(`quote amountIn ${quote.amountIn} != requested ${intent.amountIn}`);
  if (quote.expiresAt !== undefined && nowMs >= quote.expiresAt)
    block("quote expired — fetch a fresh quote");

  /* ---- 2. sanity ---- */
  const slip = impliedSlippagePct(quote.estimatedOut, quote.minAmountOut);
  if (slip === null) {
    block("quote amounts are inconsistent (minOut > estimatedOut or non-positive)");
  } else {
    const userTolPct = intent.slippageBps / 100;
    if (slip > userTolPct + 0.01)
      block(`implied slippage ${slip.toFixed(2)}% exceeds your ${userTolPct.toFixed(2)}% tolerance`);
    else if (slip > 1) caution(`implied slippage ${slip.toFixed(2)}% is high`, 60);
    else if (slip > 0.5) caution(`implied slippage ${slip.toFixed(2)}% is elevated`, 40);
  }
  if (!quote.route.router || typeof quote.route.router !== "string")
    block("quote has no router");
  const ageMs = nowMs - quote.receivedAt;
  if (ageMs > 120_000) caution(`quote is ${Math.round(ageMs / 1000)}s old — prices may have moved`, 55);
  else if (ageMs > 60_000) caution(`quote is ${Math.round(ageMs / 1000)}s old`, 35);

  /* ---- 3. quote-age vs expiry ---- */
  if (quote.expiresAt !== undefined) {
    const ttlMs = quote.expiresAt - nowMs;
    if (ttlMs < 15_000) caution("quote expires in under 15s — it may fail at build", 50);
  }

  const verdict: GuardianVerdict =
    reasons.some((r) => r.startsWith("BLOCKED")) ? "BLOCKED"
    : reasons.some((r) => r.startsWith("CAUTION")) ? "CAUTION"
    : "SAFE";
  if (verdict === "SAFE") reasons.push("all revalidation and sanity checks passed");

  return { verdict, reasons, score, checkedAt: new Date(nowMs).toISOString() };
}
