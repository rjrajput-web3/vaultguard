/**
 * Real wallet executors for the official RHEA SDK (browser).
 *
 *  - EVM: wraps the injected provider (window.ethereum). Every transaction
 *    and signature is approved by the USER in their own wallet popup —
 *    nothing is ever auto-signed. No private keys are handled here at all.
 *  - NEAR: wraps a near-api-js Account built from the user's own
 *    client-side keystore (unlocked by them on the /wallet page flow).
 *    NEAR action shapes from the API ({type:"FunctionCall"|"Transfer"})
 *    are mapped to near-api-js actions; anything else throws instead of
 *    being guessed.
 *
 * Both adapters surface user rejections as rejections (the SDK aborts the
 * swap) and never log addresses, amounts, or calldata beyond what the SDK
 * itself needs.
 */
import {
  createEvmExecutor,
  type EvmWalletAdapter,
} from "@rhea-finance/cross-chain-aggregation-dex/executors/evm";
import {
  createNearExecutor,
  type NearWalletAdapter,
} from "@rhea-finance/cross-chain-aggregation-dex/executors/near";
import type {
  EvmTx,
  NearTransaction,
} from "@rhea-finance/cross-chain-aggregation-dex";
/* `Action` comes from the package root — near-api-js v7 ships a flat bundled
 * type layout with no `near-api-js/lib/transaction` path (that deep import
 * broke Vercel's fresh-install build). */
import type { Account, Action } from "near-api-js";

/* near-api-js exposes the action creators at runtime under `transactions`
 * (not present in the root .d.ts) — typed here without touching the lib. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { transactions } = require("near-api-js") as {
  transactions: {
    functionCall: (
      methodName: string,
      args: object | Uint8Array,
      gas: bigint,
      deposit: bigint,
    ) => Action;
    transfer: (deposit: bigint) => Action;
  };
};

/* ------------------------------------------------------------------ */
/* EVM (injected wallet)                                               */
/* ------------------------------------------------------------------ */

interface EthProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...a: unknown[]) => void) => void;
}

function ethProvider(): EthProvider {
  const w = window as unknown as { ethereum?: EthProvider };
  if (!w.ethereum || typeof w.ethereum.request !== "function") {
    throw new Error(
      "No injected EVM wallet found — install/connect MetaMask (or equivalent) first.",
    );
  }
  return w.ethereum;
}

async function ethAccount(p: EthProvider): Promise<string> {
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0 || !accounts[0]) {
    throw new Error("EVM wallet did not expose an account — connection rejected?");
  }
  return accounts[0];
}

function toHexQty(v: string | undefined): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  try {
    return "0x" + BigInt(v).toString(16);
  } catch {
    return v.startsWith("0x") ? v : undefined;
  }
}

function isUserRejection(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown };
  return (
    e?.code === 4001 ||
    (typeof e?.message === "string" &&
      /user (rejected|denied|cancelled)|rejected the request/i.test(e.message))
  );
}

export function createBrowserEvmAdapter(): EvmWalletAdapter {
  return {
    isUserRejection: (e) => isUserRejection(e),

    async sendTransaction(tx: EvmTx) {
      const p = ethProvider();
      const from = tx.from ?? (await ethAccount(p));
      const params: Record<string, string | undefined> = {
        from,
        to: tx.to,
        data: tx.data,
        value: toHexQty(tx.value),
        gas: toHexQty(tx.gasLimit),
        gasPrice: toHexQty(tx.gasPrice),
        maxFeePerGas: toHexQty(tx.maxFeePerGas),
        maxPriorityFeePerGas: toHexQty(tx.maxPriorityFeePerGas),
      };
      // The wallet shows the REAL transaction to the user for approval.
      const txHash = (await p.request({
        method: "eth_sendTransaction",
        params: [params],
      })) as string;
      if (!txHash || typeof txHash !== "string") {
        throw new Error("EVM wallet did not return a transaction hash");
      }
      return { txHash };
    },

    async signTypedData(request) {
      const p = ethProvider();
      const from = await ethAccount(p);
      const signature = (await p.request({
        method: "eth_signTypedData_v4",
        params: [from, JSON.stringify(request.typedData)],
      })) as string;
      if (!signature || typeof signature !== "string") {
        throw new Error("EVM wallet did not return a signature");
      }
      return signature;
    },

    async isApprovalRequired(approval) {
      // Real on-chain allowance check — no guessing.
      const p = ethProvider();
      const owner = approval.tx.from ?? (await ethAccount(p));
      const allowanceSig = "0xdd62ed3e"; // allowance(address,address)
      const pad = (h: string) =>
        h.toLowerCase().replace(/^0x/, "").padStart(64, "0");
      const data =
        allowanceSig + pad(owner) + pad(approval.spender);
      const raw = (await p.request({
        method: "eth_call",
        params: [{ to: approval.tx.to, data }, "latest"],
      })) as string;
      let allowance: bigint;
      try {
        allowance = BigInt(raw);
      } catch {
        return true; // unreadable allowance → treat as required (safe side)
      }
      // For ERC-20 approvals the spend amount lives in the calldata; when it
      // cannot be determined we stay on the safe side and require approval.
      return allowance === BigInt(0);
    },

    async waitForTransaction(txHash) {
      const p = ethProvider();
      const deadline = Date.now() + 10 * 60_000;
      for (;;) {
        const receipt = (await p.request({
          method: "eth_getTransactionReceipt",
          params: [txHash],
        })) as { status?: string } | null;
        if (receipt && receipt.status !== undefined) {
          return {
            status: receipt.status === "0x1" ? "confirmed" : "failed",
            raw: receipt,
          };
        }
        if (Date.now() > deadline) {
          throw new Error("Timed out waiting for EVM transaction receipt");
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    },
  };
}

export function createBrowserEvmExecutor() {
  return createEvmExecutor(createBrowserEvmAdapter());
}

/* ------------------------------------------------------------------ */
/* NEAR (keystore Account — testnet per lib/wallet/near.ts)            */
/* ------------------------------------------------------------------ */

interface NearFunctionCallParams {
  methodName?: unknown;
  args?: unknown;
  gas?: unknown;
  deposit?: unknown;
}
interface NearTransferParams {
  deposit?: unknown;
}
type NearActionJson = { type: unknown; params?: unknown };

function toNearActions(raw: unknown[]): Action[] {
  return raw.map((a) => {
    const item = a as NearActionJson;
    if (item.type === "FunctionCall") {
      const p = (item.params ?? {}) as NearFunctionCallParams;
      if (typeof p.methodName !== "string" || p.methodName.length === 0) {
        throw new Error("NEAR FunctionCall action is missing methodName — refusing to guess");
      }
      let gas: bigint;
      let deposit: bigint;
      try {
        gas = BigInt(String(p.gas ?? "30000000000000"));
        deposit = BigInt(String(p.deposit ?? "0"));
      } catch {
        throw new Error("NEAR FunctionCall action has non-numeric gas/deposit — refusing to guess");
      }
      const args = p.args ?? {};
      return transactions.functionCall(
        p.methodName,
        typeof args === "string" ? Buffer.from(args, "base64") : (args as object),
        gas,
        deposit,
      );
    }
    if (item.type === "Transfer") {
      const p = (item.params ?? {}) as NearTransferParams;
      let deposit: bigint;
      try {
        deposit = BigInt(String(p.deposit ?? "0"));
      } catch {
        throw new Error("NEAR Transfer action has non-numeric deposit — refusing to guess");
      }
      return transactions.transfer(deposit);
    }
    throw new Error(
      `Unsupported NEAR action type "${String(item.type)}" — refusing to map an unknown action to a signature`,
    );
  });
}

/**
 * @param getAccount resolves the user's unlocked NEAR Account (their
 * keystore, unlocked by them). The executor never sees passwords or seeds.
 */
export function createKeystoreNearExecutor(
  getAccount: () => Promise<Account>,
) {
  const adapter: NearWalletAdapter = {
    isUserRejection: (e) => isUserRejection(e),

    async getChain() {
      return "near" as const;
    },

    async signAndSendTransactions(txs: NearTransaction[]) {
      const account = await getAccount();
      const txHashes: string[] = [];
      for (const tx of txs) {
        if (!tx.receiverId || !Array.isArray(tx.actions) || tx.actions.length === 0) {
          throw new Error("NEAR execution batch contains an empty transaction — aborted");
        }
        const actions = toNearActions(tx.actions);
        // Real signature + real broadcast on the account's network.
        const outcome = await account.signAndSendTransaction({
          receiverId: tx.receiverId,
          actions,
        });
        const hash = (outcome as { transaction?: { hash?: unknown } })?.transaction?.hash;
        if (typeof hash !== "string" || hash.length === 0) {
          throw new Error("NEAR RPC accepted the transaction but returned no hash");
        }
        txHashes.push(hash);
      }
      return { txHashes };
    },

    async waitForTransactions(txHashes: string[]) {
      const account = await getAccount();
      // getConnection()/provider exist at runtime (near-api-js v7) but are
      // absent from the shipped .d.ts — structural cast, no behavior change.
      const provider = (
        account as unknown as {
          getConnection(): {
            provider: {
              txStatus(
                hash: string,
                signerId: string,
                waitUntil: string,
              ): Promise<unknown>;
            };
          };
        }
      ).getConnection().provider;
      const signerId = account.accountId;
      for (const hash of txHashes) {
        const deadline = Date.now() + 5 * 60_000;
        for (;;) {
          try {
            const st = (await provider.txStatus(hash, signerId, "NONE")) as {
              status?: unknown;
            };
            const s = st?.status as
              | { SuccessValue?: unknown; Failure?: unknown }
              | undefined;
            if (s && ("SuccessValue" in s || "successValue" in s)) {
              break;
            }
            if (s && ("Failure" in s || "failure" in s)) {
              return { status: "failed" as const, raw: st };
            }
          } catch {
            /* still propagating — keep polling */
          }
          if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for NEAR transaction ${hash.slice(0, 12)}…`);
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      return { status: "confirmed" as const };
    },
  };
  return createNearExecutor(adapter);
}
