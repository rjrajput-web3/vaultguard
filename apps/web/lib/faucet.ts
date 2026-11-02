/**
 * VAULTGUARD — NEAR testnet faucet client.
 *
 * Verified against the live official flow on 2026-11-02 (~15:28 IST):
 *
 *   POST https://helper.testnet.near.org/account
 *   body: { "newAccountId": "<name>.testnet", "newAccountPublicKey": "ed25519:..." }
 *
 *   - No API key, no captcha, no human step. Returns HTTP 200 with the full
 *     signed transaction result JSON (same shape as RPC `broadcast_tx_commit`).
 *   - A funded account receives exactly 10 NEAR (10e24 yoctoNEAR) plus one
 *     FullAccess key for the given public key.
 *   - Duplicate account id → HTTP 200 body with
 *     `status.Failure.ActionError.kind.AccountAlreadyExists`.
 *   - Account-id rules enforced by the protocol: lowercase [a-z0-9_-],
 *     2–64 chars per label, must end in `.testnet`.
 *
 * Live proof (probe account created + verified via RPC in this session):
 *   probe1234567890.testnet → 10 NEAR confirmed at
 *   https://rpc.testnet.fastnear.com (`view_account`).
 *
 * Human-step alternatives (NOT needed for the default flow, kept as fallbacks):
 *   - https://docs.near.org/getting-started/faucet — built-in docs faucet,
 *     HUMAN STEP: user must click the "Request" button in their own browser.
 *   - https://near-faucet.io — external UI faucet (native NEAR + fungible
 *     tokens), HUMAN STEP: user fills the form in their own browser.
 */

export const FAUCET_HELPER_URL = "https://helper.testnet.near.org";
export const FAUCET_RPC_URL = "https://rpc.testnet.fastnear.com";
export const FAUCET_RPC_BACKUP_URL = "https://rpc.testnet.near.org";

/** 10 NEAR in yoctoNEAR — what the official helper grants per new account. */
export const FAUCET_GRANT_YOCTO = "10000000000000000000000000";

export type FaucetErrorCode =
  | "FAUCET_RATE_LIMITED"
  | "CAPTCHA_REQUIRED"
  | "SERVICE_DOWN"
  | "ACCOUNT_EXISTS"
  | "INVALID_ACCOUNT_ID"
  | "INVALID_PUBLIC_KEY"
  | "NETWORK_ERROR"
  | "FUNDING_TIMEOUT"
  | "UNKNOWN";

export class FaucetError extends Error {
  code: FaucetErrorCode;
  /** Raw snippet from the faucet/RPC response, for honest error display. */
  detail?: string;
  httpStatus?: number;

  constructor(code: FaucetErrorCode, message: string, opts?: { detail?: string; httpStatus?: number }) {
    super(message);
    this.name = "FaucetError";
    this.code = code;
    this.detail = opts?.detail;
    this.httpStatus = opts?.httpStatus;
  }
}

export interface CreateAccountParams {
  accountId: string; // e.g. "alice.testnet"
  publicKey: string; // e.g. "ed25519:..." — becomes a FullAccess key on the account
}

export interface CreateAccountResult {
  accountId: string;
  txHash: string;
  grantedNear: "10";
}

export interface FundingStatus {
  accountId: string;
  exists: boolean;
  balanceYocto: string | null;
  balanceNear: string | null;
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * NEAR account-id rules (protocol): full id 2–64 chars, labels separated by
 * ".", each label 2–64 chars of [a-z0-9_-]. For the faucet the id must end
 * in ".testnet".
 */
export function validateTestnetAccountId(accountId: string): { ok: true } | { ok: false; reason: string } {
  if (!accountId.endsWith(".testnet")) {
    return { ok: false, reason: 'Account ID must end with ".testnet" (e.g. alice.testnet).' };
  }
  if (accountId.length < 2 || accountId.length > 64) {
    return { ok: false, reason: "Account ID must be 2–64 characters long." };
  }
  const labels = accountId.split(".");
  const labelRe = /^[a-z0-9_-]{2,64}$/;
  for (const label of labels) {
    if (!labelRe.test(label)) {
      return {
        ok: false,
        reason: "Only lowercase letters, digits, '-' and '_' are allowed (2–64 chars per label).",
      };
    }
  }
  return { ok: true };
}

export function validatePublicKey(publicKey: string): boolean {
  // ed25519: + 44 base58 chars (32 bytes). Lenient check: scheme + plausible length.
  return /^ed25519:[1-9A-HJ-NP-Za-km-z]{40,48}$/.test(publicKey.trim());
}

/* ------------------------------------------------------------------ */
/* account creation (official helper faucet)                           */
/* ------------------------------------------------------------------ */

/** Map a helper `/account` response body to a typed result or FaucetError. */
function parseHelperResponse(
  body: unknown,
  accountId: string,
  httpStatus: number,
): CreateAccountResult {
  const b = body as Record<string, any> | null;

  if (httpStatus === 429 || (b && /rate limit|too many/i.test(JSON.stringify(b)))) {
    throw new FaucetError("FAUCET_RATE_LIMITED", "The official faucet is rate-limiting this IP right now. Wait a few minutes and retry.", {
      detail: safeStringify(b),
      httpStatus,
    });
  }
  if (httpStatus === 503 || httpStatus === 502) {
    throw new FaucetError("SERVICE_DOWN", "helper.testnet.near.org is temporarily unavailable (server error). Retry later or use the manual fallback on /faucet.", {
      detail: safeStringify(b),
      httpStatus,
    });
  }
  if (!b || typeof b !== "object") {
    throw new FaucetError("UNKNOWN", "Unexpected non-JSON response from the faucet.", {
      detail: safeStringify(body),
      httpStatus,
    });
  }

  const failureKind =
    b?.status?.Failure?.ActionError?.kind ?? b?.transaction_outcome?.outcome?.status?.Failure?.ActionError?.kind;
  if (failureKind) {
    const key = Object.keys(failureKind)[0];
    if (key === "AccountAlreadyExists") {
      throw new FaucetError("ACCOUNT_EXISTS", `The account "${accountId}" already exists on testnet. Pick another name — you cannot re-fund an existing account through this endpoint.`, {
        detail: safeStringify(failureKind),
        httpStatus,
      });
    }
    throw new FaucetError("UNKNOWN", `Faucet rejected the request (${key}).`, {
      detail: safeStringify(failureKind),
      httpStatus,
    });
  }

  const success = b?.status?.SuccessValue !== undefined || b?.final_execution_status === "EXECUTED_OPTIMISTIC";
  if (success) {
    const txHash = String(b?.transaction?.hash ?? "");
    return { accountId, txHash, grantedNear: "10" };
  }

  throw new FaucetError("UNKNOWN", "Faucet returned an unrecognized response.", {
    detail: safeStringify(b).slice(0, 500),
    httpStatus,
  });
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Create + fund a NEAR testnet account through the official helper faucet.
 *
 * Fully server-side capable: no captcha, no human step required.
 * The caller must wait for `waitForFunding` / RPC confirmation before
 * displaying any "funded" state — a 200 here only means the transaction was
 * broadcast, not that it is confirmed.
 *
 * Throws typed FaucetError (ACCOUNT_EXISTS, FAUCET_RATE_LIMITED,
 * SERVICE_DOWN, NETWORK_ERROR, UNKNOWN) — never a bare string.
 */
export async function createTestnetAccount(params: CreateAccountParams): Promise<CreateAccountResult> {
  const accountId = params.accountId.trim().toLowerCase();
  const idCheck = validateTestnetAccountId(accountId);
  if (!idCheck.ok) {
    throw new FaucetError("INVALID_ACCOUNT_ID", idCheck.reason);
  }
  if (!validatePublicKey(params.publicKey)) {
    throw new FaucetError("INVALID_PUBLIC_KEY", "Public key must look like ed25519:<44 base58 chars>.");
  }

  let res: Response;
  try {
    res = await fetch(`${FAUCET_HELPER_URL}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: params.publicKey.trim() }),
    });
  } catch (e) {
    throw new FaucetError("NETWORK_ERROR", "Could not reach helper.testnet.near.org — check your connection and retry.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body; parseHelperResponse handles it */
  }
  return parseHelperResponse(body, accountId, res.status);
}

/* ------------------------------------------------------------------ */
/* funding status via real RPC                                         */
/* ------------------------------------------------------------------ */

async function rpcViewAccount(accountId: string, rpcUrl: string): Promise<FundingStatus> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vaultguard-faucet",
      method: "query",
      params: { request_type: "view_account", account_id: accountId, finality: "final" },
    }),
  });
  const body = (await res.json()) as Record<string, any>;
  if (body?.error) {
    const cause = body.error?.cause?.name ?? "";
    if (cause === "UNKNOWN_ACCOUNT") {
      return { accountId, exists: false, balanceYocto: null, balanceNear: null };
    }
    throw new Error(`RPC error: ${safeStringify(body.error).slice(0, 200)}`);
  }
  const amount: string = String(body.result.amount);
  return {
    accountId,
    exists: true,
    balanceYocto: amount,
    balanceNear: yoctoToNear(amount),
  };
}

/**
 * Check whether an account exists and read its REAL balance from testnet RPC.
 * "funded" in the UI must come only from this function's `exists: true`
 * result — never from a faucet HTTP 200 alone.
 */
export async function getFundingStatus(accountId: string): Promise<FundingStatus> {
  const errors: string[] = [];
  for (const rpcUrl of [FAUCET_RPC_URL, FAUCET_RPC_BACKUP_URL]) {
    try {
      return await rpcViewAccount(accountId, rpcUrl);
    } catch (e) {
      errors.push(`${rpcUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new FaucetError("SERVICE_DOWN", "Both testnet RPC endpoints are unreachable right now.", {
    detail: errors.join(" | "),
  });
}

/** Convert yoctoNEAR string to a human-readable NEAR string (up to 5 decimals). */
export function yoctoToNear(yocto: string): string {
  const Y = BigInt("1000000000000000000000000");
  const v = BigInt(yocto);
  const whole = v / Y;
  const frac = (v % Y) / BigInt("100000000000000000000"); // 5 decimals
  return `${whole.toString()}.${frac.toString().padStart(5, "0")}`;
}

/**
 * Poll RPC until the account exists, then return its status.
 * Rejects with FUNDING_TIMEOUT — the account may still fund later; the
 * caller should keep retrying rather than claiming success.
 */
export async function waitForFunding(
  accountId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<FundingStatus> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const intervalMs = opts?.intervalMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getFundingStatus(accountId);
    if (status.exists) return status;
    if (Date.now() > deadline) {
      throw new FaucetError(
        "FUNDING_TIMEOUT",
        "The transaction was sent but the account is not visible on testnet RPC yet. It may still confirm — retry the balance check in a minute.",
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/* ------------------------------------------------------------------ */
/* limits + manual fallbacks                                           */
/* ------------------------------------------------------------------ */

export const FAUCET_LIMITS_NOTE =
  "The official helper faucet grants exactly 10 testnet NEAR per new account, " +
  "no captcha and no human step. IP-based rate limits apply (threshold not " +
  "publicly documented; in our live tests no limit was hit with spaced requests). " +
  "Each account can only be created once — existing accounts cannot be re-funded " +
  "through this endpoint.";

export interface ManualFaucet {
  name: string;
  url: string;
  /** The exact step that requires the user's own browser. */
  humanStep: string;
}

export const MANUAL_FAUCETS: ManualFaucet[] = [
  {
    name: "NEAR Docs built-in faucet",
    url: "https://docs.near.org/getting-started/faucet",
    humanStep: 'On the docs page, type your account ID and click the "Request" button yourself — this click cannot be done server-side.',
  },
  {
    name: "near-faucet.io (native + fungible tokens)",
    url: "https://near-faucet.io",
    humanStep:
      "Fill the Wallet Address + Amount form in your own browser and submit it yourself — the page has no public server-side API.",
  },
];

export const EXPLORER_TX_URL = (txHash: string) => `https://explorer.testnet.near.org/transactions/${txHash}`;
