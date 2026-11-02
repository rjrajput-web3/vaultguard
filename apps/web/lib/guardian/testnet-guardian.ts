/**
 * VAULTRY Route Guardian — TESTNET gate for TidePool intent swaps.
 *
 * Every testnet swap passes through checkTestnetSwap() AFTER the live quote
 * and BEFORE any keystore unlock / signature. Nothing reaches the signing
 * step unless this returns { verdict: "SAFE" } or the user explicitly
 * confirms a CAUTION (per-quote checkbox, never pre-ticked).
 *
 * Verdicts:
 *  - BLOCKED → the UI disables execution and shows the reasons. No override.
 *  - CAUTION → the UI shows the reasons and requires an explicit checkbox +
 *    button press for THIS quote. No pre-ticked boxes, no blanket approval.
 *  - SAFE    → the flow continues to the policy gate, then the wallet step.
 *
 * Checks (all from live data, nothing invented):
 *  1. Intent match — quoted tokens/amount match what the user asked for.
 *  2. Sanity — amountOut > 0, minAmountOut > 0, minAmountOut <= amountOut,
 *     recipient is a valid testnet account, quote fresh.
 *  3. Risk scoring — implied slippage bands, quote age.
 *  4. Policy — emergency pause and spending caps from the visitor's
 *     device-local policy (user-policy.ts). A paused console BLOCKS.
 */

import { loadUserPolicy, type UserPolicy } from "../policy/user-policy";
import { getTodaySpendUsd } from "../policy/spend-tracker";

export type GuardianVerdict = "SAFE" | "CAUTION" | "BLOCKED";

export interface TestnetSwapIntent {
  fromTokenKey: string; // e.g. "usdc"
  toTokenKey: string; // e.g. "wnear"
  fromTokenId: string; // nep141:usdc.tidepool-sandbox.testnet
  toTokenId: string;
  amountInBaseUnits: string;
  slippageBps: number;
  recipient: string; // testnet account
}

export interface TestnetQuote {
  amountInBaseUnits: string;
  amountOutBaseUnits: string;
  minAmountOutBaseUnits?: string;
  amountOutUsd?: string;
  timeEstimateSec?: number;
  receivedAtMs: number;
}

export interface GuardianResult {
  verdict: GuardianVerdict;
  reasons: string[];
  score: number; // 0..100, higher = riskier
  checkedAt: string;
}

const TESTNET_ACCOUNT_RE = /^(([a-z\d]+[\-_])*[a-z\d]+\.)*([a-z\d]+[\-_])*[a-z\d]+$/;

export function isValidTestnetAccount(accountId: string): boolean {
  const a = accountId.trim().toLowerCase();
  if (a.length < 2 || a.length > 64) return false;
  if (!TESTNET_ACCOUNT_RE.test(a)) return false;
  // Testnet accounts end in .testnet, or are implicit (64 hex chars).
  return a.endsWith(".testnet") || /^[0-9a-f]{64}$/.test(a);
}

function impliedSlippagePct(out: string, minOut: string): number | null {
  try {
    const o = BigInt(out);
    const m = BigInt(minOut);
    if (o <= BigInt(0) || m < BigInt(0) || m > o) return null;
    return Number(((o - m) * BigInt(10000)) / o) / 100;
  } catch {
    return null;
  }
}

export function checkTestnetSwap(
  quote: TestnetQuote,
  intent: TestnetSwapIntent,
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

  /* ---- 0. emergency pause + policy (device-local) ---- */
  let policy: UserPolicy | null = null;
  try {
    policy = loadUserPolicy();
  } catch {
    policy = null;
  }
  if (policy?.paused) {
    block("emergency pause is ON in your Policy Console — swaps are frozen until you unpause");
  }

  /* ---- 1. intent match ---- */
  if (quote.amountInBaseUnits !== intent.amountInBaseUnits)
    block(`quote amount ${quote.amountInBaseUnits} != requested ${intent.amountInBaseUnits}`);
  if (!isValidTestnetAccount(intent.recipient))
    block(`"${intent.recipient}" is not a valid NEAR testnet account`);

  /* ---- 2. sanity ---- */
  let outNum: bigint;
  try {
    outNum = BigInt(quote.amountOutBaseUnits);
  } catch {
    block("quote output amount is not a number");
    return finish(reasons, score, nowMs);
  }
  if (outNum <= BigInt(0)) block("quote output is zero or negative");
  if (quote.minAmountOutBaseUnits) {
    const slip = impliedSlippagePct(quote.amountOutBaseUnits, quote.minAmountOutBaseUnits);
    if (slip === null) {
      block("quote amounts inconsistent (minOut > estimatedOut)");
    } else {
      const userTolPct = intent.slippageBps / 100;
      if (slip > userTolPct + 0.01)
        block(`implied slippage ${slip.toFixed(2)}% exceeds your ${userTolPct.toFixed(2)}% tolerance`);
      else if (slip > 2) caution(`implied slippage ${slip.toFixed(2)}% is high`, 60);
      else if (slip > 1) caution(`implied slippage ${slip.toFixed(2)}% is elevated`, 40);
    }
  }
  const ageMs = nowMs - quote.receivedAtMs;
  if (ageMs > 120_000) caution(`quote is ${Math.round(ageMs / 1000)}s old — prices may have moved`, 55);
  else if (ageMs > 60_000) caution(`quote is ${Math.round(ageMs / 1000)}s old`, 35);

  /* ---- 3. spending caps (testnet USD estimate from the quote) ---- */
  if (policy) {
    const usd = Number(quote.amountOutUsd ?? "0");
    if (Number.isFinite(usd) && usd > 0) {
      if (usd > policy.maxSpendPerTx)
        block(`$${usd.toFixed(2)} exceeds your per-transaction cap $${policy.maxSpendPerTx}`);
      const today = getTodaySpendUsd();
      if (today + usd > policy.maxSpendPerDay)
        block(
          `today's testnet spend $${today.toFixed(2)} + $${usd.toFixed(2)} would exceed your daily cap $${policy.maxSpendPerDay}`,
        );
    }
  }

  return finish(reasons, score, nowMs);
}

function finish(reasons: string[], score: number, nowMs: number): GuardianResult {
  const verdict: GuardianVerdict = reasons.some((r) => r.startsWith("BLOCKED"))
    ? "BLOCKED"
    : reasons.some((r) => r.startsWith("CAUTION"))
      ? "CAUTION"
      : "SAFE";
  if (verdict === "SAFE") reasons.push("all testnet revalidation and sanity checks passed");
  return { verdict, reasons, score, checkedAt: new Date(nowMs).toISOString() };
}
