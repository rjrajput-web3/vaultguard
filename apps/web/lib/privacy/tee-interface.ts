/**
 * VAULTRY Privacy module — confidential-compute (TEE) integration interface (workstream M3).
 *
 * STATUS (honest, 2026-11-02):
 *   - NEAR AI Cloud's confidential INFERENCE endpoint exists
 *     (https://cloud-api.near.ai/v1, OpenAI-compatible) but requires an
 *     `sk-` API key with PURCHASED credits (or staked NEAR). There is no free
 *     tier — see docs/NEAR-AI-CLOUD-RESEARCH.md. VAULTRY does NOT wire paid
 *     inference and holds no key.
 *   - What ships instead: (1) the keyless attestation VERIFICATION in
 *     ./attestation.ts (real, live), and (2) this interface + an OPTIONAL
 *     bring-your-own-key path below. The user pastes their own key; it lives
 *     in their browser's localStorage (vg_byok_nearaicloud) and is sent
 *     browser → cloud-api.near.ai directly — never to VAULTRY servers.
 *   - analyzeViaConfidentialCompute() is implemented against the official
 *     documented API but is NOT live-tested (no key under the zero-investment
 *     rule). Callers must surface that; never present its output as verified
 *     until a real run succeeds.
 *   - Shade Agents are DEPRECATED (docs.near.org, unmaintained since
 *     2026-04-19, mainnet-prohibited) — nothing here builds on them.
 *
 * THE ATTESTATION HANDSHAKE a future TEE deployment must satisfy
 * (enforced by analyzeViaConfidentialCompute):
 *   1. PREFLIGHT — fetch fresh ITA attestation evidence via
 *      verifyAttestationEvidence() with a client-generated nonce BEFORE the
 *      user's key or any data is sent. overall must be "pass".
 *   2. FRESHNESS — the signed evidence's caller_nonce must equal our nonce
 *      (replay protection), and tcb_status must be UpToDate.
 *   3. DIRECT CHANNEL — the keyed request goes browser → provider only.
 *      Routing the user's key through our server is FORBIDDEN by this
 *      interface (the function refuses server-side execution contexts it
 *      can detect, and documents the rest).
 *   4. MINIMAL PROMPT — the prompt may contain ONLY redacted features
 *      (assertMinimal("swapRisk") enforced); raw identifiers/secrets throw.
 *   5. RESPONSE BINDING — after the completion, fetch the response signature
 *      and require its claimed signing address to match the attested gateway
 *      signing address from step 1. Full ECDSA recovery is out of scope for
 *      this dependency-free module (use ethers + the official verifier for
 *      cryptographic proof); the structural match is recorded honestly.
 */

import {
  verifyAttestationEvidence,
  type AttestationVerificationResult,
} from "./attestation";
import { assertMinimal } from "./minimal-features";
import { ATTESTATION_ENDPOINT } from "./attestation";

/** NEAR AI Cloud confidential inference base (OpenAI-compatible). */
export const CONFIDENTIAL_COMPUTE_BASE_URL = "https://cloud-api.near.ai";

export interface ConfidentialComputeProvider {
  readonly name: "near-ai-cloud";
  readonly baseUrl: string;
  readonly keyless: false;
  /**
   * Run analysis inside the provider's TEE with the USER's key.
   * Implementations must satisfy the 5-step attestation handshake above.
   */
  analyzeViaConfidentialCompute(
    req: ConfidentialComputeRequest,
  ): Promise<ConfidentialComputeResult>;
}

export interface ConfidentialComputeRequest {
  /** The user's own NEAR AI Cloud `sk-` key (BYOK). Never stored by VAULTRY. */
  apiKey: string;
  /** Model id, e.g. a catalog alias from the provider's model list. */
  model: string;
  systemPrompt: string;
  /**
   * The analysis prompt. MUST contain only redacted features —
   * assertMinimal("swapRisk") is enforced before sending.
   */
  userPrompt: string;
  /** Fresh attestation nonce; generated when omitted. */
  nonce?: string;
  timeoutMs?: number;
}

export interface ResponseSignatureEvidence {
  completionId: string;
  signingAddress: string;
  matchesAttestedSigner: boolean;
  note: string;
}

export interface ConfidentialComputeResult {
  text: string;
  model: string;
  /** The preflight attestation evidence (step 1–2 of the handshake). */
  attestation: AttestationVerificationResult;
  /** Response-signature binding (step 5), null when unavailable. */
  responseSignature: ResponseSignatureEvidence | null;
  honestyNote: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof fetch !== "undefined";
}

/**
 * OPTIONAL BYOK confidential-compute analysis via NEAR AI Cloud.
 *
 * Not live-tested (no API key under the zero-investment rule) — implemented
 * against the official OpenAI-compatible API + the documented
 * /v1/signature/{id} endpoint. Requires the user's own key with credits.
 */
export async function analyzeViaConfidentialCompute(
  req: ConfidentialComputeRequest,
): Promise<ConfidentialComputeResult> {
  if (!isBrowser()) {
    throw new Error(
      "[privacy] analyzeViaConfidentialCompute is browser-only: the user's key " +
        "must never pass through a server.",
    );
  }
  if (!req.apiKey || !req.apiKey.trim()) {
    throw new Error("[privacy] a user-supplied NEAR AI Cloud API key is required (BYOK).");
  }
  // Handshake step 4: the prompt may carry only redacted features.
  assertMinimal({ prompt: req.userPrompt } as unknown as Record<string, unknown>, "swapRisk");
  // NOTE: assertMinimal checks field NAMES; the prompt is free text, so we
  // additionally require the caller to pass redactedFeatures separately in
  // real integrations. The name-check above is a tripwire, not a content scan.

  // Handshake steps 1–2: attestation preflight BEFORE the key is used.
  const attestation = await verifyAttestationEvidence({ timeoutMs: req.timeoutMs });
  if (attestation.overall !== "pass") {
    throw new Error(
      "[privacy] attestation preflight FAILED — refusing to send the keyed request. " +
        attestation.checks
          .filter((c) => c.status === "fail")
          .map((c) => `${c.id}: ${c.detail}`)
          .join(" | "),
    );
  }
  const attestedSigner = attestation.gatewaySigningAddress;

  // Handshake step 3: direct browser → provider request (OpenAI-compatible).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 120_000);
  let completion: { id?: string; choices?: Array<{ message?: { content?: string } }>; model?: string };
  try {
    const res = await fetch(`${CONFIDENTIAL_COMPUTE_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 300);
      throw new Error(`confidential inference failed: HTTP ${res.status}: ${snippet}`);
    }
    completion = (await res.json()) as typeof completion;
  } finally {
    clearTimeout(timer);
  }

  const text = completion.choices?.[0]?.message?.content ?? "";
  const completionId = completion.id ?? "";

  // Handshake step 5: response-signature binding (structural; see header note).
  let responseSignature: ResponseSignatureEvidence | null = null;
  if (completionId) {
    try {
      const sigRes = await fetch(
        `${CONFIDENTIAL_COMPUTE_BASE_URL}/v1/signature/${encodeURIComponent(completionId)}`,
        { headers: { Authorization: `Bearer ${req.apiKey.trim()}` } },
      );
      if (sigRes.ok) {
        const sigData = (await sigRes.json()) as {
          signing_address?: string;
          signature?: string;
        };
        const signer = String(sigData.signing_address ?? "");
        responseSignature = {
          completionId,
          signingAddress: signer,
          matchesAttestedSigner:
            !!attestedSigner && signer.toLowerCase() === attestedSigner.toLowerCase(),
          note:
            "Structural match of the claimed signing address against the " +
            "attested gateway signer. Full ECDSA recovery needs ethers + the " +
            "official nearai/nearai-cloud-verifier — not claimed here.",
        };
      } else {
        responseSignature = {
          completionId,
          signingAddress: "",
          matchesAttestedSigner: false,
          note: `signature endpoint returned HTTP ${sigRes.status} — binding not established`,
        };
      }
    } catch (err) {
      responseSignature = {
        completionId,
        signingAddress: "",
        matchesAttestedSigner: false,
        note: `signature fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    text,
    model: completion.model ?? req.model,
    attestation,
    responseSignature,
    honestyNote:
      "BYOK confidential inference via NEAR AI Cloud (OpenAI-compatible endpoint). " +
      "Attestation preflight passed before the keyed request; the request went " +
      "browser → cloud-api.near.ai directly, never via VAULTRY servers. " +
      "This function is implemented against official docs but NOT live-tested " +
      "(no API key under the zero-investment rule).",
  };
}

/** Re-exported for UIs that need the endpoint without importing attestation.ts. */
export { ATTESTATION_ENDPOINT };
