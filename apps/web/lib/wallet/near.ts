/**
 * VAULTGUARD wallet core — NEAR testnet connector (near-api-js v7).
 *
 * - Keys always arrive from the caller (decrypted client-side from the
 *   local keystore). This module NEVER reads private material by itself.
 * - Read-only helpers (balance, gas price, tx history) need no key at all.
 * - Testnet only. Mainnet connections are intentionally not offered here.
 */

import {
  Account,
  JsonRpcProvider,
  KeyPairSigner,
  formatNearAmount,
  parseNearAmount,
  type KeyPairString,
} from "near-api-js";
import { parseSeedPhrase } from "near-seed-phrase";
import { validateMnemonic } from "bip39";
import { NEAR_NETWORKS, type NearNetwork } from "./network";

export const NEAR_TESTNET_RPC = "https://rpc.testnet.fastnear.com";
export const NEAR_NETWORK_ID = "testnet";
export const NEAR_EXPLORER = "https://explorer.testnet.near.org";

/* ---------------- types ---------------- */

export interface TestnetConnection {
  provider: JsonRpcProvider;
}

export interface NearBalance {
  /** raw yoctoNEAR */
  yocto: string;
  /** human-readable NEAR, e.g. "3.5" */
  near: string;
}

export interface FeeEstimate {
  gasPriceYocto: string;
  /** conservative upper bound for a plain NEAR transfer, in yocto */
  feeYoctoUpperBound: string;
  feeNearUpperBound: string;
}

export interface SendResult {
  txHash: string;
}

export interface TxRecord {
  hash: string;
  signerId: string;
  receiverId: string;
  blockTimestamp: string | null;
  kind: string;
  succeeded: boolean | null;
}

export interface TxHistoryResult {
  status: "ok" | "unavailable";
  txs: TxRecord[];
  /** human-readable reason when status === "unavailable" */
  error?: string;
}

/* ---------------- validation ---------------- */

const ACCOUNT_ID_RE = /^(([a-z\d]+[\-_])*[a-z\d]+\.)*([a-z\d]+[\-_])*[a-z\d]+$/;

export function isValidAccountId(accountId: string): boolean {
  return ACCOUNT_ID_RE.test(accountId.trim());
}

/* ---------------- connection ---------------- */

/** Open a read-only-capable NEAR connection for the given network. Stateless — no keystore. */
export function createConnection(network: NearNetwork): TestnetConnection {
  return { provider: new JsonRpcProvider({ url: NEAR_NETWORKS[network].rpcUrl }) };
}

/** Open a read-only-capable NEAR testnet connection. Stateless — no keystore. */
export function createTestnetConnection(): TestnetConnection {
  return createConnection("testnet");
}

/**
 * Verify that a public key is registered as a full-access key on an account.
 * Used at import time so a wrong phrase/key for an account fails LOUDLY
 * instead of silently importing a key that cannot sign.
 *
 * Returns { ok:true } when the key is on the account.
 * Returns { ok:false, notFound:true } when the ACCOUNT does not exist on-chain
 *   (fresh account — import is still allowed, it becomes usable once funded).
 * Returns { ok:false, error } when the account exists but the key is not on it.
 */
export async function verifyKeyOnAccount(
  provider: JsonRpcProvider,
  accountId: string,
  publicKey: string
): Promise<{ ok: true } | { ok: false; notFound?: boolean; error: string }> {
  const id = accountId.trim();
  try {
    await provider.viewAccount({ accountId: id, blockQuery: { finality: "optimistic" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist/i.test(msg)) {
      return { ok: false, notFound: true, error: "Account does not exist on-chain yet" };
    }
    return { ok: false, error: `Could not check the account on-chain: ${msg.slice(0, 120)}` };
  }
  try {
    await provider.query({
      request_type: "view_access_key",
      account_id: id,
      public_key: publicKey,
      finality: "final",
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist|unknown access key/i.test(msg)) {
      return {
        ok: false,
        error:
          "This key is NOT registered on that account — the phrase/key does not control it. Check the account ID and the recovery phrase.",
      };
    }
    return { ok: false, error: `Key verification failed: ${msg.slice(0, 120)}` };
  }
}

/**
 * Build a signing account from a raw secret key (decrypted client-side by the
 * caller). Throws a readable error when the key string is invalid.
 */
export function getSignerAccount(params: {
  provider: JsonRpcProvider;
  accountId: string;
  secretKey: string;
}): Account {
  const accountId = params.accountId.trim();
  if (!isValidAccountId(accountId)) throw new Error(`"${accountId}" is not a valid NEAR account ID`);
  let signer: KeyPairSigner;
  try {
    signer = KeyPairSigner.fromSecretKey(params.secretKey.trim() as KeyPairString);
  } catch {
    throw new Error("The stored key is not a valid NEAR secret key");
  }
  return new Account(accountId, params.provider, signer);
}

/** Convenience: signing account from a 12-word recovery phrase (decrypted client-side). */
export function getSignerAccountFromSeedPhrase(params: {
  provider: JsonRpcProvider;
  accountId: string;
  seedPhrase: string;
}): Account {
  const normalized = params.seedPhrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.split(" ").length !== 12 || !validateMnemonic(normalized)) {
    throw new Error("That is not a valid 12-word recovery phrase — check the word order and spelling");
  }
  let secretKey: string;
  try {
    secretKey = parseSeedPhrase(normalized).secretKey;
  } catch {
    throw new Error("That recovery phrase is not valid — check the word order and spelling");
  }
  return getSignerAccount({ ...params, secretKey });
}

/* ---------------- balance ---------------- */

/**
 * Live NEAR balance for any testnet account. Read-only — no key needed.
 * Throws a readable error on RPC failure; never returns a fake balance.
 */
export async function getNearBalance(
  provider: JsonRpcProvider,
  accountId: string
): Promise<NearBalance> {
  const id = accountId.trim();
  if (!isValidAccountId(id)) throw new Error(`"${id}" is not a valid NEAR account ID`);
  try {
    const view = await provider.viewAccount({ accountId: id, blockQuery: { finality: "optimistic" } });
    const yocto = String(view.amount);
    return { yocto, near: formatNearAmount(yocto) };
  } catch (e) {
    throw new Error(readableRpcError(e, "Could not fetch balance"));
  }
}

/* ---------------- fees ---------------- */

/** Real gas price from the network RPC; returns a conservative fee upper bound for a transfer. */
export async function estimateSendFee(rpcUrl: string = NEAR_TESTNET_RPC): Promise<FeeEstimate> {
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gas_price", params: [null] }),
    });
  } catch (e) {
    throw new Error(`Fee query failed: RPC unreachable (${e instanceof Error ? e.message : "network error"})`);
  }
  if (!res.ok) throw new Error(`Fee query failed: RPC responded ${res.status}`);
  const json = (await res.json()) as { result?: { gas_price?: string } };
  const gasPriceYocto = json.result?.gas_price;
  if (!gasPriceYocto) throw new Error("Fee query failed: no gas price in RPC response");
  // Plain transfers are far cheaper; 1 TGas is a safe over-estimate for the preview.
  const feeYoctoUpperBound = (BigInt(gasPriceYocto) * BigInt(1_000_000_000_000)).toString();
  return {
    gasPriceYocto,
    feeYoctoUpperBound,
    feeNearUpperBound: formatNearAmount(feeYoctoUpperBound),
  };
}

/* ---------------- send ---------------- */

export interface SendNearParams {
  account: Account;
  /** destination account ID (validated) */
  receiverId: string;
  /** decimal NEAR amount, e.g. "0.5" */
  amountNear: string;
}

/**
 * Build, sign and broadcast a real NEAR transfer on testnet.
 * Returns the real transaction hash. Throws readable errors on failure.
 */
export async function sendNear(params: SendNearParams): Promise<SendResult> {
  const receiverId = params.receiverId.trim();
  if (!isValidAccountId(receiverId)) throw new Error(`"${receiverId}" is not a valid NEAR account ID`);
  const amountNear = params.amountNear.trim();
  let yocto: bigint;
  try {
    if (!/^\d+(\.\d+)?$/.test(amountNear)) throw new Error("bad-format");
    // v7 types: parseNearAmount expects a numeric-literal string; guarded by the regex above.
    yocto = BigInt(parseNearAmount(amountNear as `${number}`));
  } catch {
    throw new Error(`"${amountNear}" is not a valid positive NEAR amount`);
  }
  if (yocto <= BigInt(0)) throw new Error(`"${amountNear}" is not a valid positive NEAR amount`);
  try {
    const outcome = await params.account.transfer({ receiverId, amount: yocto });
    return { txHash: extractTxHash(outcome) };
  } catch (e) {
    throw new Error(readableRpcError(e, "Transfer failed"));
  }
}

function extractTxHash(outcome: unknown): string {
  const o = outcome as { transaction?: { hash?: unknown } } | null | undefined;
  const hash = o?.transaction?.hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error("Transfer was accepted but the RPC returned no transaction hash");
  }
  return hash;
}

/* ---------------- transaction history (read-only) ---------------- */

/**
 * Recent transactions for an account via the NEARBlocks testnet explorer API.
 * Read-only — needs no key. Returns { status: "unavailable" } instead of
 * fake data when the explorer API is down, blocked, or changes shape.
 */
export async function getRecentTransactions(
  accountId: string,
  limit = 25,
  nearblocksApi: string = "https://testnet.nearblocks.io"
): Promise<TxHistoryResult> {
  const id = accountId.trim();
  if (!isValidAccountId(id)) throw new Error(`"${id}" is not a valid NEAR account ID`);
  const url = `${nearblocksApi}/api/v1/account/${encodeURIComponent(
    id
  )}/txns?page=1&per_page=${Math.min(Math.max(limit, 1), 100)}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      return {
        status: "unavailable",
        txs: [],
        error: `Explorer API returned ${res.status} — history temporarily unavailable`,
      };
    }
    const json = (await res.json()) as { txns?: RawNearblocksTxn[] };
    if (!Array.isArray(json.txns)) {
      return {
        status: "unavailable",
        txs: [],
        error: "Explorer API response had an unexpected shape — history temporarily unavailable",
      };
    }
    return {
      status: "ok",
      txs: json.txns.map((t) => ({
        hash: t.transaction_hash ?? "",
        signerId: t.signer_account_id ?? "",
        receiverId: t.receiver_account_id ?? "",
        blockTimestamp: t.block_timestamp ?? null,
        kind: t.actions_agg?.method ?? t.actions?.map((a) => a.action_kind).join("+") ?? "unknown",
        succeeded: typeof t.outcomes_agg?.status === "boolean" ? t.outcomes_agg.status : null,
      })),
    };
  } catch (e) {
    return {
      status: "unavailable",
      txs: [],
      error: `Could not reach the explorer API (${e instanceof Error ? e.message : "network error"})`,
    };
  }
}

interface RawNearblocksTxn {
  transaction_hash?: string;
  signer_account_id?: string;
  receiver_account_id?: string;
  block_timestamp?: string | null;
  actions?: { action_kind?: string }[];
  actions_agg?: { method?: string };
  outcomes_agg?: { status?: boolean };
}

/* ---------------- error mapping ---------------- */

function readableRpcError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/does not exist/i.test(msg)) {
    return "Account not found on NEAR testnet — check the account ID";
  }
  if (/does not have enough balance|insufficient/i.test(msg)) {
    return "Insufficient balance — amount plus the network fee exceeds what is available";
  }
  if (/does not have permission|AccessKey .* does not have|not allowed/i.test(msg)) {
    return "The imported key cannot sign for this account (wrong key or account ID)";
  }
  if (/fetch failed|Failed to fetch|network|timeout|ECONN/i.test(msg)) {
    return "Could not reach the NEAR testnet RPC — check your connection and retry";
  }
  return `${fallback}: ${msg.slice(0, 180)}`;
}
