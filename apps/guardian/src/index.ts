/** VAULTGUARD guardian service entrypoint. */
import { runQuoteIteration, type QuoteLoopParams } from "./quote-loop";

const DEMO_PARAMS: QuoteLoopParams = {
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
};

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "once";
  if (mode === "once") {
    const tick = await runQuoteIteration(DEMO_PARAMS);
    console.log(
      `tick: source=${tick.source} healthy=${tick.healthy} ` +
        `verdict=${tick.report?.verdict ?? "n/a"} score=${tick.report?.score ?? "n/a"}`,
    );
    if (tick.error) console.log(`note: ${tick.error}`);
  } else {
    const { pollQuoteLoop } = await import("./quote-loop");
    console.log("guardian quote loop running (60s interval) — Ctrl+C to stop");
    pollQuoteLoop(DEMO_PARAMS, 60000, (tick) => {
      console.log(
        `[${new Date(tick.at).toISOString()}] ${tick.source} ` +
          `${tick.report?.verdict ?? "unhealthy"} (${tick.report?.score ?? "-"})`,
      );
    });
    await new Promise(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
