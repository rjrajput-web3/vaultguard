# VAULTRY — Multichain Wallet & Cross-Chain Security

> **Built as VAULTGUARD and renamed VAULTRY for public launch — the underlying
> NEAR security contract remains `vaultguard.vgdeployer.testnet`.**

**NEAR Hackathon "Build Beyond Boundaries" · Nov 1–14, 2026**
**Tracks: Unstoppable DeFi · AI Security & Defense · Privacy & Private AI**

In April 2026, a single flawed swap function drained **$18.4M** from RHEA. DeFi vaults keep dying
the same way: blind swaps, no pre-flight checks, no limits. VAULTRY is an independent
**safety and recovery layer** wrapped around cross-chain execution on the **RHEA X Chain SDK** +
**NEAR Intents** — protocol-grade protection packaged as a retail user-facing vault.

> **Never blind swaps.** Every conversion goes through the risk engine first, and the on-chain
> contract enforces user limits as the final authority — not the UI, not an off-chain server.

🎬 **Demo video:** _(YouTube link added at submission)_
🔗 **VAULTRY security contract (NEAR testnet):** `vaultguard.vgdeployer.testnet`
🌐 **Live demo:** https://vaultry.vercel.app

## The 5 features

1. **Pre-flight risk scanner** — every quote is scored 0–100 before signing: router health,
   slippage, fees, exit cost. Verdicts: SAFE / CAUTION / BLOCKED.
2. **Smart route guardian** — when the primary router degrades, the guardian falls back to a
   healthy alternative automatically and leaves a human-readable trail explaining *why* it
   switched. RHEA-first with NEAR Intents fallback — it keeps working when RHEA's quote
   endpoint is down.
3. **User-defined spending limits + asset permissions** — per-transaction and per-day caps,
   allowed assets and routers, editable in the policy UI.
4. **Depeg detection + auto vault pause** — stablecoin depeg monitor (Pyth primary, Chainlink
   fallback, ±2% band, N-tick confirmation); the guardian pauses the vault and alerts instead
   of executing into a depeg.
5. **On-chain enforcement + safe recovery** — the NEAR smart contract enforces the per-tx spend
   cap and the pause flag on-chain. Guardian pause/unpause recovery proven end-to-end.

## Proven on-chain (NEAR testnet, real transactions)

`vaultguard.vgdeployer.testnet` — 6 transactions, verdict **PASS**:

| # | Action | Result |
|---|--------|--------|
| 1 | Withdraw 500 USDC (within 1000 cap) | ✅ APPROVED — `EEHfcL14YnABocSomyUJGNTozoBQFrLRHqinPAa2na5j` |
| 2 | Withdraw 2000 USDC (over cap) | ❌ REJECTED — `VAULTGUARD: amount exceeds per-tx spend cap` |
| 3 | Guardian `set_paused(true)` | ✅ OK — `Dq8R4nZqRoSsUYnHD2MTh4NNVjrMF9k5cRLhBJ3PcdWo` |
| 4 | Withdraw 100 USDC while paused | ❌ REJECTED — `VAULTGUARD: vault is paused — guardian halt in effect` |
| 5 | Guardian `set_paused(false)` | ✅ OK — `FR5g2Xm9fCK63Tj9sG91jGcTLYbpQxdGERo1Vb2nvkfB` |
| 6 | Withdraw 100 USDC after unpause | ✅ APPROVED — `Goz6hbkT5LyVdKCP7sv4SZqMJ4dE98hqRB3CaHqYgbNy` |

Full transcript: [`docs/spending-limit-demo-transcript-2026-11-02.txt`](docs/spending-limit-demo-transcript-2026-11-02.txt).
All verifiable on the NEAR testnet explorer.

## Try it yourself (judge walkthrough)

Every step below works on the live deployment right now — do X, see Y.

### Track 1 — Unstoppable DeFi (multichain wallet + Intents swaps)

1. **Open https://vaultry.vercel.app/wallet** → create or import a NEAR testnet wallet.
   Keys are generated and encrypted client-side — they never leave your browser. Send
   NEAR and browse real on-chain history from the wallet page.
2. **Open https://vaultry.vercel.app/faucet** → fund the testnet wallet with 10 NEAR
   through the official NEAR testnet faucet flow, RPC-confirmed on the page.
3. **Open https://vaultry.vercel.app/swap** → pick Base USDC → NEAR USDC from the live
   token registry and fetch a real dry-run quote (NEAR Intents). The risk engine scores
   it SAFE / CAUTION / BLOCKED *before* anything is signed. No funds move — dry-run only.
   Honest-availability note: if the 1Click solver is temporarily down (it was on
   2026-11-02 ~18:23 IST), the page shows the solver's own message verbatim instead of
   a quote — never a fake number.
4. **Open https://vaultry.vercel.app/lab** → the Live Testing Lab runs 8 guided steps
   with per-visitor isolation: connect testnet wallet → faucet-fund → fetch a real
   quote → run the risk scanner → edit your own isolated policy → call the contract
   and verify each tx hash on the NEAR explorer.

### Track 2 — AI Security & Defense

5. **Open https://vaultry.vercel.app/security** → the detector suite scores *live* data:
   suspicious routers, abnormal slippage, implied-liquidity risk, unverified tokens,
   allowlist/denylist (editable, stored locally), and route-outage detection. The
   auto-policy engine can session-block or pause on its own verdicts — every verdict
   is computed from real inputs, failures shown verbatim.
6. **Open https://vaultry.vercel.app/policy** → set per-transaction and per-day spending
   caps plus allowed assets and routers. The NEAR smart contract enforces the cap and
   the pause flag on-chain as the final authority — not the UI.
7. **Scroll to "On-Chain Proof" on the homepage** → 6 real NEAR testnet transactions
   (table above): 500 USDC approved, 2000 USDC rejected over the cap, guardian pause,
   withdraw-while-paused rejected, unpause, 100 USDC approved — each with a clickable
   NEAR Explorer link. Nothing is mocked.

### Track 3 — Privacy & Private AI

8. **Open https://vaultry.vercel.app/privacy** → the privacy dashboard shows exactly
   what data each feature uses and where it goes; consent toggles control data sharing
   per module. Click **"Verify my privacy"** → `analyzeSwapPrivately()` runs on
   labeled sample data entirely on-device and renders the true audit trail plus the
   real local risk verdict. Wallet addresses and tx details are stripped/hashed before
   any AI request — documented minimal-data contracts, fail-closed.
9. **Click "Verify attestation"** on the same page → the app calls NEAR AI Cloud's
   public, keyless attestation endpoint and renders each check PASS / FAIL / SKIP with
   verbatim evidence. Labeled honestly as **Device-side Privacy**: it verifies *their*
   TEE evidence — our analysis does not run inside their TEE, and we never claim it does.

> **Local reproducibility:** `cd apps/guardian && npx ts-node scripts/route-guardian-demo.ts`
> attempts a real 1Click dry-run quote and prints the guardian's SAFE / CAUTION / BLOCKED
> decision trail. No funds move, no key needed. Same solver-availability note as step 3.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  VAULTRY UI (Next.js, TypeScript)            │
│  pre-flight report card · policy editor ·       │
│  guardian feed · recovery console               │
└──────────────┬──────────────────────────────────┘
               │  quotes + policy checks
┌──────────────▼──────────────────────────────────┐
│  Guardian service (Node/TS — never holds funds) │
│  risk-engine · route-guardian · policy ·        │
│  oracle-monitor · depeg-flow · rhea-client      │
└──────┬────────────────────────────┬─────────────┘
       │ RHEA X Chain SDK           │ NEAR Intents 1Click
       │ (primary, JWT from env)    │ (fallback, no key needed)
┌──────▼────────────────────────────▼─────────────┐
│  NEAR smart contract (near-sdk-js, testnet)     │
│  paused flag · per-tx spend cap · allowed assets│
│  — the final authority on every withdrawal      │
└─────────────────────────────────────────────────┘
```

## Run it locally

```bash
# 1. guardian service (RHEA JWT optional — NEAR Intents fallback works without it)
cd apps/guardian && npm install
export RHEA_API_JWT="your-rhea-jwt"   # optional
npx ts-node scripts/dry-run-quote.ts  # read-only quote check, no funds
npx ts-node scripts/route-guardian-demo.ts

# 2. web UI
cd apps/web && npm install && npm run dev
# → http://localhost:3000  (pre-flight report + policy editor at /policy)

# 3. contract (NEAR testnet only)
cd contracts/vault
npm install && npm run build          # reproducible wasm build
# deploy: see contracts/vault/DEPLOY.md (needs a funded testnet account via env)
```

No real mainnet funds anywhere in this repo: dry-run quotes + NEAR testnet only.
Secrets (RHEA JWT, deployer keys) live in env files only — never in code, never committed.

## Originality

100% original work, built Nov 1–2, 2026 for this hackathon. No templates, no tutorial
redeploys: the risk engine, route-guardian fallback logic, policy engine, depeg flow, and the
NEAR vault contract were all written for VAULTRY. Repo source matches the deployed
testnet contract.

## Two independent submissions

Per the official hackathon FAQ, one person may enter up to 2 independent projects. My second,
fully independent submission is **EscrowPact** — milestone escrow for freelancers
(contract `escrow.p2deployer.testnet`, repo `near-p2`). The two projects share no code, no
contracts, and no infrastructure; each README names the other.

## Team

Solo build — **Rohit Rajput** (Web3 researcher & developer, India).

## License

MIT — see [LICENSE](LICENSE).
