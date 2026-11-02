# VAULTGUARD — Self-Protecting Cross-Chain Vault

**NEAR Hackathon "Build Beyond Boundaries" · Unstoppable DeFi track · Nov 1–14, 2026**

In April 2026, a single flawed swap function drained **$18.4M** from RHEA. DeFi vaults keep dying
the same way: blind swaps, no pre-flight checks, no limits. VAULTGUARD is an independent
**safety and recovery layer** wrapped around cross-chain execution on the **RHEA X Chain SDK** +
**NEAR Intents** — protocol-grade protection packaged as a retail user-facing vault.

> **Never blind swaps.** Every conversion goes through the risk engine first, and the on-chain
> contract enforces user limits as the final authority — not the UI, not an off-chain server.

🎬 **Demo video:** _(YouTube link added at submission)_
🔗 **Live contract (NEAR testnet):** `vaultguard.vgdeployer.testnet`

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

## Architecture

```
┌─────────────────────────────────────────────────┐
│  VAULTGUARD UI (Next.js, TypeScript)            │
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
NEAR vault contract were all written for VAULTGUARD. Repo source matches the deployed
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
