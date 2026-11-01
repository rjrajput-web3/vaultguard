/**
 * VAULTGUARD route-guardian fallback demo — Phase B.
 *
 * Shows the guardian's policy-driven fallback in action:
 *   1. Takes a LIVE quote via the quote loop (RHEA first, 1Click fallback).
 *   2. Runs the guardian decision with a healthy primary (expect: use-primary).
 *   3. Simulates primary-router degradation:
 *      - RHEA path: re-quotes with the primary killed via excludeDexs, then
 *        the guardian picks the best healthy alternative (fallback-to-alternative).
 *      - 1Click path: single aggregated route, no alternatives — the guardian
 *        demonstrates the honest no-route-pause decision instead.
 *   4. Prints the full human-readable decision trail.
 *
 * Dry-run only: no swaps are built or executed, no funds move.
 *
 * Usage:
 *   npx ts-node scripts/route-guardian-demo.ts
 *
 * Env (optional):
 *   RHEA_API_JWT — enables the RHEA primary path; without it the demo runs
 *   on the 1Click fallback automatically.
 */
import { runQuoteIteration, type QuoteLoopParams, type QuoteTick } from "../src/quote-loop";
import { decideRoute, type FallbackDecision } from "../src/route-guardian";
import { loadPolicy } from "../src/policy-config";

const PARAMS: QuoteLoopParams = {
  fromChain: "8453",
  toChain: "near",
  fromBlockchain: "base",
  toBlockchain: "near",
  symbolIn: "USDC",
  symbolOut: "USDC",
  amountIn: "1000000",
  slippageBps: 50,
  dryRecipient: "intents.near",
  dryRefundTo: "0x53CFA0C9EB10E352fC5B4DaAC1A9Eac2267303F9",
  sourceTimeoutMs: 30000,
  policy: loadPolicy(),
};

function header(title: string): void {
  console.log(`\n${"=".repeat(64)}\n${title}\n${"=".repeat(64)}`);
}

function printDecision(d: FallbackDecision): void {
  console.log(`\nDECISION: ${d.action}`);
  console.log(`primary router : ${d.primaryRouter}`);
  console.log(`selected router: ${d.selectedRouter ?? "(none — paused)"}`);
  console.log(`excluded       : ${d.excluded.join(", ") || "(none)"}`);
  if (d.selectedRoute) {
    console.log(
      `selected route : out ${d.selectedRoute.amountOut} / min ${d.selectedRoute.minAmountOut} ` +
        `(slippage ${d.selectedRoute.impliedSlippagePct.toFixed(2)}%)`,
    );
  }
  console.log(`policy allowed : ${d.policyAllowed ?? "n/a"}`);
  if (d.policyReasons && d.policyReasons.length > 0) {
    console.log(`policy reasons : ${d.policyReasons.join(" | ")}`);
  }
  console.log("\nDecision trail:");
  for (const s of d.trail) console.log(`  [${s.at}] ${s.step}`);
}

async function main(): Promise<void> {
  const policy = loadPolicy();

  // --- Step 1: live baseline quote.
  header("STEP 1 — live quote (RHEA first, 1Click fallback)");
  const base: QuoteTick = await runQuoteIteration(PARAMS);
  if (!base.healthy || !base.normalized) {
    console.error(`quote loop unhealthy: ${base.error ?? "unknown"}`);
    process.exit(1);
  }
  const nq = base.normalized;
  console.log(
    `source=${base.source} router=${nq.router} ` +
      `out=${nq.estimatedOut} min=${nq.minAmountOut} ` +
      `slippage=${nq.slippagePct.toFixed(2)}% ` +
      `risk=${base.report?.verdict} (${base.report?.score?.toFixed(1)}) ` +
      `alternatives=${nq.alternatives.length}`,
  );

  // --- Step 2: guardian with healthy primary.
  header("STEP 2 — guardian decision, primary healthy");
  printDecision(decideRoute(nq, [], policy));

  // --- Step 3: simulate primary degradation.
  header("STEP 3 — simulate primary-router degradation");
  const degraded = [nq.router];
  console.log(`Degrading primary router: "${nq.router}"`);

  if (base.source === "rhea" && nq.alternatives.length > 0) {
    // RHEA: re-quote with the primary actually killed via excludeDexs.
    console.log(`Re-quoting with excludeDexs=["${nq.router}"] ...`);
    const re: QuoteTick = await runQuoteIteration({ ...PARAMS, excludeDexs: degraded });
    if (re.healthy && re.normalized) {
      console.log(
        `re-quote: router=${re.normalized.router} ` +
          `out=${re.normalized.estimatedOut} min=${re.normalized.minAmountOut}`,
      );
      header("STEP 4 — guardian decision on the re-quote");
      printDecision(decideRoute(re.normalized, degraded, policy));
    } else {
      console.log(`re-quote unhealthy (${re.error ?? "unknown"}) — guardian decides on baseline:`);
      header("STEP 4 — guardian decision, primary degraded, no fresh quote");
      printDecision(decideRoute(nq, degraded, policy));
    }
  } else {
    // 1Click (or RHEA without alternatives): single route — the guardian's
    // honest answer is pause-and-alert, demonstrated via decideRoute.
    console.log(
      `Source "${base.source}" exposes a single aggregated route with no ` +
        `alternatives list — the guardian cannot fall back to another router.`,
    );
    header("STEP 4 — guardian decision, primary degraded, no alternatives");
    printDecision(decideRoute(nq, degraded, policy));
  }

  console.log("\nDemo complete. No swaps built or executed — dry-run only.");
}

main().catch((err) => {
  console.error("route-guardian demo failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
