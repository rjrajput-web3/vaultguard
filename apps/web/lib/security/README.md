# VAULTRY AI Security & Defense module — `lib/security/` + `app/security/`

Workstream M2 (Track 2: AI Security & Defense). Real detectors on real inputs —
zero simulated results, zero threat-intel theatre.

## Files

| File | Purpose |
|---|---|
| `lib/security/detectors.ts` | Pure-TS detectors + localStorage list helpers + automated-policy engine. Zero deps beyond repo modules; imports the risk engine, never modifies it. |
| `app/security/page.tsx` | "AI Security & Defense" module page: live detector playground, automated-policy panel, allowlist/denylist manager. |
| `app/security/api/tokens/route.ts` | Server helper: live registry token metadata for the playground (the browser cannot rely on the registry's CORS). |

## Data sources (all real)

| Source | Used for |
|---|---|
| Live 1Click dry-run quote (`dry:true`, keyless) via `POST /api/intents/quote` | amounts, slippage, USD estimate, time estimate |
| Live 1Click token registry via `GET /security/api/tokens` | decimals, chains, reference prices, registry membership |
| Guardian policy slice (`allowedRouters` from `apps/guardian/config/policy.json`) | router allowlist |
| User's own localStorage lists | allowlist / denylist counterparty checks |

## Detectors (`lib/security/detectors.ts`)

Every detector returns `{ verdict: "pass"|"warn"|"fail", detail, evidence }`.
`detail` cites the exact real numbers used. Unknown/missing data → **warn**, never pass.

| Detector | What it measures | pass | warn | fail |
|---|---|---|---|---|
| `detectSuspiciousRouter(routerId, policy, sessionQuoteHistory)` | Router against policy allowlist + session quote history | allowed router with successful-quote history this session | allowed but no session history, or no router id given | router NOT in `policy.allowedRouters` (unknown route = potential scam route) |
| `detectAbnormalSlippage(quote)` | Effective slippage = `(amountOut − minAmountOut) / amountOut` from the real quote | ≤ 100 bps | > 100 bps | > 200 bps; unparseable amounts → warn |
| `detectLiquidityRisk(quote, origin, dest)` | **Implied** liquidity risk from price impact (same math as the risk engine: execution price vs registry reference) | ≤ 1% | > 1% | > 3% |
| `detectUnverifiedToken(token, registry)` | Presence in the live registry + live USD price | listed with a price | absent from registry, or listed with no price | — (absence of data is not proof of fraud) |
| `detectRouteOutage(origin, dest)` | Known NEAR-leg solver outage (`lib/intents/QUOTE_STATUS.md`, verified 2026-11-02: HTTP 400 "Internal server error" on any NEAR leg) | no NEAR leg | — | any NEAR leg — unquoteable route |
| `detectDenylistedAddress(address, denylist)` | Exact (case-insensitive) match in the user's denylist | not listed | empty address | match → blocked counterparty |
| `checkAllowlist(address, allowlist)` | Exact match in the user's allowlist | match | not listed ("verify the counterparty yourself") | — |

`runAllDetectors(input)` runs the full suite on one live quote for the playground.

## Automated policy (`evaluateAutoPolicy`)

Takes a `RiskAssessment` (from `lib/risk/engine`), a `routeKey`, and the count of
consecutive CAUTIONs on that route (including the current one). Returns
`{ blockSwap, sessionPause, alert, reasons }`.

- **AUTO-BLOCK:** decision `BLOCKED` → `blockSwap=true` + alert.
- **AUTO-PAUSE:** two consecutive `CAUTION`s on the same route → `sessionPause=true` + alert.

Both actions are **session-level only**: they lock this browser session's swap
flow until the user reviews. This module never touches the shared on-chain
contract — there are no admin keys anywhere in it. Session pauses are labelled
exactly that in the UI ("SESSION-LEVEL PAUSE ACTIVE (not the on-chain contract)").

## The page (`app/security/page.tsx`)

- **Detector playground:** amount input → live quote Base USDC → Solana USDC
  (verified working route) via `/api/intents/quote`, runs all detectors + the
  risk engine, renders every verdict with its `detail` and expandable raw
  `evidence`. A second button, **"Test a suspicious route"**, attempts a real
  quote on Base USDC → NEAR USDC (the NEAR-leg solver outage), shows the API's
  actual `QUOTE_FAILED` error verbatim, and runs the detectors on the route's
  real registry metadata — producing the genuine `BLOCKED` verdict.
- **Automated-policy panel:** the two rules, per-route caution streaks, and the
  trigger history. Empty state reads "no triggers yet" — history is never seeded.
- **Allowlist/denylist manager:** add/remove addresses, persisted in
  `localStorage` (`vaultry.security.lists.v1`) via the helpers in `detectors.ts`.

## Honest limits (read before quoting this module)

- **"Unverified token" ≠ "proven scam."** It means only: absent from the live
  registry, or listed with no USD price. Always verify the contract address yourself.
- **Implied-liquidity risk is inferred from price impact** (execution price vs
  registry reference). This module has no order-book depth and never claims to.
- **No token creation-date data.** The module never claims to know when a token
  was created — age-based scam heuristics are not available to it.
- **No external threat-intel feeds.** Denylist/allowlist verdicts reflect only
  the user's own local lists.
- **Unknown data warns, never passes.** `SAFE` requires every measurable check to pass.
- **Quotes are dry-run** (`dry:true`): no deposit address is created, no funds can move.
