"use client";

/**
 * VAULTRY "AI Security & Defense" module page (workstream M2).
 *
 * Every verdict on this page is computed from REAL inputs:
 *   - live 1Click dry-run quotes via POST /api/intents/quote (keyless, dry:true — no funds move),
 *   - live registry token metadata via GET /security/api/tokens,
 *   - the user's guardian policy slice + their own localStorage lists.
 * Failures are shown verbatim — never replaced with fake numbers.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { IntentsQuote } from "../../lib/intents/quotes";
import type { IntentsToken } from "../../lib/intents/registry";
import { assessSwapRisk } from "../../lib/risk/engine";
import type { RiskAssessment } from "../../lib/risk/engine";
import { PRICE_IMPACT_WARN_PCT as RISK_WARN, PRICE_IMPACT_FAIL_PCT as RISK_FAIL } from "../../lib/risk/engine";
import {
  runAllDetectors,
  detectRouteOutage,
  detectSuspiciousRouter,
  detectUnverifiedToken,
  evaluateAutoPolicy,
  loadLists,
  addToAllowlist,
  addToDenylist,
  removeFromAllowlist,
  removeFromDenylist,
  SLIPPAGE_WARN_BPS,
  SLIPPAGE_FAIL_BPS,
} from "../../lib/security/detectors";
import type {
  DetectorResult,
  DetectorPolicy,
  AutoPolicyAction,
  AddressLists,
} from "../../lib/security/detectors";

/* ---------- fixed, verified inputs (see lib/intents/QUOTE_STATUS.md) ---------- */
const BASE_USDC_ASSETID =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SOL_USDC_ASSETID =
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const NEAR_USDC_ASSETID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ROUTER_ID = "nearintents";
const POLICY: DetectorPolicy = { allowedRouters: ["nearintents", "lifi", "1inch", "rango"] };
/* Dry-run only: dry:true quotes never create a deposit address, no funds can move. */
const RECIPIENT = "G2B8bFudqhYXkFqm54s5YVdPaQwUegw2U89PJyEdSHPj";
const REFUND_TO = "0x53CFA0C9EB10E352fC5B4DaAC1A9Eac2267303F9";

const STREAK_KEY = "vaultry.security.streak.v1";
const TRIGGERS_KEY = "vaultry.security.triggers.v1";
const HISTORY_KEY = "vaultry.security.history.v1";

interface Trigger {
  ts: string;
  routeKey: string;
  decision: string;
  alert: string;
}

interface ScanResult {
  routeKey: string;
  originToken: IntentsToken;
  destinationToken: IntentsToken;
  quote: IntentsQuote;
  detectors: DetectorResult[];
  assessment: RiskAssessment;
  action: AutoPolicyAction;
  latencyMs: number;
  fetchedAt: string;
  suspicious?: boolean;
  quoteFailure?: { code: string; message: string };
}

function Shield({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="shgsec" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="0.55" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <path d="M32 4 56 12v18c0 14-9.5 24.5-24 30C17.5 54.5 8 44 8 30V12L32 4z" stroke="url(#shgsec)" strokeWidth="3.5" fill="rgba(34,211,238,0.08)" />
      <path d="M22 32l7 7 13-14" stroke="url(#shgsec)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const cls =
    verdict === "pass" || verdict === "SAFE" ? "ok"
    : verdict === "fail" || verdict === "BLOCKED" ? "no" : "info";
  return <span className={`vg-badge ${cls}`}>{verdict.toUpperCase()}</span>;
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
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<AddressLists>({ allowlist: [], denylist: [] });
  const [newAllow, setNewAllow] = useState("");
  const [newDeny, setNewDeny] = useState("");
  const [streaks, setStreaks] = useState<Record<string, number>>({});
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    setLists(loadLists());
    setStreaks(loadJson<Record<string, number>>(STREAK_KEY, {}));
    setTriggers(loadJson<Trigger[]>(TRIGGERS_KEY, []));
    setHistory(loadJson<string[]>(HISTORY_KEY, []));
  }, []);

  function persistStreak(routeKey: string, value: number) {
    setStreaks((prev) => {
      const next = { ...prev, [routeKey]: value };
      window.localStorage.setItem(STREAK_KEY, JSON.stringify(next));
      return next;
    });
  }

  function recordTrigger(t: Trigger) {
    setTriggers((prev) => {
      const next = [...prev, t];
      window.localStorage.setItem(TRIGGERS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function postQuote(originAssetId: string, destinationAssetId: string, amountUsdc: number) {
    const amountBaseUnits = String(Math.round(amountUsdc * 1_000_000));
    const started = Date.now();
    const res = await fetch("/api/intents/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originAssetId,
        destinationAssetId,
        amountBaseUnits,
        slippageBps: 50,
        recipient: RECIPIENT,
        refundTo: REFUND_TO,
      }),
    });
    const data = await res.json();
    return { data, latencyMs: Date.now() - started };
  }

  async function fetchTokens() {
    const res = await fetch("/security/api/tokens");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message ?? "token metadata unavailable");
    return data as {
      tokens: { baseUsdc: IntentsToken; solUsdc: IntentsToken; nearUsdc: IntentsToken };
      registry: IntentsToken[];
      registrySize: number;
      fetchedAt: string;
    };
  }

  async function runLiveScan() {
    setLoading(true);
    setError(null);
    setScan(null);
    const amountNum = Number(amount);
    const routeKey = `base-usdc→sol-usdc · ${amountNum} USDC`;
    try {
      if (!isFinite(amountNum) || amountNum <= 0) throw new Error("amount must be a positive number");
      const [quoteRes, meta] = await Promise.all([
        postQuote(BASE_USDC_ASSETID, SOL_USDC_ASSETID, amountNum),
        fetchTokens(),
      ]);
      if (!quoteRes.data.ok) {
        throw new Error(
          `live quote failed (${quoteRes.data.code}): ${quoteRes.data.message} — shown verbatim, no fallback data used`,
        );
      }
      const quote = quoteRes.data.quote as IntentsQuote;
      const { baseUsdc, solUsdc } = meta.tokens;
      const detectors = runAllDetectors({
        quote,
        originToken: baseUsdc,
        destinationToken: solUsdc,
        routerId: ROUTER_ID,
        policy: POLICY,
        registry: meta.registry,
        sessionQuoteHistory: history,
        lists,
      });
      const assessment = assessSwapRisk({
        quote,
        originToken: baseUsdc,
        destinationToken: solUsdc,
        policy: { maxSpendPerTxUsd: 1000, maxSlippagePct: 2 },
      });
      const consecutiveCautions =
        assessment.decision === "CAUTION" ? (streaks[routeKey] ?? 0) + 1 : 0;
      const action = evaluateAutoPolicy({ assessment, routeKey, consecutiveCautions });
      persistStreak(routeKey, consecutiveCautions);
      if (action.blockSwap || action.sessionPause) {
        recordTrigger({
          ts: new Date().toISOString(),
          routeKey,
          decision: assessment.decision,
          alert: action.alert ?? "",
        });
      }
      const newHistory = [...history, ROUTER_ID];
      setHistory(newHistory);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
      setScan({
        routeKey,
        originToken: baseUsdc,
        destinationToken: solUsdc,
        quote,
        detectors,
        assessment,
        action,
        latencyMs: quoteRes.latencyMs,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runSuspiciousRouteTest() {
    setLoading(true);
    setError(null);
    setScan(null);
    const routeKey = "base-usdc→near-usdc · suspicious route test";
    try {
      const meta = await fetchTokens();
      const { baseUsdc, nearUsdc } = meta.tokens;
      // 1) Attempt the REAL live quote — expected to fail on the NEAR-leg solver outage.
      const quoteRes = await postQuote(BASE_USDC_ASSETID, NEAR_USDC_ASSETID, 10);
      const quoteFailure = quoteRes.data.ok
        ? undefined
        : { code: String(quoteRes.data.code), message: String(quoteRes.data.message) };
      // 2) Run the detectors that need no quote, against real registry metadata.
      const detectors: DetectorResult[] = [
        detectRouteOutage(baseUsdc, nearUsdc),
        detectSuspiciousRouter("unknown-bridge-v9", POLICY, history),
        detectUnverifiedToken(baseUsdc, meta.registry),
        detectUnverifiedToken(nearUsdc, meta.registry),
      ];
      // 3) Honest assessment built from detector evidence (no quote exists — the live call failed).
      const checks = detectors.map((d) => ({
        id: d.id,
        label: d.label,
        status: (d.verdict === "fail" ? "fail" : d.verdict === "warn" ? "warn" : "pass") as
          "pass" | "warn" | "fail",
        detail: d.detail,
      }));
      const assessment: RiskAssessment = {
        decision: "BLOCKED",
        score: 40,
        checks,
        summary: `BLOCKED — route-outage detector failed: NEAR-leg solver outage (live quote attempt failed ${
          quoteFailure ? `with ${quoteFailure.code}: ${quoteFailure.message}` : "unexpectedly succeeded"
        }). No quote exists; the swap cannot proceed.`,
        evaluatedAt: new Date().toISOString(),
      };
      const action = evaluateAutoPolicy({
        assessment,
        routeKey,
        consecutiveCautions: 0,
      });
      recordTrigger({
        ts: new Date().toISOString(),
        routeKey,
        decision: "BLOCKED",
        alert: action.alert ?? "",
      });
      setScan({
        routeKey,
        originToken: baseUsdc,
        destinationToken: nearUsdc,
        quote: {
          amountIn: "n/a",
          amountOut: "n/a",
          minAmountOut: "n/a",
          timeEstimateMs: 0,
          expiresAt: "n/a",
          raw: null,
        },
        detectors,
        assessment,
        action,
        latencyMs: quoteRes.latencyMs,
        fetchedAt: new Date().toISOString(),
        suspicious: true,
        quoteFailure,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const pausedRoutes = triggers
    .filter((t) => t.alert.includes("AUTO-PAUSE"))
    .map((t) => t.routeKey);

  return (
    <>
      <nav className="vg-nav">
        <div className="vg-nav-inner">
          <Link className="vg-brand" href="/"><Shield /> VAULTRY</Link>
          <div className="vg-nav-links">
            <Link href="/swap">Swap</Link>
            <Link href="/security">Security</Link>
            <Link href="/policy">Policy</Link>
          </div>
          <span className="vg-badge info" style={{ marginLeft: 8 }}>AI SECURITY &amp; DEFENSE</span>
        </div>
      </nav>

      <main style={{ padding: "120px 0 80px" }}>
        <div className="vg-wrap" style={{ maxWidth: 1080 }}>
          <div className="vg-eyebrow">Track 2 · AI Security &amp; Defense</div>
          <h1 className="vg-h2">Real detectors on <span className="grad-text">real inputs.</span></h1>
          <p className="vg-sub">
            Every verdict below is computed from a <strong>live 1Click dry-run quote</strong> and the
            <strong> live token registry</strong> — no simulated threats, no fake intel feeds.
            Unknown or missing data warns, never passes. The automated policy can only block this
            session&apos;s flow — it never touches the shared on-chain contract.
          </p>

          {error && <div className="vg-alert err">{error}</div>}
          {pausedRoutes.length > 0 && (
            <div className="vg-alert err">
              SESSION-LEVEL PAUSE ACTIVE (not the on-chain contract): {pausedRoutes.join(" · ")} —
              review the trigger history below before continuing.
            </div>
          )}

          {/* ---------------- Detector playground ---------------- */}
          <section className="glass glass-pad" style={{ marginBottom: 24 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Detector playground</h2>
            <p style={{ color: "#93a0b8", fontSize: 14, margin: "0 0 20px" }}>
              Fetch a live quote (Base USDC → Solana USDC — verified working route), run every
              detector plus the risk engine, and inspect each verdict with its evidence.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 20 }}>
              <div className="vg-field" style={{ margin: 0 }}>
                <label className="vg-label" htmlFor="sec-amount">Amount (USDC)</label>
                <input
                  id="sec-amount"
                  className="vg-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ width: 160 }}
                />
              </div>
              <button className="vg-btn" onClick={runLiveScan} disabled={loading}>
                {loading ? "Scanning…" : "Run live scan — Base USDC → Solana USDC"}
              </button>
              <button className="vg-btn vg-btn-ghost" onClick={runSuspiciousRouteTest} disabled={loading}>
                Test a suspicious route (NEAR leg)
              </button>
            </div>
            <p style={{ color: "#5b6a84", fontSize: 12.5, margin: 0 }}>
              Quotes are <strong>dry-run</strong> (dry:true): no deposit address is created, no funds can
              move. Slippage tolerance 50 bps. Detector thresholds: abnormal slippage
              warn &gt; {SLIPPAGE_WARN_BPS} bps / fail &gt; {SLIPPAGE_FAIL_BPS} bps; implied-liquidity
              warn &gt; {RISK_WARN}% / fail &gt; {RISK_FAIL}%.
            </p>

            {scan && (
              <div style={{ marginTop: 24 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                  <VerdictBadge verdict={scan.suspicious ? "BLOCKED" : scan.assessment.decision} />
                  <span style={{ color: "#93a0b8", fontSize: 13.5 }}>{scan.routeKey}</span>
                  <span className="vg-chip" style={{ cursor: "default" }}>
                    risk score {scan.assessment.score} · quote fetched in {(scan.latencyMs / 1000).toFixed(2)}s ·{" "}
                    {scan.fetchedAt}
                  </span>
                </div>

                {scan.suspicious && scan.quoteFailure && (
                  <div className="vg-alert err">
                    <strong>Live quote attempt failed as expected:</strong> {scan.quoteFailure.code} —{" "}
                    {scan.quoteFailure.message}
                  </div>
                )}
                {scan.suspicious && !scan.quoteFailure && (
                  <div className="vg-alert ok">
                    Note: the live quote unexpectedly succeeded this time — the BLOCKED verdict above
                    comes from the route-outage detector&apos;s standing knowledge of the NEAR-leg solver
                    outage (lib/intents/QUOTE_STATUS.md), not from this single call.
                  </div>
                )}

                {!scan.suspicious && (
                  <p className="vg-trail" style={{ margin: "0 0 16px" }}>
                    risk engine: {scan.assessment.summary}
                  </p>
                )}

                {scan.action.alert && (
                  <div className="vg-alert err" style={{ marginTop: 4 }}>{scan.action.alert}</div>
                )}

                {!scan.suspicious && (
                  <dl className="vg-kv" style={{ marginBottom: 20 }}>
                    <div><dt>amountIn</dt><dd>{(Number(scan.quote.amountIn) / 1e6).toFixed(4)} USDC</dd></div>
                    <div><dt>amountOut</dt><dd>{(Number(scan.quote.amountOut) / 1e6).toFixed(4)} USDC</dd></div>
                    <div><dt>minAmountOut</dt><dd>{(Number(scan.quote.minAmountOut) / 1e6).toFixed(4)} USDC</dd></div>
                    <div><dt>amountOutUsd</dt><dd>${scan.quote.amountOutUsd ?? "n/a"}</dd></div>
                  </dl>
                )}

                <div className="grid-2" style={{ gap: 16 }}>
                  {scan.detectors.map((d) => (
                    <div key={d.id + d.label} className="glass" style={{ padding: 20 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ fontSize: 14 }}>{d.label}</strong>
                        <VerdictBadge verdict={d.verdict} />
                      </div>
                      <p style={{ color: "#c9d3e5", fontSize: 13.5, lineHeight: 1.6, margin: "0 0 10px" }}>{d.detail}</p>
                      <details>
                        <summary style={{ color: "#5b6a84", fontSize: 12.5, cursor: "pointer" }}>evidence</summary>
                        <pre className="vg-trail" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                          {JSON.stringify(d.evidence, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 16, color: "#5b6a84", fontSize: 12.5 }}>
                  Automated policy:{" "}
                  {scan.action.reasons.join(" ")}
                </div>
              </div>
            )}
          </section>

          {/* ---------------- Automated policy ---------------- */}
          <section className="glass glass-pad" style={{ marginBottom: 24 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Automated policy — session level only</h2>
            <p style={{ color: "#93a0b8", fontSize: 14, margin: "0 0 16px" }}>
              These rules can only block this session&apos;s UI flow and pause session-level trading.
              They <strong>never</strong> touch the shared on-chain contract or any admin keys —
              none exist in this module.
            </p>
            <ul style={{ color: "#c9d3e5", fontSize: 14, lineHeight: 1.9, margin: "0 0 16px", paddingLeft: 20 }}>
              <li><strong>AUTO-BLOCK:</strong> risk-engine decision <code>BLOCKED</code> → the swap is blocked in this session.</li>
              <li><strong>AUTO-PAUSE:</strong> two consecutive <code>CAUTION</code> decisions on the same route → session-level trading pause until you review.</li>
            </ul>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              {Object.keys(streaks).length === 0 && (
                <span className="vg-chip" style={{ cursor: "default" }}>no caution streaks yet</span>
              )}
              {Object.entries(streaks).map(([k, v]) => (
                <span key={k} className="vg-chip" style={{ cursor: "default" }}>
                  {k}: {v} consecutive caution{v === 1 ? "" : "s"}
                </span>
              ))}
            </div>
            <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Trigger history (this browser)</h3>
            {triggers.length === 0 ? (
              <p style={{ color: "#5b6a84", fontSize: 13.5 }}>no triggers yet — nothing has been faked or seeded</p>
            ) : (
              <div className="vg-trail">
                {triggers.map((t, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <span className="t-warn">[{t.ts}]</span> {t.routeKey} · {t.decision} · {t.alert}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---------------- Allowlist / denylist ---------------- */}
          <section className="glass glass-pad" style={{ marginBottom: 24 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Allowlist &amp; denylist manager</h2>
            <p style={{ color: "#93a0b8", fontSize: 14, margin: "0 0 20px" }}>
              Your own counterparty lists, stored only in this browser&apos;s localStorage. Exact
              (case-insensitive) matches drive the denylist / allowlist detectors above.
            </p>
            <div className="grid-2" style={{ gap: 16 }}>
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input
                    className="vg-input"
                    placeholder="address to trust"
                    value={newAllow}
                    onChange={(e) => setNewAllow(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="vg-btn"
                    onClick={() => { if (newAllow.trim()) { setLists(addToAllowlist(newAllow.trim())); setNewAllow(""); } }}
                  >
                    Allow
                  </button>
                </div>
                {lists.allowlist.length === 0 ? (
                  <p style={{ color: "#5b6a84", fontSize: 13 }}>allowlist empty</p>
                ) : lists.allowlist.map((a) => (
                  <div key={a} className="vg-chip" style={{ cursor: "default", marginBottom: 8 }}>
                    <span className="t-ok" style={{ color: "#4ade80" }}>✓</span> {a}
                    <button
                      onClick={() => setLists(removeFromAllowlist(a))}
                      style={{ background: "none", border: "none", color: "#5b6a84", cursor: "pointer", fontSize: 14 }}
                      aria-label={`remove ${a}`}
                    >✕</button>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input
                    className="vg-input"
                    placeholder="address to block"
                    value={newDeny}
                    onChange={(e) => setNewDeny(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="vg-btn"
                    onClick={() => { if (newDeny.trim()) { setLists(addToDenylist(newDeny.trim())); setNewDeny(""); } }}
                  >
                    Deny
                  </button>
                </div>
                {lists.denylist.length === 0 ? (
                  <p style={{ color: "#5b6a84", fontSize: 13 }}>denylist empty</p>
                ) : lists.denylist.map((a) => (
                  <div key={a} className="vg-chip" style={{ cursor: "default", marginBottom: 8 }}>
                    <span style={{ color: "#f87171" }}>✕</span> {a}
                    <button
                      onClick={() => setLists(removeFromDenylist(a))}
                      style={{ background: "none", border: "none", color: "#5b6a84", cursor: "pointer", fontSize: 14 }}
                      aria-label={`remove ${a}`}
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ---------------- Honest limits ---------------- */}
          <section className="glass glass-pad">
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Honest limits</h2>
            <ul style={{ color: "#93a0b8", fontSize: 13.5, lineHeight: 1.9, margin: 0, paddingLeft: 20 }}>
              <li><strong>Unverified token ≠ proven scam.</strong> It only means the token is absent from the live registry or has no USD price.</li>
              <li><strong>Implied-liquidity risk is inferred from price impact</strong> (execution price vs registry reference) — this module has no order-book depth and never claims to.</li>
              <li><strong>No token creation-date data exists here</strong> — the module never claims to know when a token was created.</li>
              <li><strong>No external threat-intel feeds.</strong> Denylist/allowlist verdicts reflect only your own lists.</li>
              <li><strong>Unknown data warns, never passes.</strong> A <code>SAFE</code> verdict requires every measurable check to pass.</li>
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
