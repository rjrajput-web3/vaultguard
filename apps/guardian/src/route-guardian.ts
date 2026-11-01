/**
 * VAULTGUARD route guardian — policy-driven fallback when a router degrades.
 *
 * The guardian never blind-swaps. Given a normalized quote and a set of
 * degraded routers, it decides:
 *   - use-primary ......... primary router healthy → proceed with it
 *   - fallback-to-alternative ... primary degraded, a healthy alternative
 *     exists → switch, with a human-readable "why"
 *   - no-route-pause ...... primary degraded and no alternative → the vault
 *     must pause / alert instead of executing
 *
 * Every decision carries a timestamped trail so the demo UI can show exactly
 * why the guardian chose what it chose.
 */
import type { NormalizedQuote, NormalizedRoute } from "./risk-engine";
import type { VaultPolicy } from "./policy";
import { evaluatePolicy } from "./policy";

export type GuardianAction = "use-primary" | "fallback-to-alternative" | "no-route-pause";

export interface TrailStep {
  at: string; // ISO timestamp
  step: string; // human-readable
}

export interface FallbackDecision {
  action: GuardianAction;
  /** Router the quote originally selected. */
  primaryRouter: string;
  /** Router the guardian selected (primary or alternative). Undefined on pause. */
  selectedRouter?: string;
  /** Degraded routers that were excluded from consideration. */
  excluded: string[];
  /** The route that would execute (primary or chosen alternative). */
  selectedRoute?: NormalizedRoute & { amountIn: string };
  /** Human-readable decision trail. */
  trail: TrailStep[];
  /** Policy verdict on the selected route (undefined when paused). */
  policyAllowed?: boolean;
  policyReasons?: string[];
}

function step(text: string): TrailStep {
  return { at: new Date().toISOString(), step: text };
}

function routeToSelectable(
  r: NormalizedRoute,
  amountIn: string,
): NormalizedRoute & { amountIn: string } {
  return { ...r, amountIn };
}

/**
 * Pure decision function: pick the best healthy route.
 * `degraded` lists router ids considered down/degraded right now.
 */
export function decideRoute(
  quote: NormalizedQuote,
  degraded: string[],
  policy: VaultPolicy,
  opts: { spentTodayHuman?: number; decimalsIn?: number } = {},
): FallbackDecision {
  const trail: TrailStep[] = [];
  const degradedSet = new Set(degraded.map((d) => d.toLowerCase()));
  const primary: NormalizedRoute & { amountIn: string } = routeToSelectable(
    {
      router: quote.router,
      amountOut: quote.estimatedOut,
      minAmountOut: quote.minAmountOut,
      impliedSlippagePct: quote.slippagePct,
    },
    quote.amountIn,
  );

  trail.push(
    step(
      `Quote received: ${quote.tokenIn} → ${quote.tokenOut}, ` +
        `primary router "${primary.router}" ` +
        `(out ${primary.amountOut}, min ${primary.minAmountOut}, ` +
        `slippage ${primary.impliedSlippagePct.toFixed(2)}%), ` +
        `${quote.alternatives.length} alternative route(s) attached.`,
    ),
  );

  if (policy.paused) {
    trail.push(step("Vault policy: PAUSED — guardian halt in effect. No route may execute."));
    return {
      action: "no-route-pause",
      primaryRouter: primary.router,
      excluded: [...degradedSet],
      trail,
      policyAllowed: false,
      policyReasons: ["vault is paused — guardian halt in effect"],
    };
  }

  const primaryDegraded = degradedSet.has(primary.router.toLowerCase());
  if (!primaryDegraded) {
    trail.push(
      step(
        `Primary router "${primary.router}" is healthy — no degradation detected. ` +
          `Guardian keeps the primary route; no fallback needed.`,
      ),
    );
    const check = evaluatePolicy(quote, policy, {
      spentTodayHuman: opts.spentTodayHuman ?? 0,
      decimalsIn: opts.decimalsIn ?? 6,
    });
    trail.push(
      step(
        check.allowed
          ? `Policy check PASSED for primary route (caps, assets, routers all clear).`
          : `Policy check FAILED for primary route: ${check.reasons.join("; ")}.`,
      ),
    );
    return {
      action: "use-primary",
      primaryRouter: primary.router,
      selectedRouter: primary.router,
      excluded: [...degradedSet],
      selectedRoute: primary,
      trail,
      policyAllowed: check.allowed,
      policyReasons: check.reasons,
    };
  }

  // Primary is degraded — hunt the alternatives.
  trail.push(
    step(
      `Primary router "${primary.router}" is DEGRADED ` +
        `(simulated outage / exclusion). Guardian will not route through it.`,
    ),
  );
  const healthyAlts = quote.alternatives.filter(
    (a) => !degradedSet.has(a.router.toLowerCase()),
  );
  trail.push(
    step(
      healthyAlts.length > 0
        ? `${healthyAlts.length} healthy alternative(s) after excluding degraded routers: ` +
          healthyAlts.map((a) => `"${a.router}" (slippage ${a.impliedSlippagePct.toFixed(2)}%)`).join(", ") +
          `.`
        : `No healthy alternatives remain after excluding degraded routers ` +
          `(${[...degradedSet].join(", ") || "none"}).`,
    ),
  );

  if (healthyAlts.length === 0) {
    trail.push(
      step(
        `DECISION: no-route-pause. The guardian refuses to execute a degraded ` +
          `primary with zero healthy fallbacks — vault pauses and the user is alerted ` +
          `instead of blind-swapping.`,
      ),
    );
    return {
      action: "no-route-pause",
      primaryRouter: primary.router,
      excluded: [...degradedSet],
      trail,
      policyAllowed: false,
      policyReasons: [
        `primary router "${primary.router}" degraded and no healthy alternative routes`,
      ],
    };
  }

  // Pick the alternative with the lowest implied slippage.
  const best = [...healthyAlts].sort((a, b) => a.impliedSlippagePct - b.impliedSlippagePct)[0];
  const selected = routeToSelectable(best, quote.amountIn);
  const altQuote: NormalizedQuote = {
    ...quote,
    router: best.router,
    estimatedOut: best.amountOut,
    minAmountOut: best.minAmountOut,
    slippagePct: best.impliedSlippagePct,
  };
  const check = evaluatePolicy(altQuote, policy, {
    spentTodayHuman: opts.spentTodayHuman ?? 0,
    decimalsIn: opts.decimalsIn ?? 6,
  });
  trail.push(
    step(
      `DECISION: fallback-to-alternative. Router "${primary.router}" degraded → ` +
        `fell back to "${best.router}" because it is the healthy alternative with the ` +
        `lowest implied slippage (${best.impliedSlippagePct.toFixed(2)}%). ` +
        `Output ${best.amountOut} (min ${best.minAmountOut}).`,
    ),
  );
  trail.push(
    step(
      check.allowed
        ? `Policy check PASSED on the fallback route — guardian may proceed.`
        : `Policy check FAILED on the fallback route: ${check.reasons.join("; ")} — ` +
          `guardian will not execute despite the healthy route.`,
    ),
  );
  return {
    action: check.allowed ? "fallback-to-alternative" : "no-route-pause",
    primaryRouter: primary.router,
    selectedRouter: check.allowed ? best.router : undefined,
    excluded: [...degradedSet],
    selectedRoute: check.allowed ? selected : undefined,
    trail,
    policyAllowed: check.allowed,
    policyReasons: check.reasons,
  };
}
