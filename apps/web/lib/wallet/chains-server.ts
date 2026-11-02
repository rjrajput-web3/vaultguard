/**
 * Server-side chain readers — shared by /api/chains/* and /api/agent.
 *
 * Public data only (balances, history, tx lookups). Never handles keys.
 * Node-only: uses Buffer freely.
 */
import { JsonRpcProvider, isAddress, formatEther } from "ethers";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getChain } from "./chains";

export interface ChainBalance {
  ok: boolean;
  balance?: string;
  symbol?: string;
  error?: string;
}

export interface HistoryItem {
  hash: string;
  from?: string;
  to?: string;
  status: "success" | "failed" | "unknown";
  timestamp?: string;
  kind?: string;
}

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_IMPLICIT_RE = /^[0-9a-f]{64}$/;

export function isValidChainAddress(chainId: string, address: string): boolean {
  const chain = getChain(chainId);
  if (!chain) return false;
  if (chain.kind === "evm") return EVM_ADDR_RE.test(address) && isAddress(address);
  if (chain.kind === "solana") return SOL_ADDR_RE.test(address);
  return NEAR_IMPLICIT_RE.test(address);
}

function fmt(raw: number): string {
  if (!isFinite(raw)) return "0";
  return raw.toFixed(6).replace(/\.?0+$/, "") || "0";
}

export async function getChainBalance(chainId: string, address: string): Promise<ChainBalance> {
  const chain = getChain(chainId);
  if (!chain) return { ok: false, error: `Unsupported chain "${chainId}"` };
  if (!isValidChainAddress(chainId, address)) {
    return { ok: false, error: `Invalid ${chain.testnetName} address` };
  }
  try {
    if (chain.kind === "evm") {
      const provider = new JsonRpcProvider(chain.rpcUrl, undefined, { staticNetwork: true });
      const wei = await provider.getBalance(address);
      return { ok: true, balance: fmt(Number(formatEther(wei))), symbol: chain.nativeSymbol };
    }
    if (chain.kind === "solana") {
      const conn = new Connection(chain.rpcUrl, "confirmed");
      const lamports = await conn.getBalance(new PublicKey(address));
      return { ok: true, balance: fmt(lamports / LAMPORTS_PER_SOL), symbol: chain.nativeSymbol };
    }
    const res = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "vaultry-balance", method: "query",
        params: { request_type: "view_account", finality: "final", account_id: address },
      }),
    });
    if (!res.ok) throw new Error(`NEAR RPC returned HTTP ${res.status}`);
    const json = (await res.json()) as { error?: { cause?: { name?: string } }; result?: { amount?: string } };
    if (json.error) {
      if ((json.error.cause?.name ?? "") === "UNKNOWN_ACCOUNT") {
        return { ok: true, balance: "0", symbol: chain.nativeSymbol };
      }
      throw new Error(`NEAR RPC error: ${json.error.cause?.name ?? "unknown"}`);
    }
    return { ok: true, balance: fmt(Number(json.result?.amount ?? "0") / 1e24), symbol: chain.nativeSymbol };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Balance lookup failed" };
  }
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
  const res = await fetch(
    `https://base-sepolia.blockscout.com/api/v2/addresses/${address}/transactions`,
    { headers: { accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Blockscout returned HTTP ${res.status}`);
  const json = (await res.json()) as {
    items?: { hash?: string; from?: { hash?: string }; to?: { hash?: string } | null; status?: string; timestamp?: string; transaction_types?: string[] }[];
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
  const url = `https://api-testnet.nearblocks.io/api/v1/account/${encodeURIComponent(accountId)}/txns?page=1&per_page=${Math.min(Math.max(limit, 1), 25)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Nearblocks returned HTTP ${res.status}`);
  const json = (await res.json()) as {
    txns?: { transaction_hash?: string; signer_account_id?: string; receiver_account_id?: string; block_timestamp?: string; outcomes_agg?: { status?: boolean } }[];
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

export async function getChainHistory(
  chainId: string, address: string, limit = 10
): Promise<{ ok: boolean; txs?: HistoryItem[]; error?: string; unavailable?: boolean; explorerUrl?: string }> {
  const chain = getChain(chainId);
  if (!chain) return { ok: false, error: `Unsupported chain "${chainId}"` };
  try {
    if (chainId === "solana-devnet") return { ok: true, txs: await solanaHistory(chain.rpcUrl, address, limit), explorerUrl: chain.explorerAddress(address) };
    if (chainId === "base-sepolia") return { ok: true, txs: await baseSepoliaHistory(address, limit), explorerUrl: chain.explorerAddress(address) };
    if (chainId === "near-testnet") return { ok: true, txs: await nearHistory(address, limit), explorerUrl: chain.explorerAddress(address) };
    return {
      ok: false, unavailable: true,
      error: "On-page history is unavailable for Sepolia (no public tx-list API).",
      explorerUrl: chain.explorerAddress(address),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "History lookup failed", explorerUrl: chain.explorerAddress(address) };
  }
}

/** EVM: does an address host contract code? (real eth_getCode — for token research) */
export async function evmHasCode(chainId: string, address: string): Promise<{ ok: boolean; hasCode?: boolean; error?: string }> {
  const chain = getChain(chainId);
  if (!chain || chain.kind !== "evm") return { ok: false, error: "Not an EVM chain" };
  try {
    const provider = new JsonRpcProvider(chain.rpcUrl, undefined, { staticNetwork: true });
    const code = await provider.getCode(address);
    return { ok: true, hasCode: code !== "0x" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 150) : "getCode failed" };
  }
}

/** Raw EVM transaction lookup (for explain_tx). */
export async function evmGetTransaction(
  chainId: string, hash: string
): Promise<{ ok: boolean; tx?: Record<string, string>; error?: string }> {
  const chain = getChain(chainId);
  if (!chain || chain.kind !== "evm") return { ok: false, error: "Not an EVM chain" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { ok: false, error: "Invalid transaction hash" };
  try {
    const provider = new JsonRpcProvider(chain.rpcUrl, undefined, { staticNetwork: true });
    const tx = await provider.getTransaction(hash);
    if (!tx) return { ok: false, error: "Transaction not found on this chain" };
    const receipt = await provider.getTransactionReceipt(hash).catch(() => null);
    return {
      ok: true,
      tx: {
        hash: tx.hash, from: tx.from, to: tx.to ?? "(contract creation)",
        value: formatEther(tx.value), nonce: String(tx.nonce),
        status: receipt ? (receipt.status === 1 ? "success" : "failed") : "unknown",
        chain: chain.testnetName,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 150) : "Lookup failed" };
  }
}

/** Solana transaction lookup (for explain_tx). */
export async function solanaGetTransaction(
  sig: string
): Promise<{ ok: boolean; tx?: Record<string, string>; error?: string }> {
  const chain = getChain("solana-devnet")!;
  try {
    const conn = new Connection(chain.rpcUrl, "confirmed");
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) return { ok: false, error: "Transaction not found on Solana devnet" };
    return {
      ok: true,
      tx: {
        signature: sig,
        slot: String(tx.slot),
        status: tx.meta?.err ? "failed" : "success",
        feeSol: String((tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL),
        blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : "unknown",
        chain: chain.testnetName,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 150) : "Lookup failed" };
  }
}

/** Live TidePool testnet quote (for swap research — same source as /api/tidepool/quote). */
export async function tidepoolQuote(
  fromKey: string, toKey: string, amount: number
): Promise<{ ok: boolean; quote?: Record<string, string>; error?: string }> {
  const TOKENS: Record<string, { id: string; label: string; decimals: number }> = {
    usdc: { id: "nep141:usdc.tidepool-sandbox.testnet", label: "test USDC", decimals: 6 },
    wnear: { id: "nep141:wnear.tidepool-sandbox.testnet", label: "test wNEAR", decimals: 24 },
    usdt: { id: "nep141:usdt.tidepool-sandbox.testnet", label: "test USDT", decimals: 6 },
    wbtc: { id: "nep141:wbtc.tidepool-sandbox.testnet", label: "test wBTC", decimals: 8 },
    eth: { id: "nep141:eth.tidepool-sandbox.testnet", label: "test ETH", decimals: 18 },
  };
  const from = TOKENS[fromKey];
  const dest = TOKENS[toKey];
  if (!from || !dest || fromKey === toKey) return { ok: false, error: "Unsupported TidePool pair" };
  try {
    const scale = BigInt(1_000_000);
    const baseUnits = (BigInt(Math.floor(amount * 1_000_000)) * BigInt(10) ** BigInt(from.decimals)) / scale;
    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      // Body shape matches the proven /api/tidepool/quote route exactly.
      const res = await fetch("https://www.usetidepool.tech/v0/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          dry: true,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100,
          originAsset: from.id,
          depositType: "INTENTS",
          destinationAsset: dest.id,
          amount: baseUnits.toString(),
          refundTo: "vgdeployer.testnet",
          refundType: "INTENTS",
          recipient: "vgdeployer.testnet",
          recipientType: "DESTINATION_CHAIN",
          deadline,
        }),
      });
      if (!res.ok) throw new Error(`TidePool quote HTTP ${res.status}`);
      const data = (await res.json()) as {
        quote?: {
          amountOut?: string; amountOutFormatted?: string; minAmountOut?: string;
          amountOutUsd?: string; timeEstimate?: number;
        };
      };
      if (!data.quote?.amountOut) throw new Error("TidePool returned no quote");
      let amountOutHuman = data.quote.amountOutFormatted ?? null;
      if (!amountOutHuman) {
        try {
          const raw = BigInt(data.quote.amountOut);
          const div = BigInt(10) ** BigInt(dest.decimals);
          const whole = raw / div;
          const frac = ((raw % div) * BigInt(1000000)) / div;
          amountOutHuman = `${whole}.${frac.toString().padStart(6, "0")}`;
        } catch {
          amountOutHuman = "?";
        }
      }
      return {
        ok: true,
        quote: {
          from: from.label, to: dest.label,
          amountIn: String(amount),
          amountOut: amountOutHuman,
          amountOutUsd: data.quote.amountOutUsd ?? "n/a",
          timeEstimateSec: String(data.quote.timeEstimate ?? "?"),
          via: "TidePool Intents sandbox (NEAR testnet)",
          network: "testnet",
        },
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Quote failed" };
  }
}

/** TidePool testnet token list (for token research). */
export async function tidepoolTokens(): Promise<{ ok: boolean; tokens?: { symbol: string; contract: string; decimals: number }[]; error?: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch("https://www.usetidepool.tech/v0/tokens", { signal: ctrl.signal });
      if (!res.ok) throw new Error(`TidePool tokens HTTP ${res.status}`);
      const j = (await res.json()) as { symbol?: string; contractAddress?: string; assetId?: string; decimals?: number }[];
      if (!Array.isArray(j)) throw new Error("Unexpected tokens response");
      return {
        ok: true,
        tokens: j.map((t) => ({
          symbol: t.symbol ?? "?",
          contract: t.contractAddress ?? t.assetId ?? "?",
          decimals: t.decimals ?? 0,
        })),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Token list failed" };
  }
}
