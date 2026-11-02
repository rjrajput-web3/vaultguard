/**
 * NEAR Intents live token registry — VAULTGUARD swap data layer (workstream C).
 *
 * The ONLY source of truth for supported chains and tokens is the LIVE
 * 1Click public token list (keyless, free):
 *   GET https://1click.chaindefuser.com/v0/tokens
 * Verified live 2026-11-02: HTTP 200, 210 tokens, 38 blockchains.
 *
 * Nothing here is hardcoded. If the API is unreachable, callers get a
 * thrown error — the UI must show the failure, never a stale list.
 */

const ONECLICK_BASE = "https://1click.chaindefuser.com/v0";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10-minute in-memory cache

export interface IntentsToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  contractAddress?: string;
  price?: number;
}

interface RawToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  contractAddress?: string;
  price?: number;
}

let cache: IntentsToken[] | null = null;
let cachedAt = 0;

async function fetchLive(): Promise<IntentsToken[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${ONECLICK_BASE}/tokens`, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`Intents registry unreachable: HTTP ${res.status}`);
    }
    const data = (await res.json()) as RawToken[];
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Intents registry returned an empty token list");
    }
    return data.map((t) => ({
      assetId: t.assetId,
      symbol: t.symbol,
      blockchain: t.blockchain,
      decimals: t.decimals,
      contractAddress: t.contractAddress,
      price: t.price,
    }));
  } finally {
    clearTimeout(timer);
  }
}

/** Full live token list (10-min cache). Throws when the registry is down. */
export async function getIntentsTokens(): Promise<IntentsToken[]> {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  cache = await fetchLive();
  cachedAt = Date.now();
  return cache;
}

/** Supported chains, derived ONLY from the live registry — no hardcoded list. */
export async function getSupportedChains(): Promise<string[]> {
  const tokens = await getIntentsTokens();
  return [...new Set(tokens.map((t) => t.blockchain))].sort();
}

/** All live-registry tokens on a given chain (case-insensitive chain id). */
export async function getTokensForChain(chain: string): Promise<IntentsToken[]> {
  const tokens = await getIntentsTokens();
  return tokens.filter((t) => t.blockchain.toLowerCase() === chain.toLowerCase());
}

/**
 * Resolve an assetId by symbol + chain from the live registry.
 * Throws UNSUPPORTED_ROUTE when the token is not listed — the UI shows
 * "route not supported" instead of a fabricated quote.
 */
export async function resolveAssetId(symbol: string, chain: string): Promise<IntentsToken> {
  const tokens = await getTokensForChain(chain);
  const hit = tokens.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
  if (!hit) {
    throw new QuoteError(
      "UNSUPPORTED_ROUTE",
      `${symbol} is not listed on ${chain} in the live Intents registry`,
    );
  }
  return hit;
}

export type QuoteErrorCode = "UNSUPPORTED_ROUTE" | "QUOTE_FAILED" | "REGISTRY_UNREACHABLE";

/** Typed honest errors — never fabricated data. */
export class QuoteError extends Error {
  readonly code: QuoteErrorCode;
  constructor(code: QuoteErrorCode, message: string) {
    super(message);
    this.name = "QuoteError";
    this.code = code;
  }
}
