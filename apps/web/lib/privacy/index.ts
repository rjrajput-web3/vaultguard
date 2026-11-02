/**
 * VAULTRY Privacy module — public surface (workstream M3: Privacy & Private AI).
 *
 * - pipeline.ts        client-side private analysis (zero network calls)
 * - minimal-features.ts  documented minimal data contracts + fail-closed guard
 * - data-flows.ts      DATA_FLOWS table, consent levels, localStorage helpers
 * - audit.ts           static wallet scan + runtime outbound-request audit (node-only)
 * - attestation.ts     keyless NEAR AI Cloud TEE attestation verification (live)
 * - tee-interface.ts   confidential-compute interface + optional BYOK path
 */

export { analyzeSwapPrivately } from "./pipeline";
export type {
  PrivateSwapInput,
  PrivateAnalysisResult,
  AuditEntry,
} from "./pipeline";

export { MINIMAL_FEATURES, assertMinimal, minimalFeaturesFor } from "./minimal-features";
export type { AnalysisType } from "./minimal-features";

export {
  DATA_FLOWS,
  DATA_LEVEL_INFO,
  CONSENT_MODULES,
  CONSENT_STORAGE_KEY,
  BYOK_STORAGE_KEY,
  DEFAULT_CONSENT,
  loadConsent,
  saveConsent,
  loadByokKey,
  saveByokKey,
  clearByokKey,
} from "./data-flows";
export type {
  DataDestination,
  DataFlow,
  DataSharingLevel,
  ConsentModuleId,
  PrivacyConsent,
} from "./data-flows";

export {
  verifyAttestationEvidence,
  ATTESTATION_ENDPOINT,
  ATTESTATION_DOCS_URL,
  ATTESTATION_API_REF_URL,
} from "./attestation";
export type {
  AttestationCheck,
  AttestationCheckStatus,
  AttestationVerificationResult,
  ModelAttestationEvidence,
} from "./attestation";

export {
  analyzeViaConfidentialCompute,
  CONFIDENTIAL_COMPUTE_BASE_URL,
} from "./tee-interface";
export type {
  ConfidentialComputeProvider,
  ConfidentialComputeRequest,
  ConfidentialComputeResult,
  ResponseSignatureEvidence,
} from "./tee-interface";

// audit.ts is node-only (fs/path) — imported directly by the test runner,
// not re-exported here so browser bundles never pull it in.
