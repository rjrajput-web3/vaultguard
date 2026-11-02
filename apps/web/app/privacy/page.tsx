"use client";

/**
 * VAULTRY "Privacy & Data Controls" page (workstream M3: Privacy & Private AI).
 *
 * Honest labeling, binding:
 *  - "Device-side Privacy — swap risk analysis runs on your device; data never leaves it."
 *  - "NEAR AI Cloud attestation verification (public endpoint)" — verifies THEIR
 *    TEE evidence; our analysis does NOT run inside their TEE.
 * No "military-grade", no "TEE-secured" anywhere on this page.
 *
 * Everything interactive here is real:
 *  - "Verify my privacy" runs analyzeSwapPrivately() on labeled SAMPLE data and
 *    renders the true audit trail + the real local risk verdict.
 *  - "Verify attestation" calls NEAR AI Cloud's public, keyless ITA endpoint
 *    and renders each check PASS / FAIL / SKIP with verbatim evidence.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { analyzeSwapPrivately } from "../../lib/privacy/pipeline";
import type {
  PrivateAnalysisResult,
  PrivateSwapInput,
} from "../../lib/privacy/pipeline";
import {
  DATA_FLOWS,
  DATA_LEVEL_INFO,
  CONSENT_MODULES,
  loadConsent,
  saveConsent,
  loadByokKey,
  saveByokKey,
  clearByokKey,
} from "../../lib/privacy/data-flows";
import type {
  DataSharingLevel,
  PrivacyConsent,
  ConsentModuleId,
} from "../../lib/privacy/data-flows";
import {
  verifyAttestationEvidence,
  ATTESTATION_DOCS_URL,
} from "../../lib/privacy/attestation";
import type { AttestationVerificationResult } from "../../lib/privacy/attestation";

/* ------------------------------------------------------------------ */
/* Sample input for the "Verify my privacy" demo. Labeled SAMPLE —     */
/* not a real wallet, not a real quote. The pipeline run itself is real.*/
/* ------------------------------------------------------------------ */

const SAMPLE_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA9e"; // SAMPLE

function buildSampleInput(): PrivateSwapInput {
  return {
    userAddress: SAMPLE_ADDRESS,
    recipient: SAMPLE_ADDRESS,
    refundTo: SAMPLE_ADDRESS,
    privateKey: `0x${"cd".repeat(32)}`, // SAMPLE — the pipeline drops it
    seedPhrase:
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", // SAMPLE
    originAssetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    destinationAssetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amountHuman: "1",
    amountDecimals: 6,
    slippageBps: 50,
    routerId: "1click",
    quote: {
      amountIn: "1000000",
      amountOut: "999200",
      minAmountOut: "994200",
      amountOutUsd: "0.9992",
      timeEstimateMs: 45000,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      raw: { sample: true },
    },
    originToken: {
      assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "USDC",
      blockchain: "eth",
      decimals: 6,
      price: 1,
    },
    destinationToken: {
      assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      symbol: "USDC",
      blockchain: "base",
      decimals: 6,
      price: 1,
    },
    policy: { maxSpendPerTxUsd: 5000, maxSlippagePct: 2 },
  };
}

/* ------------------------------------------------------------------ */

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 1,
  color: "var(--dim)",
  borderBottom: "1px solid var(--panel-border)",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "12px",
  fontSize: 13.5,
  color: "var(--text)",
  borderBottom: "1px solid rgba(125,211,252,0.07)",
  verticalAlign: "top",
  lineHeight: 1.55,
};

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        border: "1px solid var(--panel-border)",
        background: on ? "linear-gradient(100deg, var(--blue), var(--cyan))" : "rgba(148,184,255,0.08)",
        cursor: "pointer",
        position: "relative",
        flexShrink: 0,
        transition: "background 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}

function CheckBadge({ status }: { status: "pass" | "fail" | "skip" }) {
  const colors = {
    pass: { bg: "rgba(34,197,94,0.14)", fg: "#4ade80", bd: "rgba(34,197,94,0.4)" },
    fail: { bg: "rgba(239,68,68,0.14)", fg: "#f87171", bd: "rgba(239,68,68,0.4)" },
    skip: { bg: "rgba(148,184,255,0.08)", fg: "var(--muted)", bd: "var(--panel-border)" },
  }[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 12px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 800,
        letterSpacing: 1,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.bd}`,
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

export default function PrivacyPage() {
  const [consent, setConsent] = useState<PrivacyConsent | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<PrivateAnalysisResult | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [attestation, setAttestation] = useState<AttestationVerificationResult | null>(null);
  const [byokInput, setByokInput] = useState("");
  const [byokSaved, setByokSaved] = useState(false);

  useEffect(() => {
    setConsent(loadConsent());
    setByokSaved(loadByokKey() !== null);
  }, []);

  const updateConsent = (next: PrivacyConsent) => {
    setConsent(next);
    saveConsent(next);
  };

  const setLevel = (level: DataSharingLevel) => {
    if (!consent) return;
    updateConsent({ ...consent, level });
  };

  const toggleModule = (id: ConsentModuleId) => {
    if (!consent) return;
    updateConsent({
      ...consent,
      modules: { ...consent.modules, [id]: !consent.modules[id] },
    });
  };

  const runVerify = async () => {
    setVerifying(true);
    try {
      const result = await analyzeSwapPrivately(buildSampleInput());
      setVerifyResult(result);
    } finally {
      setVerifying(false);
    }
  };

  const runAttestation = async () => {
    setAttesting(true);
    try {
      const result = await verifyAttestationEvidence();
      setAttestation(result);
    } catch (err) {
      setAttestation({
        endpoint: "https://cloud-api.near.ai/v1/attestation/ita-token",
        nonce: "",
        fetchedAt: new Date().toISOString(),
        httpStatus: 0,
        checks: [
          {
            id: "http-200",
            label: "Public attestation endpoint reachable (no key)",
            status: "fail",
            detail: err instanceof Error ? err.message : String(err),
          },
        ],
        models: [],
        overall: "fail",
        honestyNote:
          "The verification request itself failed — no evidence was retrieved, so nothing is claimed.",
      });
    } finally {
      setAttesting(false);
    }
  };

  const saveKey = () => {
    if (!byokInput.trim()) return;
    saveByokKey(byokInput);
    setByokInput("");
    setByokSaved(true);
  };
  const removeKey = () => {
    clearByokKey();
    setByokSaved(false);
  };

  const verdict = verifyResult?.verdict;
  const verdictColor =
    verdict?.decision === "SAFE"
      ? "#4ade80"
      : verdict?.decision === "CAUTION"
        ? "var(--amber)"
        : "#f87171";

  return (
    <main className="vg-wrap" style={{ paddingTop: 96, paddingBottom: 96 }}>
      <p className="vg-eyebrow">Privacy &amp; Private AI</p>
      <h1 className="vg-h2">Privacy &amp; Data Controls</h1>

      {/* Exact guarantee banner — honest labeling, binding */}
      <div
        className="vg-panel"
        style={{
          padding: "18px 22px",
          marginBottom: 40,
          borderLeft: "3px solid var(--cyan)",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
          Device-side Privacy — swap risk analysis runs on your device; data never
          leaves it.
        </div>
        <div style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.65 }}>
          Identifiers are SHA-256 hashed, secrets are dropped at the pipeline
          boundary, and the analysis function makes zero network calls — by
          construction, not by promise. What leaves the device, and why, is listed
          verbatim in the data-flows table below.
        </div>
      </div>

      {/* ---- Data-sharing level ---- */}
      <section style={{ marginBottom: 56 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Data-sharing level</h2>
        <p style={{ color: "var(--muted)", fontSize: 14.5, marginBottom: 20, maxWidth: 720 }}>
          This controls what any VAULTRY feature may send off your device. Stored
          locally as <code>vg_privacy_consent</code>.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {(Object.keys(DATA_LEVEL_INFO) as DataSharingLevel[]).map((level) => {
            const active = consent?.level === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => setLevel(level)}
                style={{
                  textAlign: "left",
                  padding: "18px",
                  borderRadius: "var(--radius)",
                  cursor: "pointer",
                  background: active ? "rgba(34,211,238,0.08)" : "var(--panel)",
                  border: active
                    ? "1px solid var(--cyan)"
                    : "1px solid var(--panel-border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: "2px solid var(--cyan)",
                      background: active ? "var(--cyan)" : "transparent",
                    }}
                  />
                  <b style={{ fontSize: 15 }}>{DATA_LEVEL_INFO[level].title}</b>
                  {level === "anonymized" && (
                    <span style={{ fontSize: 11, color: "var(--cyan)", fontWeight: 700 }}>DEFAULT</span>
                  )}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.6 }}>
                  {DATA_LEVEL_INFO[level].description}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- Per-module consent ---- */}
      <section style={{ marginBottom: 56 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Per-module consent</h2>
        <p style={{ color: "var(--muted)", fontSize: 14.5, marginBottom: 20, maxWidth: 720 }}>
          Each feature asks before it acts. Turn a module off and its outbound
          calls stop; on-device analysis it already performed is unaffected.
        </p>
        <div className="vg-panel" style={{ padding: 6 }}>
          {CONSENT_MODULES.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "16px 18px",
                borderBottom: "1px solid rgba(125,211,252,0.07)",
              }}
            >
              <Toggle
                on={consent?.modules[m.id] ?? true}
                onChange={() => toggleModule(m.id)}
                label={m.label}
              />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{m.label}</div>
                <div style={{ color: "var(--muted)", fontSize: 13.5 }}>{m.whatItDoes}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Data-flows dashboard ---- */}
      <section style={{ marginBottom: 56 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Privacy dashboard</h2>
        <p style={{ color: "var(--muted)", fontSize: 14.5, marginBottom: 20, maxWidth: 720 }}>
          Every feature → the data it uses → where that data goes. Single source
          of truth: <code>DATA_FLOWS</code> in <code>lib/privacy/data-flows.ts</code>.
        </p>
        <div className="vg-panel" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={th}>Feature</th>
                <th style={th}>Data it uses</th>
                <th style={th}>Where it goes</th>
                <th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {DATA_FLOWS.map((f) => (
                <tr key={f.feature}>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{f.feature}</td>
                  <td style={td}>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {f.dataUsed.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "4px 12px",
                        borderRadius: 999,
                        fontSize: 12.5,
                        fontWeight: 700,
                        background:
                          f.destination === "local-device"
                            ? "rgba(34,197,94,0.12)"
                            : "rgba(59,130,246,0.12)",
                        border: "1px solid var(--panel-border)",
                        color: f.destination === "local-device" ? "#4ade80" : "var(--ice)",
                      }}
                    >
                      {f.destinationLabel}
                    </span>
                  </td>
                  <td style={{ ...td, color: "var(--muted)" }}>{f.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Verify my privacy ---- */}
      <section style={{ marginBottom: 56 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Verify my privacy</h2>
        <p style={{ color: "var(--muted)", fontSize: 14.5, marginBottom: 20, maxWidth: 720 }}>
          Runs the real redaction pipeline on <b>labeled sample data</b> (not your
          wallet) and shows exactly what happened to each field — hashed, dropped,
          or kept — plus the genuine on-device risk verdict.
        </p>
        <button type="button" className="vg-btn" onClick={runVerify} disabled={verifying}>
          {verifying ? "Running…" : "Verify my privacy"}
        </button>

        {verifyResult && (
          <div className="vg-panel" style={{ marginTop: 20, padding: 22 }}>
            {verdict ? (
              <div style={{ marginBottom: 18 }}>
                <span style={{ color: "var(--dim)", fontSize: 12, letterSpacing: 1 }}>
                  LOCAL VERDICT (sample data)
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: 20,
                      color: verdictColor,
                      letterSpacing: 1,
                    }}
                  >
                    {verdict.decision}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: 13.5 }}>
                    score {verdict.score} · {verdict.checks.length} checks · computed
                    on-device, zero network calls
                  </span>
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--muted)" }}>No verdict — {verifyResult.privacyNote}</p>
            )}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Field</th>
                  <th style={th}>Action</th>
                  <th style={th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {verifyResult.auditTrail.map((e, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
                      {e.field}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: 12,
                          letterSpacing: 1,
                          color:
                            e.action === "hashed"
                              ? "var(--cyan)"
                              : e.action === "dropped"
                                ? "#f87171"
                                : "#4ade80",
                        }}
                      >
                        {e.action.toUpperCase()}
                      </span>
                      {e.evidence && (
                        <div
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 11,
                            color: "var(--dim)",
                            marginTop: 4,
                            wordBreak: "break-all",
                          }}
                        >
                          {e.evidence}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, color: "var(--muted)" }}>{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 14 }}>
              {verifyResult.privacyNote}
            </p>
          </div>
        )}
      </section>

      {/* ---- NEAR AI Cloud attestation verification ---- */}
      <section style={{ marginBottom: 56 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          NEAR AI Cloud attestation verification{" "}
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cyan)" }}>
            (public endpoint)
          </span>
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 14.5, marginBottom: 8, maxWidth: 720 }}>
          This verifies <b>NEAR AI Cloud&apos;s own infrastructure</b> — live Intel
          TDX attestation evidence from their public, keyless endpoint. It does{" "}
          <b>not</b> mean VAULTRY&apos;s analysis runs inside their TEE: our
          analysis runs on your device (above).
        </p>
        <p style={{ color: "var(--dim)", fontSize: 12.5, marginBottom: 20 }}>
          Source:{" "}
          <a
            href={ATTESTATION_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--cyan)" }}
          >
            docs.near.ai — Gateway Attestation
          </a>{" "}
          · public by explicit documented decision (nearai/infra#193) — no account, no key.
        </p>
        <button
          type="button"
          className="vg-btn-ghost vg-btn"
          onClick={runAttestation}
          disabled={attesting}
        >
          {attesting ? "Verifying…" : "Verify attestation evidence"}
        </button>

        {attestation && (
          <div className="vg-panel" style={{ marginTop: 20, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
              <span style={{ color: "var(--dim)", fontSize: 12, letterSpacing: 1 }}>
                OVERALL
              </span>
              <CheckBadge status={attestation.overall} />
              <span style={{ color: "var(--dim)", fontSize: 12.5 }}>
                HTTP {attestation.httpStatus} · {attestation.fetchedAt}
              </span>
            </div>
            {attestation.gatewaySigningAddress && (
              <div
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12.5,
                  color: "var(--muted)",
                  marginBottom: 14,
                }}
              >
                attested gateway signer: {attestation.gatewaySigningAddress}
              </div>
            )}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Check</th>
                  <th style={th}>Result</th>
                  <th style={th}>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {attestation.checks.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{c.label}</td>
                    <td style={td}>
                      <CheckBadge status={c.status} />
                    </td>
                    <td
                      style={{
                        ...td,
                        color: "var(--muted)",
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12,
                        wordBreak: "break-word",
                      }}
                    >
                      {c.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
              {attestation.honestyNote}
            </p>
          </div>
        )}
      </section>

      {/* ---- BYOK ---- */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          Bring your own NEAR AI Cloud key{" "}
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dim)" }}>
            (optional)
          </span>
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 14.5, marginBottom: 8, maxWidth: 720 }}>
          Confidential AI inference on NEAR AI Cloud needs an <code>sk-</code> key
          with purchased credits (or staked NEAR) — there is no free tier, so
          VAULTRY ships no key. If you have your own, paste it here: it is stored
          in <b>your browser&apos;s localStorage only</b> (
          <code>vg_byok_nearaicloud</code>) and is sent <b>browser → NEAR AI Cloud
          directly</b> — never to VAULTRY servers. Keyed requests run an
          attestation preflight first.
        </p>
        <p style={{ color: "var(--dim)", fontSize: 12.5, marginBottom: 20, maxWidth: 720 }}>
          Get a key at cloud.near.ai (their signup + credits are outside VAULTRY).
          The BYOK analysis path is implemented but not live-tested by us — your
          first run is the live test.
        </p>
        {byokSaved ? (
          <div className="vg-panel" style={{ padding: 18, display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ color: "#4ade80", fontWeight: 700, fontSize: 14 }}>
              ● Key saved in this browser
            </span>
            <button type="button" className="vg-btn-ghost vg-btn" onClick={removeKey}>
              Remove key
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, maxWidth: 560 }}>
            <input
              type="password"
              value={byokInput}
              onChange={(e) => setByokInput(e.target.value)}
              placeholder="sk-… (your NEAR AI Cloud key)"
              autoComplete="off"
              spellCheck={false}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid var(--panel-border)",
                background: "rgba(148,184,255,0.05)",
                color: "var(--text)",
                fontSize: 14,
                fontFamily: "ui-monospace, monospace",
              }}
            />
            <button type="button" className="vg-btn" onClick={saveKey} disabled={!byokInput.trim()}>
              Save in this browser
            </button>
          </div>
        )}
      </section>

      <div style={{ marginTop: 48 }}>
        <Link href="/" style={{ color: "var(--cyan)", fontSize: 14 }}>
          ← Back to VAULTRY
        </Link>
      </div>
    </main>
  );
}
