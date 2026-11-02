/**
 * VAULTRY multi-chain send — CLIENT-SIDE ONLY.
 *
 * SECURITY CONTRACT:
 * - Signing happens in the browser with the in-memory key from the unlocked
 *   session. Keys are NEVER sent to any server.
 * - /api/chains/* routes only relay already-signed bytes or serve public
 *   read data (balances, params, blockhash).
 * - Every send should pass the Route Guardian + Policy Console checks in the
 *   UI BEFORE this is called (the wallet page enforces this).
 */

import { Wallet as EthersWallet, isAddress, parseEther } from "ethers";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { getChain, type ChainDef } from "./chains";
import { createConnection, getSignerAccount, sendNear } from "./near";
import "../polyfills";

function assertBrowser(): void {
  if (typeof window === "undefined") throw new Error("chain-rpc is client-only");
}

export interface SendResult {
  ok: true;
  hash: string;
  explorerUrl: string;
}

export type SendError = { ok: false; error: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/* ---------------- EVM (Sepolia / Base Sepolia) ---------------- */

export async function sendEvm(params: {
  chainId: "sepolia" | "base-sepolia";
  privateKey: string; // 0x… — memory only
  to: string;
  amountEth: string; // human-readable, e.g. "0.01"
}): Promise<SendResult | SendError> {
  assertBrowser();
  const chain = getChain(params.chainId) as ChainDef;
  const to = params.to.trim();
  if (!isAddress(to)) return { ok: false, error: `"${to}" is not a valid EVM address` };
  let valueWei: bigint;
  try {
    valueWei = parseEther(params.amountEth.trim());
    if (valueWei <= BigInt(0)) throw new Error("x");
  } catch {
    return { ok: false, error: "Enter a valid positive amount" };
  }
  const wallet = new EthersWallet(params.privateKey);
  try {
    // 1. fetch live tx params (server-side, no key involved)
    const p = await postJson<{
      ok: boolean; error?: string; nonce?: number; chainId?: number;
      gasLimit?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string;
    }>("/api/chains/evm-params", {
      chain: params.chainId, address: wallet.address, to, value: valueWei.toString(),
    });
    if (!p.ok) return { ok: false, error: p.error ?? "Could not fetch network params" };
    // 2. sign LOCALLY — the key never leaves this browser
    const signed = await wallet.signTransaction({
      to,
      value: valueWei,
      nonce: p.nonce,
      chainId: p.chainId,
      gasLimit: p.gasLimit,
      maxFeePerGas: p.maxFeePerGas,
      maxPriorityFeePerGas: p.maxPriorityFeePerGas,
      type: 2,
    });
    // 3. relay the signed bytes
    const b = await postJson<{ ok: boolean; error?: string; hash?: string }>("/api/chains/broadcast", {
      chain: params.chainId, signedTx: signed,
    });
    if (!b.ok || !b.hash) return { ok: false, error: b.error ?? "Broadcast failed" };
    return { ok: true, hash: b.hash, explorerUrl: chain.explorerTx(b.hash) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Send failed" };
  }
}

/* ---------------- Solana devnet ---------------- */

export async function sendSolana(params: {
  secretKeyB58: string; // memory only
  to: string;
  amountSol: string; // human-readable, e.g. "0.01"
}): Promise<SendResult | SendError> {
  assertBrowser();
  const chain = getChain("solana-devnet")!;
  let toPubkey: PublicKey;
  try {
    toPubkey = new PublicKey(params.to.trim());
  } catch {
    return { ok: false, error: `"${params.to.trim()}" is not a valid Solana address` };
  }
  const lamports = Math.round(Number(params.amountSol) * 1e9);
  if (!isFinite(lamports) || lamports <= 0) return { ok: false, error: "Enter a valid positive amount" };
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(params.secretKeyB58.trim()));
  } catch {
    return { ok: false, error: "Invalid Solana secret key" };
  }
  try {
    // 1. fresh blockhash (public read)
    const bhRes = await fetch("/api/chains/solana-blockhash");
    const bh = (await bhRes.json()) as { ok: boolean; error?: string; blockhash?: string };
    if (!bh.ok || !bh.blockhash) return { ok: false, error: bh.error ?? "Could not fetch blockhash" };
    // 2. build + sign LOCALLY
    const tx = new Transaction({
      feePayer: keypair.publicKey,
      recentBlockhash: bh.blockhash,
    }).add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey, lamports }));
    tx.sign(keypair);
    const rawB64 = Buffer.from(tx.serialize()).toString("base64");
    // 3. relay the signed bytes
    const b = await postJson<{ ok: boolean; error?: string; hash?: string }>("/api/chains/broadcast", {
      chain: "solana-devnet", signedTx: rawB64,
    });
    if (!b.ok || !b.hash) return { ok: false, error: b.error ?? "Broadcast failed" };
    return { ok: true, hash: b.hash, explorerUrl: chain.explorerTx(b.hash) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Send failed" };
  }
}

/* ---------------- NEAR testnet (implicit account) ---------------- */

export async function sendNearImplicit(params: {
  implicitAccountId: string;
  secretKey: string; // ed25519:… — memory only
  to: string; // testnet account (named or implicit)
  amountNear: string;
}): Promise<SendResult | SendError> {
  assertBrowser();
  try {
    const conn = createConnection();
    const account = getSignerAccount({
      provider: conn.provider,
      accountId: params.implicitAccountId,
      secretKey: params.secretKey,
    });
    const r = await sendNear({ account, receiverId: params.to, amountNear: params.amountNear });
    const chain = getChain("near-testnet")!;
    return { ok: true, hash: r.txHash, explorerUrl: chain.explorerTx(r.txHash) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Send failed" };
  }
}

/* ---------------- shared helpers ---------------- */

/** Fetch balances for all core chains for the given addresses. Never throws — per-chain errors are returned inline. */
export async function fetchAllBalances(addresses: {
  evmAddress: string;
  solanaAddress: string;
  nearImplicitAccountId: string;
}): Promise<Record<string, { ok: boolean; balance?: string; symbol?: string; error?: string }>> {
  assertBrowser();
  const jobs: [string, string, string][] = [
    ["sepolia", addresses.evmAddress, ""],
    ["base-sepolia", addresses.evmAddress, ""],
    ["solana-devnet", addresses.solanaAddress, ""],
    ["near-testnet", addresses.nearImplicitAccountId, ""],
  ];
  const out: Record<string, { ok: boolean; balance?: string; symbol?: string; error?: string }> = {};
  await Promise.all(
    jobs.map(async ([chain, address]) => {
      try {
        const r = await postJson<{ ok: boolean; balance?: string; symbol?: string; error?: string }>(
          "/api/chains/balance", { chain, address }
        );
        out[chain] = r.ok
          ? { ok: true, balance: r.balance, symbol: r.symbol }
          : { ok: false, error: r.error ?? "Balance unavailable" };
      } catch (e) {
        out[chain] = { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : "Network error" };
      }
    })
  );
  return out;
}
