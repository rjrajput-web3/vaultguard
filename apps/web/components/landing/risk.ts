/**
 * Honest client-side risk scoring for live quotes, mirroring the Route
 * Guardian's slippage bands (see lib/rhea/guardian.ts). Computed ONLY from
 * real quote numbers (amountOut / minAmountOut from the API) — nothing is
 * invented. Higher score = riskier. 0–100.
 */

export type RiskVerdict = "SAFE" | "CAUTION" | "BLOCKED";

export interface RiskScore {
  score: number; // 0..100
  verdict: RiskVerdict;
  slippagePct: number | null;
  reasons: string[];
}

/** Implied slippage in percent from base-unit amount strings (BigInt-safe). */
export function impliedSlippagePct(amountOut: string, minAmountOut: string): number | null {
  try {
    const out = BigInt(amountOut);
    const min = BigInt(minAmountOut);
    if (out <= BigInt(0) || min < BigInt(0) || min > out) return null;
    // BigInt() calls, not `10000n` literal: tsconfig targets ES2017.
    return Number(((out - min) * BigInt(10000)) / out) / 100;
  } catch {
    return null;
  }
}

export function scoreLiveQuote(amountOut: string | undefined, minAmountOut: string | undefined): RiskScore {
  if (!amountOut || !minAmountOut) {
    return { score: 95, verdict: "BLOCKED", slippagePct: null, reasons: ["Quote is missing amount fields — refusing to score"] };
  }
  const slip = impliedSlippagePct(amountOut, minAmountOut);
  if (slip === null) {
    return { score: 95, verdict: "BLOCKED", slippagePct: null, reasons: ["Quote amounts inconsistent (minOut > out or non-positive)"] };
  }
  let score: number;
  const reasons: string[] = [];
  if (slip <= 0.5) {
    score = 12 + slip * 12; // 12–18
    reasons.push(`Implied slippage ${slip.toFixed(2)}% — inside the tight band`);
  } else if (slip <= 1) {
    score = 30 + (slip - 0.5) * 20; // 30–40
    reasons.push(`Implied slippage ${slip.toFixed(2)}% — slightly elevated`);
  } else if (slip <= 2) {
    score = 50 + (slip - 1) * 15; // 50–65
    reasons.push(`Implied slippage ${slip.toFixed(2)}% — high, review before signing`);
  } else {
    score = Math.min(95, 70 + (slip - 2) * 6);
    reasons.push(`Implied slippage ${slip.toFixed(2)}% — exceeds safe bands`);
  }
  score = Math.round(score);
  const verdict: RiskVerdict = score <= 40 ? "SAFE" : score <= 70 ? "CAUTION" : "BLOCKED";
  if (verdict === "SAFE") reasons.push("All bands green — quote is signable");
  return { score, verdict, slippagePct: slip, reasons };
}

export const VERDICT_COLOR: Record<RiskVerdict, string> = {
  SAFE: "#22c55e",
  CAUTION: "#f59e0b",
  BLOCKED: "#ef4444",
};
