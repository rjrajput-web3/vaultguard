/**
 * VAULTGUARD locked core flow (approved 2026-10-31):
 *
 *   depeg detect
 *     → risk / slippage / fees / exit-cost calc
 *     → user limits + permissions check
 *     → safe route available ? auto-hedge to USDC via NEAR Intents
 *                                : pause vault + alert user
 *
 * NEVER blind swaps: every hedge goes through the risk engine first.
 * If any check fails → pause + alert instead of swapping.
 */
import { scoreRisk, type NormalizedQuote, type RiskReport } from "./risk-engine";
import { evaluatePolicy, toHuman, type VaultPolicy } from "./policy";
import { checkPeg, trackDepeg, type DepegState } from "./oracle-monitor";

export type DepegDecisionKind = "no-action" | "auto-hedge" | "pause-and-alert";

export interface DepegDecision {
  kind: DepegDecisionKind;
  reasons: string[];
  riskReport?: RiskReport;
  hedgeRouter?: string;
}

/**
 * Evaluate the full depeg response.
 *
 * @param depeggedAsset e.g. "USDe" / "near:<token>"
 * @param spotPrice current oracle price of the depegged asset
 * @param hedgeQuote normalized live quote (RHEA or 1Click fallback) converting
 *   the vault position → USDC — produced by the quote loop, already normalized
 * @param policy the vault's user-defined policy
 */
export function evaluateDepegResponse(input: {
  depeggedAsset: string;
  spotPrice: number;
  depegState: DepegState;
  hedgeQuote: NormalizedQuote; // position -> USDC, from either quote source
  policy: VaultPolicy;
  spentTodayHuman: number;
  decimalsIn: number;
  decimalsOut: number;
}): DepegDecision {
  const pegCheck = checkPeg(input.depeggedAsset, input.spotPrice);
  if (pegCheck.stale) {
    return {
      kind: "no-action",
      reasons: ["oracle price stale — freeze new actions, do NOT auto-pause on stale data"],
    };
  }

  const state = trackDepeg(input.depegState, pegCheck);
  if (!state.confirmed) {
    return {
      kind: "no-action",
      reasons: [
        `deviation ${pegCheck.deviationPct.toFixed(2)}% — ` +
          (pegCheck.outsideBand
            ? `${state.consecutiveOutside} tick(s) outside band, need ${3} to confirm`
            : "inside ±2% band"),
      ],
    };
  }

  const reasons = [
    `DEPEG CONFIRMED: ${input.depeggedAsset} at ${input.spotPrice} ` +
      `(${pegCheck.deviationPct.toFixed(2)}% off peg, ${state.consecutiveOutside} consecutive ticks)`,
  ];

  // Step 2: risk / slippage / fees / exit-cost calc.
  // The hedge quote arrives pre-normalized from the quote loop (RHEA or
  // 1Click) — score it directly. Same math as analyzeQuote's second half.
  const normalized = input.hedgeQuote;
  const report = scoreRisk(normalized, {
    peggedPair: false, // depegged asset: no peg assumption
    decimalsIn: input.decimalsIn,
    decimalsOut: input.decimalsOut,
  });
  reasons.push(
    `hedge quote via ${normalized.router}: slippage ${normalized.slippagePct.toFixed(3)}%, ` +
      `risk score ${report.score} (${report.verdict})`,
  );

  // Step 3: user limits + permissions.
  const policyCheck = evaluatePolicy(normalized, input.policy, {
    spentTodayHuman: input.spentTodayHuman,
    decimalsIn: input.decimalsIn,
  });
  if (!policyCheck.allowed) {
    return {
      kind: "pause-and-alert",
      reasons: [...reasons, ...policyCheck.reasons, "policy violated → PAUSE vault + alert user"],
      riskReport: report,
    };
  }

  // Step 4/5: safe route? — the hedge must itself be SAFE, within the user's
  // hedge slippage ceiling and fee ceiling, and via an allowed router.
  const exitCostHuman =
    toHuman(input.hedgeQuote.amountIn, input.decimalsIn) -
    toHuman(input.hedgeQuote.estimatedOut, input.decimalsOut);
  reasons.push(`exit cost ≈ ${exitCostHuman.toFixed(4)} (input value − expected output)`);

  const hedgeOk =
    report.verdict === "SAFE" &&
    normalized.slippagePct <= input.policy.maxHedgeSlippagePct;

  if (hedgeOk) {
    return {
      kind: "auto-hedge",
      reasons: [...reasons, "hedge quote passes all checks → execute conversion to USDC"],
      riskReport: report,
      hedgeRouter: normalized.router,
    };
  }

  return {
    kind: "pause-and-alert",
    reasons: [
      ...reasons,
      report.verdict !== "SAFE"
        ? `hedge quote verdict ${report.verdict} — unsafe to auto-swap`
        : `hedge slippage ${normalized.slippagePct.toFixed(2)}% exceeds user ceiling ${input.policy.maxHedgeSlippagePct}%`,
      "→ PAUSE vault + alert user (never blind-swapped)",
    ],
    riskReport: report,
  };
}
