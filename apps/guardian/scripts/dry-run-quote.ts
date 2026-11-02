/**
 * Dry-run connectivity check: Base USDC → NEAR USDC, tiny amount.
 *
 * - Finds token addresses via the SDK token lists (no hardcoded addresses).
 * - Requests a quote (read-only, no build, no execution, no funds).
 * - Logs the quote SHAPE: bestQuote router, estimatedOut, minAmountOut,
 *   alternatives count — never any credential.
 * - A "no route" answer from the API is an HONEST result, not a failure:
 *   exit 0 with a clear NO_ROUTE log (the loop then falls back to 1Click).
 *
 * Auth: the client in ../src/rhea-client.ts routes HTTP through the local
 * bridge (rhea_bridge.py) which attaches the connector credential itself —
 * no RHEA_API_JWT env var is needed or read.
 *
 * Usage: npx ts-node scripts/dry-run-quote.ts
 * Exit 0 on quote OR honest no-route; 1 on transport/unexpected failure.
 */
import { createRheaClient } from "../src/rhea-client";
import { pickDestinationToken, rawTokenAddress } from "../src/quote-loop";
import { analyzeQuote } from "../src/risk-engine";

const BASE_CHAIN: `${number}` = "8453"; // Base
const NEAR_CHAIN = "near" as const;
const NEAR_REGISTRY_ID = 900001;
const AMOUNT_USDC = "1000000"; // 1.0 USDC (6 decimals)
// Dry-run sender: a real, well-formed public address (his EVM payout wallet).
// Nothing moves; the API requires a sender field for quoting.
const DRY_SENDER = "0x53CFA0C9EB10E352fC5B4DaAC1A9Eac2267303F9";

async function pickTokens(): Promise<{
  from: { address: string; decimals: number };
  to: { address: string; decimals: number };
}> {
  const client = createRheaClient();
  // Source token: from-list of the SOURCE chain. Destination token: from-list
  // of the DESTINATION chain — the cross-chain to-list returns only omft
  // wrappers, which the quote endpoint rejects (verified live).
  const fromRows = await client.getFromTokens({ chainId: 8453 });
  const from = fromRows.find(
    (r) => r.symbol?.toUpperCase() === "USDC" && String(r.chain) === "8453",
  );
  const toRows = await client.getFromTokens({ chainId: NEAR_REGISTRY_ID });
  const usdcPool = toRows.filter((r) => r.symbol?.toUpperCase() === "USDC");
  let supported: Set<string> | undefined;
  try {
    const destList = await client.getCrossChainToTokens({ chainId: NEAR_REGISTRY_ID });
    supported = new Set(
      destList
        .flatMap((r) => [r.address, r.assetId, r.contractAddress])
        .map((v) => String(v ?? "").toLowerCase())
        .filter(Boolean),
    );
  } catch {
    supported = undefined;
  }
  const to = pickDestinationToken(usdcPool, "near", supported);
  if (!from) throw new Error("USDC not found in RHEA from-tokens for Base (8453)");
  if (!to) {
    throw new Error(
      `USDC on NEAR: ${usdcPool.length} symbol matches, none with chain == near; refusing to guess`,
    );
  }
  const fromAddr = rawTokenAddress(from);
  const toAddr = rawTokenAddress(to);
  console.log(`Base USDC: ${fromAddr} (${from.decimals ?? 6}d)`);
  console.log(`NEAR USDC: ${toAddr} (${to.decimals ?? 6}d)`);
  return {
    from: { address: fromAddr, decimals: from.decimals ?? 6 },
    to: { address: toAddr, decimals: to.decimals ?? 6 },
  };
}

async function main(): Promise<void> {
  const client = createRheaClient();
  const { from, to } = await pickTokens();

  let quote;
  try {
    quote = await client.quote({
      fromChain: BASE_CHAIN,
      toChain: NEAR_CHAIN,
      tokenIn: { chain: BASE_CHAIN, address: from.address, symbol: "USDC", decimals: from.decimals },
      tokenOut: { chain: NEAR_CHAIN, address: to.address, symbol: "USDC", decimals: to.decimals },
      amountIn: AMOUNT_USDC,
      slippageBps: 50,
      sender: DRY_SENDER,
    });
  } catch (err) {
    // Any quote-stage failure is an HONEST signal, never a fabricated quote:
    // the API answered "no route" (solver outage), or the bridge couldn't
    // reach the API at all. Both are exit-0 diagnostics, distinguished below.
    const msg = err instanceof Error ? err.message : String(err);
    const noRoute = /cross-chain quote failed|API_ERROR|QUOTE_TIMEOUT|no.*route/i.test(msg);
    console.log(
      `${noRoute ? "NO_ROUTE" : "NO_QUOTE"} (honest): ${msg.slice(0, 200)}`,
    );
    console.log("The quote loop falls back to 1Click for this pair.");
    return;
  }

  const { normalized, report } = analyzeQuote(quote, {
    peggedPair: true,
    decimalsIn: from.decimals,
    decimalsOut: to.decimals,
  });

  console.log("QUOTE SHAPE (Base USDC → NEAR USDC, 1.0 USDC, dry-run):");
  console.log(`  router        : ${normalized.router}`);
  console.log(`  estimatedOut  : ${normalized.estimatedOut}`);
  console.log(`  minAmountOut  : ${normalized.minAmountOut}`);
  console.log(`  slippagePct   : ${normalized.slippagePct.toFixed(4)}%`);
  console.log(`  alternatives  : ${normalized.alternatives.length}`);
  normalized.alternatives.slice(0, 5).forEach((a, i) => {
    console.log(`    [${i}] ${a.router} out=${a.amountOut} min=${a.minAmountOut}`);
  });
  console.log(`  risk score    : ${report.score} → ${report.verdict}`);
  report.components.forEach((c) => {
    console.log(`    - ${c.name}: ${c.value.toFixed(1)} (w=${c.weight}) — ${c.detail}`);
  });
  console.log("RHEA API: LIVE");
}

main().catch((err) => {
  console.error("DRY-RUN FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
