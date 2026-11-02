/**
 * NEAR Intents dry-run quote layer — VAULTGUARD swap data layer (workstream C).
 *
 * Uses the keyless 1Click dry-run endpoint (free, no account):
 *   POST https://1click.chaindefuser.com/v0/quote   (dry:true)
 * Verified live 2026-11-02. dry:true never creates a deposit address —
 * no funds can move. Any failure throws a typed QuoteError; the UI shows
 * the failure verbatim. Quotes are NEVER fabricated.
 *
 * Measured 2026-11-02: NEAR-chain legs (origin OR destination) fail
 * server-side (HTTP 400 "Internal server error"); EVM<->EVM and
 * Base->Solana return real quotes (HTTP 201). See QUOTE_STATUS.md.
 */

import { QuoteError, getIntentsTokens } from "./registry";

export { QuoteError };
export type { QuoteErrorCode } from "./registry";

const ONECLICK_BASE = "https://1click.chaindefuser.com/v0";

export interface QuoteParams {
  /** 1Click assetId, e.g. from the live registry (resolveAssetId) */
  originAssetId: string;
  destinationAssetId: string;
  /** Exact input in base units (string, e.g. "10000000" for 10 USDC) */
  amountBaseUnits: string;
  slippageBps?: number;
  /** Valid account on the DESTINATION chain. No funds move on dry runs. */
  recipient: string;
  /** Refund address on the ORIGIN chain (EVM address for EVM origins) */
  refundTo: string;
  timeoutMs?: number;
}

export interface IntentsQuote {
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  amountOutUsd?: string;
  /** Solver time estimate in ms (API returns seconds — converted here) */
  timeEstimateMs: number;
  expiresAt: string; // ISO deadline sent with the request
  raw: unknown; // full API payload for debugging
}

interface ApiQuote {
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  amountOutUsd?: string;
  timeEstimate?: number;
}

async function assertAssetListed(assetId: string): Promise<void> {
  const tokens = await getIntentsTokens();
  const hit = tokens.some((t) => t.assetId === assetId);
  if (!hit) {
    throw new QuoteError("UNSUPPORTED_ROUTE", `assetId not in live registry: ${assetId}`);
  }
}

/**
 * Dry-run quote. Read-only. Throws QuoteError:
 *  - UNSUPPORTED_ROUTE when an assetId is not in the live registry
 *  - QUOTE_FAILED with the API's own message when the solver rejects it
 */
export async function getQuote(params: QuoteParams): Promise<IntentsQuote> {
  await assertAssetListed(params.originAssetId);
  await assertAssetListed(params.destinationAssetId);

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: params.slippageBps ?? 50,
    originAsset: params.originAssetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: params.destinationAssetId,
    amount: params.amountBaseUnits,
    refundTo: params.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: params.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: expiresAt,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), params.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(`${ONECLICK_BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new QuoteError(
      "QUOTE_FAILED",
      `quote request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearTimeout(timer);

  let data: { quote?: ApiQuote; message?: string } | null = null;
  try {
    data = (await res.json()) as { quote?: ApiQuote; message?: string };
  } catch {
    // non-JSON error body
  }

  if (!res.ok || !data?.quote) {
    const apiMsg =
      data?.message ??
      (res.status === 400
        ? "solver internal error (observed on NEAR-chain legs 2026-11-02)"
        : `HTTP ${res.status}`);
    throw new QuoteError("QUOTE_FAILED", `1Click quote failed: ${apiMsg}`);
  }

  const q = data.quote;
  return {
    amountIn: q.amountIn,
    amountOut: q.amountOut,
    minAmountOut: q.minAmountOut,
    amountOutUsd: q.amountOutUsd,
    timeEstimateMs: (q.timeEstimate ?? 0) * 1000,
    expiresAt,
    raw: data,
  };
}
