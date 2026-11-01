# VAULTGUARD — Self-Protecting Cross-Chain Vault

NEAR Hackathon **"Build Beyond Boundaries"** · Unstoppable DeFi track · Build window Nov 1–14, 2026.

An independent safety and recovery layer wrapped around cross-chain execution on the
**RHEA X Chain SDK** + **NEAR Intents**. Not another swap aggregator: a protocol-grade
safety layer packaged as a retail user-facing vault.

## Core flow (locked)

```
depeg detect
  → risk / slippage / fees / exit-cost calc
  → user limits + permissions check
  → safe route available ? auto-hedge to USDC via NEAR Intents
                             : pause vault + alert user
```

**NEVER blind swaps** — every conversion goes through the risk engine first.

## Repo layout

```
apps/
  web/            Next.js (TypeScript) demo UI — pre-flight report card, policy editor, guardian feed
  guardian/       Node/TS backend service (never holds user funds)
    src/
      risk-engine.ts    normalize RHEA Quote → {estimatedOut, minAmountOut, slippagePct, router, alternatives[]} + 0–100 risk score
      policy.ts         user limits + asset permissions (mirrors on-chain contract)
      oracle-monitor.ts Pyth (primary) / Chainlink (fallback) depeg detection, ±2% band, N-tick confirmation
      depeg-flow.ts     the locked 5-step depeg response flow
      rhea-client.ts    RHEA SDK client factory — JWT from env only, NEVER in frontend
    scripts/
      dry-run-quote.ts  read-only quote check (Base USDC → NEAR USDC); no build, no execution, no funds
contracts/
  vault/          NEAR smart contract (near-sdk-js): paused flag, per-tx spend cap, allowed assets
docs/             (build notes, demo script)
```

## Security

- RHEA API JWT lives at `~/workspace/vaultguard-research/.rhea_jwt` (chmod 600), exported as
  `RHEA_API_JWT` for the guardian service only. **Never in frontend code, never committed.**
- Guardian key is a single EOA for the MVP — documented centralization tradeoff; rotation
  procedure before mainnet.
- No real mainnet funds during the hackathon build: dry-run quotes + NEAR testnet only.
- Depeg pause triggers only outside the ±2% band for N consecutive ticks; stale oracle → freeze, never auto-pause.

## Build phases

1. **Kickoff (Nov 1)** — scaffold, SDK install, risk engine, dry-run quote, contract skeleton. ✅
2. Live oracle loop + policy editor UI wiring.
3. Route-guardian fallback demo (excludeDexs re-quote).
4. Contract deploy to NEAR testnet + on-chain cap enforcement demo.
5. Demo video + submission (public repo, public X demo post, form).

## Quick start

```bash
# guardian service
cd apps/guardian
export RHEA_API_JWT="$(cat ~/workspace/vaultguard-research/.rhea_jwt)"
npx ts-node scripts/dry-run-quote.ts   # read-only quote check

# web UI
cd apps/web && npm install && npm run dev
```
