/**
 * POST /api/chains/balance — server-side balance reader for the multi-chain wallet.
 *
 * Why server-side: avoids browser CORS issues with public RPCs and keeps one
 * place for RPC config. This route NEVER sees private keys — it only reads
 * public on-chain balances for an address.
 *
 * Body: { chain: "sepolia"|"base-sepolia"|"solana-devnet"|"near-testnet", address: string }
 * Returns: { ok: true, balance: string, symbol: string } (human-readable, max 6dp)
 *          { ok: false, error: string } — never a fabricated number.
 */
import { NextRequest, NextResponse } from "next/server";
import { JsonRpcProvider, isAddress, formatEther } from "ethers";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getChain } from "../../../../lib/wallet/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_IMPLICIT_RE = /^[0-9a-f]{64}$/;

function fmt(raw: number): string {
  if (!isFinite(raw)) return "0";
  // max 6 decimals, trim trailing zeros
  return raw.toFixed(6).replace(/\.?0+$/, "") || "0";
}

async function evmBalance(rpcUrl: string, address: string): Promise<string> {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const wei = await provider.getBalance(address);
  return fmt(Number(formatEther(wei)));
}

async function solanaBalance(rpcUrl: string, address: string): Promise<string> {
  const conn = new Connection(rpcUrl, "confirmed");
  const lamports = await conn.getBalance(new PublicKey(address));
  return fmt(lamports / LAMPORTS_PER_SOL);
}

async function nearBalance(rpcUrl: string, accountId: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vaultry-balance",
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: accountId },
    }),
  });
  if (!res.ok) throw new Error(`NEAR RPC returned HTTP ${res.status}`);
  const json = (await res.json()) as { error?: { cause?: { name?: string } }; result?: { amount?: string } };
  if (json.error) {
    const name = json.error.cause?.name ?? "";
    if (name === "UNKNOWN_ACCOUNT") return "0"; // unfunded implicit account — honest zero
    throw new Error(`NEAR RPC error: ${name || "unknown"}`);
  }
  const yocto = json.result?.amount ?? "0";
  return fmt(Number(yocto) / 1e24);
}

export async function POST(req: NextRequest) {
  let body: { chain?: string; address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const chain = getChain(String(body.chain ?? ""));
  const address = String(body.address ?? "").trim();
  if (!chain) {
    return NextResponse.json({ ok: false, error: `Unsupported chain "${body.chain}"` }, { status: 400 });
  }
  const valid =
    chain.kind === "evm"
      ? EVM_ADDR_RE.test(address) && isAddress(address)
      : chain.kind === "solana"
        ? SOL_ADDR_RE.test(address)
        : NEAR_IMPLICIT_RE.test(address);
  if (!valid) {
    return NextResponse.json({ ok: false, error: `Invalid ${chain.testnetName} address` }, { status: 400 });
  }
  try {
    const balance =
      chain.kind === "evm"
        ? await evmBalance(chain.rpcUrl, address)
        : chain.kind === "solana"
          ? await solanaBalance(chain.rpcUrl, address)
          : await nearBalance(chain.rpcUrl, address);
    return NextResponse.json({ ok: true, balance, symbol: chain.nativeSymbol });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Balance lookup failed" },
      { status: 502 }
    );
  }
}
