/**
 * POST /api/tidepool/execute — TESTNET-ONLY intent creation.
 *
 * Creates a real (non-dry) TidePool intent quote on the NEAR testnet
 * sandbox and returns the deposit address the user must fund. No funds
 * move here — the user's own keystore signs the token deposit in the
 * browser. This route NEVER touches mainnet: the base URL is hardcoded
 * to the testnet sandbox.
 *
 * Body: { from, to, amount, recipient }
 *   from/to  — test token keys: usdc | wnear | usdt | wbtc | eth (must differ)
 *   amount   — human amount in the FROM token, 0 < amount <= 10000
 *   recipient — NEAR testnet account that receives the swap output
 */
export const dynamic = "force-dynamic";

const TIDEPOOL_BASE = "https://www.usetidepool.tech/v0";

const TEST_TOKENS: Record<string, { id: string; label: string; decimals: number }> = {
  usdc: { id: "nep141:usdc.tidepool-sandbox.testnet", label: "test USDC", decimals: 6 },
  wnear: { id: "nep141:wnear.tidepool-sandbox.testnet", label: "test wNEAR", decimals: 24 },
  usdt: { id: "nep141:usdt.tidepool-sandbox.testnet", label: "test USDT", decimals: 6 },
  wbtc: { id: "nep141:wbtc.tidepool-sandbox.testnet", label: "test wBTC", decimals: 8 },
  eth: { id: "nep141:eth.tidepool-sandbox.testnet", label: "test ETH", decimals: 18 },
};

const TESTNET_ACCOUNT_RE = /^(([a-z\d]+[\-_])*[a-z\d]+\.)*([a-z\d]+[\-_])*[a-z\d]+$/;

function isTestnetAccount(a: string): boolean {
  const s = a.trim().toLowerCase();
  return (
    s.length >= 2 &&
    s.length <= 64 &&
    TESTNET_ACCOUNT_RE.test(s) &&
    (s.endsWith(".testnet") || /^[0-9a-f]{64}$/.test(s))
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: { from?: string; to?: string; amount?: string; recipient?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, network: "testnet", error: "invalid JSON body" }, { status: 400 });
  }

  const fromKey = String(body.from ?? "usdc").toLowerCase();
  const toKey = String(body.to ?? "wnear").toLowerCase();
  const from = TEST_TOKENS[fromKey];
  const dest = TEST_TOKENS[toKey];
  if (!from || !dest)
    return Response.json({ ok: false, network: "testnet", error: "unsupported token" }, { status: 400 });
  if (fromKey === toKey)
    return Response.json({ ok: false, network: "testnet", error: "from and to must differ" }, { status: 400 });

  const amountNum = Number(body.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 10000)
    return Response.json(
      { ok: false, network: "testnet", error: "amount must be a number between 0 and 10000" },
      { status: 400 },
    );

  const recipient = String(body.recipient ?? "").trim();
  if (!isTestnetAccount(recipient))
    return Response.json(
      { ok: false, network: "testnet", error: "recipient must be a NEAR testnet account" },
      { status: 400 },
    );

  // Base units without float drift.
  const scale = BigInt(1_000_000);
  const baseUnits =
    (BigInt(Math.floor(amountNum * 1_000_000)) * BigInt(10) ** BigInt(from.decimals)) / scale;

  const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  try {
    const res = await fetch(`${TIDEPOOL_BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: from.id,
        depositType: "INTENTS",
        destinationAsset: dest.id,
        amount: baseUnits.toString(),
        refundTo: recipient,
        refundType: "INTENTS",
        recipient,
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
      correlationId?: string;
      quote?: {
        amountIn?: string;
        amountOut?: string;
        minAmountOut?: string;
        amountOutFormatted?: string;
        amountOutUsd?: string;
        timeEstimate?: number;
        depositAddress?: string;
        deadline?: string;
      };
    };
    if (!data.quote?.depositAddress) {
      return Response.json(
        { ok: false, network: "testnet", error: "TidePool returned no deposit address" },
        { status: 502 },
      );
    }
    return Response.json({
      ok: true,
      network: "testnet",
      correlationId: data.correlationId,
      depositAddress: data.quote.depositAddress,
      amountInBaseUnits: data.quote.amountIn,
      amountOutBaseUnits: data.quote.amountOut,
      minAmountOutBaseUnits: data.quote.minAmountOut,
      amountOutUsd: data.quote.amountOutUsd,
      timeEstimateSec: data.quote.timeEstimate,
      deadline: data.quote.deadline,
      fromToken: { key: fromKey, id: from.id, label: from.label, decimals: from.decimals },
      toToken: { key: toKey, id: dest.id, label: dest.label, decimals: dest.decimals },
      disclaimer:
        "Testnet only — tokens are valueless. Fund the deposit address with an " +
        "ft_transfer of the exact test-token amount; TidePool settles to your recipient.",
    });
  } catch (e) {
    return Response.json(
      { ok: false, network: "testnet", error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
