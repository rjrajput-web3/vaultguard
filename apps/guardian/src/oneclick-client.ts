/**
 * NEAR Intents 1Click API client — VAULTGUARD's quote fallback.
 *
 * RHEA is the primary quote source. When RHEA's quote endpoint is
 * unreachable/failing, the guardian falls back to 1Click dry-run quotes
 * (no key needed for dry:true, no funds ever move).
 *
 * Docs: https://github.com/defuse-protocol/one-click-sdk-typescript
 *   (endpoint shapes verified live 2026-11-01 against
 *   https://1click.chaindefuser.com/v0)
 */

const ONECLICK_BASE = "https://1click.chaindefuser.com/v0";

export interface OneClickToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price?: number;
  contractAddress?: string;
}

export interface OneClickQuoteParams {
  originAsset: string; // 1Click assetId, e.g. nep141:base-0x...omft.near
  destinationAsset: string; // 1Click assetId
  amount: string; // base units, EXACT_INPUT
  slippageBps?: number; // default 50
  /** Dry-run placeholder recipient — must be a valid account on the destination chain. No funds move on dry runs. */
  recipient: string;
  /** Refund address on the origin chain (EVM address for EVM origins). Dry-run only. */
  refundTo: string;
  timeoutMs?: number;
}

export interface OneClickQuote {
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  amountOutUsd?: string;
  timeEstimate?: number;
}

interface OneClickQuoteResponse {
  quote: OneClickQuote;
  quoteRequest: Record<string, unknown>;
  signature: string;
  timestamp: string;
}

let tokenCache: OneClickToken[] | null = null;
let tokenCacheAt = 0;
const TOKEN_CACHE_TTL_MS = 10 * 60 * 1000;

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

/** Public token list (no auth). Cached for 10 minutes. */
export async function fetchOneClickTokens(timeoutMs = 30000): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCacheAt < TOKEN_CACHE_TTL_MS) return tokenCache;
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetch(`${ONECLICK_BASE}/tokens`, { signal });
    if (!res.ok) throw new Error(`1Click tokens HTTP ${res.status}`);
    const data = (await res.json()) as OneClickToken[];
    if (!Array.isArray(data) || data.length === 0) throw new Error("1Click tokens: empty list");
    tokenCache = data;
    tokenCacheAt = Date.now();
    return data;
  } finally {
    done();
  }
}

/** Resolve a 1Click assetId by symbol + blockchain (case-insensitive). No hardcoding. */
export async function resolveOneClickAsset(
  symbol: string,
  blockchain: string,
  timeoutMs = 30000,
): Promise<OneClickToken> {
  const tokens = await fetchOneClickTokens(timeoutMs);
  const hit = tokens.find(
    (t) =>
      t.symbol.toUpperCase() === symbol.toUpperCase() &&
      t.blockchain.toLowerCase() === blockchain.toLowerCase(),
  );
  if (!hit) throw new Error(`1Click: ${symbol} not found on ${blockchain}`);
  return hit;
}

/**
 * Dry-run quote. Read-only: dry:true never creates a deposit address and no
 * funds can move. Throws on HTTP errors, validation errors, or timeout.
 */
export async function fetchOneClickQuote(params: OneClickQuoteParams): Promise<OneClickQuote> {
  const timeoutMs = params.timeoutMs ?? 60000;
  const { signal, done } = withTimeout(timeoutMs);
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: params.slippageBps ?? 50,
    originAsset: params.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    refundTo: params.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: params.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline,
  };
  try {
    const res = await fetch(`${ONECLICK_BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = (await res.json()) as OneClickQuoteResponse & { message?: string };
    if (!res.ok || !data.quote) {
      throw new Error(`1Click quote failed: HTTP ${res.status} ${data.message ?? "no quote"}`);
    }
    return data.quote;
  } finally {
    done();
  }
}
