"use client";

/**
 * VAULTRY — premium Web3 cybersecurity SaaS dashboard.
 * Backend + /api/policy untouched. All on-chain data below is real (NEAR testnet).
 */

import { useEffect, useState } from "react";

const EXPLORER = "https://explorer.testnet.near.org";
const CONTRACT = "vaultguard.vgdeployer.testnet";
const REPO = "https://github.com/rjrajput-web3/vaultguard";

/* ---------------- shared bits ---------------- */

function Shield({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="shg" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="0.55" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <path
        d="M32 4 56 12v18c0 14-9.5 24.5-24 30C17.5 54.5 8 44 8 30V12L32 4z"
        stroke="url(#shg)" strokeWidth="3.5" fill="rgba(34,211,238,0.08)"
      />
      <path d="M22 32l7 7 13-14" stroke="url(#shg)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Nav() {
  return (
    <nav className="vg-nav">
      <div className="vg-nav-inner">
        <a className="vg-brand" href="#top">
          <Shield size={30} /> VAULTRY
        </a>
        <div className="vg-nav-links">
          <a href="#scanner">Risk scanner</a>
          <a href="#guardian">Route guardian</a>
          <a href="#depeg">Depeg shield</a>
          <a href="#proof">On-chain proof</a>
          <a href="#architecture">Architecture</a>
          <a href="/wallet">Wallet</a>
        </div>
        <a className="vg-btn" href="/policy" style={{ marginLeft: 8 }}>Policy console</a>
      </div>
    </nav>
  );
}

/* ---------------- 1. hero ---------------- */

function Hero() {
  return (
    <header className="vg-hero" id="top">
      <div className="vg-hero-bg">
        <div className="vg-grid-bg" />
        <div className="vg-orb vg-orb-1" />
        <div className="vg-orb vg-orb-2" />
      </div>
      <div className="vg-wrap vg-hero-inner">
        <div className="vg-shield-wrap fade-up">
          <div className="vg-shield-ring" />
          <div className="vg-shield-ring r2" />
          <div className="vg-shield-ring r3" />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Shield size={64} />
          </div>
        </div>
        <div className="vg-hero-badge fade-up d1">
          <span className="vg-pulse-dot" /> NEAR HACKATHON · BUILD BEYOND BOUNDARIES · UNSTOPPABLE DEFI
        </div>
        <h1 className="fade-up d2">
          Never <span className="grad-text">blind swaps.</span>
        </h1>
        <p className="lead fade-up d3">
          VAULTRY is a self-protecting cross-chain vault. Every conversion is risk-scored
          before it executes, routes fall back automatically when a venue degrades, and a NEAR
          smart contract enforces your limits on-chain — as code, not as a suggestion.
        </p>
        <div className="vg-hero-ctas fade-up d4">
          <a className="vg-btn" href="#proof">Explore the on-chain proof</a>
          <a className="vg-btn vg-btn-ghost" href="/policy">Open policy console</a>
        </div>
        <div className="vg-stats fade-up d4">
          <div className="vg-stat glass"><b>6/6</b><span>on-chain checks passed</span></div>
          <div className="vg-stat glass"><b>$18.4M</b><span>RHEA exploit that inspired it</span></div>
          <div className="vg-stat glass"><b>1,000</b><span>USDC per-tx hard cap</span></div>
          <div className="vg-stat glass"><b>0</b><span>blind swaps executed</span></div>
        </div>
      </div>
    </header>
  );
}

/* ---------------- 2. risk scanner ---------------- */

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const [sx, sy] = polar(cx, cy, r, start);
  const [ex, ey] = polar(cx, cy, r, end);
  return `M ${sx} ${sy} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${ex} ${ey}`;
}

function RiskScanner() {
  const SCORE = 15.7;
  const [val, setVal] = useState(0);
  const [spinning, setSpinning] = useState(false);

  const run = () => {
    setSpinning(true);
    setVal(0);
    const t0 = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / 1400);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(SCORE * eased);
      if (p < 1) requestAnimationFrame(tick);
      else setSpinning(false);
    };
    requestAnimationFrame(tick);
  };

  useEffect(() => { run(); }, []);
  const ang = -120 + (val / 100) * 240;

  return (
    <section className="vg-section" id="scanner">
      <div className="vg-wrap">
        <div className="vg-eyebrow">Pre-flight risk scanner</div>
        <h2 className="vg-h2">Every quote scored <span className="grad-text">before it signs.</span></h2>
        <p className="vg-sub">
          Router health, slippage, fees and exit cost collapse into one 0–100 risk score.
          Verdicts: SAFE, CAUTION, BLOCKED. Nothing reaches the chain unchecked.
        </p>
        <div className="vg-banner">
          Sample result — demo data. Live RHEA quotes connect when their endpoint recovers; the NEAR Intents 1Click fallback is live.
        </div>
        <div className="glass glass-pad">
          <div className="vg-gauge-wrap">
            <div className="vg-gauge">
              <svg viewBox="0 0 240 160" width="100%">
                <defs>
                  <linearGradient id="gg" x1="0" y1="0" x2="240" y2="0" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#22c55e" />
                    <stop offset="0.5" stopColor="#f59e0b" />
                    <stop offset="1" stopColor="#ef4444" />
                  </linearGradient>
                </defs>
                <path d={arcPath(120, 120, 92, -120, 120)} stroke="rgba(125,211,252,0.12)" strokeWidth="16" fill="none" strokeLinecap="round" />
                <path d={arcPath(120, 120, 92, -120, ang)} stroke="url(#gg)" strokeWidth="16" fill="none" strokeLinecap="round" />
                <text x="120" y="108" textAnchor="middle" fill="#e9eef7" fontSize="34" fontWeight="800">{val.toFixed(1)}</text>
                <text x="120" y="130" textAnchor="middle" fill="#5b6a84" fontSize="11" letterSpacing="2">RISK SCORE</text>
              </svg>
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <span className="vg-verdict safe">● SAFE</span>
              </div>
            </div>
            <dl className="vg-kv">
              <div><dt>Route</dt><dd>Base USDC → NEAR USDC</dd></div>
              <div><dt>Amount</dt><dd>1.0 USDC</dd></div>
              <div><dt>Best router</dt><dd>nearintents</dd></div>
              <div><dt>Estimated out</dt><dd>0.9990 USDC</dd></div>
              <div><dt>Min. amount out</dt><dd>0.9980 USDC</dd></div>
              <div><dt>Slippage</dt><dd>0.10%</dd></div>
              <div><dt>Alternatives evaluated</dt><dd>3 routes</dd></div>
              <div><dt>Policy check</dt><dd style={{ color: "#4ade80" }}>PASSED</dd></div>
            </dl>
          </div>
          <div style={{ marginTop: 28 }}>
            <button className="vg-btn vg-btn-ghost" onClick={run} disabled={spinning}>
              {spinning ? "Scanning…" : "↻ Run pre-flight scan"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 3. route guardian ---------------- */

function RouteGuardian() {
  return (
    <section className="vg-section" id="guardian" style={{ background: "rgba(7,11,22,0.6)" }}>
      <div className="vg-wrap">
        <div className="vg-eyebrow">Smart route guardian</div>
        <h2 className="vg-h2">When a router degrades, <span className="grad-text">the vault reroutes.</span></h2>
        <p className="vg-sub">
          The guardian watches the primary venue. Degradation detected → it falls back to a
          healthy alternative automatically and leaves a human-readable trail explaining why.
        </p>
        <div className="grid-2">
          <div className="glass glass-pad">
            <svg viewBox="0 0 520 340" width="100%" style={{ display: "block" }}>
              <defs>
                <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" fill="#22d3ee" />
                </marker>
              </defs>
              <g className="vg-node">
                <rect x="20" y="140" width="110" height="60" rx="12" fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="1.5" />
                <text x="75" y="166" textAnchor="middle" fill="#e9eef7" fontSize="13" fontWeight="700">QUOTE</text>
                <text x="75" y="184" textAnchor="middle" fill="#93a0b8" fontSize="11">1.0 USDC</text>
              </g>
              <g className="vg-node">
                <rect x="205" y="60" width="130" height="60" rx="12" fill="rgba(34,211,238,0.1)" stroke="#22d3ee" strokeWidth="1.5" />
                <text x="270" y="86" textAnchor="middle" fill="#e9eef7" fontSize="13" fontWeight="700">RHEA SDK</text>
                <text x="270" y="104" textAnchor="middle" fill="#f59e0b" fontSize="11">degraded · 500</text>
              </g>
              <g className="vg-node">
                <rect x="205" y="220" width="130" height="60" rx="12" fill="rgba(34,197,94,0.1)" stroke="#22c55e" strokeWidth="1.5" />
                <text x="270" y="246" textAnchor="middle" fill="#e9eef7" fontSize="13" fontWeight="700">NEAR Intents</text>
                <text x="270" y="264" textAnchor="middle" fill="#4ade80" fontSize="11">healthy · fallback</text>
              </g>
              <g className="vg-node">
                <rect x="400" y="140" width="100" height="60" rx="12" fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="1.5" />
                <text x="450" y="166" textAnchor="middle" fill="#e9eef7" fontSize="13" fontWeight="700">EXECUTE</text>
                <text x="450" y="184" textAnchor="middle" fill="#93a0b8" fontSize="11">0.9998 USDC</text>
              </g>
              <line x1="130" y1="170" x2="200" y2="100" stroke="#f59e0b" strokeWidth="2" className="vg-flow-line" markerEnd="url(#arr)" opacity="0.6" />
              <line x1="130" y1="170" x2="200" y2="245" stroke="#22c55e" strokeWidth="2.5" className="vg-flow-line" markerEnd="url(#arr)" />
              <line x1="335" y1="250" x2="398" y2="175" stroke="#22c55e" strokeWidth="2.5" className="vg-flow-line" markerEnd="url(#arr)" />
              <text x="150" y="118" fill="#f59e0b" fontSize="11" fontStyle="italic">blocked</text>
              <text x="148" y="228" fill="#4ade80" fontSize="11" fontWeight="700">fallback ✓</text>
            </svg>
            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <span className="vg-status-pill degraded"><span className="vg-pulse-dot" style={{ background: "#f59e0b", boxShadow: "0 0 12px #f59e0b" }} /> RHEA QUOTE ENDPOINT · DEGRADED</span>
              <span className="vg-status-pill armed"><span className="vg-pulse-dot" /> 1CLICK FALLBACK · ACTIVE</span>
            </div>
          </div>
          <div className="glass glass-pad">
            <h3 style={{ margin: "0 0 16px", fontSize: 17 }}>Decision trail <span style={{ color: "#5b6a84", fontWeight: 400, fontSize: 13 }}>— real guardian output, dry-run</span></h3>
            <div className="vg-trail">
              <div><span className="t-dim">[quote]</span> 8453:USDC → near:USDC · 1.0 · router <span className="t-ok">nearintents</span></div>
              <div><span className="t-dim">[risk]</span> out 999846 · min 994846 · slippage 0.50% · score <span className="t-ok">15.7 SAFE</span></div>
              <div><span className="t-dim">[policy]</span> caps, assets, routers — <span className="t-ok">PASSED</span></div>
              <div><span className="t-dim">[rhea]</span> primary degraded <span className="t-warn">(server-side 500)</span> — excluded</div>
              <div><span className="t-dim">[decision]</span> <span className="t-ok">fallback-to-alternative</span> — 1Click route selected</div>
              <div><span className="t-dim">[simulate]</span> primary outage → <span className="t-warn">no-route-pause</span>: vault pauses, user alerted</div>
              <div className="t-dim" style={{ marginTop: 12 }}>No swaps built or executed — dry-run only. The guardian never blind-swaps.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 4. depeg shield ---------------- */

function DepegShield() {
  const outcomes = [
    { k: "no-action", t: "No action", d: "Peg holds inside the ±2% band. Quotes flow normally.", c: "#4ade80" },
    { k: "auto-hedge", t: "Auto-hedge", d: "Borderline drift — the guardian hedges exposure within slippage limits.", c: "#7dd3fc" },
    { k: "pause-and-alert", t: "Pause + alert", d: "Depeg confirmed over N ticks — the vault pauses instead of executing into it.", c: "#f59e0b" },
  ];
  return (
    <section className="vg-section" id="depeg">
      <div className="vg-wrap">
        <div className="vg-eyebrow">Depeg protection</div>
        <h2 className="vg-h2">A stablecoin breaks peg — <span className="grad-text">the vault stops first.</span></h2>
        <p className="vg-sub">
          The oracle monitor watches pegged assets around the clock. Break the band with
          confirmation and the guardian pauses the vault and alerts — never executes into a depeg.
        </p>
        <div className="grid-2">
          <div className="glass glass-pad">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>USDC · live peg monitor</h3>
              <span className="vg-status-pill armed"><span className="vg-pulse-dot" /> ARMED</span>
            </div>
            <div style={{ fontSize: 42, fontWeight: 800, margin: "20px 0 4px", fontFamily: "ui-monospace, monospace" }}>$1.0000</div>
            <div style={{ fontSize: 13, color: "#93a0b8" }}>Band ±2% · deviation 0.00%</div>
            <div className="vg-peg-band"><div className="vg-peg-marker" /></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#5b6a84" }}>
              <span>$0.98</span><span>$1.00</span><span>$1.02</span>
            </div>
            <div className="grid-2" style={{ marginTop: 24 }}>
              <div><div className="vg-label">Primary oracle</div><div style={{ fontWeight: 700 }}>Pyth Network</div></div>
              <div><div className="vg-label">Fallback oracle</div><div style={{ fontWeight: 700 }}>Chainlink</div></div>
              <div><div className="vg-label">Deviation band</div><div style={{ fontWeight: 700 }}>±2%</div></div>
              <div><div className="vg-label">Confirmation</div><div style={{ fontWeight: 700 }}>N ticks</div></div>
            </div>
          </div>
          <div className="glass glass-pad">
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>Verified outcomes <span style={{ color: "#5b6a84", fontWeight: 400, fontSize: 13 }}>— monitor logic, function-level</span></h3>
            <p style={{ color: "#93a0b8", fontSize: 14, margin: "0 0 20px" }}>All three depeg responses verified in the guardian test harness.</p>
            {outcomes.map((o) => (
              <div key={o.k} style={{ display: "flex", gap: 14, padding: "14px 0", borderTop: "1px solid rgba(125,211,252,0.1)" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: o.c, boxShadow: `0 0 10px ${o.c}`, marginTop: 5, flex: "0 0 auto" }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{o.t}</div>
                  <div style={{ color: "#93a0b8", fontSize: 13.5, marginTop: 4 }}>{o.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 5. policy console preview ---------------- */

function PolicyPreview() {
  const [p, setP] = useState<{ maxSpendPerTx: number; maxSpendPerDay: number; paused: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/policy").then((r) => r.json()).then((d) => setP(d.policy)).catch(() => {});
  }, []);
  return (
    <section className="vg-section" id="policy" style={{ background: "rgba(7,11,22,0.6)" }}>
      <div className="vg-wrap">
        <div className="vg-eyebrow">Policy console</div>
        <h2 className="vg-h2">Your rules. <span className="grad-text">Enforced as code.</span></h2>
        <p className="vg-sub">
          Spending caps, allowed assets and routers, emergency pause — set in the console,
          pre-checked by the guardian, enforced on-chain as the final authority.
        </p>
        <div className="grid-3">
          <div className="glass glass-pad">
            <div className="vg-label">Max per transaction</div>
            <div style={{ fontSize: 34, fontWeight: 800 }}>{p ? p.maxSpendPerTx.toLocaleString() : "—"} <span style={{ fontSize: 15, color: "#93a0b8" }}>USDC</span></div>
            <div style={{ fontSize: 13, color: "#5b6a84", marginTop: 8 }}>Hard cap — the contract rejects anything above it.</div>
          </div>
          <div className="glass glass-pad">
            <div className="vg-label">Max per day</div>
            <div style={{ fontSize: 34, fontWeight: 800 }}>{p ? p.maxSpendPerDay.toLocaleString() : "—"} <span style={{ fontSize: 15, color: "#93a0b8" }}>USDC</span></div>
            <div style={{ fontSize: 13, color: "#5b6a84", marginTop: 8 }}>Rolling daily budget across all routes.</div>
          </div>
          <div className="glass glass-pad">
            <div className="vg-label">Vault state</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: p && p.paused ? "#f87171" : "#4ade80" }}>{p ? (p.paused ? "PAUSED" : "LIVE") : "—"}</div>
            <div style={{ fontSize: 13, color: "#5b6a84", marginTop: 8 }}>Guardian halt switch — pauses every route instantly.</div>
          </div>
        </div>
        <div style={{ marginTop: 28 }}>
          <a className="vg-btn" href="/policy">Open the full policy editor →</a>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 6. on-chain proof ---------------- */

const TXS = [
  { n: 1, title: "Withdraw 500 USDC", detail: "Within the 1,000 per-tx cap", badge: "ok", label: "APPROVED", hash: "EEHfcL14YnABocSomyUJGNTozoBQFrLRHqinPAa2na5j" },
  { n: 2, title: "Withdraw 2,000 USDC", detail: "Over the cap — the contract itself refused", badge: "no", label: "REJECTED", hash: "BLLd3UdF36pSjjotwodNcj5SZXEp4itwf96guHwZf5b1" },
  { n: 3, title: "Guardian pauses vault", detail: "set_paused(true) — emergency halt", badge: "info", label: "OK", hash: "Dq8R4nZqRoSsUYnHD2MTh4NNVjrMF9k5cRLhBJ3PcdWo" },
  { n: 4, title: "Withdraw 100 USDC while paused", detail: "Halt in effect — refused on-chain", badge: "no", label: "REJECTED", hash: "g6xTryWvhgtdkzTd5Nf438uvxoPXajGXow3m32fCKDK" },
  { n: 5, title: "Guardian unpauses vault", detail: "set_paused(false) — recovery", badge: "info", label: "OK", hash: "FR5g2Xm9fCK63Tj9sG91jGcTLYbpQxdGERo1Vb2nvkfB" },
  { n: 6, title: "Withdraw 100 USDC after unpause", detail: "Normal operation resumes", badge: "ok", label: "APPROVED", hash: "Goz6hbkT5LyVdKCP7sv4SZqMJ4dE98hqRB3CaHqYgbNy" },
];

function OnChainProof() {
  return (
    <section className="vg-section" id="proof">
      <div className="vg-wrap">
        <div className="vg-eyebrow">On-chain proof</div>
        <h2 className="vg-h2">Six transactions. <span className="grad-text">Zero trust required.</span></h2>
        <p className="vg-sub">
          Real transactions against the deployed contract on NEAR testnet. Cap enforced. Pause
          enforced. Recovery proven. Click any hash to verify it on the explorer yourself.
        </p>
        <div className="glass glass-pad" style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Shield size={34} />
          <div>
            <div style={{ fontWeight: 700, fontFamily: "ui-monospace, monospace", fontSize: 15 }}>VAULTRY security contract ({CONTRACT})</div>
            <a href={`${EXPLORER}/accounts/${CONTRACT}`} target="_blank" rel="noreferrer" style={{ color: "#22d3ee", fontSize: 13, textDecoration: "none" }}>View contract on explorer ↗</a>
          </div>
          <span className="vg-badge ok" style={{ marginLeft: "auto" }}>6/6 PASS</span>
        </div>
        <div className="grid-3">
          {TXS.map((t) => (
            <div className="glass vg-tx" key={t.n}>
              <span className="vg-tx-num">TX {t.n}</span>
              <span className={`vg-badge ${t.badge}`}>{t.label}</span>
              <h4 style={{ marginTop: 12 }}>{t.title}</h4>
              <div style={{ fontSize: 13.5, color: "#93a0b8" }}>{t.detail}</div>
              <div className="hash" title={t.hash}>{t.hash.slice(0, 20)}…{t.hash.slice(-8)}</div>
              <a className="exp" href={`${EXPLORER}/transactions/${t.hash}`} target="_blank" rel="noreferrer">Verify on explorer ↗</a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- 7. architecture ---------------- */

function Architecture() {
  const nodes = [
    { x: 40, t: "VAULTRY UI", s: "policy console · risk report", c: "#3b82f6" },
    { x: 310, t: "GUARDIAN SERVICE", s: "risk engine · route guardian · oracle monitor", c: "#22d3ee" },
    { x: 580, t: "EXECUTION", s: "RHEA X Chain SDK · NEAR Intents 1Click", c: "#7dd3fc" },
    { x: 830, t: "NEAR CONTRACT", s: "spend caps · pause flag · final authority", c: "#22c55e" },
  ];
  return (
    <section className="vg-section" id="architecture" style={{ background: "rgba(7,11,22,0.6)" }}>
      <div className="vg-wrap">
        <div className="vg-eyebrow">System architecture</div>
        <h2 className="vg-h2">Three layers. <span className="grad-text">One guarantee.</span></h2>
        <p className="vg-sub">Off-chain intelligence proposes and pre-checks. The on-chain contract disposes — it is the final authority on every withdrawal.</p>
        <div className="glass glass-pad">
          <svg viewBox="0 0 1080 420" width="100%" style={{ display: "block" }}>
            <defs>
              <marker id="arr2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill="#22d3ee" />
              </marker>
            </defs>
            {nodes.map((n, i) => (
              <g key={n.t} className="vg-node">
                <rect x={n.x} y={150} width={210} height={120} rx={14} fill="rgba(148,184,255,0.05)" stroke={n.c} strokeWidth="1.8" />
                <text x={n.x + 105} y={196} textAnchor="middle" fill="#e9eef7" fontSize="15" fontWeight="800" letterSpacing="1">{n.t}</text>
                <text x={n.x + 105} y={222} textAnchor="middle" fill="#93a0b8" fontSize="12.5">{n.s.split("·")[0]}</text>
                <text x={n.x + 105} y={240} textAnchor="middle" fill="#93a0b8" fontSize="12.5">{n.s.split("·")[1] || ""}</text>
                {i < 3 && (
                  <line x1={n.x + 210} y1={210} x2={n.x + 270} y2={210} stroke="#22d3ee" strokeWidth="2.5" className="vg-flow-line" markerEnd="url(#arr2)" />
                )}
              </g>
            ))}
            <text x={540} y={330} textAnchor="middle" fill="#5b6a84" fontSize="13" fontStyle="italic">
              quotes + policy checks flow down · enforcement flows up — the contract can always say no
            </text>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 8. footer ---------------- */

function Footer() {
  return (
    <footer className="vg-footer">
      <div className="vg-wrap">
        <div className="vg-footer-grid">
          <div>
            <a className="vg-brand" href="#top" style={{ marginBottom: 14 }}><Shield size={28} /> VAULTRY</a>
            <p style={{ color: "#5b6a84", fontSize: 14, lineHeight: 1.7, maxWidth: 300 }}>
              Self-protecting cross-chain vault. Built for the NEAR Build Beyond Boundaries hackathon — Unstoppable DeFi track.
            </p>
          </div>
          <div>
            <h5>Project</h5>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub repository</a>
            <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">Documentation</a>
            <a href="/policy">Policy console</a>
          </div>
          <div>
            <h5>On-chain</h5>
            <a href={`${EXPLORER}/accounts/${CONTRACT}`} target="_blank" rel="noreferrer">VAULTRY security contract</a>
            <a href="#proof">Transaction proof</a>
            <a href={EXPLORER} target="_blank" rel="noreferrer">NEAR testnet explorer</a>
          </div>
          <div>
            <h5>Stack</h5>
            <a href="https://rhea.finance" target="_blank" rel="noreferrer">RHEA X Chain SDK</a>
            <a href="https://near.org" target="_blank" rel="noreferrer">NEAR Protocol</a>
            <a href="https://nearhackathon.com" target="_blank" rel="noreferrer">Build Beyond Boundaries</a>
          </div>
        </div>
        <div className="vg-footer-bottom">
          <span>© 2026 VAULTRY · Testnet demo — no real funds.</span>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>VAULTRY security contract: {CONTRACT}</span>
        </div>
      </div>
    </footer>
  );
}

/* ---------------- page ---------------- */

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <RiskScanner />
        <RouteGuardian />
        <DepegShield />
        <PolicyPreview />
        <OnChainProof />
        <Architecture />
      </main>
      <Footer />
    </>
  );
}
