/**
 * VAULTRY agent explainer — "AI narrates, deterministic code decides".
 *
 * These are HAND-WRITTEN templates that turn machine verdicts into plain
 * language. They are READ-ONLY over guardian/policy output: they receive a
 * verdict object and render an explanation. They can NEVER change a verdict,
 * a threshold, an amount, or a policy — there is no code path from here back
 * into the decision layer. The LLM (when used) only selects phrasing; the
 * facts always come from these templates + the verdict data.
 */

import type { GuardianResult } from "../guardian/testnet-guardian";
import type { UserPolicy } from "../policy/user-policy";

export interface ExplainedVerdict {
  headline: string;
  /** one line per reason, plain language */
  lines: string[];
  /** what the user can do next */
  nextStep: string;
  /** the exact machine verdict, always shown alongside */
  machine: { verdict: string; score: number };
}

/**
 * Explain a Route Guardian verdict. Pure function of the verdict —
 * deterministic, no model involved.
 */
export function explainGuardianVerdict(v: GuardianResult): ExplainedVerdict {
  const lines = v.reasons.map((r) => {
    // Strip the machine prefix, keep the human reason.
    const clean = r.replace(/^(BLOCKED|CAUTION):\s*/, "");
    if (v.verdict === "BLOCKED") return `🛡 Blocked — ${clean} Your funds stayed put; nothing was signed.`;
    return `⚠ Caution — ${clean}`;
  });
  if (lines.length === 0) {
    lines.push("✓ Every check passed: quote matches your intent, slippage within your policy, recipient valid, quote fresh.");
  }
  const headline =
    v.verdict === "BLOCKED"
      ? "Route Guardian BLOCKED this transaction."
      : v.verdict === "CAUTION"
        ? "Route Guardian flagged this transaction for your review."
        : "Route Guardian scored this transaction SAFE.";
  const nextStep =
    v.verdict === "BLOCKED"
      ? "Fix the flagged issue (or adjust your Policy Console limits) and try again. A BLOCKED verdict cannot be overridden — that is the fund-safety guarantee."
      : v.verdict === "CAUTION"
        ? "Review each caution above. If you accept the risk, confirm explicitly for this transaction only — approval never carries over."
        : "It still needs YOUR explicit wallet signature — SAFE never auto-executes.";
  return { headline, lines, nextStep, machine: { verdict: v.verdict, score: v.score } };
}

/** Explain the current policy state in plain language. */
export function explainPolicy(p: UserPolicy): string[] {
  const lines: string[] = [];
  lines.push(
    p.paused
      ? "🛡 Emergency pause is ON — all swaps and agent-prepared sends are frozen until you unpause in the Policy Console."
      : "✓ Emergency pause is OFF — the agent may prepare transactions within your limits."
  );
  lines.push(`Per-transaction cap: $${p.maxSpendPerTx.toLocaleString()} (testnet USD reference). Anything above is blocked before signing.`);
  lines.push(`Daily cap: $${p.maxSpendPerDay.toLocaleString()} (testnet USD reference).`);
  lines.push(`Allowed swap router: ${p.allowedRouters.join(", ") || "none"} — the agent will never route through anything else.`);
  lines.push(`Max slippage: ${p.maxHedgeSlippagePct}% · max fee: ${p.maxHedgeFeePct}%. Quotes breaching these are blocked or flagged.`);
  return lines;
}

/** Explain the 3 agent states so the UI never mixes them up. */
export function explainAgentStates(): { state: string; meaning: string }[] {
  return [
    { state: "SUGGESTION", meaning: "An idea from the agent. Nothing prepared, nothing signed. You can ignore it." },
    { state: "PREPARED", meaning: "A real transaction is built and checked (guardian + policy passed), but NOT signed. It only executes after your explicit wallet approval." },
    { state: "COMPLETED", meaning: "Signed by you and confirmed on-chain. Carries a real transaction hash + explorer link." },
  ];
}

/** Plain-language wrapper for why a route is unavailable (honest, from the route table). */
export function explainUnsupportedRoute(from: string, to: string, note: string): string[] {
  return [
    `No genuine testnet route exists for ${from} → ${to} right now.`,
    note,
    "VAULTRY will not fake a route or relabel a same-chain transfer as a cross-chain swap. Supported today: NEAR Intents testnet pairs via the TidePool sandbox.",
  ];
}
