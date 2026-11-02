/**
 * POST /api/chains/balance — server-side balance reader for the multi-chain wallet.
 * Public data only — never sees private keys. Logic lives in lib/wallet/chains-server.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getChainBalance } from "../../../../lib/wallet/chains-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { chain?: string; address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const r = await getChainBalance(String(body.chain ?? ""), String(body.address ?? "").trim());
  return NextResponse.json(r, { status: r.ok ? 200 : r.error?.includes("Invalid") || r.error?.includes("Unsupported") ? 400 : 502 });
}
