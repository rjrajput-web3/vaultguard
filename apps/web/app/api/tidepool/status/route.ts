/**
 * GET /api/tidepool/status — TESTNET-ONLY intent status proxy.
 *
 * Proxies TidePool's /v0/status for a deposit address so the UI can poll
 * for settlement without touching the TidePool API directly.
 * Query: ?depositAddress=<64-hex>
 */
export const dynamic = "force-dynamic";

const TIDEPOOL_BASE = "https://www.usetidepool.tech/v0";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const depositAddress = (url.searchParams.get("depositAddress") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(depositAddress)) {
    return Response.json(
      { ok: false, network: "testnet", error: "depositAddress must be 64 hex chars" },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(
      `${TIDEPOOL_BASE}/status?depositAddress=${encodeURIComponent(depositAddress)}`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (!res.ok) {
      return Response.json(
        { ok: false, network: "testnet", error: `TidePool HTTP ${res.status}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      status?: string;
      updatedAt?: string;
      correlationId?: string;
      swapDetails?: Record<string, unknown>;
    };
    return Response.json({
      ok: true,
      network: "testnet",
      status: data.status ?? "UNKNOWN",
      updatedAt: data.updatedAt,
      correlationId: data.correlationId,
      swapDetails: data.swapDetails ?? null,
    });
  } catch (e) {
    return Response.json(
      { ok: false, network: "testnet", error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
