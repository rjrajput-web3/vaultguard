/**
 * POST /api/chains/history — server-side tx-history reader.
 * Logic lives in lib/wallet/chains-server.ts. Honest unavailability included.
 */
import { NextRequest, NextResponse } from "next/server";
import { getChainHistory } from "../../../../lib/wallet/chains-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { chain?: string; address?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const r = await getChainHistory(
    String(body.chain ?? ""),
    String(body.address ?? "").trim(),
    Number(body.limit) || 10
  );
  return NextResponse.json(r, { status: r.ok || r.unavailable ? 200 : 502 });
}
