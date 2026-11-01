# VAULTGUARD BUILD LOG

NEAR Hackathon "Build Beyond Boundaries" · Unstoppable DeFi track · Nov 1–14, 2026.

## 2026-11-01 05:30 IST — Kickoff run (vaultguard-build-kickoff)

### Scaffolded
- `apps/guardian/` — Node/TS backend service:
  - `src/risk-engine.ts` — normalizeQuote() → {estimatedOut, minAmountOut, slippagePct, router, alternatives[]}; scoreRisk() → 0–100 (slippage 40%, fee 20%, route-redundancy 15%, route-divergence 25%); verdicts SAFE/CAUTION/BLOCKED; slippage ceiling hard-block. Typechecks clean (tsc --noEmit). Smoke-tested: good quote → SAFE (score 1.5); 8%-slippage quote → BLOCKED (score 74).
  - `src/policy.ts` — vault policy engine: paused flag, per-tx + per-day caps, allowed assets/routers; mirrors on-chain contract.
  - `src/oracle-monitor.ts` — Pyth Hermes price fetch (free, no key), ±2% band, N-tick confirmation, stale-oracle freeze (never auto-pause on stale data).
  - `src/depeg-flow.ts` — LOCKED 5-step flow: detect → risk/slippage/fees/exit-cost → limits/permissions → safe route ? auto-hedge via NEAR Intents : pause + alert. Smoke-tested all three outcomes.
  - `src/rhea-client.ts` — SwapClient factory, JWT from `RHEA_API_JWT` env only, reportMode disabled (dry-run phase).
  - `scripts/dry-run-quote.ts` — read-only Base USDC → NEAR USDC quote; resolves token addresses from SDK token lists (no hardcoding); logs quote shape only.
  - `src/index.ts`, `.env.example`, `tsconfig.json` (strict).
- `contracts/vault/` — NEAR contract skeleton in **near-sdk-js 2.0.0** (chosen: no Rust toolchain on this VM; builds fastest). `paused` flag, per-tx spend cap, allowed-assets list, guardian-only setters, `request_withdraw`/`register_deposit` enforcing all three on-chain. Typechecks clean.
- `apps/web/` — Next.js 14 + TS scaffold: layout, homepage with pre-flight risk report card, route-guardian / depeg auto-hedge / spending-limits feature cards. Carries the mandatory "Sample result — demo data" banner; live quote wiring = next phase.
- Root `package.json` (npm workspaces), `README.md`, `.gitignore`.

### RHEA SDK
- `@rhea-finance/cross-chain-aggregation-dex@2.1.9` installed from npm (verified version).
- Quote type reviewed: `Quote { route: RouteSummary, alternatives: RouteSummary[], estimatedOut, minAmountOut, buildContext, raw }`; `RouteSummary { router, market?, amountOut, minAmountOut, raw }`; slippage derived as (estimatedOut − minAmountOut)/estimatedOut. `excludeDexs[]` confirmed on QuoteRequest — the guardian-fallback mechanism.
- ApiClientConfig: `{ baseUrl, apiKey?, getAccessToken? }`; base `https://api.rhea.finance`.

### RHEA API JWT
- `~/workspace/vaultguard-research/.rhea_jwt` MISSING (checked 05:26 IST).
- Browser task dispatched 05:27 IST: sign in to boss.rhea.finance (xyzcryp0@gmail.com) → Create API Key → save JWT.
- **NEED: RHEA Boss portal sign-in** — Oct 31 session expired; no saved login exists for rhea.finance, and the browser task cannot enter credentials in this detached run. Per kickoff instructions, build continues on everything not needing the key.
- → **Rohit's one-line step:** open https://boss.rhea.finance/#/login, sign in as xyzcryp0@gmail.com, go to "My API Keys" → "Create API Key", and paste the JWT back here (or save it to ~/workspace/vaultguard-research/.rhea_jwt with chmod 600).

### API connectivity
- **NOT YET LIVE** — dry-run quote script is written and ready but requires the JWT. Run: `cd apps/guardian && RHEA_API_JWT=<jwt> npx ts-node scripts/dry-run-quote.ts`. Fallback if key stalls: NEAR Intents 1Click direct (`dry:true` quotes free, no key).

### Git
- Repo initialized at ~/workspace/vaultguard/, first commit made. **Not pushed anywhere** (repo goes public at submission time).

### Next (following runs)
1. Get JWT → run dry-run quote → confirm API live.
2. Live oracle monitor loop (Pyth USDC feed id) + policy editor UI wiring.
3. Route-guardian fallback demo (kill primary via excludeDexs → alt route, feed shows why).
4. Contract build (near-sdk-js → wasm) + deploy to NEAR testnet.
5. Spending-limit on-chain enforcement demo + failure-recovery console.
6. Demo video + submission (public repo + his X demo post + form). He posts the X demo (X automation banned); need his NEAR payout address at submission.
