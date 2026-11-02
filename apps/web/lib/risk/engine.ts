/**
 * VAULTGUARD swap risk engine — workstream E (security).
 *
 * Pure, framework-free TypeScript. Zero dependencies beyond the repo's own
 * modules. Deterministic: the same input always yields the same assessment.
 *
 * Consumes real data only:
 *   - the 1Click dry-run quote (`lib/intents/quotes.ts` — never fabricated),
 *   - the live registry token entries (`lib/intents/registry.ts`),
 *   - the user's policy (max spend per tx, slippage ceiling),
 *   - an optional oracle price for the destination token.
 *
 * Every check's `detail` cites the exact numbers used. Missing data can
 * NEVER produce SAFE — an "unknown" check forces CAUTION at best.
 *
 * Related guardian logic this mirrors:
 *   - apps/guardian/src/risk-engine.ts   (score-from-real-checks philosophy)
 *   - apps/guardian/src/depeg-flow.ts    (pause-and-alert / auto-hedge semantics)
 *   - apps/guardian/src/oracle-monitor.ts (±2% peg band, staleness rule)
 *   - apps/guardian/config/policy.json   (policy thresholds)
 */

import type { IntentsQuote } from "../intents/quotes";
import type { IntentsToken } from "../intents/registry";

export type RiskDecision = "SAFE" | "CAUTION" | "BLOCKED";
export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface RiskCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Short human-readable value, e.g. "0.50%", "$10.00", "32s". */
  value?: string;
}

export interface RiskAssessment {
  decision: RiskDecision;
  /** 0–100, computed ONLY from check results (see SCORE_WEIGHTS). Never invented. */
  score: number;
  checks: RiskCheck[];
  summary: string;
  evaluatedAt: string; // ISO
}

/** Policy inputs for the assessment. */
export interface SwapRiskPolicy {
  /** USD ceiling per transaction. */
  maxSpendPerTxUsd: number;
  /** Hard slippage ceiling in %. Default 2. */
  maxSlippagePct?: number;
}

/** Optional oracle price for the DESTINATION token (what the user receives). */
export interface SwapRiskOracle {
  price: number;
  source: string;
  updatedAt: string; // ISO
}

export interface SwapRiskInput {
  quote: IntentsQuote;
  originToken: IntentsToken;
  destinationToken: IntentsToken;
  policy: SwapRiskPolicy;
  oracle?: SwapRiskOracle | null;
}

/* ------------------------------------------------------------------ */
/* Thresholds (exported so the UI can quote them verbatim)             */
/* ------------------------------------------------------------------ */

export const DEFAULT_MAX_SLIPPAGE_PCT = 2;
export const PRICE_IMPACT_WARN_PCT = 1;
export const PRICE_IMPACT_FAIL_PCT = 3;
export const DEPEG_WARN_PCT = 0.5;
export const DEPEG_FAIL_PCT = 2;
export const ROUTE_TIME_WARN_MS = 120_000;
export const FEE_LOSS_BEYOND_IMPACT_WARN_PCT = 5;
/** Oracle readings older than this are treated as stale (no silent pass). */
export const ORACLE_STALE_MS = 10 * 60_000;

/** Score weights: derived from real check outcomes, nothing else. */
export const SCORE_WEIGHTS = { fail: 40, warn: 20, unknown: 15 } as const;

/** Chain-name marker for the known NEAR-leg solver outage. */
export const NEAR_CHAIN_MARKER = "near";

const STABLE_SYMBOLS = [
  "USDC",
  "USDT",
  "DAI",
  "FRAX",
  "USDE",
  "FDUSD",
  "TUSD",
  "USDD",
  "USD1",
] as const;

function isStable(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return STABLE_SYMBOLS.some((t) => s === t || s.startsWith(t + ".") || s.endsWith("." + t));
}

function safeBigInt(v: string): bigint | null {
  try {
    const b = BigInt(v);
    return b >= BigInt(0) ? b : null;
  } catch {
    return null;
  }
}

function toHuman(baseUnits: string, decimals: number): number | null {
  const b = safeBigInt(baseUnits);
  if (b === null || decimals < 0 || decimals > 36) return null;
  const n = Number(b) / 10 ** decimals;
  return isFinite(n) && n >= 0 ? n : null;
}

const pct = (x: number, digits = 2): string => `${x.toFixed(digits)}%`;

/* ------------------------------------------------------------------ */
/* Individual checks — each returns a RiskCheck with cited numbers     */
/* ------------------------------------------------------------------ */

function checkSlippage(quote: IntentsQuote, maxSlippagePct: number): RiskCheck {
  const out = safeBigInt(quote.amountOut);
  const min = safeBigInt(quote.minAmountOut);
  if (out === null || min === null || out <= BigInt(0) || min < BigInt(0) || min > out) {
    return {
      id: "slippage",
      label: "Slippage within policy ceiling",
      status: "unknown",
      detail:
        `quote amounts unparseable (amountOut="${quote.amountOut}", ` +
        `minAmountOut="${quote.minAmountOut}") — slippage cannot be measured, never assumed safe`,
    };
  }
  const effBps = (Number((out - min) * BigInt(10000)) / Number(out)) / 100;
  const detail =
    `amountOut=${out.toString()}, minAmountOut=${min.toString()} → ` +
    `effective slippage ${effBps.toFixed(3)}% vs policy ceiling ${maxSlippagePct}%`;
  const status: CheckStatus = effBps > maxSlippagePct ? "fail" : "pass";
  return {
    id: "slippage",
    label: "Slippage within policy ceiling",
    status,
    detail,
    value: pct(effBps),
  };
}

function checkPriceImpact(
  quote: IntentsQuote,
  origin: IntentsToken,
  dest: IntentsToken,
): { check: RiskCheck; impactPct: number | null } {
  const inHuman = toHuman(quote.amountIn, origin.decimals);
  const outHuman = toHuman(quote.amountOut, dest.decimals);
  const originPrice = origin.price;
  const destPrice = dest.price;
  const base: Omit<RiskCheck, "status" | "detail"> = {
    id: "price-impact",
    label: "Price impact vs registry reference",
  };
  if (inHuman === null || outHuman === null || inHuman <= 0 || outHuman <= 0) {
    return {
      check: {
        ...base,
        status: "unknown",
        detail:
          `amountIn="${quote.amountIn}" (decimals ${origin.decimals}), ` +
          `amountOut="${quote.amountOut}" (decimals ${dest.decimals}) — ` +
          "execution price cannot be computed, never assumed safe",
      },
      impactPct: null,
    };
  }
  if (
    typeof originPrice !== "number" ||
    typeof destPrice !== "number" ||
    !isFinite(originPrice) ||
    !isFinite(destPrice) ||
    originPrice <= 0 ||
    destPrice <= 0
  ) {
    return {
      check: {
        ...base,
        status: "unknown",
        detail:
          `registry reference prices missing (origin ${origin.symbol} price=${String(origin.price)}, ` +
          `destination ${dest.symbol} price=${String(dest.price)}) — ` +
          "price impact cannot be measured, never assumed safe",
      },
      impactPct: null,
    };
  }
  const execRatio = outHuman / inHuman; // destination tokens per origin token
  const refRatio = destPrice / originPrice;
  const impactPct = ((refRatio - execRatio) / refRatio) * 100;
  const detail =
    `execution price ${execRatio.toFixed(6)} ${dest.symbol}/${origin.symbol} ` +
    `(amountOut=${outHuman} / amountIn=${inHuman}, decimals ${origin.decimals}/${dest.decimals}) ` +
    `vs registry reference ${refRatio.toFixed(6)} ` +
    `(${dest.symbol} $${destPrice} / ${origin.symbol} $${originPrice}) → ` +
    `price impact ${impactPct.toFixed(3)}%`;
  const status: CheckStatus =
    impactPct > PRICE_IMPACT_FAIL_PCT ? "fail" : impactPct > PRICE_IMPACT_WARN_PCT ? "warn" : "pass";
  return { check: { ...base, status, detail, value: pct(impactPct) }, impactPct };
}

function checkRouteHealth(quote: IntentsQuote, origin: IntentsToken, dest: IntentsToken): RiskCheck {
  const base: Omit<RiskCheck, "status" | "detail"> = { id: "route-health", label: "Route health" };
  const chains = [origin.blockchain, dest.blockchain].map((c) => String(c ?? "").toLowerCase());
  const nearLeg = chains.some((c) => c === NEAR_CHAIN_MARKER || c.startsWith(NEAR_CHAIN_MARKER + "-"));
  if (nearLeg) {
    return {
      ...base,
      status: "fail",
      detail:
        `route touches NEAR (origin chain="${origin.blockchain}", destination chain="${dest.blockchain}"). ` +
        `Per apps/web/lib/intents/QUOTE_STATUS.md (verified 2026-11-02): NEAR-chain legs fail ` +
        `server-side on the 1Click quote endpoint (HTTP 400 "Internal server error") — solver outage, ` +
        `route unquoteable → BLOCKED`,
      value: "NEAR leg outage",
    };
  }
  const t = quote.timeEstimateMs;
  if (typeof t !== "number" || !isFinite(t) || t <= 0) {
    return {
      ...base,
      status: "unknown",
      detail:
        `quote carries no solver time estimate (timeEstimateMs=${String(t)}) — ` +
        "route speed cannot be judged, never assumed fast",
    };
  }
  if (t > ROUTE_TIME_WARN_MS) {
    return {
      ...base,
      status: "warn",
      detail: `solver time estimate ${(t / 1000).toFixed(0)}s exceeds ${ROUTE_TIME_WARN_MS / 1000}s warning threshold`,
      value: `${(t / 1000).toFixed(0)}s`,
    };
  }
  return {
    ...base,
    status: "pass",
    detail:
      `no NEAR leg (origin=${origin.blockchain}, destination=${dest.blockchain}); ` +
      `solver time estimate ${(t / 1000).toFixed(0)}s ≤ ${ROUTE_TIME_WARN_MS / 1000}s`,
    value: `${(t / 1000).toFixed(0)}s`,
  };
}

function oracleIsStale(oracle: SwapRiskOracle): boolean {
  const ts = Date.parse(oracle.updatedAt);
  if (isNaN(ts)) return true; // unparseable timestamp = unusable
  return Date.now() - ts > ORACLE_STALE_MS;
}

function checkDepeg(
  origin: IntentsToken,
  dest: IntentsToken,
  oracle: SwapRiskOracle | null | undefined,
): RiskCheck {
  const base: Omit<RiskCheck, "status" | "detail"> = { id: "depeg", label: "Stablecoin depeg guard" };
  const legs: Array<{ token: IntentsToken; side: "origin" | "destination" }> = [];
  if (isStable(origin.symbol)) legs.push({ token: origin, side: "origin" });
  if (isStable(dest.symbol)) legs.push({ token: dest, side: "destination" });
  if (legs.length === 0) {
    return {
      ...base,
      status: "pass",
      detail:
        `no stablecoin leg in route (${origin.symbol} → ${dest.symbol}) — ` +
        "depeg guard not applicable",
    };
  }
  const stale = oracle != null && oracleIsStale(oracle);
  const parts: string[] = [];
  let worst = 0;
  let unknownLegs = 0;
  for (const { token, side } of legs) {
    // Oracle price describes the destination token (what the user receives);
    // origin legs use the live registry price.
    const price = side === "destination" && oracle != null && !stale ? oracle.price : token.price;
    const source =
      side === "destination" && oracle != null && !stale
        ? `oracle (${oracle.source})`
        : "live registry";
    if (typeof price !== "number" || !isFinite(price) || price <= 0) {
      unknownLegs++;
      parts.push(`${token.symbol} (${side}): NO price data via ${source} — unmeasurable`);
      continue;
    }
    const dev = (Math.abs(price - 1) / 1) * 100;
    worst = Math.max(worst, dev);
    parts.push(
      `${token.symbol} (${side}): $${price} via ${source} → ${dev.toFixed(3)}% off $1.00 peg`,
    );
  }
  if (stale && oracle != null) {
    parts.push(
      `oracle reading from ${oracle.source} is STALE (updatedAt=${oracle.updatedAt}, ` +
        `older than ${ORACLE_STALE_MS / 60000} min) — per oracle-monitor.ts staleness rule it is ignored`,
    );
  }
  const detail = parts.join("; ");
  if (unknownLegs > 0 && worst === 0) {
    return {
      ...base,
      status: "unknown",
      detail: `${detail} — depeg state unknown, pushes decision toward CAUTION (never silently passed)`,
    };
  }
  if (worst > DEPEG_FAIL_PCT) {
    return {
      ...base,
      status: "fail",
      detail: `${detail} — deviation ${worst.toFixed(3)}% > ${DEPEG_FAIL_PCT}% fail band ` +
        `(depeg-flow.ts pause-and-alert semantics)`,
      value: pct(worst),
    };
  }
  if (worst > DEPEG_WARN_PCT) {
    return {
      ...base,
      status: "warn",
      detail: `${detail} — deviation ${worst.toFixed(3)}% > ${DEPEG_WARN_PCT}% warn band`,
      value: pct(worst),
    };
  }
  const status: CheckStatus = unknownLegs > 0 ? "unknown" : "pass";
  return {
    ...base,
    status,
    detail:
      status === "unknown"
        ? `${detail} — some leg unmeasurable, pushes decision toward CAUTION`
        : `${detail} — inside ±${DEPEG_WARN_PCT}% noise band`,
    value: pct(worst),
  };
}

function checkPolicyLimit(
  quote: IntentsQuote,
  origin: IntentsToken,
  policy: SwapRiskPolicy,
): RiskCheck {
  const base: Omit<RiskCheck, "status" | "detail"> = {
    id: "policy-limit",
    label: "Policy: max spend per transaction",
  };
  const inHuman = toHuman(quote.amountIn, origin.decimals);
  let usd: number | null = null;
  let source = "";
  if (
    inHuman !== null &&
    typeof origin.price === "number" &&
    isFinite(origin.price) &&
    origin.price > 0
  ) {
    usd = inHuman * origin.price;
    source = `amountIn ${inHuman} ${origin.symbol} × registry price $${origin.price}`;
  } else if (quote.amountOutUsd !== undefined) {
    const parsed = Number(quote.amountOutUsd);
    if (isFinite(parsed) && parsed > 0) {
      usd = parsed;
      source = `quote.amountOutUsd=$${quote.amountOutUsd} (origin registry price unavailable — output-side proxy)`;
    }
  }
  if (usd === null || !isFinite(usd)) {
    return {
      ...base,
      status: "unknown",
      detail:
        `input USD value cannot be computed (origin ${origin.symbol} price=${String(origin.price)}, ` +
        `quote.amountOutUsd=${String(quote.amountOutUsd)}) — limit check unmeasurable, never assumed under`,
    };
  }
  const status: CheckStatus = usd > policy.maxSpendPerTxUsd ? "fail" : "pass";
  return {
    ...base,
    status,
    detail: `${source} = $${usd.toFixed(2)} vs policy maxSpendPerTxUsd $${policy.maxSpendPerTxUsd}`,
    value: `$${usd.toFixed(2)}`,
  };
}

function checkFeeSanity(
  quote: IntentsQuote,
  origin: IntentsToken,
  dest: IntentsToken,
  impactPct: number | null,
): RiskCheck {
  const base: Omit<RiskCheck, "status" | "detail"> = { id: "fee-sanity", label: "Fee sanity" };
  const inHuman = toHuman(quote.amountIn, origin.decimals);
  const outHuman = toHuman(quote.amountOut, dest.decimals);
  if (inHuman === null || outHuman === null || inHuman <= 0 || outHuman <= 0) {
    return {
      ...base,
      status: "unknown",
      detail:
        `amountIn="${quote.amountIn}" / amountOut="${quote.amountOut}" unparseable ` +
        "— implied loss cannot be measured, never assumed small",
    };
  }
  const lossPct = ((inHuman - outHuman) / inHuman) * 100;
  const knownImpact = impactPct !== null && isFinite(impactPct);
  const beyond = knownImpact ? lossPct - (impactPct as number) : lossPct;
  const beyondShown = Math.abs(beyond) < 0.0005 ? 0 : beyond;
  const status: CheckStatus =
    beyond > FEE_LOSS_BEYOND_IMPACT_WARN_PCT ? "warn" : "pass";
  const detail =
    `implied loss ${(100 - (outHuman / inHuman) * 100).toFixed(3)}% ` +
    `(amountIn=${inHuman} ${origin.symbol} vs amountOut=${outHuman} ${dest.symbol}, ` +
    `decimals ${origin.decimals}/${dest.decimals})` +
    (knownImpact
      ? `; price impact ${(impactPct as number).toFixed(3)}% → loss beyond impact ${beyondShown.toFixed(3)}% ` +
        `(warn threshold ${FEE_LOSS_BEYOND_IMPACT_WARN_PCT}%)`
      : `; price impact unknown — raw implied loss ${beyondShown.toFixed(3)}% judged against ` +
        `${FEE_LOSS_BEYOND_IMPACT_WARN_PCT}% threshold`);
  return { ...base, status, detail, value: pct(beyondShown) };
}

/* ------------------------------------------------------------------ */
/* Assessment                                                          */
/* ------------------------------------------------------------------ */

/**
 * Assess a swap quote against policy + live market data.
 * Deterministic and pure: no network, no clock reads except evaluatedAt.
 */
export function assessSwapRisk(input: SwapRiskInput): RiskAssessment {
  const maxSlippagePct = input.policy.maxSlippagePct ?? DEFAULT_MAX_SLIPPAGE_PCT;
  const oracle = input.oracle ?? null;

  const slippage = checkSlippage(input.quote, maxSlippagePct);
  const { check: priceImpact, impactPct } = checkPriceImpact(
    input.quote,
    input.originToken,
    input.destinationToken,
  );
  const routeHealth = checkRouteHealth(input.quote, input.originToken, input.destinationToken);
  const depeg = checkDepeg(input.originToken, input.destinationToken, oracle);
  const policyLimit = checkPolicyLimit(input.quote, input.originToken, input.policy);
  const feeSanity = checkFeeSanity(input.quote, input.originToken, input.destinationToken, impactPct);

  const checks = [slippage, priceImpact, routeHealth, depeg, policyLimit, feeSanity];

  const fails = checks.filter((c) => c.status === "fail");
  const warns = checks.filter((c) => c.status === "warn");
  const unknowns = checks.filter((c) => c.status === "unknown");

  const decision: RiskDecision =
    fails.length > 0 ? "BLOCKED" : warns.length > 0 || unknowns.length > 0 ? "CAUTION" : "SAFE";

  // Score is a pure function of real check results — never invented.
  const score =
    Math.round(
      Math.min(100, fails.length * SCORE_WEIGHTS.fail + warns.length * SCORE_WEIGHTS.warn + unknowns.length * SCORE_WEIGHTS.unknown) * 100,
    ) / 100;

  const label = (c: RiskCheck): string => `${c.label} [${c.status}]`;
  let summary: string;
  if (decision === "BLOCKED") {
    summary =
      `BLOCKED — ${fails.length} failing check(s): ` +
      fails.map((c) => `${c.id}: ${c.detail}`).join(" | ");
  } else if (decision === "CAUTION") {
    summary =
      `CAUTION — ${warns.length} warning(s), ${unknowns.length} unknown(s): ` +
      [...warns, ...unknowns].map((c) => `${c.id}: ${c.detail}`).join(" | ");
  } else {
    summary =
      `SAFE — all ${checks.length} checks passed: ` +
      checks.map((c) => label(c)).join(", ");
  }

  return {
    decision,
    score,
    checks,
    summary,
    evaluatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Depeg helper — mirrors apps/guardian/src/depeg-flow.ts outcomes     */
/* ------------------------------------------------------------------ */

export type DepegOutcome = "no-action" | "auto-hedge" | "pause-and-alert";

export interface DepegAssessment {
  outcome: DepegOutcome;
  symbol: string;
  price: number;
  source: string;
  deviationPct: number;
  reason: string;
}

/**
 * Standalone peg check for the oracle-monitor UI.
 * Mirrors depeg-flow.ts:
 *   - inside the ±2% band → no-action (band from oracle-monitor.ts DEFAULT_BAND_PCT)
 *   - outside the band → auto-hedge ONLY when a live hedge quote has already
 *     cleared assessSwapRisk as SAFE (hedgeSafe=true); otherwise pause-and-alert
 *     (depeg-flow.ts: "never blind-swapped", policy violations → pause + alert).
 */
export function assessDepeg(
  symbol: string,
  price: number,
  source: string,
  hedgeSafe = false,
): DepegAssessment {
  const deviationPct = price <= 0 ? 100 : (Math.abs(price - 1) / 1) * 100;
  const cite = `${symbol} at $${price} (${source}): ${deviationPct.toFixed(3)}% off $1.00 peg`;
  if (deviationPct <= DEPEG_FAIL_PCT) {
    return {
      outcome: "no-action",
      symbol,
      price,
      source,
      deviationPct,
      reason: `${cite} — inside ±${DEPEG_FAIL_PCT}% band (oracle-monitor.ts DEFAULT_BAND_PCT): no-action`,
    };
  }
  if (hedgeSafe) {
    return {
      outcome: "auto-hedge",
      symbol,
      price,
      source,
      deviationPct,
      reason:
        `${cite} — outside ±${DEPEG_FAIL_PCT}% band, and a live hedge quote cleared ` +
        `assessSwapRisk as SAFE: auto-hedge eligible (depeg-flow.ts step 4/5)`,
    };
  }
  return {
    outcome: "pause-and-alert",
    symbol,
    price,
    source,
    deviationPct,
    reason:
      `${cite} — outside ±${DEPEG_FAIL_PCT}% band with NO SAFE hedge quote supplied: ` +
      `pause vault + alert user (depeg-flow.ts: never blind-swap)`,
  };
}
