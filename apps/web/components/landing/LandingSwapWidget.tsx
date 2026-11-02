/**
 * LandingSwapWidget — a genuinely functional swap widget for the landing page.
 *
 * Testnet mode: live dry-run quotes from /api/tidepool/quote (NEAR testnet
 * Intents sandbox) for real destination/amount combos, with a live Route
 * Guardian risk gauge computed from the REAL quote numbers. Nothing mocked.
 *
 * Mainnet mode: source/destination/amount selects are live, but quoting goes
 * through /api/rhea/quote which honestly reports RHEA_NOT_CONFIGURED until
 * the operator sets the server key — the widget shows that state instead of
 * inventing a quote.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scoreLiveQuote, VERDICT_COLOR, type RiskScore } from "./risk";
import { useAnimEnabled } from "./useMotion";

type Network = "testnet" | "mainnet";

const TESTNET_DESTS = [
  { key: "wnear", label: "wNEAR · NEAR testnet" },
  { key: "usdt", label: "USDT · NEAR testnet" },
  { key: "wbtc", label: "wBTC · NEAR testnet" },
  { key: "eth", label: "ETH · NEAR testnet" },
];
const MAINNET_SOURCES = [
  { key: "8453", label: "Base" },
  { key: "1", label: "Ethereum" },
];
const MAINNET_DESTS = [
  { key: "501", label: "Solana" },
  { key: "900001", label: "NEAR" },
  { key: "1", label: "Ethereum" },
];

interface TestnetQuote {
  ok: boolean;
  pair?: string;
  amountIn?: string;
  amountOut?: string;
  amountOutBaseUnits?: string;
  minAmountOut?: string;
  error?: string;
}

/** Animated source→destination transfer path (pure SVG/CSS). Shown on a live quote.
 *  Reduced-motion / low-power: static path, dot parked at the source — no movement. */
function TransferPath({ active, label, anim }: { active: boolean; label: string; anim: boolean }) {
  if (!active) return null;
  return (
    <div className="transfer-path" aria-hidden="true">
      <svg viewBox="0 0 320 44" width="100%" height="44">
        <defs>
          <linearGradient id="tpath" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7c3aed" />
            <stop offset="1" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <path
          id="tpath-line"
          d="M14 22 C 90 6, 170 38, 306 22"
          fill="none"
          stroke="url(#tpath)"
          strokeWidth="2"
          strokeDasharray="7 6"
          className={anim ? "tpath-dash" : undefined}
        />
        <circle r="5" fill="#a855f7" className="tpath-glow" cx={anim ? undefined : 14} cy={anim ? undefined : 22}>
          {anim && (
            <animateMotion dur="2.2s" repeatCount="indefinite">
              <mpath href="#tpath-line" />
            </animateMotion>
          )}
        </circle>
        <circle cx="14" cy="22" r="4" fill="#7c3aed" />
        <circle cx="306" cy="22" r="4" fill="#22c55e" />
      </svg>
      <span className="hp-muted" style={{ fontSize: 11 }}>{label}</span>
    </div>
  );
}

function RiskGauge({ risk, scanning }: { risk: RiskScore | null; scanning: boolean }) {
  // 240° arc gauge, needle animates via CSS transition on stroke-dashoffset.
  const R = 84;
  const CX = 100;
  const CY = 100;
  const START = -210; // degrees, 0 = east
  const SWEEP = 240;
  const CIRC = 2 * Math.PI * R;
  const frac = risk ? Math.min(1, Math.max(0, risk.score / 100)) : 0;
  const arcLen = (CIRC * SWEEP) / 360;
  const shown = arcLen * frac;
  const color = risk ? VERDICT_COLOR[risk.verdict] : "rgba(139,92,246,0.35)";
  const a = ((START + SWEEP * frac - 90) * Math.PI) / 180;
  const nx = CX + (R - 14) * Math.cos(a);
  const ny = CY + (R - 14) * Math.sin(a);

  const arc = (s: number, e: number) => {
    const p = (deg: number): [number, number] => {
      const r = ((deg - 90) * Math.PI) / 180;
      return [CX + R * Math.cos(r), CY + R * Math.sin(r)];
    };
    const [sx, sy] = p(s);
    const [ex, ey] = p(e);
    return `M ${sx} ${sy} A ${R} ${R} 0 ${e - s > 180 ? 1 : 0} 1 ${ex} ${ey}`;
  };

  return (
    <div className="gauge-stage">
      {scanning && (
        <div className="radar-rings" aria-hidden="true">
          <span className="rr r1" />
          <span className="rr r2" />
          <span className="rr r3" />
        </div>
      )}
    <svg viewBox="0 0 200 200" className="risk-gauge" role="img" aria-label={risk ? `Risk score ${risk.score} of 100, ${risk.verdict}` : "Risk gauge"}>
      <path d={arc(START, START + SWEEP)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" strokeLinecap="round" />
      <path
        d={arc(START, START + SWEEP)}
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${arcLen}`}
        strokeDashoffset={arcLen - shown}
        style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.2,0.7,0.3,1), stroke 0.4s", filter: `drop-shadow(0 0 10px ${color})` }}
      />
      {risk && (
        <g style={{ transition: "all 0.9s cubic-bezier(0.2,0.7,0.3,1)" }}>
          <line x1={CX} y1={CY} x2={nx} y2={ny} stroke={color} strokeWidth="3" strokeLinecap="round" />
          <circle cx={CX} cy={CY} r="7" fill="#0a0f1e" stroke={color} strokeWidth="2.5" />
        </g>
      )}
      <text x={CX} y={CY + 34} textAnchor="middle" fill="#fff" fontSize="34" fontWeight="800" fontFamily="var(--font-grotesk), sans-serif">
        {risk ? risk.score : "–"}
      </text>
      <text x={CX} y={CY + 52} textAnchor="middle" fill="rgba(196,181,253,0.65)" fontSize="11" letterSpacing="2">
        RISK / 100
      </text>
      {risk && (
        <text x={CX} y={CY + 70} textAnchor="middle" fill={color} fontSize="13" fontWeight="800" letterSpacing="2">
          {risk.verdict}
        </text>
      )}
    </svg>
    </div>
  );
}

export default function LandingSwapWidget() {
  const anim = useAnimEnabled();
  const [network, setNetwork] = useState<Network>("testnet");
  const [dest, setDest] = useState("wnear");
  const [amount, setAmount] = useState("1");
  const [srcChain, setSrcChain] = useState("8453");
  const [dstChain, setDstChain] = useState("501");
  const [quote, setQuote] = useState<TestnetQuote | null>(null);
  const [risk, setRisk] = useState<RiskScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [mainnetState, setMainnetState] = useState<"idle" | "checking" | "unconfigured" | "error">("idle");
  const [mainnetMsg, setMainnetMsg] = useState("");
  const reqId = useRef(0);

  const fetchTestnetQuote = useCallback(async (to: string, amt: string) => {
    const id = ++reqId.current;
    const num = Number(amt);
    if (!Number.isFinite(num) || num <= 0) {
      setQuote(null);
      setRisk(null);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/tidepool/quote?to=${encodeURIComponent(to)}&amount=${encodeURIComponent(amt)}`);
      const d = (await r.json()) as TestnetQuote;
      if (reqId.current !== id) return;
      setQuote(d);
      setRisk(d.ok ? scoreLiveQuote(d.amountOutBaseUnits, d.minAmountOut) : null);
    } catch {
      if (reqId.current !== id) return;
      setQuote({ ok: false, error: "quote feed unreachable" });
      setRisk(null);
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, []);

  // Live quote on mount + when testnet params change (debounced).
  useEffect(() => {
    if (network !== "testnet") return;
    const t = setTimeout(() => fetchTestnetQuote(dest, amount), 450);
    return () => clearTimeout(t);
  }, [network, dest, amount, fetchTestnetQuote]);

  async function checkMainnet() {
    setMainnetState("checking");
    setMainnetMsg("");
    try {
      const r = await fetch("/api/rhea/quote");
      const d = await r.json();
      if (d.configured) {
        setMainnetState("error");
        setMainnetMsg("RHEA key is configured — use the full /swap terminal for executable mainnet quotes.");
      } else {
        setMainnetState("unconfigured");
        setMainnetMsg("Mainnet quoting is not configured on this deployment yet (server RHEA_API_KEY). Testnet mode above is live now.");
      }
    } catch {
      setMainnetState("error");
      setMainnetMsg("Could not reach the quote service.");
    }
  }

  return (
    <div className="swap-widget glass" id="live-swap">
      <div className="swap-widget-head">
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 8 }}>Live swap terminal</div>
          <h2 className="vg-h2" style={{ margin: 0 }}>Swap. <span className="grad-text">Scored before signing.</span></h2>
        </div>
        <div className="net-toggle" role="tablist" aria-label="Network">
          {(["testnet", "mainnet"] as Network[]).map((n) => (
            <button
              key={n}
              role="tab"
              aria-selected={network === n}
              className={network === n ? "on" : ""}
              onClick={() => {
                setNetwork(n);
                setQuote(null);
                setRisk(null);
                setMainnetState("idle");
              }}
            >
              {n === "testnet" ? "Testnet · Live" : "Mainnet"}
            </button>
          ))}
        </div>
      </div>

      {network === "testnet" ? (
        <div className="swap-grid">
          <div className="swap-controls">
            <div className="vg-field">
              <label className="vg-label">Source</label>
              <div className="vg-input vg-input-static">NEAR testnet · test USDC</div>
            </div>
            <div className="vg-field">
              <label className="vg-label">Destination</label>
              <select className="vg-input" value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination token">
                {TESTNET_DESTS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="vg-field">
              <label className="vg-label">Amount (test USDC)</label>
              <input
                className="vg-input"
                type="number"
                min="0"
                step="0.1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Amount in test USDC"
              />
            </div>
            <div className="swap-quote-line">
              {loading ? (
                <span className="hp-muted">Fetching live quote…</span>
              ) : quote?.ok ? (
                <span>
                  <strong>{quote.amountIn} test USDC</strong> → <strong>{quote.amountOut}</strong>
                  <span className="hp-muted"> · {quote.pair}</span>
                </span>
              ) : quote && !quote.ok ? (
                <span className="hp-muted">Quote unavailable: {quote.error ?? "unknown"}</span>
              ) : (
                <span className="hp-muted">Enter an amount to fetch a live quote.</span>
              )}
            </div>
            <TransferPath active={!!quote?.ok && !loading} label="Route Guardian verified path" anim={anim} />
            <div className="testnet-note">
              <span className="testnet-pill">TESTNET · VALUELESS</span>
              <span className="hp-muted">Dry-run quotes — no funds move.</span>
            </div>
          </div>
          <div className="swap-gauge">
            <RiskGauge risk={risk} scanning={loading && anim} />
            {risk && (
              <ul className="risk-reasons">
                {risk.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="swap-grid">
          <div className="swap-controls">
            <div className="vg-field">
              <label className="vg-label">Source chain</label>
              <select className="vg-input" value={srcChain} onChange={(e) => setSrcChain(e.target.value)} aria-label="Source chain">
                {MAINNET_SOURCES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="vg-field">
              <label className="vg-label">Source token</label>
              <div className="vg-input vg-input-static">USDC</div>
            </div>
            <div className="vg-field">
              <label className="vg-label">Destination chain</label>
              <select className="vg-input" value={dstChain} onChange={(e) => setDstChain(e.target.value)} aria-label="Destination chain">
                {MAINNET_DESTS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <button className="vg-btn" onClick={checkMainnet} disabled={mainnetState === "checking"}>
              {mainnetState === "checking" ? "Checking…" : "Get live quote"}
            </button>
            {mainnetState !== "idle" && <div className="hp-muted" style={{ marginTop: 10 }}>{mainnetMsg}</div>}
          </div>
          <div className="swap-gauge">
            <RiskGauge risk={null} scanning={mainnetState === "checking" && anim} />
            <p className="hp-muted" style={{ textAlign: "center", maxWidth: 260 }}>
              Mainnet risk scoring activates with the first live RHEA quote.
            </p>
          </div>
        </div>
      )}

      <div className="swap-widget-foot">
        <a className="vg-btn" href="/swap">Open full swap terminal →</a>
        <span className="hp-muted">Route Guardian checks every quote before anything is signed.</span>
      </div>
    </div>
  );
}
