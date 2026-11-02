/**
 * GET /api/chains/solana-blockhash — fresh blockhash for client-side signing.
 *
 * The browser builds + signs the Solana transaction locally (keys never leave
 * the device) but needs a recent blockhash first. This route supplies it.
 * Read-only, no parameters.
 */
import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { getChain } from "../../../../lib/wallet/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET() {
  const chain = getChain("solana-devnet")!;
  try {
    const conn = new Connection(chain.rpcUrl, "confirmed");
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    return NextResponse.json({ ok: true, blockhash, lastValidBlockHeight });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Blockhash lookup failed" },
      { status: 502 }
    );
  }
}
