/**
 * HeroLivePanel — the hero's "live dApp dashboard preview".
 *
 * A 3D-tilted glass panel built from REAL live components, never a flat
 * screenshot or mocked numbers:
 *  - live TidePool testnet quote (same /api/tidepool/quote as the swap bar)
 *  - guardian risk chip scored from that real quote (scoreLiveQuote)
 *  - honest wallet slot ("Connect wallet →" → /wallet; never a fake balance)
 *
 * Mouse-tracked 3D tilt on desktop (pointer: fine); a fixed cinematic tilt
 * on touch devices. Respects the motion tier (static → no tilt).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { scoreLiveQuote } from "./risk";
import { VERDICT_COLOR, type RiskVerdict } from "./risk";
import { useMotionTier } from "./useMotion";

interface QuoteState {
  amountOut: string;
  ok: boolean;
}

export default function HeroLivePanel() {
  const tier = useMotionTier();
  const panelRef = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [guardian, setGuardian] = useState<{ score: number; verdict: RiskVerdict } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/tidepool/quote?amount=1&from=usdc&to=wnear")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j && j.ok && j.amountOut) {
          setQuote({ amountOut: String(j.amountOut), ok: true });
          const s = scoreLiveQuote(j.amountOutBaseUnits, j.minAmountOut);
          setGuardian({ score: s.score, verdict: s.verdict });
        } else {
          setQuote({ amountOut: "", ok: false });
        }
      })
      .catch(() => {
        if (alive) setQuote({ amountOut: "", ok: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  // Mouse-tracked 3D tilt (desktop only; static cinematic tilt on touch).
  function onMove(e: React.MouseEvent) {
    if (tier === "static") return;
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1100px) rotateY(${(px * 10).toFixed(2)}deg) rotateX(${(-py * 10).toFixed(2)}deg) translateY(-6px)`;
  }
  function onLeave() {
    const el = panelRef.current;
    if (el) el.style.transform = "";
  }

  const verdictColor = guardian ? VERDICT_COLOR[guardian.verdict] : "#94a3b8";

  return (
    <div
      ref={panelRef}
      className="hero-live-panel glass-3d"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <div className="hlp-head">
        <span className="live-dot" aria-hidden="true" />
        <span className="hlp-title">Live · VAULTRY dApp</span>
        <span className="testnet-pill">TESTNET</span>
      </div>

      <div className="hlp-quote">
        <span className="hlp-label">Live swap quote</span>
        {quote === null ? (
          <span className="hlp-loading">Fetching live quote…</span>
        ) : quote.ok ? (
          <span className="hlp-amount">
            1 test USDC <span className="hlp-arrow">→</span>{" "}
            <strong>≈ {Number(Number(quote.amountOut).toFixed(6))} test wNEAR</strong>
          </span>
        ) : (
          <span className="hlp-error">Quote unavailable — try the swap widget below</span>
        )}
      </div>

      <div className="hlp-row">
        <span
          className="hero-risk-chip"
          style={{ borderColor: verdictColor, color: verdictColor }}
        >
          <span className="hero-risk-dot" style={{ background: verdictColor, boxShadow: `0 0 10px ${verdictColor}` }} />
          Guardian: {guardian ? `${guardian.verdict} · ${Math.round(guardian.score)}` : "scanning…"}
        </span>
        <a className="hero-wallet-slot" href="/wallet">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M20 7H5a2 2 0 0 1 0-4h13v4 M20 7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
          </svg>
          Connect wallet <strong>→</strong>
        </a>
      </div>

      <div className="hlp-foot">
        <span className="hlp-foot-label">Security contract</span>
        <code>vaultguard.vgdeployer.testnet</code>
        <a
          href="https://explorer.testnet.near.org/accounts/vaultguard.vgdeployer.testnet"
          target="_blank"
          rel="noreferrer"
        >
          Verify ↗
        </a>
      </div>
    </div>
  );
}
