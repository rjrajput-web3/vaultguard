"use client";

/** VAULTGUARD policy editor — premium edition. Backend logic unchanged (/api/policy). */

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "../../components/BrandMark";

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

function Shield({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="shg2" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="0.55" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <path d="M32 4 56 12v18c0 14-9.5 24.5-24 30C17.5 54.5 8 44 8 30V12L32 4z" stroke="url(#shg2)" strokeWidth="3.5" fill="rgba(34,211,238,0.08)" />
      <path d="M22 32l7 7 13-14" stroke="url(#shg2)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PolicyPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [routers, setRouters] = useState<string[]>([]);
  const [assetsText, setAssetsText] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/policy")
      .then((r) => r.json())
      .then((d) => {
        setPolicy(d.policy);
        setRouters(d.knownRouters ?? []);
        setAssetsText((d.policy.allowedAssets ?? []).join("\n"));
      })
      .catch((e) => setStatus({ kind: "err", msg: `load failed: ${String(e)}` }));
  }, []);

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
    const body = { ...policy, allowedAssets: assetsText.split("\n").map((s) => s.trim()).filter(Boolean) };
    try {
      const r = await fetch("/api/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    <>
      <nav className="vg-nav">
        <div className="vg-nav-inner">
          <Link className="vg-brand" href="/"><BrandMark size={32} /> VAULTRY</Link>
          <div className="vg-nav-links">
            <Link href="/#scanner">Risk scanner</Link>
            <Link href="/#proof">On-chain proof</Link>
          </div>
          <span className="vg-badge info" style={{ marginLeft: 8 }}>POLICY CONSOLE</span>
        </div>
      </nav>

      <main style={{ padding: "120px 0 80px" }}>
        <div className="vg-wrap" style={{ maxWidth: 960 }}>
          <div className="vg-eyebrow">Guardian policy</div>
          <h1 className="vg-h2">Vault policy <span className="grad-text">console.</span></h1>
          <p className="vg-sub">
            This policy steers the <strong>off-chain guardian</strong> — caps, assets, routers, pause.
            The <strong>on-chain contract</strong> carries its own hard cap as the final authority;
            the two are aligned by the guardian operator, not auto-synced.
          </p>

          {status && <div className={`vg-alert ${status.kind}`}>{status.msg}</div>}

          {!policy ? (
            <div className="glass glass-pad"><p style={{ color: "#93a0b8" }}>Loading policy…</p></div>
          ) : (
            <>
              <section className="glass glass-pad fade-up" style={{ marginBottom: 24 }}>
                <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Guardian controls</h2>
                <div className="vg-field">
                  <label className="vg-label">Vault ID</label>
                  <input className="vg-input" value={policy.vaultId} onChange={(e) => set("vaultId", e.target.value)} />
                </div>
                <div className="vg-field">
                  <label className="vg-label">Guardian account</label>
                  <input className="vg-input" value={policy.guardian} onChange={(e) => set("guardian", e.target.value)} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px", borderRadius: 12, background: policy.paused ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.06)", border: `1px solid ${policy.paused ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.25)"}` }}>
                  <label className="vg-switch">
                    <input type="checkbox" checked={policy.paused} onChange={(e) => set("paused", e.target.checked)} />
                    <span className="track" />
                  </label>
                  <div>
                    <div style={{ fontWeight: 700 }}>Emergency pause {policy.paused && <span style={{ color: "#f87171" }}>— ACTIVE</span>}</div>
                    <div style={{ fontSize: 13, color: "#93a0b8" }}>{policy.paused ? "All routes halt — withdrawals stop until unpaused." : "Vault live — flip to halt every route instantly."}</div>
                  </div>
                </div>
              </section>

              <section className="glass glass-pad fade-up d1" style={{ marginBottom: 24 }}>
                <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Spending limits <span style={{ color: "#5b6a84", fontWeight: 400, fontSize: 14 }}>(USDC)</span></h2>
                <div className="grid-2">
                  <div className="vg-field">
                    <label className="vg-label">Max per transaction</label>
                    <input className="vg-input" type="number" min={0} value={policy.maxSpendPerTx} onChange={(e) => set("maxSpendPerTx", Number(e.target.value))} />
                  </div>
                  <div className="vg-field">
                    <label className="vg-label">Max per day</label>
                    <input className="vg-input" type="number" min={0} value={policy.maxSpendPerDay} onChange={(e) => set("maxSpendPerDay", Number(e.target.value))} />
                  </div>
                  <div className="vg-field">
                    <label className="vg-label">Max hedge slippage %</label>
                    <input className="vg-input" type="number" min={0} max={100} step={0.1} value={policy.maxHedgeSlippagePct} onChange={(e) => set("maxHedgeSlippagePct", Number(e.target.value))} />
                  </div>
                  <div className="vg-field">
                    <label className="vg-label">Max hedge fee %</label>
                    <input className="vg-input" type="number" min={0} max={100} step={0.1} value={policy.maxHedgeFeePct} onChange={(e) => set("maxHedgeFeePct", Number(e.target.value))} />
                  </div>
                </div>
              </section>

              <section className="glass glass-pad fade-up d2" style={{ marginBottom: 24 }}>
                <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Allowed assets</h2>
                <div className="vg-field">
                  <label className="vg-label">One “chain:address” per line</label>
                  <textarea className="vg-textarea" value={assetsText} onChange={(e) => setAssetsText(e.target.value)} />
                </div>
              </section>

              <section className="glass glass-pad fade-up d3" style={{ marginBottom: 24 }}>
                <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Allowed routers</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {routers.map((r) => (
                    <span key={r} className={`vg-chip ${policy.allowedRouters.includes(r) ? "on" : ""}`} onClick={() => toggleRouter(r)}>
                      {policy.allowedRouters.includes(r) ? "●" : "○"} {r}
                    </span>
                  ))}
                </div>
              </section>

              <div style={{ display: "flex", gap: 12 }}>
                <button className="vg-btn" onClick={save} disabled={saving} style={{ fontSize: 16, padding: "14px 36px" }}>
                  {saving ? "Saving…" : "✓ Save policy"}
                </button>
                <Link className="vg-btn vg-btn-ghost" href="/">← Back to dashboard</Link>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
