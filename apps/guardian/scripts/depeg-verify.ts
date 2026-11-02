/**
 * VAULTGUARD depeg-monitor verification — function-level, dry-run.
 * Calls the REAL evaluateDepegResponse with 3 scenarios:
 *   1. no depeg (inside ±2% band)        -> no-action
 *   2. depeg confirmed + SAFE hedge      -> auto-hedge
 *   3. depeg confirmed + UNSAFE hedge    -> pause-and-alert
 * No funds move; no network calls.
 */
import { evaluateDepegResponse } from "../src/depeg-flow";
import { loadPolicy } from "../src/policy-config";
import type { NormalizedQuote } from "../src/risk-engine";

const policy = loadPolicy();

function hedgeQuote(slippagePct: number, router: string): NormalizedQuote {
  const amountIn = "1000000"; // 1.0 USDC
  const estimatedOut = "999846";
  const minAmountOut = String(Math.floor(999846 * (1 - slippagePct / 100)));
  return {
    fromChain: "8453",
    toChain: "near",
    tokenIn: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    tokenOut: "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    amountIn,
    estimatedOut,
    minAmountOut,
    slippagePct,
    router,
    alternatives: [],
    receivedAt: Date.now(),
  };
}

function run(name: string, spotPrice: number, state: { consecutiveOutside: number; confirmed: boolean }, q: NormalizedQuote) {
  console.log(`\n================================================================`);
  console.log(`SCENARIO — ${name}`);
  console.log(`================================================================`);
  const d = evaluateDepegResponse({
    depeggedAsset: "USDC",
    spotPrice,
    depegState: state,
    hedgeQuote: q,
    policy,
    spentTodayHuman: 0,
    decimalsIn: 6,
    decimalsOut: 6,
  });
  console.log(`DECISION: ${d.kind}`);
  for (const r of d.reasons) console.log(`  - ${r}`);
}

run("no depeg — price inside band", 1.001,
  { consecutiveOutside: 0, confirmed: false }, hedgeQuote(0.5, "nearintents"));

run("depeg CONFIRMED + SAFE hedge quote", 0.94,
  { consecutiveOutside: 3, confirmed: true }, hedgeQuote(0.5, "nearintents"));

run("depeg CONFIRMED + UNSAFE hedge quote", 0.94,
  { consecutiveOutside: 3, confirmed: true }, hedgeQuote(5.0, "nearintents"));

console.log("\nDone — function-level verification, dry-run only. No funds moved.");
