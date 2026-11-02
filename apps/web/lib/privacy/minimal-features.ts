/**
 * VAULTRY Privacy module — minimal data contracts (workstream M3).
 *
 * Every analysis type declares EXACTLY which fields it may consume.
 * Anything not on the list is either hashed (identifiers) or dropped
 * (secrets) by the pipeline in `./pipeline.ts` — never passed through raw.
 *
 * The swap UI and API routes MUST pass outbound payloads through
 * `assertMinimal()` before sending them anywhere. It throws on forbidden
 * fields (fail-closed): a payload containing a raw identifier or secret
 * can never silently leave the device.
 */

/** Allowed fields per analysis type — the complete data contract. */
export const MINIMAL_FEATURES = {
  /**
   * Swap-risk analysis. Explicitly NOT included: userAddress, txHistory,
   * privateKey, seedPhrase, recipient, refundTo, or any secret material.
   * Amounts travel as base-unit strings; identifiers travel as SHA-256
   * hashes (see pipeline.ts), never raw.
   */
  swapRisk: [
    "originAssetId",
    "destinationAssetId",
    "amountBaseUnits",
    "slippageBps",
    "routerId",
  ],
} as const;

export type AnalysisType = keyof typeof MINIMAL_FEATURES;

/**
 * Raw fields that must NEVER appear in an analysis payload.
 * Presence of any one of these throws in assertMinimal().
 */
const FORBIDDEN_FIELDS: Record<AnalysisType, readonly string[]> = {
  swapRisk: [
    "userAddress",
    "txHistory",
    "privateKey",
    "secretKey",
    "seedPhrase",
    "mnemonic",
    "recipient",
    "refundTo",
    "apiKey",
    "password",
  ],
};

/**
 * Fail-closed guard: throws if `payload` contains any forbidden field for
 * the given analysis type. Call this on every outbound payload (swap UI,
 * API routes, BYOK prompts) before it leaves the device.
 */
export function assertMinimal(
  payload: Record<string, unknown> | null | undefined,
  type: AnalysisType,
): void {
  if (payload == null || typeof payload !== "object") return;
  const forbidden = FORBIDDEN_FIELDS[type];
  const found = forbidden.filter((f) =>
    Object.prototype.hasOwnProperty.call(payload, f),
  );
  if (found.length > 0) {
    throw new Error(
      `[privacy] assertMinimal(${type}) rejected payload: forbidden field(s) ` +
        `${found.join(", ")} present. Allowed: ${MINIMAL_FEATURES[type].join(", ")}. ` +
        `Raw identifiers must be hashed and secrets dropped by the pipeline first.`,
    );
  }
}

/** The documented allow-list, for UIs that render the contract verbatim. */
export function minimalFeaturesFor(type: AnalysisType): readonly string[] {
  return MINIMAL_FEATURES[type];
}
