/**
 * VAULTGUARD quote-loop runner — Phase A smoke CLI.
 *
 * Runs ONE quote-loop iteration for the demo pair (Base USDC → NEAR USDC):
 * tries RHEA first, falls back to NEAR Intents 1Click dry-run quotes.
 * Prints the tick (source, normalized quote, risk report) as JSON.
 *
 * Dry-run only: no swaps are built or executed, no funds move.
 *
 * Usage:
 *   npx ts-node scripts/quote-loop.ts
 *   npx ts-node scripts/quote-loop.ts --daemon --interval-ms 60000
 *
 * Env (optional):
 *   RHEA_API_JWT — when set, the RHEA primary path is attempted; when absent
 *   or failing, the loop falls back to 1Click automatically.
 */
import { runQuoteIteration, pollQuoteLoop, type QuoteLoopParams } from "../src/quote-loop";
import { loadPolicy } from "../src/policy-config";

const PARAMS: QuoteLoopParams = {
  fromChain: "8453", // Base (RHEA chain id)
  toChain: "near", // NEAR (RHEA chain id)
  fromBlockchain: "base", // 1Click blockchain name
  toBlockchain: "near", // 1Click blockchain name
  symbolIn: "USDC",
  symbolOut: "USDC",
  amountIn: "1000000", // 1.0 USDC
  slippageBps: 50,
  // Dry-run placeholders — must be valid addresses on their chains. No funds move.
  dryRecipient: "intents.near",
  dryRefundTo: "0x53CFA0C9EB10E352fC5B4DaAC1A9Eac2267303F9",
  sourceTimeoutMs: 30000,
  // Vault policy (apps/guardian/config/policy.json, auto-created with defaults).
  policy: loadPolicy(),
};

function printTick(tick: ReturnType<typeof runQuoteIteration> extends Promise<infer T> ? T : never): void {
  // Strip to the fields the demo UI needs; never print credentials.
  const out = {
    at: new Date(tick.at).toISOString(),
    source: tick.source,
    healthy: tick.healthy,
    attempted: tick.attempted,
    latencyMs: tick.latencyMs,
    ...(tick.error ? { note: tick.error } : {}),
    ...(tick.normalized
      ? {
          quote: {
            fromChain: tick.normalized.fromChain,
            toChain: tick.normalized.toChain,
            tokenIn: tick.normalized.tokenIn,
            tokenOut: tick.normalized.tokenOut,
            amountIn: tick.normalized.amountIn,
            estimatedOut: tick.normalized.estimatedOut,
            minAmountOut: tick.normalized.minAmountOut,
            slippagePct: tick.normalized.slippagePct,
            router: tick.normalized.router,
            alternatives: tick.normalized.alternatives.length,
          },
        }
      : {}),
    ...(tick.report
      ? {
          risk: {
            score: tick.report.score,
            verdict: tick.report.verdict,
            autoExecuteAllowed: tick.report.autoExecuteAllowed,
            components: tick.report.components.map((c) => ({
              name: c.name,
              value: Math.round(c.value * 10) / 10,
              detail: c.detail,
            })),
          },
        }
      : {}),
    ...(tick.policyCheck
      ? {
          policy: {
            allowed: tick.policyCheck.allowed,
            reasons: tick.policyCheck.reasons,
          },
        }
      : {}),
  };
  console.log(JSON.stringify(out, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--daemon")) {
    const ivArg = args[args.indexOf("--interval-ms") + 1];
    const intervalMs = ivArg ? Number(ivArg) : 60000;
    console.log(`quote-loop daemon: polling every ${intervalMs}ms (Ctrl+C to stop)`);
    pollQuoteLoop(PARAMS, intervalMs, (tick) => printTick(tick));
    // Keep the process alive; the loop's timer holds it.
    await new Promise(() => undefined);
  } else {
    const tick = await runQuoteIteration(PARAMS);
    printTick(tick);
    process.exit(tick.healthy ? 0 : 1);
  }
}

main().catch((err) => {
  console.error("quote-loop failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
