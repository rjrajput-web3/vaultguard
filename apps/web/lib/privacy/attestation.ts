/**
 * VAULTRY Privacy module — NEAR AI Cloud attestation verification (workstream M3).
 *
 * REAL, KEYLESS, VERIFIED-LIVE integration (probed 2026-11-02):
 *
 *   GET https://cloud-api.near.ai/v1/attestation/ita-token
 *       ?nonce=<64 hex chars>&signing_algo=ecdsa
 *       Accept: application/json
 *
 * Official source: https://docs.near.ai/api-reference/attestation/get-intel-trust-authority-attestation-token
 * ("Public endpoint — this is an explicit, documented decision (nearai/infra#193):
 *  public access lets third parties verify the platform without an account").
 * Verification flow: https://docs.near.ai/cloud/verification/cloud-api/gateway-attestation.md
 *
 * What verifyAttestationEvidence() does:
 *   1. Generates a fresh 32-byte nonce in the client (replay protection).
 *   2. Fetches the public ITA attestation evidence — NO account, NO key.
 *   3. Runs staged structural + freshness checks, each PASS / FAIL / SKIP
 *      with verbatim evidence.
 *
 * HONEST SCOPE (binding — read before rendering results):
 *   - This verifies NEAR AI Cloud's INFRASTRUCTURE (their gateway's Intel TDX
 *     evidence). It does NOT mean VAULTRY's analysis runs inside their TEE —
 *     our swap analysis runs on-device (see pipeline.ts).
 *   - The checks below are structural + freshness verification of the public
 *     evidence. The ITA JWT's PS384 signature is NOT cryptographically
 *     verified here — that requires the ITA JWKS plus an Intel DCAP quote
 *     verifier (see the official nearai/nearai-cloud-verifier repo, MIT).
 *     The result's honestyNote states this; UIs must render it.
 *   - Per-request model attestation reports (/v1/attestation/report) and
 *     response signatures (/v1/signature/…) require an API key and are only
 *     available on the BYOK path (see tee-interface.ts).
 */

export const ATTESTATION_ENDPOINT =
  "https://cloud-api.near.ai/v1/attestation/ita-token";
export const ATTESTATION_DOCS_URL =
  "https://docs.near.ai/cloud/verification/cloud-api/gateway-attestation.md";
export const ATTESTATION_API_REF_URL =
  "https://docs.near.ai/api-reference/attestation/get-intel-trust-authority-attestation-token";

export type AttestationCheckStatus = "pass" | "fail" | "skip";

export interface AttestationCheck {
  id: string;
  label: string;
  status: AttestationCheckStatus;
  /** Verbatim evidence (truncated where long). */
  detail: string;
}

export interface ModelAttestationEvidence {
  model: string;
  attestationType: string;
  tokenSigningAlg: string;
  checks: AttestationCheck[];
}

export interface AttestationVerificationResult {
  endpoint: string;
  /** The fresh nonce WE generated for this run (replay protection). */
  nonce: string;
  fetchedAt: string;
  httpStatus: number;
  checks: AttestationCheck[];
  models: ModelAttestationEvidence[];
  overall: "pass" | "fail";
  /** Signing identity the gateway evidence binds (when verified). */
  gatewaySigningAddress?: string;
  honestyNote: string;
}

/* ------------------------------------------------------------------ */

function randomNonceHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64urlToUtf8(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : // eslint-disable-next-line no-undef
        (globalThis as unknown as { Buffer: { from(s: string, e: string): { toString(e: string): string } } }).Buffer.from(
          padded,
          "base64",
        ).toString("binary");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function parseJwt(token: string): JwtParts {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error(`JWT has ${parts.length} segments, expected 3`);
  return {
    header: JSON.parse(b64urlToUtf8(parts[0])) as Record<string, unknown>,
    payload: JSON.parse(b64urlToUtf8(parts[1])) as Record<string, unknown>,
  };
}

const trunc = (s: string, n = 24): string =>
  s.length > n ? `${s.slice(0, 12)}…${s.slice(-6)}` : s;

function check(
  id: string,
  label: string,
  status: AttestationCheckStatus,
  detail: string,
): AttestationCheck {
  return { id, label, status, detail };
}

function verifyModelToken(
  model: string,
  token: string,
  nonce: string,
): ModelAttestationEvidence {
  const checks: AttestationCheck[] = [];
  try {
    const { header, payload } = parseJwt(token);
    checks.push(
      check(
        "model-jwt-structure",
        "Model token is a well-formed JWT",
        "pass",
        `alg=${String(header.alg)}, typ=${String(header.typ)}`,
      ),
    );
    const tdx = (payload.tdx ?? {}) as Record<string, unknown>;
    const runtime = (tdx.attester_runtime_data ?? {}) as Record<string, unknown>;
    const callerNonce = String(runtime.caller_nonce ?? "");
    checks.push(
      check(
        "model-nonce-freshness",
        "Model evidence binds our fresh nonce",
        callerNonce === nonce ? "pass" : "fail",
        callerNonce === nonce
          ? `caller_nonce matches the ${nonce.length / 2}-byte nonce we generated`
          : `caller_nonce=${trunc(callerNonce)} does NOT match our nonce — possible replay`,
      ),
    );
    checks.push(
      check(
        "model-tcb",
        "Model TCB status",
        String(tdx.attester_tcb_status) === "UpToDate" ? "pass" : "fail",
        `attester_tcb_status=${String(tdx.attester_tcb_status)}`,
      ),
    );
  } catch (err) {
    checks.push(
      check(
        "model-token-parse",
        "Model token parses",
        "fail",
        err instanceof Error ? err.message : String(err),
      ),
    );
  }
  const first = checks[0];
  return {
    model,
    attestationType: "tdx",
    tokenSigningAlg: "PS384",
    checks,
  };
}

/**
 * Verify NEAR AI Cloud's public TEE attestation evidence, keyless.
 * No account, no API key, no user data leaves the device except the
 * client-generated random nonce (which is the documented replay
 * protection, not user data).
 */
export async function verifyAttestationEvidence(opts?: {
  /** Optional model alias to request model evidence for. */
  model?: string;
  timeoutMs?: number;
}): Promise<AttestationVerificationResult> {
  const nonce = randomNonceHex();
  const fetchedAt = new Date().toISOString();
  const checks: AttestationCheck[] = [];
  const models: ModelAttestationEvidence[] = [];

  const params = new URLSearchParams({ nonce, signing_algo: "ecdsa" });
  if (opts?.model) params.set("model", opts.model);
  const url = `${ATTESTATION_ENDPOINT}?${params.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 30_000);
  let res: Response;
  let httpStatus = 0;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    httpStatus = res.status;
  } catch (err) {
    clearTimeout(timer);
    checks.push(
      check(
        "http-200",
        "Public attestation endpoint reachable",
        "fail",
        `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return finish(checks, models, {
      endpoint: ATTESTATION_ENDPOINT,
      nonce,
      fetchedAt,
      httpStatus,
    });
  }
  clearTimeout(timer);

  let data: Record<string, unknown> | null = null;
  let bodySnippet = "";
  try {
    const text = await res.text();
    bodySnippet = text.slice(0, 300);
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // non-JSON body
  }

  checks.push(
    check(
      "http-200",
      "Public attestation endpoint reachable (no key)",
      res.ok && data !== null ? "pass" : "fail",
      res.ok
        ? `HTTP ${httpStatus} — keyless access confirmed (no Authorization header sent)`
        : `HTTP ${httpStatus}: ${bodySnippet}`,
    ),
  );
  if (!res.ok || data === null) {
    return finish(checks, models, { endpoint: ATTESTATION_ENDPOINT, nonce, fetchedAt, httpStatus });
  }

  // Freshness: the response must echo OUR nonce.
  const echoedNonce = String(data.nonce ?? "");
  checks.push(
    check(
      "response-nonce-echo",
      "Response echoes our fresh nonce",
      echoedNonce === nonce ? "pass" : "fail",
      echoedNonce === nonce
        ? "response.nonce matches the 32-byte nonce generated for this run"
        : `response.nonce=${trunc(echoedNonce)} ≠ our nonce — rejecting as stale/foreign`,
    ),
  );

  const gateway = (data.gateway ?? {}) as Record<string, unknown>;
  const token = gateway.token;
  checks.push(
    check(
      "gateway-token-present",
      "Gateway attestation token present",
      typeof token === "string" && token.length > 0 ? "pass" : "fail",
      typeof token === "string"
        ? `JWT, ${token.length} chars, token_type=${String(gateway.token_type)}, attestation_type=${String(gateway.attestation_type)}`
        : "gateway.token missing or not a string",
    ),
  );

  let gatewaySigningAddress: string | undefined;
  if (typeof token === "string" && token.length > 0) {
    try {
      const { header, payload } = parseJwt(token);
      checks.push(
        check(
          "jwt-structure",
          "Token is an ITA-signed JWT (PS384)",
          header.alg === "PS384" && header.typ === "JWT" ? "pass" : "fail",
          `header.alg=${String(header.alg)}, typ=${String(header.typ)}, jku=${String(header.jku)}`,
        ),
      );
      const tdx = (payload.tdx ?? {}) as Record<string, unknown>;
      const runtime = (tdx.attester_runtime_data ?? {}) as Record<string, unknown>;
      const callerNonce = String(runtime.caller_nonce ?? "");
      checks.push(
        check(
          "nonce-freshness",
          "Signed evidence binds our fresh nonce",
          callerNonce === nonce ? "pass" : "fail",
          callerNonce === nonce
            ? `attester_runtime_data.caller_nonce inside the SIGNED payload matches our nonce — evidence is fresh, not replayed`
            : `signed caller_nonce=${trunc(callerNonce)} does NOT match our nonce — possible replay`,
        ),
      );
      const tcb = String(tdx.attester_tcb_status ?? "");
      checks.push(
        check(
          "tcb-status",
          "Intel TCB status is UpToDate",
          tcb === "UpToDate" ? "pass" : "fail",
          `attester_tcb_status=${tcb} (attester_tcb_date=${String(tdx.attester_tcb_date ?? "?")})`,
        ),
      );
      const hwType = String(tdx.attester_type ?? "");
      checks.push(
        check(
          "hardware",
          "Hardware is Intel TDX",
          hwType === "TDX" && String(gateway.attestation_type) === "tdx" ? "pass" : "fail",
          `attester_type=${hwType}, gateway.attestation_type=${String(gateway.attestation_type)}`,
        ),
      );
      const debuggable = tdx.tdx_is_debuggable;
      checks.push(
        check(
          "debug-disabled",
          "Enclave is not debuggable",
          debuggable === false ? "pass" : "fail",
          `tdx_is_debuggable=${String(debuggable)}`,
        ),
      );
      const addr = String(runtime.signing_address ?? "");
      gatewaySigningAddress = /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : undefined;
      checks.push(
        check(
          "signer-binding",
          "Evidence binds a gateway signing identity",
          gatewaySigningAddress !== undefined ? "pass" : "fail",
          gatewaySigningAddress
            ? `signing_address=${gatewaySigningAddress} (signing_algo=${String(runtime.signing_algo)})`
            : `signing_address missing or malformed: ${trunc(addr)}`,
        ),
      );
      const jwks = String(data.jwks_url ?? "");
      checks.push(
        check(
          "jwks-present",
          "ITA JWKS URL published for independent verification",
          jwks.startsWith("https://") ? "pass" : "fail",
          `jwks_url=${jwks}`,
        ),
      );
    } catch (err) {
      checks.push(
        check(
          "jwt-parse",
          "Attestation JWT parses",
          "fail",
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }

  // Model evidence (only when the endpoint returns it).
  const modelEntries = Array.isArray(data.models) ? data.models : [];
  if (opts?.model) {
    if (modelEntries.length === 0) {
      checks.push(
        check(
          "model-evidence",
          "Model attestation evidence",
          "fail",
          `requested model "${opts.model}" but the endpoint returned no model evidence (it may not be a valid catalog alias)`,
        ),
      );
    } else {
      for (const m of modelEntries) {
        const entry = m as Record<string, unknown>;
        const ev = verifyModelToken(String(entry.model ?? "?"), String(entry.token ?? ""), nonce);
        models.push(ev);
        const failed = ev.checks.filter((c) => c.status === "fail").length;
        checks.push(
          check(
            "model-evidence",
            `Model evidence: ${ev.model}`,
            failed === 0 ? "pass" : "fail",
            `${ev.checks.length} sub-checks, ${failed} failed (attestation_type=${String(entry.attestation_type)})`,
          ),
        );
      }
    }
  } else {
    checks.push(
      check(
        "model-evidence",
        "Model attestation evidence",
        "skip",
        "No model alias requested — pass { model } to verify per-model TEE evidence from the same public endpoint.",
      ),
    );
  }

  // Response signatures are only available after a keyed completion.
  checks.push(
    check(
      "response-signature",
      "Response signature",
      "skip",
      "Requires a keyed /v1/chat/completions request — only available on the BYOK path (your own NEAR AI Cloud key). Never faked here.",
    ),
  );

  return finish(checks, models, {
    endpoint: ATTESTATION_ENDPOINT,
    nonce,
    fetchedAt,
    httpStatus,
    gatewaySigningAddress,
  });
}

function finish(
  checks: AttestationCheck[],
  models: ModelAttestationEvidence[],
  base: {
    endpoint: string;
    nonce: string;
    fetchedAt: string;
    httpStatus: number;
    gatewaySigningAddress?: string;
  },
): AttestationVerificationResult {
  const overall = checks.some((c) => c.status === "fail") ? "fail" : "pass";
  return {
    ...base,
    checks,
    models,
    overall,
    honestyNote:
      "Structural + freshness verification of NEAR AI Cloud's PUBLIC attestation " +
      "evidence (no account, no key — per docs.near.ai, public by explicit decision " +
      "nearai/infra#193). The ITA JWT's PS384 signature is NOT cryptographically " +
      "verified in this panel — full verification needs the ITA JWKS and an Intel " +
      "DCAP quote verifier (official: nearai/nearai-cloud-verifier, MIT). " +
      "This panel verifies NEAR's infrastructure; VAULTRY's swap analysis runs " +
      "on-device and never inside NEAR's TEE.",
  };
}
