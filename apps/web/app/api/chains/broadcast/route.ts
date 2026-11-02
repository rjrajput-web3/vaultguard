/**
 * POST /api/chains/broadcast — relay for CLIENT-SIGNED transactions.
 *
 * SECURITY CONTRACT:
 * - The server NEVER sees private keys or seed phrases. It receives only
 *   already-signed transaction bytes, which are public the moment they hit
 *   the mempool anyway.
 * - EVM: body { chain: "sepolia"|"base-sepolia", signedTx: "0x…" } — validated
 *   as hex, size-capped, relayed via eth_sendRawTransaction.
 * - Solana: body { chain: "solana-devnet", signedTx: "<base64>" } — validated
 *   base64, size-capped, relayed via sendRawTransaction.
 * - NEAR: NOT relayed here — NEAR sends use near-api-js directly from the
 *   browser (existing lib/wallet/near.ts flow).
 *
 * Returns { ok: true, hash } or { ok: false, error }.
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { getChain } from "../../../../lib/wallet/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HEX_RE = /^0x[0-9a-fA-F]+$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_TX_BYTES = 128 * 1024; // 128KB — far above any legitimate tx

async function broadcastEvm(rpcUrl: string, signedTx: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "vaultry-broadcast", method: "eth_sendRawTransaction", params: [signedTx] }),
  });
  if (!res.ok) throw new Error(`RPC returned HTTP ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error || !json.result) throw new Error(`RPC rejected the transaction: ${json.error?.message ?? "unknown"}`);
  return json.result;
}

async function broadcastSolana(rpcUrl: string, signedB64: string): Promise<string> {
  const conn = new Connection(rpcUrl, "confirmed");
  const raw = Buffer.from(signedB64, "base64");
  return conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed" });
}

export async function POST(req: NextRequest) {
  let body: { chain?: string; signedTx?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const chain = getChain(String(body.chain ?? ""));
  const signedTx = String(body.signedTx ?? "").trim();
  if (!chain || (chain.kind !== "evm" && chain.id !== "solana-devnet")) {
    return NextResponse.json({ ok: false, error: `Broadcast not supported for chain "${body.chain}"` }, { status: 400 });
  }
  if (chain.kind === "evm") {
    if (!HEX_RE.test(signedTx) || signedTx.length > MAX_TX_BYTES * 2 + 2) {
      return NextResponse.json({ ok: false, error: "signedTx must be 0x-hex within size limits" }, { status: 400 });
    }
  } else {
    if (!B64_RE.test(signedTx) || Buffer.from(signedTx, "base64").length > MAX_TX_BYTES) {
      return NextResponse.json({ ok: false, error: "signedTx must be base64 within size limits" }, { status: 400 });
    }
  }
  try {
    const hash =
      chain.kind === "evm"
        ? await broadcastEvm(chain.rpcUrl, signedTx)
        : await broadcastSolana(chain.rpcUrl, signedTx);
    return NextResponse.json({ ok: true, hash });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Broadcast failed" },
      { status: 502 }
    );
  }
}
