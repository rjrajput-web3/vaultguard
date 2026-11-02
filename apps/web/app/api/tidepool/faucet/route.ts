/**
 * POST /api/tidepool/faucet — TESTNET-ONLY test-token faucet proxy.
 *
 * Proxies TidePool's /v0/faucet so visitors can fund test USDC/USDT/wNEAR/
 * wBTC for swaps. Rate-limited per account by TidePool itself; this route
 * quotes their real response verbatim and never invents success.
 *
 * Body: { accountId } — must be a NEAR testnet account.
 */
export const dynamic = "force-dynamic";

const TIDEPOOL_BASE = "https://www.usetidepool.tech/v0";

const TESTNET_ACCOUNT_RE = /^(([a-z\d]+[\-_])*[a-z\d]+\.)*([a-z\d]+[\-_])*[a-z\d]+$/;

export async function POST(req: Request): Promise<Response> {
  let body: { accountId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, network: "testnet", error: "invalid JSON body" }, { status: 400 });
  }
  const accountId = String(body.accountId ?? "").trim().toLowerCase();
  if (
    accountId.length < 2 ||
    accountId.length > 64 ||
    !TESTNET_ACCOUNT_RE.test(accountId) ||
    !accountId.endsWith(".testnet")
  ) {
    return Response.json(
      { ok: false, network: "testnet", error: "accountId must be a *.testnet account" },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(`${TIDEPOOL_BASE}/faucet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, mode: "wallet" }),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      // Quote TidePool's real message (e.g. rate-limit) verbatim.
      const msg =
        typeof data.message === "string" ? data.message : `TidePool HTTP ${res.status}`;
      return Response.json({ ok: false, network: "testnet", error: msg }, { status: 502 });
    }
    return Response.json({ ok: true, network: "testnet", ...data });
  } catch (e) {
    return Response.json(
      { ok: false, network: "testnet", error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
