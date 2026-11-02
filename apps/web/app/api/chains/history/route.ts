/**
 * POST /api/chains/history — server-side tx-history reader.
 *
 * Sources (all real, live):
 *  - solana-devnet: getSignaturesForAddress via the chain RPC
 *  - base-sepolia: Blockscout v2 API (verified live 2026-11-03)
 *  - near-testnet: Nearblocks API (same source the wallet page already uses)
 *  - sepolia: Sepolia's Blockscout instance does not serve its API (404,
 *    verified 2026-11-03) -> honest { ok:false, unavailable:true } with an
 *    explorer URL, never fabricated rows.
 *
 * Body: { chain, address, limit? }
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getChain, CORE_CHAINS } from "../../../../lib/wallet/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface HistoryItem {
  hash: string;
  from?: string;
  to?: string;
  status: "success" | "failed" | "unknown";
  timestamp?: string;
  kind?: string;
}

async function solanaHistory(rpcUrl: string, address: string, limit: number): Promise<HistoryItem[]> {
  const conn = new Connection(rpcUrl, "confirmed");
  const sigs = await conn.getSignaturesForAddress(new PublicKey(address), { limit });
  return sigs.map((s) => ({
    hash: s.signature,
    status: s.err ? "failed" : "success",
    timestamp: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : undefined,
    kind: "transaction",
  }));
}

async function baseSepoliaHistory(address: string, limit: number): Promise<HistoryItem[]> {
  const url =
    `https://base-sepolia.blockscout.com/api/v2/addresses/${address}/transactions` +
    `?filter=from%7Cto`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Blockscout returned HTTP ${res.status}`);
  const json = (await res.json()) as {
    items?: {
      hash?: string;
      from?: { hash?: string };
      to?: { hash?: string } | null;
      status?: string;
      timestamp?: string;
      transaction_types?: string[];
    }[];
  };
  return (json.items ?? []).slice(0, limit).map((t) => ({
    hash: t.hash ?? "",
    from: t.from?.hash,
    to: t.to?.hash ?? undefined,
    status: t.status === "ok" ? "success" : t.status === "error" ? "failed" : "unknown",
    timestamp: t.timestamp,
    kind: (t.transaction_types ?? []).join(",") || "transaction",
  }));
}

async function nearHistory(accountId: string, limit: number): Promise<HistoryItem[]> {
  const nearblocksApi = "https://api-testnet.nearblocks.io";
  const url = `${nearblocksApi}/api/v1/account/${encodeURIComponent(accountId)}/txns?page=1&per_page=${Math.min(Math.max(limit, 1), 25)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Nearblocks returned HTTP ${res.status}`);
  const json = (await res.json()) as {
    txns?: {
      transaction_hash?: string;
      signer_account_id?: string;
      receiver_account_id?: string;
      block_timestamp?: string;
      outcomes_agg?: { status?: boolean };
    }[];
  };
  if (!Array.isArray(json.txns)) throw new Error("Unexpected Nearblocks response shape");
  return json.txns.map((t) => ({
    hash: t.transaction_hash ?? "",
    from: t.signer_account_id,
    to: t.receiver_account_id,
    status: t.outcomes_agg?.status === false ? "failed" : t.outcomes_agg?.status === true ? "success" : "unknown",
    timestamp: t.block_timestamp,
    kind: "transaction",
  }));
}

export async function POST(req: NextRequest) {
  let body: { chain?: string; address?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const chain = getChain(String(body.chain ?? ""));
  const address = String(body.address ?? "").trim();
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 25);
  if (!chain) {
    return NextResponse.json({ ok: false, error: `Unsupported chain "${body.chain}"` }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ ok: false, error: "Missing address" }, { status: 400 });
  }
  const core = CORE_CHAINS.find((c) => c.id === chain.id)!;
  try {
    let items: HistoryItem[];
    if (chain.id === "solana-devnet") items = await solanaHistory(chain.rpcUrl, address, limit);
    else if (chain.id === "base-sepolia") items = await baseSepoliaHistory(address, limit);
    else if (chain.id === "near-testnet") items = await nearHistory(address, limit);
    else {
      // sepolia: no working public tx-list API (Blockscout 404, verified).
      return NextResponse.json({
        ok: false,
        unavailable: true,
        error: "On-page history is unavailable for Sepolia (no public tx-list API).",
        explorerUrl: core.explorerAddress(address),
      });
    }
    return NextResponse.json({ ok: true, txs: items, explorerUrl: core.explorerAddress(address) });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 200) : "History lookup failed",
        explorerUrl: core.explorerAddress(address),
      },
      { status: 502 }
    );
  }
}
