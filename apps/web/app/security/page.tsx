"use client";

/**
 * /security — AI Security & Defense: live risk engine (2026-11-02).
 *
 * TESTNET-ONLY. Runs a REAL TidePool testnet quote through the Route
 * Guardian (checkTestnetSwap) and the device-local detectors:
 * denylisted addresses, abnormal slippage, unverified tokens. Every
 * verdict is computed from live data — nothing is mocked.
 *
 * This is the "refuses to swap blind" engine: the same guardian that
 * gates /swap execution.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "../../components/BrandMark";
import {
  checkTestnetSwap,
  type GuardianResult,
} from "../../lib/guardian/testnet-guardian";
import {
  detectDenylistedAddress,
  checkAllowlist,
  loadLists,
  saveLists,
  type AddressLists,
} from "../../lib/security/detectors";

const TRIGGERS_KEY = "vaultry.security.triggers.v1";

interface Trigger {
  ts: string;
  routeKey: string;
  decision: string;
  alert: string;
}

interface ScanResult {
  routeKey: string;
  amountIn: string;
  amountOut: string;
  guardian: GuardianResult;
  detectorNotes: string[];
  latencyMs: number;
  fetchedAt: string;
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function SecurityPage() {
  const [amount, setAmount] = useState("10");
  const [recipient, setRecipient] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<AddressLists>({ allowlist: [], denylist: [] });
  const [newAllow, setNewAllow] = useState("");
  const [newDeny, setNewDeny] = useState("");
  const [triggers, setTriggers] = useState<Trigger[]>([]);

  useEffect(() => {
    setLists(loadLists());
    setTriggers(loadJson<Trigger[]>(TRIGGERS_KEY, []));
  }, []);

  function recordTrigger(t: Trigger) {
    setTriggers((prev) => {
      const next = [...prev, t];
      try {
        window.localStorage.setItem(TRIGGERS_KEY, JSON.stringify(next));
      } catch { /* noop */ }
      return next;
    });
  }

  async function runLiveScan() {
    setLoading(true);
    setError(null);
    setScan(null);
    const amountNum = Number(amount);
    const routeKey = `test USDC → test wNEAR · ${amountNum}`;
    try {
      if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 10000)
        throw new Error("amount must be a number between 0 and 10,000");
      const recip = recipient.trim() || "vgdeployer.testnet";
      const started = Date.now();
      const res = await fetch(
        `/api/tidepool/quote?amount=${encodeURIComponent(amount)}&from=usdc&to=wnear`,
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        amountIn?: string;
        amountInBaseUnits?: string;
        amountOut?: string;
        amountOutBaseUnits?: string;
        minAmountOut?: string;
        amountOutUsd?: string;
        timeEstimateSec?: number;
      };
      const latencyMs = Date.now() - started;
      if (!data.ok) throw new Error(`live quote failed: ${data.error ?? "unknown"} — shown verbatim`);

      // Route Guardian: the real pre-signing gate.
      const guardian = checkTestnetSwap(
        {
          amountInBaseUnits: data.amountInBaseUnits!,
          amountOutBaseUnits: data.amountOutBaseUnits!,
          minAmountOutBaseUnits: data.minAmountOut,
          amountOutUsd: data.amountOutUsd,
          timeEstimateSec: data.timeEstimateSec,
          receivedAtMs: Date.now(),
        },
        {
          fromTokenKey: "usdc",
          toTokenKey: "wnear",
          fromTokenId: "nep141:usdc.tidepool-sandbox.testnet",
          toTokenId: "nep141:wnear.tidepool-sandbox.testnet",
          amountInBaseUnits: data.amountInBaseUnits!,
          slippageBps: 100,
          recipient: recip,
        },
      );

      // Device-local detectors: denylist / allowlist on the recipient.
      const detectorNotes: string[] = [];
      const deny = detectDenylistedAddress(recip, lists.denylist);
      if (deny.verdict === "fail") detectorNotes.push(`DENYLIST: ${deny.detail}`);
      const allow = checkAllowlist(recip, lists.allowlist);
      if (lists.allowlist.length > 0)
        detectorNotes.push(allow.verdict === "pass" ? `ALLOWLIST: ${allow.detail}` : `ALLOWLIST: ${recip} not on allowlist`);

      if (guardian.verdict === "BLOCKED") {
        recordTrigger({
          ts: new Date().toISOString(),
          routeKey,
          decision: guardian.verdict,
          alert: guardian.reasons.join(" · "),
        });
      }

      setScan({
        routeKey,
        amountIn: `${data.amountIn} test USDC`,
        amountOut: `${data.amountOut} test wNEAR`,
        guardian,
        detectorNotes,
        latencyMs,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function addToList(kind: "allowlist" | "denylist", value: string) {
    const v = value.trim();
    if (!v) return;
    const next = { ...lists, [kind]: [...lists[kind], v] };
    setLists(next);
    saveLists(next);
    if (kind === "allowlist") setNewAllow("");
    else setNewDeny("");
  }

  const verdictColor =
    !scan ? "#94a3b8"
    : scan.guardian.verdict === "SAFE" ? "#34d399"
    : scan.guardian.verdict === "CAUTION" ? "#fbbf24" : "#f87171";

  return (
    <>
      <nav className="vg-nav">
        <div className="vg-nav-inner">
          <Link className="vg-brand" href="/"><BrandMark size={32} /> VAULTRY</Link>
          <div className="vg-nav-links">
            <Link href="/swap">Swap</Link>
            <Link href="/policy">Policy Console</Link>
          </div>
          <span className="vg-badge info" style={{ marginLeft: 8 }}>TESTNET</span>
        </div>
      </nav>
      <div className="vg-wrap" style={{ paddingTop: 100, paddingBottom: 60, maxWidth: 760 }}>
        <div className="vg-eyebrow">AI SECURITY &amp; DEFENSE</div>
        <h1 className="vg-h2">Route Guardian <span className="grad-text">live scan</span></h1>
        <p className="vg-sub" style={{ marginBottom: 20 }}>
          The same engine that gates every swap on <a href="/swap" style={{ color: "#22d3ee" }}>/swap</a> —
          run it here against a <b>live</b> TidePool testnet quote. BLOCKED means the swap
          cannot execute. Testnet only; valueless tokens.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <input
            className="vg-input"
            style={{ maxWidth: 160 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (test USDC)"
            inputMode="decimal"
          />
          <input
            className="vg-input"
            style={{ maxWidth: 260 }}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Recipient (default: vgdeployer.testnet)"
          />
          <button className="vg-btn" onClick={() => void runLiveScan()} disabled={loading}>
            {loading ? "Scanning…" : "Run live scan"}
          </button>
        </div>

        {error && (
          <div role="alert" style={{ background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 10, padding: "10px 14px", fontSize: 13.5, color: "#fca5a5", marginBottom: 16 }}>
            {error}
          </div>
        )}

        {scan && (
          <div style={{ background: "rgba(13,10,28,0.72)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 16, padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--t-dim)" }}>{scan.routeKey}</span>
              <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, color: verdictColor }}>
                {scan.guardian.verdict} · {scan.guardian.score}/100
              </span>
            </div>
            <div style={{ fontSize: 14, marginBottom: 12 }}>
              {scan.amountIn} → <b>{scan.amountOut}</b>
              <span style={{ color: "var(--t-dim)", fontSize: 12.5, marginLeft: 10 }}>quote latency {scan.latencyMs}ms</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--t-dim)" }}>
              {scan.guardian.reasons.map((r, i) => (
                <li key={i} style={{ marginBottom: 4, color: r.startsWith("BLOCKED") ? "#fca5a5" : r.startsWith("CAUTION") ? "#fcd34d" : undefined }}>{r}</li>
              ))}
              {scan.detectorNotes.map((n, i) => (
                <li key={`d${i}`} style={{ marginBottom: 4 }}>{n}</li>
              ))}
            </ul>
            <div style={{ fontSize: 11.5, color: "var(--t-dim)", marginTop: 10 }}>
              Scanned {new Date(scan.fetchedAt).toLocaleString()} · score {scan.guardian.score}/100 (higher = riskier)
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>
          <div style={{ background: "rgba(13,10,28,0.6)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 14, padding: 16 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Denylist</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input className="vg-input" value={newDeny} onChange={(e) => setNewDeny(e.target.value)} placeholder="address to block" style={{ fontSize: 13 }} />
              <button className="vg-btn vg-btn-ghost" onClick={() => addToList("denylist", newDeny)}>Add</button>
            </div>
            {lists.denylist.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--t-dim)" }}>Empty — scans to a denylisted recipient trigger an alert.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{lists.denylist.map((a, i) => <li key={i} style={{ fontFamily: "monospace", fontSize: 12 }}>{a}</li>)}</ul>
            )}
          </div>
          <div style={{ background: "rgba(13,10,28,0.6)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 14, padding: 16 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Allowlist</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input className="vg-input" value={newAllow} onChange={(e) => setNewAllow(e.target.value)} placeholder="trusted address" style={{ fontSize: 13 }} />
              <button className="vg-btn vg-btn-ghost" onClick={() => addToList("allowlist", newAllow)}>Add</button>
            </div>
            {lists.allowlist.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--t-dim)" }}>Empty — allowlist checks are skipped until you add addresses.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{lists.allowlist.map((a, i) => <li key={i} style={{ fontFamily: "monospace", fontSize: 12 }}>{a}</li>)}</ul>
            )}
          </div>
        </div>

        {triggers.length > 0 && (
          <div>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>BLOCKED trigger history (this device)</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--t-dim)" }}>
              {triggers.slice(-10).reverse().map((t, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  <b style={{ color: "#fca5a5" }}>{t.decision}</b> · {t.routeKey} ·{" "}
                  <span title={t.alert}>{t.alert.slice(0, 90)}{t.alert.length > 90 ? "…" : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
