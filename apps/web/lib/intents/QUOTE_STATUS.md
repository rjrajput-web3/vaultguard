# NEAR Intents quote + registry — live verification record

**Date:** 2026-11-02 ~15:24–15:27 IST (09:54–09:56 UTC), checked via curl from the build VM.
**Workstream C** (quotes + swap data layer). All figures below are measured, not assumed.

## What works (verified live, keyless, no account)

### 1. Live token registry — GET https://1click.chaindefuser.com/v0/tokens
- **HTTP 200 in 0.88 s**, 53,374 bytes. **210 tokens across 38 blockchains.**
- Rows carry `assetId, symbol, blockchain, decimals, contractAddress, price, priceUpdatedAt, coingeckoId`. Prices were fresh (priceUpdatedAt minutes old).
- Blockchains include: near, base, eth, sol, arb, op, pol, bsc, avax, btc, sui, aptos, gnosis, tron, ton, starknet, stellar, monad, hypercore, … (full list derived at runtime — nothing hardcoded in `lib/intents/registry.ts`).
- Token list endpoint is keyless and CORS-independent via our server proxy.

### 2. Dry-run quotes — POST https://1click.chaindefuser.com/v0/quote (dry:true)
Keyless dry-run quotes **still work** — no funds move, no deposit address created.
Real quotes received (HTTP 201):

**Base USDC → Solana USDC** (1.09 s)
```json
{
  "amountIn": "10000000",        // 10.0000 USDC in
  "amountOut": "9747875",        // 9.7479 USDC out
  "amountOutUsd": "9.7437",
  "minAmountOut": "9699135",     // 9.6991 (50 bps slippage)
  "timeEstimate": 32,            // seconds (quotes.ts exposes ms)
  "refundFee": "2400",
  "withdrawFee": "251284"
}
```

**Base USDC → ETH USDC** (0.89 s)
```json
{
  "amountIn": "10000000",        // 10.0000 USDC in
  "amountOut": "9698837",        // 9.6988 USDC out
  "amountOutUsd": "9.6947",
  "minAmountOut": "9650342",     // 9.6503
  "timeEstimate": 42
}
```

## What is NOT working (exact errors)

### NEAR-chain legs fail server-side on the 1Click quote endpoint
Every quote whose **origin OR destination is on NEAR** fails — 5 attempts, 2 amounts (1 and 10 USDC), identical result:
- Base USDC → NEAR USDC: **HTTP 400** `{"message":"Internal server error","path":"/v0/quote",...}` (4 attempts, 0.78–1.96 s)
- Base USDC → wNEAR (`nep141:wrap.near`): **HTTP 400**, same body
- NEAR USDC → Base USDC: **HTTP 400**, same body

This is a **solver-side outage for NEAR legs**, not our request shape: the identical
request shape returns HTTP 201 for Base→ETH and Base→Solana. The `/tokens` registry
still lists NEAR-chain tokens fine. `getQuote()` surfaces this as
`QUOTE_FAILED` with the API's message — the UI must show the failure, never a fake number.

### RHEA quote endpoint — not retested
- Public endpoint rechecked keyless: `GET https://api.rhea.finance/get_chain_prices?chain=8453`
  → **HTTP 200 in 2.5 s**, `{code:0, data:{…}}` with **1989 Base tokens**, each with
  `address, symbol, decimals, price` (e.g. ETH price 2286.32).
- The `/api/v2/swap/quote` endpoint requires the vault JWT — deliberately **not
  touched** per task scope. Last known state (connector doc, 2026-11-01 ~14:15 IST):
  HTTP 500 (HTML body) on every quote attempt including the docs' verbatim example,
  while token lists worked. Status after that is unverified.

### Docs note
- Official docs: `docs.near-intents.org/near-intents/integration/distribution-channels/1click-api`
  now documents API-key issuance ("Keys" section), and the one-click SDK README marks
  `getQuote` as a protected endpoint requiring JWT. **Despite that, keyless `dry:true`
  quotes demonstrably work right now** (HTTP 201 above) — the NEAR-leg 400s are
  route-specific solver failures, not auth failures (auth failures would be 401 on all routes).

## Exact assetIds (from the live registry, 2026-11-02)

| Token | 1Click assetId | blockchain | decimals |
|---|---|---|---|
| Base USDC | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` | base | 6 |
| NEAR USDC | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | near | 6 |
| Solana USDC | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` | sol | 6 |

## Measured latency (VM → API)
| Call | Time |
|---|---|
| GET /v0/tokens | 0.88 s |
| POST /v0/quote (success) | 0.89–1.09 s |
| POST /v0/quote (NEAR-leg 400) | 0.78–1.96 s |
| RHEA /get_chain_prices | 2.52 s |

## Contract for other workstreams
1. `apps/web/lib/intents/registry.ts` — `getSupportedChains()`, `getTokensForChain(chain)`, `resolveAssetId(symbol, chain)` — live registry only, 10-min cache, throws when unreachable.
2. `apps/web/lib/intents/quotes.ts` — `getQuote({...})` → `{amountIn, amountOut, minAmountOut, amountOutUsd, timeEstimateMs, expiresAt, raw}`. Throws `QuoteError("UNSUPPORTED_ROUTE" | "QUOTE_FAILED" | "REGISTRY_UNREACHABLE")` — **never fabricate**.
3. `apps/web/app/api/intents/quote/route.ts` — POST passthrough for browser CORS; no secrets.
4. **NEAR legs are currently unquoteable** — any UI flow touching NEAR must degrade gracefully until the solver recovers. EVM↔EVM and EVM→Solana are live.

## Update 2026-11-02 ~18:23 IST (coordinator re-verification)
- The 1Click solver is currently returning `"Quoting for this pair is not available"` (HTTP 400, with correlationId) for Base USDC → Solana USDC dry-run quotes with a correct request shape (verified via curl with valid Solana recipient `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, depositType ORIGIN_CHAIN, recipientType DESTINATION_CHAIN, ISO deadline). Same shape returned HTTP 201 with a real quote at 15:24 IST today → **solver-side liquidity/availability outage, not a request bug**.
- `/v0/tokens` still HTTP 200 (registry loads fine). Quote path is the only broken part.
- UI impact: swap page and lab Step 3 surface the solver's own message verbatim; Steps 4/5 refuse to run without a live quote. No code changes needed when the solver recovers.
