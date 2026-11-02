"use client";

/**
 * Policy Console — device-local, per-visitor (2026-11-02).
 *
 * Your policy is stored in THIS browser only (localStorage) — never on a
 * server, never shared with other visitors. The Route Guardian reads it
 * before every swap: emergency pause BLOCKS execution, spending caps are
 * enforced against real quote amounts. A limit that doesn't enforce is a
 * broken promise — these do.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "../../components/BrandMark";
import {
  loadUserPolicy,
  saveUserPolicy,
  resetUserPolicy,
  type UserPolicy,
} from "../../lib/policy/user-policy";
import { getTodaySpendUsd } from "../../lib/policy/spend-tracker";

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

const TESTNET_ROUTERS = ["tidepool-intents"];

export default function PolicyPage() {
  const [policy, setPolicy] = useState<UserPolicy | null>(null);
  const [assetsText, setAssetsText] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [todaySpend, setTodaySpend] = useState(0);

  useEffect(() => {
    // Seed from server defaults, then apply this device's overrides.
    fetch("/api/policy")
      .then((r) => r.json())
      .then((d) => {
        const p = loadUserPolicy(d.policy ?? null);
        setPolicy(p);
        setAssetsText((p.allowedAssets ?? []).join("\n"));
      })
      .catch(() => {
        const p = loadUserPolicy(null);
        setPolicy(p);
        setAssetsText((p.allowedAssets ?? []).join("\n"));
      });
    setTodaySpend(getTodaySpendUsd());
  }, []);

  const set = <K extends keyof UserPolicy>(k: K, v: UserPolicy[K]) =>
    setPolicy((p) => (p ? { ...p, [k]: v } : p));

  const toggleRouter = (r: string) =>
    setPolicy((p) => {
      if (!p) return p;
      const has = p.allowedRouters.includes(r);
      return { ...p, allowedRouters: has ? p.allowedRouters.filter((x) => x !== r) : [...p.allowedRouters, r] };
    });

  function save() {
    if (!policy) return;
    setStatus(null);
    const body = { ...policy, allowedAssets: assetsText.split("\n").map((s) => s.trim()).filter(Boolean) };
    const r = saveUserPolicy(body);
    if (!r.ok) {
      setStatus({ kind: "err", msg: r.error });
    } else {
      setPolicy(body);
      setStatus({ kind: "ok", msg: "Saved on this device — the Route Guardian enforces it on your next swap." });
    }
  }

  function reset() {
    resetUserPolicy();
    const p = loadUserPolicy(null);
    setPolicy(p);
    setAssetsText((p.allowedAssets ?? []).join("\n"));
    setStatus({ kind: "ok", msg: "Reset to defaults." });
  }

  if (!policy) {
    return (
      <div className="vg-wrap" style={{ paddingTop: 120, paddingBottom: 60 }}>
        <div style={{ color: "var(--t-dim)" }}>Loading your policy…</div>
      </div>
    );
  }

  return (
    <>
      <nav className="vg-nav">
        <div className="vg-nav-inner">
          <Link className="vg-brand" href="/"><BrandMark size={32} /> VAULTRY</Link>
          <div className="vg-nav-links">
            <Link href="/swap">Swap</Link>
            <Link href="/wallet">Wallet</Link>
          </div>
          <span className="vg-badge info" style={{ marginLeft: 8 }}>POLICY CONSOLE</span>
        </div>
      </nav>
      <div className="vg-wrap" style={{ paddingTop: 100, paddingBottom: 60, maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
          <Shield />
          <h1 className="vg-h2" style={{ margin: 0 }}>Policy Console</h1>
        </div>
        <p className="vg-sub" style={{ marginBottom: 6 }}>
          Your fund-protection controls. The Route Guardian enforces these{" "}
          <b>before</b> any swap is signed — a paused console freezes execution,
          and spending caps block over-limit quotes.
        </p>
        <p style={{ fontSize: 12.5, color: "var(--t-dim)", marginBottom: 20 }}>
          Stored on <b>this device only</b> — never on a server, never shared with other visitors.
          Testnet only.
        </p>

        {status && (
          <div
            role={status.kind === "err" ? "alert" : "status"}
            style={{
              background: status.kind === "err" ? "rgba(248,113,113,0.10)" : "rgba(52,211,153,0.08)",
              border: `1px solid ${status.kind === "err" ? "rgba(248,113,113,0.4)" : "rgba(52,211,153,0.35)"}`,
              borderRadius: 10, padding: "10px 14px", fontSize: 13.5, marginBottom: 16,
              color: status.kind === "err" ? "#fca5a5" : "#6ee7b7",
            }}
          >
            {status.msg}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 16, borderRadius: 12, background: policy.paused ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.06)", border: `1px solid ${policy.paused ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.25)"}`, marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={policy.paused} onChange={(e) => set("paused", e.target.checked)} style={{ width: 20, height: 20 }} />
            <div>
              <div style={{ fontWeight: 700 }}>Emergency pause {policy.paused && <span style={{ color: "#f87171" }}>— ACTIVE</span>}</div>
              <div style={{ fontSize: 13, color: "#93a0b8" }}>{policy.paused ? "All swaps halt — nothing can execute until you unpause." : "Swaps live — flip to freeze every swap instantly."}</div>
            </div>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--t-dim)", display: "block", marginBottom: 6 }}>MAX SPEND PER TX (USD)</span>
            <input className="vg-input" type="number" min={0} value={policy.maxSpendPerTx} onChange={(e) => set("maxSpendPerTx", Number(e.target.value))} />
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--t-dim)", display: "block", marginBottom: 6 }}>MAX SPEND PER DAY (USD)</span>
            <input className="vg-input" type="number" min={0} value={policy.maxSpendPerDay} onChange={(e) => set("maxSpendPerDay", Number(e.target.value))} />
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--t-dim)", marginBottom: 16 }}>
          Spent on testnet swaps today: <b style={{ color: "#fff" }}>${todaySpend.toFixed(2)}</b>
        </div>

        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--t-dim)", display: "block", marginBottom: 8 }}>ALLOWED ROUTERS (testnet)</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TESTNET_ROUTERS.map((r) => (
              <label key={r} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10, border: `1px solid ${policy.allowedRouters.includes(r) ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.12)"}`, cursor: "pointer", fontSize: 13.5 }}>
                <input type="checkbox" checked={policy.allowedRouters.includes(r)} onChange={() => toggleRouter(r)} />
                {r}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--t-dim)", marginTop: 8 }}>
            Only the TidePool Intents router exists on testnet. Unticking it blocks all swaps at the guardian.
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--t-dim)", display: "block", marginBottom: 8 }}>ALLOWED ASSETS (one per line)</span>
          <textarea className="vg-input" rows={4} value={assetsText} onChange={(e) => setAssetsText(e.target.value)} style={{ fontFamily: "monospace", fontSize: 12.5 }} />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="vg-btn" onClick={save}>Save policy</button>
          <button className="vg-btn vg-btn-ghost" onClick={reset}>Reset to defaults</button>
        </div>
      </div>
    </>
  );
}
