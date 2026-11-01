/**
 * Dry-run connectivity check: Base USDC → NEAR USDC, tiny amount.
 *
 * - Finds token addresses via the SDK token lists (no hardcoded addresses).
 * - Requests a quote (read-only, no build, no execution, no funds).
 * - Logs the quote SHAPE: bestQuote router, estimatedOut, minAmountOut,
 *   alternatives count — never the JWT.
 *
 * Usage: RHEA_API_JWT=<jwt> ts-node scripts/dry-run-quote.ts
 * Exit 0 on success, 2 when no JWT (skip, not failure).
 */
import { createRheaClient } from "../src/rhea-client";
import { analyzeQuote } from "../src/risk-engine";

const BASE_CHAIN: `${number}` = "8453"; // Base
const NEAR_CHAIN = "near" as const;
const AMOUNT_USDC = "1000000"; // 1.0 USDC (6 decimals)

async function pickToken(
  client: ReturnType<typeof createRheaClient>,
  symbol: string,
  chain: "8453" | "near",
): Promise<{ address: string; decimals: number }> {
  // From-tokens on the source chain.
  const fromRows = await client.getFromTokens({ chainId: 8453 });
  // Cross-chain destinations reachable from the source chain.
  const toRows = await client.getCrossChainToTokens({ chainId: 8453 });
  const pool = [...fromRows, ...toRows];
  const hit = pool.find(
    (r) => r.symbol?.toUpperCase() === symbol.toUpperCase() && String(r.chain) === chain,
  );
  if (!hit) {
    throw new Error(`${symbol} not found in token lists for chain ${chain}`);
  }
  return { address: hit.address, decimals: hit.decimals ?? 6 };
}

async function main(): Promise<void> {
  if (!process.env.RHEA_API_JWT) {
    console.log("SKIP: RHEA_API_JWT not set — dry-run quote deferred until key is available.");
    process.exit(2);
  }

  const client = createRheaClient();

  const from = await pickToken(client, "USDC", "8453"); // Base USDC
  console.log(`Base USDC: ${from.address} (${from.decimals}d)`);
  const to = await pickToken(client, "USDC", "near"); // NEAR USDC
  console.log(`NEAR USDC: ${to.address} (${to.decimals}d)`);

  const quote = await client.quote({
    fromChain: BASE_CHAIN,
    toChain: NEAR_CHAIN,
    tokenIn: { chain: BASE_CHAIN, address: from.address, symbol: "USDC", decimals: from.decimals },
    tokenOut: { chain: NEAR_CHAIN, address: to.address, symbol: "USDC", decimals: to.decimals },
    amountIn: AMOUNT_USDC,
    slippageBps: 50,
    sender: "vaultguard.test",
  });

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
