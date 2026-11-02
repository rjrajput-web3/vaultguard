/**
 * VAULTRY AI Security & Defense module — workstream M2.
 *
 * Real detectors on real inputs. Pure, framework-free TypeScript; zero
 * dependencies beyond the repo's own modules (imports the risk engine,
 * never modifies it).
 *
 * Honesty contract (enforced in every detector):
 *   - every verdict cites the exact real numbers used;
 *   - unknown/missing data → warn (never pass);
 *   - no threat-intel feeds, no creation dates, no order-book depth claims;
 *   - "unverified token" means "absent from the live verified registry",
 *     NOT "proven scam";
 *   - the automated policy can only block the session UI flow and pause
 *     session-level trading — it can NEVER touch the shared on-chain
 *     contract or its admin keys.
 */

import type { IntentsQuote } from "../intents/quotes";
import type { IntentsToken } from "../intents/registry";
import type { RiskAssessment } from "../risk/engine";
import { PRICE_IMPACT_WARN_PCT, PRICE_IMPACT_FAIL_PCT } from "../risk/engine";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DetectorVerdict = "pass" | "warn" | "fail";

export interface DetectorResult {
  id: string;
  label: string;
  verdict: DetectorVerdict;
  /** Human-readable reasoning citing the exact numbers used. */
  detail: string;
  /** The raw real inputs the verdict was derived from. */
  evidence: Record<string, unknown>;
}

/** Policy slice consumed by the detectors (subset of apps/guardian/config/policy.json). */
export interface DetectorPolicy {
  /** Router ids the guardian policy explicitly allows (e.g. ["nearintents","lifi","1inch","rango"]). */
  allowedRouters: string[];
}

/** Abnormal-slippage thresholds (bps). Exported so the UI can quote them verbatim. */
export const SLIPPAGE_WARN_BPS = 100;
export const SLIPPAGE_FAIL_BPS = 200;

/** NEAR-chain marker — the known 1Click solver outage (see lib/intents/QUOTE_STATUS.md). */
export const NEAR_CHAIN_MARKER = "near";

const norm = (s: string): string => String(s ?? "").trim().toLowerCase();

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

function touchesNear(tokens: Array<IntentsToken | null | undefined>): boolean {
  return tokens.some((t) => {
    const c = norm(t?.blockchain ?? "");
    return c === NEAR_CHAIN_MARKER || c.startsWith(NEAR_CHAIN_MARKER + "-");
  });
}

/* ------------------------------------------------------------------ */
/* Detector 1 — suspicious router                                      */
/* ------------------------------------------------------------------ */

/**
 * fail: router is NOT in policy.allowedRouters → unknown route = potential scam route.
 * warn: router is allowed but has no successful-quote history in this session.
 * pass: allowed router with a quote history this session.
 */
export function detectSuspiciousRouter(
  routerId: string,
  policy: DetectorPolicy,
  sessionQuoteHistory: string[] = [],
): DetectorResult {
  const id = norm(routerId);
  const allowed = (policy.allowedRouters ?? []).map(norm);
  if (!id) {
    return {
      id: "suspicious-router",
      label: "Router allowlist check",
      verdict: "warn",
      detail: "no router id was provided — an unnamed routing path cannot be trusted, warn by default",
      evidence: { routerId },
    };
  }
  if (!allowed.includes(id)) {
    return {
      id: "suspicious-router",
      label: "Router allowlist check",
      verdict: "fail",
      detail:
        `router "${routerId}" is NOT in the guardian policy's allowedRouters ` +
        `(${JSON.stringify(policy.allowedRouters ?? [])}) — unknown routing path, potential scam route → FAIL`,
      evidence: { routerId, allowedRouters: policy.allowedRouters ?? [] },
    };
  }
  const seen = sessionQuoteHistory.map(norm).includes(id);
  if (!seen) {
    return {
      id: "suspicious-router",
      label: "Router allowlist check",
      verdict: "warn",
      detail:
        `router "${routerId}" is policy-allowed but has NO successful-quote history in this session ` +
        `(history: ${JSON.stringify(sessionQuoteHistory)}) — unproven path, warn`,
      evidence: { routerId, allowedRouters: policy.allowedRouters ?? [], sessionQuoteHistory },
    };
  }
  return {
    id: "suspicious-router",
    label: "Router allowlist check",
    verdict: "pass",
    detail:
      `router "${routerId}" is in allowedRouters and has successful-quote history this session ` +
      `(${sessionQuoteHistory.filter((h) => norm(h) === id).length} successful quote(s))`,
    evidence: { routerId, allowedRouters: policy.allowedRouters ?? [], sessionQuoteHistory },
  };
}

/* ------------------------------------------------------------------ */
/* Detector 2 — abnormal slippage                                      */
/* ------------------------------------------------------------------ */

/**
 * Effective slippage (bps) = (amountOut − minAmountOut) / amountOut × 10000,
 * computed from the real quote's amounts.
 * fail > 200 bps, warn > 100 bps. Unparseable amounts → warn (never pass).
 */
export function detectAbnormalSlippage(quote: IntentsQuote): DetectorResult {
  const out = safeBigInt(quote.amountOut);
  const min = safeBigInt(quote.minAmountOut);
  if (out === null || min === null || out <= BigInt(0) || min < BigInt(0) || min > out) {
    return {
      id: "abnormal-slippage",
      label: "Abnormal slippage",
      verdict: "warn",
      detail:
        `quote amounts unparseable (amountOut="${quote.amountOut}", minAmountOut="${quote.minAmountOut}") — ` +
        "slippage cannot be measured, never assumed safe",
      evidence: { amountOut: quote.amountOut, minAmountOut: quote.minAmountOut },
    };
  }
  const bps = (Number(out - min) / Number(out)) * 10000;
  const detail =
    `effective slippage ${bps.toFixed(2)} bps ` +
    `(amountOut=${out.toString()}, minAmountOut=${min.toString()}) ` +
    `vs warn > ${SLIPPAGE_WARN_BPS} bps / fail > ${SLIPPAGE_FAIL_BPS} bps`;
  if (bps > SLIPPAGE_FAIL_BPS) {
    return {
      id: "abnormal-slippage",
      label: "Abnormal slippage",
      verdict: "fail",
      detail: `${detail} — extreme slippage, quote is exploitable or the route is broken`,
      evidence: { amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, slippageBps: bps },
    };
  }
  if (bps > SLIPPAGE_WARN_BPS) {
    return {
      id: "abnormal-slippage",
      label: "Abnormal slippage",
      verdict: "warn",
      detail: `${detail} — elevated slippage`,
      evidence: { amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, slippageBps: bps },
    };
  }
  return {
    id: "abnormal-slippage",
    label: "Abnormal slippage",
    verdict: "pass",
    detail,
    evidence: { amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, slippageBps: bps },
  };
}

/* ------------------------------------------------------------------ */
/* Detector 3 — implied-liquidity risk (from price impact)             */
/* ------------------------------------------------------------------ */

/**
 * Same math as the risk engine's price-impact check: execution price
 * (amountOut/amountIn) vs registry reference (destPrice/originPrice).
 * warn > 1%, fail > 3%. This is IMPLIED liquidity risk from price impact —
 * the module does NOT have order-book depth and never claims to.
 */
export function detectLiquidityRisk(
  quote: IntentsQuote,
  originToken: IntentsToken,
  destinationToken: IntentsToken,
): DetectorResult {
  const base: Omit<DetectorResult, "verdict" | "detail"> = {
    id: "liquidity-risk",
    label: "Implied-liquidity risk (from price impact)",
    evidence: {
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      originSymbol: originToken.symbol,
      originDecimals: originToken.decimals,
      originPrice: originToken.price,
      destinationSymbol: destinationToken.symbol,
      destinationDecimals: destinationToken.decimals,
      destinationPrice: destinationToken.price,
    },
  };
  const inHuman = toHuman(quote.amountIn, originToken.decimals);
  const outHuman = toHuman(quote.amountOut, destinationToken.decimals);
  const originPrice = originToken.price;
  const destPrice = destinationToken.price;
  if (inHuman === null || outHuman === null || inHuman <= 0 || outHuman <= 0) {
    return {
      ...base,
      verdict: "warn",
      detail:
        `amounts unparseable (amountIn="${quote.amountIn}", amountOut="${quote.amountOut}") — ` +
        "execution price cannot be computed, never assumed liquid",
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
      ...base,
      verdict: "warn",
      detail:
        `registry reference prices missing (origin ${originToken.symbol} price=${String(originPrice)}, ` +
        `destination ${destinationToken.symbol} price=${String(destPrice)}) — ` +
        "price impact cannot be measured, never assumed liquid",
    };
  }
  const execRatio = outHuman / inHuman;
  const refRatio = destPrice / originPrice;
  const impactPct = ((refRatio - execRatio) / refRatio) * 100;
  const detail =
    `execution price ${execRatio.toFixed(6)} ${destinationToken.symbol}/${originToken.symbol} ` +
    `vs registry reference ${refRatio.toFixed(6)} → implied price impact ${impactPct.toFixed(3)}% ` +
    `(warn > ${PRICE_IMPACT_WARN_PCT}%, fail > ${PRICE_IMPACT_FAIL_PCT}%) — ` +
    "an impact this large implies thin liquidity on the executed route; order-book depth is not available to this module";
  if (impactPct > PRICE_IMPACT_FAIL_PCT) {
    return { ...base, verdict: "fail", detail, evidence: { ...base.evidence, impactPct } };
  }
  if (impactPct > PRICE_IMPACT_WARN_PCT) {
    return { ...base, verdict: "warn", detail, evidence: { ...base.evidence, impactPct } };
  }
  return { ...base, verdict: "pass", detail, evidence: { ...base.evidence, impactPct } };
}

/* ------------------------------------------------------------------ */
/* Detector 4 — unverified token                                       */
/* ------------------------------------------------------------------ */

/**
 * warn: token absent from the live registry OR has no USD price there.
 * pass: present with a price. Verdict language: "not in the verified
 * registry — treat as unverified, verify the contract address yourself".
 * This module has NO token creation-date data and NEVER claims to know it.
 * "Unverified" ≠ "proven scam".
 */
export function detectUnverifiedToken(
  token: IntentsToken,
  registry: IntentsToken[],
): DetectorResult {
  const hit = registry.find(
    (t) => t.assetId === token.assetId || (norm(t.symbol) === norm(token.symbol) && norm(t.blockchain) === norm(token.blockchain)),
  );
  const evidence: Record<string, unknown> = {
    assetId: token.assetId,
    symbol: token.symbol,
    blockchain: token.blockchain,
    contractAddress: token.contractAddress ?? null,
    registryMatch: hit != null,
  };
  if (!hit) {
    return {
      id: "unverified-token",
      label: "Token registry verification",
      verdict: "warn",
      detail:
        `${token.symbol} (${token.blockchain}, assetId="${token.assetId}") is NOT in the live ` +
        "verified registry — treat as UNVERIFIED. Verify the contract address yourself before trusting it. " +
        "Note: unverified ≠ proven scam, and this module has no token-creation-date data.",
      evidence,
    };
  }
  if (typeof hit.price !== "number" || !isFinite(hit.price) || hit.price <= 0) {
    return {
      id: "unverified-token",
      label: "Token registry verification",
      verdict: "warn",
      detail:
        `${token.symbol} (${token.blockchain}) is listed in the live registry but has NO USD price ` +
        `(price=${String(hit.price)}) — unpriced tokens cannot be value-checked, treat as unverified until a price appears`,
      evidence: { ...evidence, registryPrice: hit.price },
    };
  }
  return {
    id: "unverified-token",
    label: "Token registry verification",
    verdict: "pass",
    detail:
      `${token.symbol} (${token.blockchain}) is in the live verified registry ` +
      `(assetId="${token.assetId}", contractAddress="${token.contractAddress ?? "n/a"}") ` +
      `with a live USD price of $${hit.price} — verified listing`,
    evidence: { ...evidence, registryPrice: hit.price },
  };
}

/* ------------------------------------------------------------------ */
/* Detector 5 — route outage (NEAR-leg solver outage)                  */
/* ------------------------------------------------------------------ */

/**
 * fail: route touches NEAR on either leg. Per apps/web/lib/intents/QUOTE_STATUS.md
 * (verified live 2026-11-02), NEAR-chain legs fail server-side on the 1Click
 * quote endpoint (HTTP 400 "Internal server error") — a solver outage, not a
 * request-shape problem. A route that cannot be quoted cannot be executed.
 */
export function detectRouteOutage(
  originToken: IntentsToken,
  destinationToken: IntentsToken,
): DetectorResult {
  const near = touchesNear([originToken, destinationToken]);
  const evidence = {
    originChain: originToken.blockchain,
    destinationChain: destinationToken.blockchain,
  };
  if (near) {
    return {
      id: "route-outage",
      label: "Route outage check",
      verdict: "fail",
      detail:
        `route touches NEAR (origin="${originToken.blockchain}", destination="${destinationToken.blockchain}"). ` +
        `Per lib/intents/QUOTE_STATUS.md (verified 2026-11-02): NEAR-chain legs fail server-side on the ` +
        `1Click quote endpoint (HTTP 400 "Internal server error") — solver outage, route unquoteable → FAIL`,
      evidence,
    };
  }
  return {
    id: "route-outage",
    label: "Route outage check",
    verdict: "pass",
    detail:
      `no NEAR leg (origin="${originToken.blockchain}", destination="${destinationToken.blockchain}") — ` +
      "not affected by the known NEAR-leg solver outage",
    evidence,
  };
}

/* ------------------------------------------------------------------ */
/* Detectors 6/7 — denylist / allowlist (user-managed)                 */
/* ------------------------------------------------------------------ */

/** fail: exact (case-insensitive) match in the user's denylist → blocked counterparty. */
export function detectDenylistedAddress(address: string, denylist: string[]): DetectorResult {
  const a = norm(address);
  const hit = (denylist ?? []).some((d) => norm(d) === a && a.length > 0);
  const evidence = { address, denylistSize: (denylist ?? []).length };
  if (!a) {
    return {
      id: "denylisted-address",
      label: "Denylist check",
      verdict: "warn",
      detail: "no address was provided — cannot screen an empty counterparty, warn",
      evidence,
    };
  }
  if (hit) {
    return {
      id: "denylisted-address",
      label: "Denylist check",
      verdict: "fail",
      detail: `address "${address}" is on YOUR denylist (${(denylist ?? []).length} entr(y/ies)) — blocked counterparty → FAIL`,
      evidence,
    };
  }
  return {
    id: "denylisted-address",
    label: "Denylist check",
    verdict: "pass",
    detail: `address "${address}" is not on your denylist (${(denylist ?? []).length} entr(y/ies)) — not denylisted`,
    evidence,
  };
}

/**
 * pass: exact match in the allowlist. warn: not on it ("not allowlisted — verify
 * the counterparty yourself"). Absence from the allowlist is NOT evidence of fraud.
 */
export function checkAllowlist(address: string, allowlist: string[]): DetectorResult {
  const a = norm(address);
  const hit = (allowlist ?? []).some((x) => norm(x) === a && a.length > 0);
  const evidence = { address, allowlistSize: (allowlist ?? []).length };
  if (!a) {
    return {
      id: "allowlist",
      label: "Allowlist check",
      verdict: "warn",
      detail: "no address was provided — cannot match an empty counterparty against the allowlist, warn",
      evidence,
    };
  }
  if (hit) {
    return {
      id: "allowlist",
      label: "Allowlist check",
      verdict: "pass",
      detail: `address "${address}" is on your allowlist — trusted counterparty`,
      evidence,
    };
  }
  return {
    id: "allowlist",
    label: "Allowlist check",
    verdict: "warn",
    detail:
      `address "${address}" is NOT on your allowlist (${(allowlist ?? []).length} entr(y/ies)) — ` +
      "verify the counterparty yourself before proceeding. Not allowlisted ≠ fraudulent.",
    evidence,
  };
}

/* ------------------------------------------------------------------ */
/* localStorage-backed user lists                                      */
/* ------------------------------------------------------------------ */

const LISTS_KEY = "vaultry.security.lists.v1";

export interface AddressLists {
  allowlist: string[];
  denylist: string[];
}

const emptyLists = (): AddressLists => ({ allowlist: [], denylist: [] });

/** Load the user's allowlist/denylist. Never throws; empty lists on the server or bad data. */
export function loadLists(): AddressLists {
  if (typeof window === "undefined") return emptyLists();
  try {
    const raw = window.localStorage.getItem(LISTS_KEY);
    if (!raw) return emptyLists();
    const parsed = JSON.parse(raw) as Partial<AddressLists>;
    const clean = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return { allowlist: clean(parsed.allowlist), denylist: clean(parsed.denylist) };
  } catch {
    return emptyLists();
  }
}

/** Persist the user's allowlist/denylist. */
export function saveLists(lists: AddressLists): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    LISTS_KEY,
    JSON.stringify({ allowlist: lists.allowlist, denylist: lists.denylist }),
  );
}

export function addToAllowlist(address: string): AddressLists {
  const lists = loadLists();
  if (!lists.allowlist.some((x) => norm(x) === norm(address))) {
    lists.allowlist = [...lists.allowlist, address];
  }
  saveLists(lists);
  return lists;
}

export function addToDenylist(address: string): AddressLists {
  const lists = loadLists();
  if (!lists.denylist.some((x) => norm(x) === norm(address))) {
    lists.denylist = [...lists.denylist, address];
  }
  saveLists(lists);
  return lists;
}

export function removeFromAllowlist(address: string): AddressLists {
  const lists = loadLists();
  lists.allowlist = lists.allowlist.filter((x) => norm(x) !== norm(address));
  saveLists(lists);
  return lists;
}

export function removeFromDenylist(address: string): AddressLists {
  const lists = loadLists();
  lists.denylist = lists.denylist.filter((x) => norm(x) !== norm(address));
  saveLists(lists);
  return lists;
}

/* ------------------------------------------------------------------ */
/* Automated-policy engine                                             */
/* ------------------------------------------------------------------ */

/**
 * Input: a RiskAssessment (lib/risk), the route key (e.g. "base-usdc→sol-usdc"),
 * and how many CAUTION decisions this exact route has produced in a row.
 *
 * Actions are SESSION-LEVEL only:
 *   - blockSwap: the UI must not let this swap proceed;
 *   - sessionPause: a SESSION-LEVEL trading pause — the page locks new quotes
 *     until the user reviews; this is NOT the shared on-chain contract and
 *     never touches contract admin keys (there are none in this module).
 */
export interface AutoPolicyInput {
  assessment: RiskAssessment;
  routeKey: string;
  /** Consecutive CAUTION decisions on this route, INCLUDING the current one. */
  consecutiveCautions: number;
}

export interface AutoPolicyAction {
  blockSwap: boolean;
  sessionPause: boolean;
  alert: string | null;
  /** Machine-readable reasons, cited verbatim in the UI. */
  reasons: string[];
}

export function evaluateAutoPolicy(input: AutoPolicyInput): AutoPolicyAction {
  const { assessment, routeKey, consecutiveCautions } = input;
  const reasons: string[] = [];
  let blockSwap = false;
  let sessionPause = false;
  let alert: string | null = null;

  if (assessment.decision === "BLOCKED") {
    blockSwap = true;
    const fails = assessment.checks
      .filter((c) => c.status === "fail")
      .map((c) => c.id)
      .join(", ");
    reasons.push(`risk engine decision BLOCKED on route "${routeKey}" (failing checks: ${fails || "n/a"})`);
    alert = `AUTO-BLOCK: swap blocked on route ${routeKey} — ${assessment.summary}`;
  } else if (assessment.decision === "CAUTION" && consecutiveCautions >= 2) {
    sessionPause = true;
    reasons.push(
      `two consecutive CAUTION decisions on route "${routeKey}" ` +
        `(consecutiveCautions=${consecutiveCautions}) — session-level trading pause, ` +
        "NOT the shared on-chain contract",
    );
    alert = `AUTO-PAUSE: session-level trading paused for route ${routeKey} after ${consecutiveCautions} consecutive CAUTIONs — review before continuing`;
  } else {
    reasons.push(
      `decision ${assessment.decision} on route "${routeKey}" ` +
        `(consecutiveCautions=${consecutiveCautions}) — no automated action triggered`,
    );
  }

  return { blockSwap, sessionPause, alert, reasons };
}

/* ------------------------------------------------------------------ */
/* Combined scan — everything the playground runs on one live quote     */
/* ------------------------------------------------------------------ */

export interface SecurityScanInput {
  quote: IntentsQuote;
  originToken: IntentsToken;
  destinationToken: IntentsToken;
  routerId: string;
  policy: DetectorPolicy;
  registry: IntentsToken[];
  sessionQuoteHistory?: string[];
  counterparty?: string;
  lists?: AddressLists;
}

/** Runs every detector that needs a live quote plus the registry/router/list checks. */
export function runAllDetectors(input: SecurityScanInput): DetectorResult[] {
  const lists = input.lists ?? emptyLists();
  const results: DetectorResult[] = [
    detectRouteOutage(input.originToken, input.destinationToken),
    detectSuspiciousRouter(input.routerId, input.policy, input.sessionQuoteHistory ?? []),
    detectAbnormalSlippage(input.quote),
    detectLiquidityRisk(input.quote, input.originToken, input.destinationToken),
    detectUnverifiedToken(input.originToken, input.registry),
    detectUnverifiedToken(input.destinationToken, input.registry),
    detectDenylistedAddress(input.counterparty ?? "", lists.denylist),
    checkAllowlist(input.counterparty ?? "", lists.allowlist),
  ];
  return results;
}
