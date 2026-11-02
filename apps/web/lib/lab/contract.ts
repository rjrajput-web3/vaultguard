/**
 * VAULTRY Live Testing Lab — contract view access (workstream F).
 *
 * READ-ONLY. This module calls ONLY the view method `get_status` on the
 * shared contract via a plain RPC query — no signer, no key, no admin
 * functions. The operator-only change methods (`set_paused`,
 * `set_max_spend_per_tx`) are NEVER called from the lab; they are shown
 * only as historical, honestly labeled, on-chain transactions.
 */

export const CONTRACT_ID = "vaultguard.vgdeployer.testnet";
export const CONTRACT_RPC_URL = "https://rpc.testnet.fastnear.com";
export const EXPLORER_TX = (txHash: string) =>
  `https://explorer.testnet.near.org/transactions/${txHash}`;
export const DEPLOY_GUIDE = "contracts/vault/DEPLOY.md";

export interface ContractStatus {
  paused: boolean;
  guardian: string;
  /** Smallest-unit string as returned on-chain (field name kept verbatim). */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  max_spend_per_tx: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  allowed_assets: string[];
}

export class ContractViewError extends Error {
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "ContractViewError";
    this.detail = detail;
  }
}

function b64EncodeUtf8(s: string): string {
  // Browser-safe base64 of a UTF-8 string (no Buffer in client code).
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Live `get_status` view call against the shared contract on NEAR testnet.
 * Returns the current paused flag, guardian, per-tx spend cap and allowed
 * assets — real on-chain state, read just now.
 */
export async function getContractStatus(rpcUrl: string = CONTRACT_RPC_URL): Promise<ContractStatus> {
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "vaultguard-lab-status",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: CONTRACT_ID,
          method_name: "get_status",
          args_base64: b64EncodeUtf8("{}"),
        },
      }),
    });
  } catch (e) {
    throw new ContractViewError(
      "Could not reach the NEAR testnet RPC endpoint. Check your connection and retry.",
      e instanceof Error ? e.message : String(e),
    );
  }

  let body: Record<string, any> | null = null;
  try {
    body = (await res.json()) as Record<string, any>;
  } catch {
    /* handled below */
  }
  if (!res.ok || !body) {
    throw new ContractViewError(`RPC request failed (HTTP ${res.status}).`);
  }
  if (body?.error) {
    const detail = JSON.stringify(body.error).slice(0, 300);
    throw new ContractViewError("The contract view call was rejected by the RPC node.", detail);
  }

  const resultBytes: unknown = body?.result?.result;
  if (!Array.isArray(resultBytes)) {
    throw new ContractViewError("Unexpected RPC response shape — no result bytes returned.");
  }
  let status: ContractStatus;
  try {
    const bytes = new Uint8Array(resultBytes as number[]);
    const text = new TextDecoder().decode(bytes);
    status = JSON.parse(text) as ContractStatus;
  } catch {
    throw new ContractViewError("Could not decode the contract's get_status response.");
  }
  if (typeof status?.paused !== "boolean" || typeof status?.max_spend_per_tx !== "string") {
    throw new ContractViewError("get_status returned an unexpected shape.");
  }
  return {
    paused: status.paused,
    guardian: String(status.guardian ?? ""),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    max_spend_per_tx: status.max_spend_per_tx,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    allowed_assets: Array.isArray(status.allowed_assets) ? status.allowed_assets.map(String) : [],
  };
}

/* ------------------------------------------------------------------ */
/* Phase-D historical operator transactions — display data only.        */
/*                                                                       */
/* These are the REAL transaction hashes recorded during the Phase-D    */
/* demo (see README). The lab displays them with explorer links and     */
/* the honest label "historical operator demo". The lab NEVER replays   */
/* or re-sends them — doing so would require the operator key, which    */
/* visitors never see. To run the same calls yourself, deploy your own  */
/* contract: contracts/vault/DEPLOY.md.                                  */
/* ------------------------------------------------------------------ */

export interface PhaseDTx {
  hash: string;
  title: string;
  /** What the transaction demonstrated, in plain words. */
  note: string;
}

export const PHASE_D_TXS: PhaseDTx[] = [
  {
    hash: "EEHfcL14YnABocSomyUJGNTozoBQFrLRHqinPAa2na5j",
    title: "Spend cap set (500 USDC)",
    note: "Operator set_max_spend_per_tx — the on-chain cap the enforcement tests below run against.",
  },
  {
    hash: "BLLd3UdF36pSjjotwodNcj5SZXEp4itwf96guHwZf5b1",
    title: "Spend cap lowered",
    note: "Operator lowered the cap mid-demo to show the limit tightening live.",
  },
  {
    hash: "Dq8R4nZqRoSsUYnHD2MTh4NNVjrMF9k5cRLhBJ3PcdWo",
    title: "Contract paused",
    note: "Operator set_paused(true) — all withdrawals halt until unpaused.",
  },
  {
    hash: "g6xTryWvhgtdkzTd5Nf438uvxoPXajGXow3m32fCKDK",
    title: "Withdraw rejected while paused",
    note: "request_withdraw correctly reverted because the contract was paused.",
  },
  {
    hash: "FR5g2Xm9fCK63Tj9sG91jGcTLYbpQxdGERo1Vb2nvkfB",
    title: "Contract unpaused",
    note: "Operator set_paused(false) — normal operation resumed.",
  },
  {
    hash: "Goz6hbkT5LyVdKCP7sv4SZqMJ4dE98hqRB3CaHqYgbNy",
    title: "Over-cap withdraw rejected",
    note: "request_withdraw above max_spend_per_tx reverted; a within-cap request passed.",
  },
];
