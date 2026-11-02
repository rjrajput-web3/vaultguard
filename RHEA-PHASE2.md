# RHEA X Chain SDK — Phase 2: Executable Swaps + Route Guardian Gate

**Status:** built, verified, committed `869ce1e`, pushed to main (2026-11-02).
**Phase 1:** `4917935` — SDK as the guardian's primary quote source via the authenticated bridge.

## What was built

### Guardian service (`apps/guardian/`)
- `scripts/rhea_bridge.py` — added `build` (POST `/api/v2/swap/swap`) and
  `order-status` (GET `/api/swap/order-status`) commands. The quote path is untouched.
- `src/rhea-fetch.ts` — build + order-status wired through the bridge.
  **`/api/swap/order-submit` and `/api/swap/report` are deliberately NOT wired:**
  nothing in the guardian can finalize a swap through a hidden path.
- `src/rhea-client.ts` — client config updated (quote/build/status only).
- `src/quote-loop.ts` — `resolveRheaAssets` exported for reuse.
- `scripts/rhea-phase2-verify.ts` — verification harness (see below).

### Web app (`apps/web/`) — new "RHEA executable swap" panel on `/swap`
- `app/api/rhea/quote|build|order-status/route.ts` — server-side proxies.
  `RHEA_API_KEY` is read from the **server environment only** (never
  `NEXT_PUBLIC_*`, never logged, never in responses). If the key is absent the
  routes answer `503 RHEA_NOT_CONFIGURED` and the page keeps its 1Click
  dry-run flow — nothing breaks. A `GET /api/rhea/quote` ping reveals only
  whether the key exists.
- `lib/rhea/proxy-fetch.ts` — the SDK's browser fetch: public token-list
  endpoints go direct to `api.rhea.finance`; quote/build/order-status go
  through our server proxies (key stays server-side). Report/submit paths
  throw by design.
- `lib/rhea/guardian.ts` — `checkExecutableQuote()`: revalidates the built
  quote against the user's original intent (chains, token addresses, amount,
  recipient, expiry, slippage tolerance) and scores risk. Runs inside the
  SDK's `beforeSign` hook — **after build, before any signature**.
  - `BLOCKED` → throws; the SDK aborts before the wallet is touched.
  - `CAUTION` → requires an explicit per-quote confirmation (unchecked
    checkbox + button in a modal). No pre-ticked boxes.
  - `SAFE` → flow continues to the wallet prompt.
- `lib/rhea/executors.ts` — real wallet adapters, no simulations:
  - **EVM:** injected provider (`window.ethereum`). Every tx/signature is
    approved by the user in their own wallet popup. Includes a real on-chain
    ERC-20 allowance check and receipt polling.
  - **NEAR:** the user's own client-side keystore, unlocked by them, verified
    against **mainnet** (`view_access_key`) before use. API action shapes
    (`FunctionCall`/`Transfer`) are mapped to near-api-js actions; unknown
    shapes throw instead of being guessed.
- `lib/rhea/flow.ts` — `executeRheaSwap()`: `buildSwap` once, guardian check,
  then `executeSwap` on **that exact build** (not `swap()`, which would
  re-build and could drift), with `beforeSign` re-validating at signing time.
  Settlement tracked via the real order-status endpoint.
- `app/swap/rhea-panel.tsx` — the UI: chain/token selectors from RHEA's live
  public token lists, guardian verdict display, CAUTION modal, execution log,
  explorer links, settlement status. Carries a permanent
  **"MAINNET · real funds"** banner. The 1Click dry-run section above it is
  untouched.

## Verification (all real, 2026-11-02)

### Part A — quote → guardian → build (fund-safe, no signing)
`npx ts-node scripts/rhea-phase2-verify.ts` (`RHEA_VERIFY_PART=a`):
- Quote Base USDC → Solana USDC: router **rango**, ~9.976 USDC per 10 USDC.
- Guardian: **SAFE**.
- Build: executionId `5dd7b38a-…`, `kind=evm-transaction`, `chain=8453`,
  real tx payload (`to=0x1231DEB6…`, 3210 bytes calldata). **No signing performed.**

### Part B — NEAR executor adapter (real testnet transaction)
(`RHEA_VERIFY_PART=b`, deployer key from `.env`, never printed):
- Real 0.0001 NEAR self-transfer on NEAR testnet through the SDK's
  `createNearExecutor` with our adapter contract.
- **Tx: `HTkmoDdiSBgiZJiE52pG67MtsrRykCC7Xvv2UWGPpEqV`**
  ([explorer](https://explorer.testnet.near.org/transactions/HTkmoDdiSBgiZJiE52pG67MtsrRykCC7Xvv2UWGPpEqV)) —
  `SuccessValue`, signer = receiver = `vgdeployer.testnet`.

### Security audit (2026-11-02)
- Built client bundles: **no `RHEA_API_KEY`/`RHEA_API_JWT`, no key material.**
  ("mnemonic"/"seed phrase" hits are UI labels on the wallet page.)
- Server bundles: the key exists **only** in the three `/api/rhea/*` routes.
- SDK audit: no telemetry, no fingerprinting; `serializeQuoteRequest` sends
  only chains/tokens/amount/slippage/sender/recipient. No hardcoded hosts
  (baseUrl is ours).

## Genuine limitations (not hidden)
1. **RHEA is mainnet-only** — the SDK has no testnet flows. Testnet testing of
   the RHEA execution path is impossible against their API.
2. **rango router build quirk (RHEA-side, verified 3×):** `POST /api/v2/swap/swap`
   with router=rango rejects valid EVM senders with
   `"Invalid wallet for SOLANA : 0x…"`. The **lifi** router builds fine for the
   same route. The panel surfaces the API's error verbatim; re-quoting may
   select another router, and `excludeDexs` is available.
3. **1Click solver outage for NEAR legs persists** (HTTP 400/521) — NEAR-leg
   quotes fail honestly on both paths until the solver recovers.
4. **No mainnet execution has been performed** — and none will be without his
   explicit approval. The EVM executor is code-complete + adapter-verified;
   its first live signature happens in his own wallet, by his own hand.
5. Solana as a **source** chain is not wired yet (destination works).

## rNEAR staking SDK — status
**Not pending — never in scope.** `rnear-sdk` is NEAR liquid staking, a
separate product. VAULTRY has no staking feature; the correct cross-chain
SDK (`@rhea-finance/cross-chain-aggregation-dex`) is integrated (Phase 1 +
this Phase 2). The SDK's `mca/` module is a managed cross-chain *account*
abstraction, not staking, and not relevant to swaps.

## His one step
Paste the Boss-portal RHEA API key into the **Vercel dashboard** as a
server-only env var **`RHEA_API_KEY`** (Production). The key is never typed
anywhere I can see it. Until then, the panel shows "not configured" and the
1Click dry-run keeps working.
