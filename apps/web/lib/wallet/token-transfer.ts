/**
 * NEP-141 token transfer on NEAR testnet (near-api-js v7).
 *
 * Used by the TidePool testnet swap: the user funds the intent's deposit
 * address with an ft_transfer of the exact test-token amount. Keys arrive
 * from the caller (decrypted client-side from the local keystore) — this
 * module never reads private material itself, and nothing here leaves the
 * device except the signed transaction broadcast to the testnet RPC.
 */

import type { Account } from "near-api-js";
import { isValidAccountId } from "./near";

export interface TokenTransferParams {
  account: Account;
  /** NEP-141 token contract, e.g. usdc.tidepool-sandbox.testnet */
  tokenContractId: string;
  /** deposit / receiver account */
  receiverId: string;
  /** amount in the token's base units (exact string) */
  amountBaseUnits: string;
  /** optional memo */
  memo?: string;
}

export interface TokenTransferResult {
  txHash: string;
}

function extractTxHash(outcome: unknown): string {
  const o = outcome as { transaction?: { hash?: unknown } } | null | undefined;
  const hash = o?.transaction?.hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error("Transfer was accepted but the RPC returned no transaction hash");
  }
  return hash;
}

/**
 * Build, sign and broadcast a real NEP-141 ft_transfer on testnet.
 * Returns the real transaction hash. Throws readable errors on failure.
 */
export async function transferToken(params: TokenTransferParams): Promise<TokenTransferResult> {
  const tokenContractId = params.tokenContractId.trim().toLowerCase();
  if (!isValidAccountId(tokenContractId))
    throw new Error(`"${params.tokenContractId}" is not a valid token contract`);
  const receiverId = params.receiverId.trim();
  // Deposit addresses are 64-hex implicit accounts — valid receivers.
  if (!isValidAccountId(receiverId) && !/^[0-9a-f]{64}$/.test(receiverId.toLowerCase()))
    throw new Error(`"${params.receiverId}" is not a valid receiver`);
  let amount: bigint;
  try {
    amount = BigInt(params.amountBaseUnits);
  } catch {
    throw new Error("token amount must be an integer number of base units");
  }
  if (amount <= BigInt(0)) throw new Error("token amount must be greater than zero");

  try {
    const outcome = await params.account.callFunctionRaw({
      contractId: tokenContractId,
      methodName: "ft_transfer",
      args: {
        receiver_id: receiverId,
        amount: amount.toString(),
        memo: params.memo ?? "VAULTRY TidePool testnet intent deposit",
      },
      gas: BigInt("100000000000000"), // 100 TGas
      deposit: BigInt("1"), // NEP-141 requires exactly 1 yocto attached
    });
    return { txHash: extractTxHash(outcome) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Token transfer failed: ${msg}`);
  }
}
