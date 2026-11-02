/**
 * PolicyModal — a working Policy Console modal wired to the REAL /api/policy
 * GET/PUT (same contract as app/policy/page.tsx). Spending limits +
 * allowed-router toggles + pause switch. Saves persist via the API;
 * success/error is reported honestly. No mocked data.
 */
"use client";

import { useEffect, useState } from "react";

interface Policy {
  vaultId: string;
  guardian: string;
  paused: boolean;
  maxSpendPerTx: number;
  maxSpendPerDay: number;
  allowedAssets: string[];
  allowedRouters: string[];
  maxHedgeSlippagePct: number;
  maxHedgeFeePct: number;
}

export default function PolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [routers, setRouters] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    fetch("/api/policy")
      .then((r) => r.json())
      .then((d) => {
        setPolicy(d.policy);
        setRouters(d.knownRouters ?? []);
      })
      .catch((e) => setStatus({ kind: "err", msg: `load failed: ${String(e)}` }));
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof Policy>(k: K, v: Policy[K]) =>
    setPolicy((p) => (p ? { ...p, [k]: v } : p));

  const toggleRouter = (r: string) =>
    setPolicy((p) => {
      if (!p) return p;
      const has = p.allowedRouters.includes(r);
      return { ...p, allowedRouters: has ? p.allowedRouters.filter((x) => x !== r) : [...p.allowedRouters, r] };
    });

  async function save() {
    if (!policy) return;
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch("/api/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus({ kind: "err", msg: (d.errors ?? [d.error ?? "save failed"]).join(" · ") });
      } else {
        setPolicy(d.policy);
        setStatus({ kind: "ok", msg: "Policy saved — the guardian loop picks it up on its next tick." });
      }
    } catch (e) {
      setStatus({ kind: "err", msg: `save failed: ${String(e)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Policy Console">
      <div className="modal-panel glass" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="vg-eyebrow" style={{ marginBottom: 6 }}>Guardian policy</div>
            <h3 style={{ margin: 0, fontSize: 22 }}>Policy <span className="grad-text">Console</span></h3>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {status && <div className={`vg-alert ${status.kind}`}>{status.msg}</div>}

        {!policy ? (
          <p className="hp-muted">Loading policy…</p>
        ) : (
          <>
            <div className="grid-2" style={{ gap: 16 }}>
              <div className="vg-field" style={{ marginBottom: 0 }}>
                <label className="vg-label">Max per transaction (USDC)</label>
                <input className="vg-input" type="number" min={0} value={policy.maxSpendPerTx} onChange={(e) => set("maxSpendPerTx", Number(e.target.value))} />
              </div>
              <div className="vg-field" style={{ marginBottom: 0 }}>
                <label className="vg-label">Max per day (USDC)</label>
                <input className="vg-input" type="number" min={0} value={policy.maxSpendPerDay} onChange={(e) => set("maxSpendPerDay", Number(e.target.value))} />
              </div>
              <div className="vg-field" style={{ marginBottom: 0 }}>
                <label className="vg-label">Max hedge slippage %</label>
                <input className="vg-input" type="number" min={0} max={100} step={0.1} value={policy.maxHedgeSlippagePct} onChange={(e) => set("maxHedgeSlippagePct", Number(e.target.value))} />
              </div>
              <div className="vg-field" style={{ marginBottom: 0 }}>
                <label className="vg-label">Max hedge fee %</label>
                <input className="vg-input" type="number" min={0} max={100} step={0.1} value={policy.maxHedgeFeePct} onChange={(e) => set("maxHedgeFeePct", Number(e.target.value))} />
              </div>
            </div>

            <div className="vg-field" style={{ marginTop: 18 }}>
              <label className="vg-label">Allowed routers</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {routers.map((r) => (
                  <span key={r} className={`vg-chip ${policy.allowedRouters.includes(r) ? "on" : ""}`} onClick={() => toggleRouter(r)}>
                    {policy.allowedRouters.includes(r) ? "●" : "○"} {r}
                  </span>
                ))}
              </div>
            </div>

            <div
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 12, marginTop: 4,
                background: policy.paused ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.06)",
                border: `1px solid ${policy.paused ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.25)"}`,
              }}
            >
              <label className="vg-switch">
                <input type="checkbox" checked={policy.paused} onChange={(e) => set("paused", e.target.checked)} />
                <span className="track" />
              </label>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Emergency pause {policy.paused && <span style={{ color: "#f87171" }}>— ACTIVE</span>}</div>
                <div style={{ fontSize: 12.5, color: "rgba(196,181,253,0.65)" }}>Halts every route instantly until unpaused.</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <button className="vg-btn" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "✓ Save policy"}
              </button>
              <a className="vg-btn vg-btn-ghost" href="/policy">Open full editor →</a>
            </div>
            <p className="hp-muted" style={{ fontSize: 12, marginTop: 14 }}>
              Caps are pre-checked by the guardian; the on-chain contract is the final authority.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
