# VAULTGUARD swap risk engine — `lib/risk/`

Workstream E (security). Pure, framework-free TypeScript — no dependencies
beyond the repo's own modules. Deterministic: identical input → identical
output. No network calls, no fabricated numbers.

## Data sources (all real)

| Source | Module | Used for |
|---|---|---|
| 1Click dry-run quote (`dry:true`, keyless) | `lib/intents/quotes.ts` (`IntentsQuote`) | amounts, slippage, USD estimate, time estimate |
| Live 1Click token registry | `lib/intents/registry.ts` (`IntentsToken`) | decimals, chains, reference prices |
| User policy | caller-supplied `SwapRiskPolicy` | `maxSpendPerTxUsd`, `maxSlippagePct` |
| Optional oracle price (destination token) | caller-supplied `SwapRiskOracle` | depeg guard; stale readings ignored, never silently passed |

## API

```ts
import { assessSwapRisk, assessDepeg } from "@/lib/risk/engine";
import type { RiskAssessment } from "@/lib/risk/engine";

const assessment: RiskAssessment = assessSwapRisk({
  quote,            // IntentsQuote from getQuote()
  originToken,      // IntentsToken from resolveAssetId()
  destinationToken, // IntentsToken from resolveAssetId()
  policy: { maxSpendPerTxUsd: 1000, maxSlippagePct: 2 },
  oracle: { price: 0.9998, source: "pyth", updatedAt: "..." } | null,
});

assessment.decision; // "SAFE" | "CAUTION" | "BLOCKED"
assessment.score;    // 0–100, computed from check results only
assessment.checks;   // per-check { id, label, status, detail, value }
assessment.summary;  // human-readable reasoning
assessment.evaluatedAt; // ISO timestamp
```

## Decision table

| # | Check (`id`) | What it computes | pass | warn → CAUTION | fail → BLOCKED | unknown → CAUTION |
|---|---|---|---|---|---|---|
| 1 | `slippage` | Effective slippage = `(amountOut − minAmountOut) / amountOut` | ≤ policy max (default 2%) | — | > policy max | quote amounts unparseable |
| 2 | `price-impact` | Execution price `(amountOut/10^dec) / (amountIn/10^dec)` vs registry reference `(dest price / origin price)` | ≤ 1% | > 1% | > 3% | registry price(s) missing |
| 3 | `route-health` | NEAR-leg detection + solver time estimate | no NEAR leg, ≤ 120 s | > 120 s | **NEAR leg present** (known solver outage, see below) | no time estimate in quote |
| 4 | `depeg` | Stablecoin legs (USDC/USDT/DAI/…) price vs $1.00 (oracle preferred for destination leg, registry otherwise) | ≤ 0.5% off peg; or no stablecoin leg | > 0.5% off peg | > 2% off peg (pause-and-alert semantics) | no price data, or stale oracle |
| 5 | `policy-limit` | Input USD = `amountIn × origin registry price` (fallback: `quote.amountOutUsd`) | ≤ `maxSpendPerTxUsd` | — | > `maxSpendPerTxUsd` | USD value uncomputable |
| 6 | `fee-sanity` | Implied loss `(amountIn − amountOut)` minus price impact | ≤ 5% beyond impact | > 5% beyond impact | — | amounts unparseable |

## Decision rules

1. **Any `fail` → `BLOCKED`.** The swap must not proceed.
2. **Any `warn` or `unknown` (and no fail) → `CAUTION`.** The reason is spelled
   out in `summary`. Missing data can NEVER produce `SAFE`.
3. **All `pass` → `SAFE`.**

### Score

`score = min(100, 40 × fails + 20 × warns + 15 × unknowns)`, rounded to 2 dp.
It is a pure function of real check outcomes — never invented. `SAFE` always
scores 0; `CAUTION` scores ≥ 15; `BLOCKED` scores ≥ 40.

## Known route condition (hard-coded knowledge, verified)

Per `apps/web/lib/intents/QUOTE_STATUS.md` (verified live 2026-11-02):
NEAR-chain legs (origin OR destination) fail server-side on the 1Click quote
endpoint with **HTTP 400 "Internal server error"** — a solver outage, not a
request-shape problem. Therefore `route-health` FAILs (→ `BLOCKED`) for any
route touching NEAR and cites `QUOTE_STATUS.md` in its `detail`. Working
routes: EVM↔EVM, Base→Solana.

## Depeg helper

`assessDepeg(symbol, price, source, hedgeSafe = false)` mirrors
`apps/guardian/src/depeg-flow.ts` outcomes for the oracle-monitor UI:

| Condition | Outcome |
|---|---|
| deviation ≤ 2% (inside ±2% band) | `no-action` |
| deviation > 2% **and** `hedgeSafe === true` (a live hedge quote cleared `assessSwapRisk` as `SAFE`) | `auto-hedge` |
| deviation > 2% **and** no SAFE hedge quote | `pause-and-alert` (depeg-flow.ts: never blind-swap) |

## What this module does NOT do

- No network calls (fetching quotes/registry/oracles is the caller's job).
- No invented prices, scores, or time estimates — anything unmeasurable is
  `unknown` and pushes the decision toward `CAUTION`.
- It does not execute swaps or pause vaults; it only reports. The guardian
  (`apps/guardian/`) owns execution policy.
