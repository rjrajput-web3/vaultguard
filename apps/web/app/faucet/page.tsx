"use client";

import AppShell from "../../components/AppShell";

/**
 * VAULTGUARD — NEAR Testnet Faucet page.
 *
 * Uses the OFFICIAL NEAR testnet helper (helper.testnet.near.org), verified
 * live 2026-11-02: POST /account creates a funded (10 NEAR) testnet account
 * with no captcha and no human step. A "funded" state is shown ONLY after
 * testnet RPC (rpc.testnet.fastnear.com) confirms the account balance —
 * never from the faucet HTTP response alone.
 *
 * HONESTY RULES in this file:
 *  - `funded` renders only from a real `getFundingStatus().exists === true`.
 *  - Every error message quotes the actual faucet/RPC response (FaucetError.detail).
 *  - Manual fallbacks are labeled with the exact human step required.
 */

import { useCallback, useRef, useState } from "react";
import { KeyPair } from "near-api-js";
import {
  createTestnetAccount,
  getFundingStatus,
  waitForFunding,
  validateTestnetAccountId,
  FaucetError,
  FAUCET_LIMITS_NOTE,
  MANUAL_FAUCETS,
  EXPLORER_TX_URL,
  type FundingStatus,
} from "../../lib/faucet";

type Phase = "idle" | "creating" | "pending" | "confirmed" | "error";

interface Step {
  label: string;
  state: "todo" | "doing" | "done" | "failed";
  detail?: string;
}

const EXPLORER_ACCOUNT = (id: string) => `https://explorer.testnet.near.org/accounts/${id}`;

function randomName(): string {
  const words = ["vault", "guard", "shield", "pact", "ledger", "sage", "mint", "cipher", "nimbus", "harbor"];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w}-${n}.testnet`;
}

function FaucetPageInner() {
  const [accountId, setAccountId] = useState("");
  const [idError, setIdError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<FundingStatus | null>(null);
  const [error, setError] = useState<{ title: string; message: string; detail?: string; code?: string } | null>(null);
  const busyRef = useRef(false);
  /** Set to true once the faucet broadcast returned a tx hash (step 1 done). */
  const broadcastDoneRef = useRef(false);

  const setStep = useCallback((idx: number, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const generateKeypair = useCallback(() => {
    const kp = KeyPair.fromRandom("ED25519");
    setPublicKey(kp.getPublicKey().toString());
    setSecretKey((kp as unknown as { secretKey?: string }).secretKey ?? "");
  }, []);

  const handleIdChange = useCallback(
    (v: string) => {
      const normalized = v.trim().toLowerCase();
      setAccountId(normalized);
      if (!normalized) {
        setIdError(null);
        return;
      }
      const check = validateTestnetAccountId(normalized);
      setIdError(check.ok ? null : check.reason);
    },
    [],
  );

  const fail = useCallback(
    (idx: number, title: string, message: string, code?: string, detail?: string) => {
      setStep(idx, { state: "failed" });
      setPhase("error");
      setError({ title, message, code, detail });
      busyRef.current = false;
    },
    [setStep],
  );

  const runCreate = useCallback(async () => {
    if (busyRef.current) return;
    const check = validateTestnetAccountId(accountId);
    if (!check.ok) {
      setIdError(check.reason);
      return;
    }
    if (!publicKey) {
      setError({ title: "No keypair", message: "Generate a keypair first — the faucet needs a public key to attach as FullAccess on the new account." });
      return;
    }
    busyRef.current = true;
    broadcastDoneRef.current = false;
    setError(null);
    setTxHash(null);
    setStatus(null);
    setSteps([
      { label: "Broadcast create+fund transaction to the official faucet", state: "doing" },
      { label: "Wait for testnet RPC to confirm the account (real balance check)", state: "todo" },
      { label: "Funded — balance confirmed on-chain", state: "todo" },
    ]);
    setPhase("creating");

    try {
      // Step 1 — official faucet broadcast.
      const created = await createTestnetAccount({ accountId, publicKey });
      setTxHash(created.txHash);
      broadcastDoneRef.current = true;
      setStep(0, { state: "done", detail: created.txHash });
      setStep(1, { state: "doing" });
      setPhase("pending");

      // Step 2 — ONLY RPC confirmation counts as "funded".
      const confirmed = await waitForFunding(accountId);
      setStatus(confirmed);
      setStep(1, { state: "done", detail: `${confirmed.balanceNear} NEAR confirmed` });
      setStep(2, { state: "done" });
      setPhase("confirmed");
      busyRef.current = false;
    } catch (e) {
      if (e instanceof FaucetError) {
        // Step 1 (broadcast) failed if we never got a tx hash; otherwise step 2 (confirmation).
        // A ref is used because React state is stale inside async catch blocks.
        const idx = broadcastDoneRef.current ? 1 : 0;
        const title =
          e.code === "ACCOUNT_EXISTS"
            ? "Account already exists"
            : e.code === "FAUCET_RATE_LIMITED"
              ? "Faucet rate-limited"
              : e.code === "SERVICE_DOWN"
                ? "Faucet service down"
                : e.code === "FUNDING_TIMEOUT"
                  ? "Confirmation timed out"
                  : e.code === "NETWORK_ERROR"
                    ? "Network error"
                    : "Faucet error";
        fail(idx, title, e.message, e.code, e.detail);
      } else {
        fail(0, "Unexpected error", e instanceof Error ? e.message : String(e));
      }
    }
  }, [accountId, publicKey, phase, fail, setStep]);

  const runLookup = useCallback(async () => {
    if (busyRef.current) return;
    const check = validateTestnetAccountId(accountId);
    if (!check.ok) {
      setIdError(check.reason);
      return;
    }
    busyRef.current = true;
    setError(null);
    setStatus(null);
    setTxHash(null);
    setPhase("pending");
    setSteps([{ label: `Read on-chain balance for ${accountId}`, state: "doing" }]);
    try {
      const s = await getFundingStatus(accountId);
      setStatus(s);
      if (s.exists) {
        setStep(0, { state: "done", detail: `${s.balanceNear} NEAR` });
        setPhase("confirmed");
      } else {
        setStep(0, { state: "failed", detail: "unknown account" });
        setError({
          title: "Account not found",
          message: `No account "${accountId}" exists on NEAR testnet. If you want this name, create it with the "Create & fund" button above.`,
          code: "UNKNOWN_ACCOUNT",
        });
        setPhase("error");
      }
    } catch (e) {
      setStep(0, { state: "failed" });
      const fe = e instanceof FaucetError ? e : null;
      setError({
        title: "Balance lookup failed",
        message: fe ? fe.message : e instanceof Error ? e.message : String(e),
        code: fe?.code,
        detail: fe?.detail,
      });
      setPhase("error");
    }
    busyRef.current = false;
  }, [accountId, setStep]);

  const busy = phase === "creating" || phase === "pending";
  const canCreate = !busy && !idError && accountId.length > 0 && publicKey.length > 0;

  return (
    <div className="vg-grid-bg">
      <nav className="vg-nav">
        <div className="vg-nav-inner">
          <a className="vg-brand" href="/">
            VAULTRY
          </a>
          <div className="vg-nav-links">
            <a href="/">Dashboard</a>
            <a href="/policy">Policy console</a>
            <a href="/faucet" style={{ color: "var(--ice)" }}>Testnet faucet</a>
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "140px 24px 80px" }}>
        <p className="vg-eyebrow">NEAR Testnet · Official faucet</p>
        <h1 className="vg-h2">Testnet Faucet</h1>
        <p className="vg-sub">
          Create a fresh NEAR testnet account funded with <b>10 testnet NEAR</b> through the official
          helper faucet (helper.testnet.near.org) — no captcha, no human step. The page shows
          “funded” only after testnet RPC confirms the balance on-chain.
        </p>

        {/* ---------------- creation card ---------------- */}
        <div className="vg-tx" style={{ borderRadius: 16, marginBottom: 28 }}>
          <div className="vg-field">
            <label className="vg-label" htmlFor="vg-acct">Account ID</label>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                id="vg-acct"
                className="vg-input"
                style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
                placeholder="my-wallet.testnet"
                value={accountId}
                onChange={(e) => handleIdChange(e.target.value)}
                disabled={busy}
                spellCheck={false}
              />
              <button type="button" className="vg-btn-ghost vg-btn" style={{ whiteSpace: "nowrap" }} onClick={() => handleIdChange(randomName())} disabled={busy}>
                Surprise me
              </button>
            </div>
            {idError && <p style={{ color: "#fca5a5", fontSize: 13, marginTop: 8 }}>{idError}</p>}
          </div>

          <div className="vg-field">
            <label className="vg-label">Keypair (FullAccess on the new account)</label>
            {publicKey ? (
              <div style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12.5, lineHeight: 1.7, wordBreak: "break-all" }}>
                <div style={{ color: "var(--muted)" }}>PUBLIC KEY</div>
                <div style={{ color: "var(--ice)" }}>{publicKey}</div>
                <div style={{ color: "var(--muted)", marginTop: 10 }}>SECRET KEY — save this now, it is shown once</div>
                <div style={{ color: "#fbbf24" }}>{secretKey}</div>
              </div>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>No keypair generated yet.</p>
            )}
            <button type="button" className="vg-btn-ghost vg-btn" style={{ marginTop: 12 }} onClick={generateKeypair} disabled={busy}>
              {publicKey ? "Regenerate keypair" : "Generate keypair"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" className="vg-btn" onClick={runCreate} disabled={!canCreate}>
              {phase === "creating" ? "Broadcasting…" : phase === "pending" ? "Confirming on-chain…" : "Create & fund (10 NEAR)"}
            </button>
            <button type="button" className="vg-btn-ghost vg-btn" onClick={runLookup} disabled={busy || !!idError || !accountId}>
              Check existing account balance
            </button>
          </div>
        </div>

        {/* ---------------- live timeline ---------------- */}
        {steps.length > 0 && (
          <div className="vg-tx" style={{ borderRadius: 16, marginBottom: 28 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, letterSpacing: 1 }}>LIVE STATUS</h3>
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {steps.map((s, i) => (
                <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: i ? "1px solid rgba(125,211,252,0.08)" : "none" }}>
                  <span
                    style={{
                      width: 22, height: 22, borderRadius: "50%", flex: "0 0 auto", marginTop: 2,
                      display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                      background:
                        s.state === "done" ? "rgba(34,197,94,0.2)" :
                        s.state === "doing" ? "rgba(56,189,248,0.2)" :
                        s.state === "failed" ? "rgba(239,68,68,0.2)" : "rgba(125,211,252,0.08)",
                      border:
                        s.state === "done" ? "1px solid rgba(34,197,94,0.6)" :
                        s.state === "doing" ? "1px solid rgba(56,189,248,0.6)" :
                        s.state === "failed" ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(125,211,252,0.2)",
                      color:
                        s.state === "done" ? "#4ade80" :
                        s.state === "doing" ? "#7dd3fc" :
                        s.state === "failed" ? "#fca5a5" : "var(--dim)",
                    }}
                  >
                    {s.state === "done" ? "✓" : s.state === "failed" ? "✕" : s.state === "doing" ? "…" : "○"}
                  </span>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{s.label}</div>
                    {s.detail && (
                      <div style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, color: "var(--muted)", marginTop: 4, wordBreak: "break-all" }}>
                        {s.detail}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {phase === "confirmed" && status?.exists && (
              <div className="vg-alert ok" style={{ marginTop: 16 }}>
                <b>Funded & confirmed on-chain.</b>
                <dl className="vg-kv" style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <div><dt>Account</dt><dd><a href={EXPLORER_ACCOUNT(status.accountId)} target="_blank" rel="noreferrer" style={{ color: "var(--ice)" }}>{status.accountId}</a></dd></div>
                  <div><dt>Balance (RPC)</dt><dd>{status.balanceNear} NEAR</dd></div>
                  {txHash && <div><dt>Funding tx</dt><dd><a href={EXPLORER_TX_URL(txHash)} target="_blank" rel="noreferrer" style={{ color: "var(--ice)" }}>{txHash.slice(0, 24)}…</a></dd></div>}
                </dl>
              </div>
            )}
          </div>
        )}

        {/* ---------------- error card ---------------- */}
        {phase === "error" && error && (
          <div className="vg-alert err" style={{ marginBottom: 28 }}>
            <b>{error.title}</b>
            {error.code && <span style={{ marginLeft: 10, fontFamily: "ui-monospace, monospace", fontSize: 12, opacity: 0.8 }}>[{error.code}]</span>}
            <p style={{ margin: "8px 0 0" }}>{error.message}</p>
            {error.detail && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 12.5 }}>Exact faucet / RPC response</summary>
                <pre style={{ fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: 0.85, marginTop: 8 }}>{error.detail.slice(0, 1200)}</pre>
              </details>
            )}
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="vg-btn" onClick={runCreate} disabled={error.code === "ACCOUNT_EXISTS"}>
                Retry
              </button>
              {error.code === "ACCOUNT_EXISTS" && (
                <button type="button" className="vg-btn-ghost vg-btn" onClick={runLookup}>
                  Check that account’s balance instead
                </button>
              )}
            </div>
          </div>
        )}

        {/* ---------------- limits + manual fallbacks ---------------- */}
        <div style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: 15, letterSpacing: 1, margin: "0 0 12px" }}>FAUCET LIMITS</h3>
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>{FAUCET_LIMITS_NOTE}</p>

          <h3 style={{ fontSize: 15, letterSpacing: 1, margin: "28px 0 12px" }}>MANUAL FALLBACKS (HUMAN STEP REQUIRED)</h3>
          <ul style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
            {MANUAL_FAUCETS.map((f) => (
              <li key={f.url} style={{ marginBottom: 12 }}>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ color: "var(--ice)", fontWeight: 600 }}>{f.name}</a>
                <br />
                <span style={{ fontSize: 13 }}>🧑 Human step: {f.humanStep}</span>
              </li>
            ))}
          </ul>

          <h3 style={{ fontSize: 15, letterSpacing: 1, margin: "28px 0 12px" }}>MULTI-CHAIN TESTNET FAUCETS</h3>
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
            Official faucets for the other VAULTRY testnets. Funding is confirmed only when
            your wallet shows a live on-chain balance — never from a faucet page alone.
            Find your addresses on the wallet's Multi-chain tab.
          </p>
          <ul style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
            {[
              { name: "Sepolia (Ethereum testnet)", url: "https://sepoliafaucet.com", note: "Free Alchemy account, or no-signup via stakely.io/faucet" },
              { name: "Base Sepolia", url: "https://www.alchemy.com/faucets/base-sepolia", note: "Free Alchemy account" },
              { name: "Solana Devnet", url: "https://faucet.solana.com", note: "Request a devnet airdrop for your address" },
            ].map((f) => (
              <li key={f.url} style={{ marginBottom: 12 }}>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ color: "var(--ice)", fontWeight: 600 }}>{f.name} ↗</a>
                <br />
                <span style={{ fontSize: 13 }}>{f.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}

export default function FaucetPage() {
  return (
    <AppShell>
      <FaucetPageInner />
    </AppShell>
  );
}
