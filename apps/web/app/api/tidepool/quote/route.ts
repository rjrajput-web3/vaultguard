/**
 * GET /api/tidepool/quote — TESTNET-ONLY live quote proxy.
 *
 * Proxies a dry-run quote from TidePool (NEAR testnet Intents sandbox).
 * Read-only: dry:true never creates a deposit address, no funds can move.
 * This route NEVER touches mainnet — the base URL is hardcoded to the
 * testnet sandbox and the response is labeled testnet throughout.
 */
export const dynamic = "force-dynamic";

const TIDEPOOL_BASE = "https://www.usetidepool.tech/v0";
const TESTNET_USDC = "nep141:usdc.tidepool-sandbox.testnet";
const TESTNET_WNEAR = "nep141:wnear.tidepool-sandbox.testnet";

export async function GET(): Promise<Response> {
  try {
    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const res = await fetch(`${TIDEPOOL_BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: TESTNET_USDC,
        depositType: "INTENTS",
        destinationAsset: TESTNET_WNEAR,
        amount: "1000000", // 1.0 test USDC
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
    return Response.json({
      ok: true,
      network: "testnet",
      sandbox: "TidePool",
      pair: "test USDC → test wNEAR",
      amountIn: data.quote.amountInFormatted ?? "?",
      amountOut: data.quote.amountOutFormatted ?? "?",
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
