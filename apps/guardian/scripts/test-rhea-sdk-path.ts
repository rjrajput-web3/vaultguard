/**
 * Live integration test: official RHEA SDK path in the guardian.
 *
 * 1. Base USDC -> Solana USDC (routable pair): expect source "rhea",
 *    a normalized quote, a risk report, and correct destination matching.
 * 2. Base USDC -> NEAR USDC (solver outage): expect an honest RHEA failure
 *    and a 1Click fallback tick (or an unhealthy tick if 1Click is also
 *    down) — never a fabricated quote.
 *
 * Read-only: no build, no execution, no funds.
 */
import { runQuoteIteration, type QuoteLoopParams } from "../src/quote-loop";

const DRY_SENDER = "0x53CFA0C9EB10E352fC5B4DaAC1A9Eac2267303F9";
const DRY_RECIPIENT = "vaultry.testnet";

async function run(name: string, params: QuoteLoopParams): Promise<void> {
  console.log(`\n=== ${name} ===`);
  const tick = await runQuoteIteration(params);
  console.log(`source     : ${tick.source} (attempted: ${tick.attempted.join(" -> ")})`);
  console.log(`healthy    : ${tick.healthy} (${tick.latencyMs}ms)`);
  if (tick.normalized) {
    const n = tick.normalized;
    console.log(`tokenIn    : ${n.tokenIn}`);
    console.log(`tokenOut   : ${n.tokenOut}`);
    console.log(`amountIn   : ${n.amountIn}`);
    console.log(`estimated  : ${n.estimatedOut}`);
    console.log(`minOut     : ${n.minAmountOut}`);
    console.log(`slippage%  : ${n.slippagePct.toFixed(4)}`);
    console.log(`router     : ${n.router}`);
    console.log(`alts       : ${n.alternatives.length}`);
  }
  if (tick.report) {
    console.log(`risk       : ${tick.report.score} -> ${tick.report.verdict}`);
  }
  if (tick.error) console.log(`note       : ${tick.error.slice(0, 200)}`);
}

async function main(): Promise<void> {
  await run("RHEA SDK path: Base USDC -> Solana USDC (routable)", {
    fromChain: "8453",
    toChain: "solana",
    fromBlockchain: "base",
    toBlockchain: "solana",
    symbolIn: "USDC",
    symbolOut: "USDC",
    amountIn: "1000000",
    slippageBps: 50,
    dryRecipient: DRY_RECIPIENT,
    dryRefundTo: DRY_SENDER,
    sourceTimeoutMs: 60_000,
  });
  await run("Solver outage: Base USDC -> NEAR USDC (expect honest fallback)", {
    fromChain: "8453",
    toChain: "near",
    fromBlockchain: "base",
    toBlockchain: "near",
    symbolIn: "USDC",
    symbolOut: "USDC",
    amountIn: "1000000",
    slippageBps: 50,
    dryRecipient: DRY_RECIPIENT,
    dryRefundTo: DRY_SENDER,
    sourceTimeoutMs: 60_000,
  });
}

main().catch((err) => {
  console.error("TEST FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
