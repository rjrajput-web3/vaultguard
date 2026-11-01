"use client";

/** VAULTGUARD policy editor — reads/writes the guardian's vault policy JSON. */

import { useEffect, useState } from "react";
import Link from "next/link";

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

const card: React.CSSProperties = {
  background: "#111a2e",
  border: "1px solid #22304d",
  borderRadius: 12,
  padding: 24,
  marginTop: 20,
};
const label: React.CSSProperties = {
  display: "block",
  color: "#9aa4b8",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0a0f1e",
  border: "1px solid #22304d",
  borderRadius: 8,
  color: "#e8ecf4",
  padding: "10px 12px",
  fontSize: 15,
};
const field: React.CSSProperties = { marginBottom: 18 };

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

  if (!policy) {
    return (
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px" }}>
        <p style={{ color: "#9aa4b8" }}>Loading policy…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px" }}>
      <Link href="/" style={{ color: "#7dd3fc", fontSize: 14 }}>← VAULTGUARD home</Link>
      <h1 style={{ fontSize: 32, margin: "12px 0 4px" }}>Vault policy</h1>
      <p style={{ color: "#9aa4b8", marginTop: 0 }}>
        Spending limits and asset permissions. The guardian pre-checks every quote against this
        policy; the on-chain vault contract enforces it as the final authority.
      </p>

      {status && (
        <div
          style={{
            background: status.kind === "ok" ? "#22c55e22" : "#ef444422",
            border: `1px solid ${status.kind === "ok" ? "#22c55e" : "#ef4444"}`,
            borderRadius: 8,
            padding: "10px 16px",
            fontSize: 14,
            marginTop: 16,
          }}
        >
          {status.msg}
        </div>
      )}

      <section style={card}>
        <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Guardian controls</h2>
        <div style={field}>
          <label style={label}>Vault ID</label>
          <input style={input} value={policy.vaultId} onChange={(e) => set("vaultId", e.target.value)} />
        </div>
        <div style={field}>
          <label style={label}>Guardian account</label>
          <input style={input} value={policy.guardian} onChange={(e) => set("guardian", e.target.value)} />
        </div>
        <div style={{ ...field, display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="checkbox"
            checked={policy.paused}
            onChange={(e) => set("paused", e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          <span style={{ fontWeight: 600 }}>
            Vault paused {policy.paused && <span style={{ color: "#ef4444" }}>— all routes halt</span>}
          </span>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Spending limits (USDC)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={field}>
            <label style={label}>Max per transaction</label>
            <input
              style={input}
              type="number"
              min={0}
              value={policy.maxSpendPerTx}
              onChange={(e) => set("maxSpendPerTx", Number(e.target.value))}
            />
          </div>
          <div style={field}>
            <label style={label}>Max per day</label>
            <input
              style={input}
              type="number"
              min={0}
              value={policy.maxSpendPerDay}
              onChange={(e) => set("maxSpendPerDay", Number(e.target.value))}
            />
          </div>
          <div style={field}>
            <label style={label}>Max hedge slippage %</label>
            <input
              style={input}
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={policy.maxHedgeSlippagePct}
              onChange={(e) => set("maxHedgeSlippagePct", Number(e.target.value))}
            />
          </div>
          <div style={field}>
            <label style={label}>Max hedge fee %</label>
            <input
              style={input}
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={policy.maxHedgeFeePct}
              onChange={(e) => set("maxHedgeFeePct", Number(e.target.value))}
            />
          </div>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Allowed assets</h2>
        <div style={field}>
          <label style={label}>One “chain:address” per line</label>
          <textarea
            style={{ ...input, minHeight: 90, fontFamily: "monospace", fontSize: 13 }}
            value={assetsText}
            onChange={(e) => setAssetsText(e.target.value)}
          />
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Allowed routers</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {routers.map((r) => (
            <label
              key={r}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: policy.allowedRouters.includes(r) ? "#22c55e22" : "#0a0f1e",
                border: `1px solid ${policy.allowedRouters.includes(r) ? "#22c55e" : "#22304d"}`,
                borderRadius: 999,
                padding: "8px 14px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={policy.allowedRouters.includes(r)}
                onChange={() => toggleRouter(r)}
              />
              {r}
            </label>
          ))}
        </div>
      </section>

      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: "#22c55e",
            color: "#0a0f1e",
            fontWeight: 800,
            border: "none",
            borderRadius: 8,
            padding: "12px 28px",
            fontSize: 15,
            cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save policy"}
        </button>
      </div>
    </main>
  );
}
