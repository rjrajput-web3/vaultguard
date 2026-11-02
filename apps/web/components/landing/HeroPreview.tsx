/**
 * Hero product preview — a live interface snapshot with REAL data only:
 * live testnet quote, Route Guardian risk chip from the real numbers,
 * an honest "Connect wallet" slot, and the on-chain contract proof line.
 * No mocked numbers anywhere.
 */
"use client";

import { useEffect, useState } from "react";
import { scoreLiveQuote, VERDICT_COLOR, type RiskScore } from "./risk";

const EXPLORER = "https://explorer.testnet.near.org";
const CONTRACT = "vaultguard.vgdeployer.testnet";

interface QuoteState {
  ok: boolean;
  pair?: string;
  amountIn?: string;
  amountOut?: string;
  amountOutBaseUnits?: string;
  minAmountOut?: string;
  error?: string;
}

export default function HeroPreview() {
  const [q, setQ] = useState<QuoteState | null>(null);
  const [risk, setRisk] = useState<RiskScore | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tidepool/quote")
      .then((r) => r.json())
      .then((d: QuoteState) => {
        if (cancelled) return;
        setQ(d);
        if (d.ok) setRisk(scoreLiveQuote(d.amountOutBaseUnits, d.minAmountOut));
      })
      .catch(() => {
        if (!cancelled) setQ({ ok: false, error: "quote feed unreachable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const color = risk ? VERDICT_COLOR[risk.verdict] : "#8b5cf6";

  return (
    <div className="hero-preview glass">
      <svg className="hero-net" viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g stroke="rgba(139,92,246,0.28)" strokeWidth="1" fill="none">
          <path className="net-flow" d="M40 180 C 140 140, 200 90, 300 90 S 460 120, 560 60" />
          <path className="net-flow d2" d="M40 60 C 150 80, 220 150, 330 150 S 470 100, 560 150" />
          <path className="net-flow d3" d="M300 200 C 320 150, 280 120, 300 90" />
        </g>
        <g fill="rgba(168,85,247,0.7)">
          <circle cx="40" cy="180" r="3.5" />
          <circle cx="300" cy="90" r="4.5" />
          <circle cx="560" cy="60" r="3.5" />
          <circle cx="40" cy="60" r="3" />
          <circle cx="330" cy="150" r="4" />
          <circle cx="560" cy="150" r="3" />
        </g>
      </svg>

      <div className="hero-preview-head">
        <span className="live-dot" />
        <span className="hero-preview-title">Live · Cross-chain quote</span>
        <span className="testnet-pill">TESTNET · VALUELESS</span>
      </div>

      <div className="hero-preview-quote">
        {q === null ? (
          <span className="hp-muted">Fetching live quote…</span>
        ) : q.ok ? (
          <>
            <span className="hp-pair">{q.pair}</span>
            <span className="hp-amount">
              {q.amountIn} → <strong>{q.amountOut}</strong>
            </span>
          </>
        ) : (
          <span className="hp-muted">Quote unavailable{q.error ? `: ${q.error}` : ""}</span>
        )}
      </div>

      <div className="hero-preview-row">
        <div className="hero-risk-chip" style={{ borderColor: `${color}55`, background: `${color}14` }}>
          <span className="hero-risk-dot" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
          <span style={{ color }}>Route Guardian · {risk ? risk.verdict : "…"}</span>
          {risk && <span className="hp-muted">risk {risk.score}/100</span>}
        </div>
        <a className="hero-wallet-slot" href="/wallet">
          <span className="hp-muted">Wallet</span>
          <strong>Connect wallet →</strong>
        </a>
      </div>

      <div className="hero-proof-line">
        <span className="hp-muted">On-chain</span>
        <code>{CONTRACT}</code>
        <a href={`${EXPLORER}/accounts/${CONTRACT}`} target="_blank" rel="noreferrer">
          Verify on explorer ↗
        </a>
      </div>
    </div>
  );
}
