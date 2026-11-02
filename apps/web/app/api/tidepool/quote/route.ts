/**
 * GET /api/tidepool/quote — TESTNET-ONLY live quote proxy.
 *
 * Proxies a dry-run quote from TidePool (NEAR testnet Intents sandbox).
 * Read-only: dry:true never creates a deposit address, no funds can move.
 * This route NEVER touches mainnet — the base URL is hardcoded to the
 * testnet sandbox and the response is labeled testnet throughout.
 *
 * Query params (all optional, validated against an allowlist):
 *   amount — test USDC amount, e.g. ?amount=2.5 (default 1, max 10000)
 *   to     — destination test token: wnear | usdt | wbtc | eth (default wnear)
 */
export const dynamic = "force-dynamic";

const TIDEPOOL_BASE = "https://www.usetidepool.tech/v0";
const TEST_USDC = "nep141:usdc.tidepool-sandbox.testnet";
const TEST_TOKENS: Record<string, { id: string; label: string; decimals: number }> = {
  wnear: { id: "nep141:wnear.tidepool-sandbox.testnet", label: "test wNEAR", decimals: 24 },
  usdt: { id: "nep141:usdt.tidepool-sandbox.testnet", label: "test USDT", decimals: 6 },
  wbtc: { id: "nep141:wbtc.tidepool-sandbox.testnet", label: "test wBTC", decimals: 8 },
  eth: { id: "nep141:eth.tidepool-sandbox.testnet", label: "test ETH", decimals: 18 },
};
const USDC_DECIMALS = 6;

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const toKey = (url.searchParams.get("to") ?? "wnear").toLowerCase();
    const dest = TEST_TOKENS[toKey];
    if (!dest) {
      return Response.json(
        { ok: false, network: "testnet", error: `unsupported destination "${toKey}"` },
        { status: 400 },
      );
    }
    const amountRaw = url.searchParams.get("amount") ?? "1";
    const amountNum = Number(amountRaw);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 10000) {
      return Response.json(
        { ok: false, network: "testnet", error: "amount must be a number between 0 and 10000" },
        { status: 400 },
      );
    }
    // test USDC has 6 decimals — convert to base units without float drift.
    // (BigInt() calls, not `10n` literals: tsconfig targets ES2017.)
    const baseUnits = (
      BigInt(Math.floor(amountNum * 1_000_000)) *
      BigInt(10) ** BigInt(USDC_DECIMALS)
    ) / BigInt(1_000_000);

    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const res = await fetch(`${TIDEPOOL_BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: TEST_USDC,
        depositType: "INTENTS",
        destinationAsset: dest.id,
        amount: baseUnits.toString(),
        refundTo: "vgdeployer.testnet",
        refundType: "INTENTS",
        recipient: "vgdeployer.testnet",
        recipientType: "DESTINATION_CHAIN",
        deadline,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return Response.json(
        { ok: false, network: "testnet", error: `TidePool HTTP ${res.status}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      quote?: {
        amountIn?: string;
        amountInFormatted?: string;
        amountOut?: string;
        amountOutFormatted?: string;
        minAmountOut?: string;
        amountOutUsd?: string;
        timeEstimate?: number;
      };
    };
    if (!data.quote?.amountOut) {
      return Response.json(
        { ok: false, network: "testnet", error: "TidePool returned no quote" },
        { status: 502 },
      );
    }
    // Human-readable out amount from base units using the destination decimals.
    let amountOutHuman = data.quote.amountOutFormatted ?? null;
    if (!amountOutHuman) {
      try {
        const raw = BigInt(data.quote.amountOut);
        const div = BigInt(10) ** BigInt(dest.decimals);
        const whole = raw / div;
        const frac = ((raw % div) * BigInt(10000)) / div;
        amountOutHuman = `${whole}.${frac.toString().padStart(4, "0")}`;
      } catch {
        amountOutHuman = "?";
      }
    }
    return Response.json({
      ok: true,
      network: "testnet",
      sandbox: "TidePool",
      pair: `test USDC → ${dest.label}`,
      amountIn: String(amountNum),
      amountInBaseUnits: baseUnits.toString(),
      amountOut: amountOutHuman,
      amountOutBaseUnits: data.quote.amountOut,
      minAmountOut: data.quote.minAmountOut,
      amountOutUsd: data.quote.amountOutUsd,
      timeEstimateSec: data.quote.timeEstimate,
      disclaimer:
        "Testnet only — tokens are valueless. Live E2E verified on-chain " +
        "2026-11-02 (see /security for the transaction hashes).",
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        network: "testnet",
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
