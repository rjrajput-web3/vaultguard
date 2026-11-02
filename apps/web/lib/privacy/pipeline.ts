/**
 * VAULTRY Privacy module — client-side private analysis pipeline (workstream M3).
 *
 * PROOF-BY-CONSTRUCTION PRIVACY INVARIANT:
 *   This module performs ZERO network calls. Read the imports: the only
 *   runtime dependency is `../risk/engine` (a pure function — no network,
 *   documented in lib/risk/README.md). There is no fetch(), no
 *   XMLHttpRequest, no WebSocket, no sendBeacon anywhere in this file.
 *   Because the function cannot transmit, raw addresses / amounts / keys
 *   passed into it cannot leave it — redaction is defense in depth, not
 *   the only barrier.
 *
 * Pipeline stages:
 *   (a) REDACT   — identifiers are SHA-256 hashed (never truncated);
 *                  secrets are DROPPED entirely (never hashed, never stored).
 *   (b) EXTRACT  — build the minimal feature set (see minimal-features.ts).
 *   (c) ANALYZE  — run assessSwapRisk() locally on the redacted features.
 *   (d) RETURN   — { verdict, redactedFeatures, auditTrail, privacyNote }.
 */

import { assessSwapRisk } from "../risk/engine";
import type { RiskAssessment, SwapRiskPolicy } from "../risk/engine";
import type { IntentsQuote } from "../intents/quotes";
import type { IntentsToken } from "../intents/registry";
import { assertMinimal } from "./minimal-features";

/** Sensitive input the pipeline accepts — and neutralizes. */
export interface PrivateSwapInput {
  /* ---- Sensitive: redacted or dropped inside the pipeline ---- */
  /** Raw user address. Hashed (SHA-256), never used raw, never transmitted. */
  userAddress?: string;
  /** Hashed like userAddress. Functionally required only by the quote API. */
  recipient?: string;
  /** Hashed like userAddress. Functionally required only by the quote API. */
  refundTo?: string;
  /** DROPPED — never hashed, never stored, never analyzed. */
  privateKey?: string;
  /** DROPPED — never hashed, never stored, never analyzed. */
  seedPhrase?: string;
  /** DROPPED — never hashed, never stored, never analyzed. */
  mnemonic?: string;
  /** DROPPED — history never enters the analysis. */
  txHistory?: unknown;

  /* ---- Analysis material (the minimal contract) ---- */
  originAssetId: string;
  destinationAssetId: string;
  /** Human-readable amount, e.g. "1.5". Converted to base units locally. */
  amountHuman?: string | number;
  /** Exact input in base units, e.g. "1500000". Preferred when known. */
  amountBaseUnits?: string;
  /** Token decimals — required when amountHuman is given. */
  amountDecimals?: number;
  slippageBps?: number;
  /** Router identifier, e.g. "1click". */
  routerId?: string;

  /* ---- Caller-supplied risk inputs ----
   * Fetching a quote / registry entries is governed by the user's
   * data-sharing level (see data-flows.ts). This function never fetches:
   * the caller passes already-obtained material in. */
  quote?: IntentsQuote;
  originToken?: IntentsToken;
  destinationToken?: IntentsToken;
  policy?: SwapRiskPolicy;
}

export interface AuditEntry {
  field: string;
  action: "hashed" | "dropped" | "kept";
  reason: string;
  /** For "hashed": the `sha256:<hex>` value (safe to display — irreversible). */
  evidence?: string;
}

export interface PrivateAnalysisResult {
  /** Real RiskAssessment, or null when the caller supplied no quote/tokens/policy. */
  verdict: RiskAssessment | null;
  /** The minimal feature set — passes assertMinimal("swapRisk"). */
  redactedFeatures: Record<string, string>;
  /** Per-field account of what happened to every sensitive input. */
  auditTrail: AuditEntry[];
  privacyNote: string;
}

/* ------------------------------------------------------------------ */

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Exact decimal → base-units conversion without floating-point error. */
function toBaseUnits(human: string | number, decimals: number): string {
  const s = String(human).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`[privacy] amountHuman must be a non-negative decimal string, got "${s}"`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`[privacy] amountDecimals must be an integer 0–36, got "${String(decimals)}"`);
  }
  const [intPart, fracPart = ""] = s.split(".");
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  const base =
    BigInt(intPart === "" ? "0" : intPart) * BigInt(10) ** BigInt(decimals) +
    BigInt(frac === "" ? "0" : frac);
  return base.toString();
}

/**
 * Run the full private pipeline. Async only because WebCrypto digest is
 * async — no I/O, no network, no timers, no randomness beyond hashing.
 */
export async function analyzeSwapPrivately(
  input: PrivateSwapInput,
): Promise<PrivateAnalysisResult> {
  const auditTrail: AuditEntry[] = [];

  /* ---- (a) REDACT ---- */
  const hashedIds: Record<string, string> = {};
  for (const field of ["userAddress", "recipient", "refundTo"] as const) {
    const raw = input[field];
    if (typeof raw === "string" && raw.trim().length > 0) {
      const hash = await sha256Hex(raw.trim());
      hashedIds[`${field}Hash`] = `sha256:${hash}`;
      auditTrail.push({
        field,
        action: "hashed",
        reason:
          "Identifier irreversibly hashed with SHA-256 (full digest, not truncated). " +
          "The raw value is used nowhere else in this function.",
        evidence: `sha256:${hash}`,
      });
    }
  }
  for (const field of ["privateKey", "seedPhrase", "mnemonic", "txHistory"] as const) {
    if (input[field] !== undefined && input[field] !== null && input[field] !== "") {
      auditTrail.push({
        field,
        action: "dropped",
        reason:
          "Secret / history material is dropped at the pipeline boundary — " +
          "never hashed, never stored, never analyzed, never transmitted.",
      });
    }
  }

  /* ---- (b) EXTRACT — the minimal feature set ---- */
  let amountBaseUnits: string;
  if (input.amountBaseUnits !== undefined) {
    if (!/^\d+$/.test(String(input.amountBaseUnits).trim())) {
      throw new Error("[privacy] amountBaseUnits must be a non-negative integer string");
    }
    amountBaseUnits = String(input.amountBaseUnits).trim();
    auditTrail.push({
      field: "amountBaseUnits",
      action: "kept",
      reason:
        "Required for the risk analysis (slippage, price impact, policy limit). " +
        "Kept in-memory only — this function makes zero network calls, so it is never transmitted.",
    });
  } else if (input.amountHuman !== undefined) {
    if (input.amountDecimals === undefined) {
      throw new Error("[privacy] amountDecimals is required when amountHuman is given");
    }
    amountBaseUnits = toBaseUnits(input.amountHuman, input.amountDecimals);
    auditTrail.push({
      field: "amountHuman",
      action: "dropped",
      reason:
        "Converted to exact base units locally; the human-readable string is discarded after conversion.",
    });
    auditTrail.push({
      field: "amountBaseUnits",
      action: "kept",
      reason:
        "Required for the risk analysis (slippage, price impact, policy limit). " +
        "Kept in-memory only — this function makes zero network calls, so it is never transmitted.",
    });
  } else {
    throw new Error("[privacy] either amountBaseUnits or amountHuman (+ amountDecimals) is required");
  }

  const redactedFeatures: Record<string, string> = {
    originAssetId: input.originAssetId,
    destinationAssetId: input.destinationAssetId,
    amountBaseUnits,
    slippageBps: String(input.slippageBps ?? 50),
    routerId: input.routerId ?? "1click",
  };
  for (const field of ["originAssetId", "destinationAssetId", "slippageBps", "routerId"] as const) {
    auditTrail.push({
      field,
      action: "kept",
      reason:
        "Part of the documented minimal data contract (minimal-features.ts). " +
        "Contains no identifier and no secret; used only for local analysis.",
    });
  }

  // Fail-closed: the analysis payload must satisfy the minimal contract.
  assertMinimal(redactedFeatures, "swapRisk");

  /* ---- (c) ANALYZE — locally, via the pure risk engine ---- */
  let verdict: RiskAssessment | null = null;
  let privacyNote: string;
  if (input.quote && input.originToken && input.destinationToken && input.policy) {
    verdict = assessSwapRisk({
      quote: input.quote,
      originToken: input.originToken,
      destinationToken: input.destinationToken,
      policy: input.policy,
    });
    privacyNote =
      "Verdict computed on-device by assessSwapRisk() (pure, no network). " +
      "The quote and registry entries above were obtained by the caller under " +
      "your data-sharing level — this function fetched nothing.";
  } else {
    privacyNote =
      "No quote / token / policy material was supplied, so no verdict was computed. " +
      "Fetching a quote requires sending asset IDs, amounts and recipient/refundTo " +
      "to the 1Click API — that fetch is governed by your data-sharing level " +
      "(disabled at “nothing”), never performed silently by this function.";
  }

  /* ---- (d) RETURN ---- */
  return { verdict, redactedFeatures, auditTrail, privacyNote };
}
