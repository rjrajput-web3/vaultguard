"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RiskGauge from "./RiskGauge";
import { scoreLiveQuote, VERDICT_COLOR, type RiskVerdict } from "./risk";
import { useAnimEnabled } from "./useMotion";

const FROM_CHAINS = [
  { key: "near-testnet", label: "NEAR Testnet", live: true },
  { key: "1", label: "Ethereum", live: false },
  { key: "8453", label: "Base", live: false },
  { key: "501", label: "Solana", live: false },
];
const TESTNET_TOKENS = [
  { key: "usdc", label: "test USDC" },
  { key: "wnear", label: "test wNEAR" },
  { key: "usdt", label: "test USDT" },
  { key: "wbtc", label: "test wBTC" },
  { key: "eth", label: "test ETH" },
];
const MAINNET_TOS = [
  { key: "501", label: "Solana" },
  { key: "900001", label: "NEAR" },
  { key: "1", label: "Ethereum" },
];

type Quote = {
  ok: boolean;
  pair?: string;
  amountIn?: string;
  amountOut?: string;
  amountOutBaseUnits?: string;
  minAmountOut?: string;
  amountOutUsd?: string;
  timeEstimateSec?: number;
  disclaimer?: string;
  error?: string;
};

function fromLabel(k: string) {
  return TESTNET_TOKENS.find((t) => t.key === k)?.label ?? k;
}

/** Horizontal swap bar: live TidePool testnet quotes + real Route Guardian verdict. */
export default function SwapBar() {
  const anim = useAnimEnabled();
  const [fromChain, setFromChain] = useState("near-testnet");
  const [fromToken, setFromToken] = useState("usdc");
  const [toKey, setToKey] = useState("wnear");
  const [amount, setAmount] = useState("1");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTestnet = fromChain === "near-testnet";
  const toOptions = isTestnet
    ? TESTNET_TOKENS.filter((t) => t.key !== fromToken).map((t) => ({ key: t.key, label: t.label }))
    : MAINNET_TOS;

  const fetchQuote = useCallback(async (amt: string, from: string, to: string) => {
    const n = Number(amt);
    if (!Number.isFinite(n) || n <= 0) {
      setQuote(null);
      setErr(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/tidepool/quote?amount=${encodeURIComponent(amt)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const j = (await r.json()) as Quote;
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setQuote(j);
    } catch (e) {
      setQuote(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!isTestnet) {
      setQuote(null);
      setErr(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => fetchQuote(amount, fromToken, toKey), 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [amount, fromToken, toKey, isTestnet, fetchQuote]);

  const flip = () => {
    if (isTestnet) {
      const f = fromToken;
      setFromToken(toKey);
      setToKey(f);
    } else {
      const chainOpt = FROM_CHAINS.find((c) => c.key === toKey);
      if (chainOpt) {
        setFromChain(toKey);
        setToKey(fromChain === "near-testnet" ? "501" : fromChain);
      }
    }
  };

  const risk = quote ? scoreLiveQuote(quote.amountOutBaseUnits, quote.minAmountOut) : null;
  const verdict: RiskVerdict = risk ? risk.verdict : "SAFE";
  const verdictLabel = verdict === "SAFE" ? "Protected" : verdict === "CAUTION" ? "Review needed" : "Blocked";

  const statusLine = !isTestnet ? (
    <span className="sb-status-warn">
      <span className="sb-dot" style={{ background: "#fbbf24" }} /> Mainnet quoting needs the RHEA API key —{" "}
      <a href="/swap">open the full terminal</a> for the honest status.
    </span>
  ) : loading ? (
    <span className="sb-status-live">
      <span className="sb-dot sb-dot-pulse" /> Fetching live testnet quote…
    </span>
  ) : err ? (
    <span className="sb-status-err">
      <span className="sb-dot" style={{ background: "#f87171" }} /> Quote failed: {err}
    </span>
  ) : quote ? (
    <span className="sb-status-live">
      <span className="sb-dot" /> Best Route: {quote.pair}
      {typeof quote.timeEstimateSec === "number" ? ` · Est. Time: ~${quote.timeEstimateSec}s` : ""}
      <span className="sb-sec">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={VERDICT_COLOR[verdict]} strokeWidth="2.4">
          <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" />
        </svg>
        Security: {verdictLabel}
      </span>
    </span>
  ) : (
    <span className="sb-status-idle">Enter an amount for a live testnet quote.</span>
  );

  return (
    <div id="live-swap" className="swap-bar glass tilt" data-swap-bar>
      <div className="sb-row">
        <label className="sb-field">
          <span className="sb-label">From Chain</span>
          <select value={fromChain} onChange={(e) => { setFromChain(e.target.value); setToKey(e.target.value === "near-testnet" ? "wnear" : "501"); }}>
            {FROM_CHAINS.map((c) => (
              <option key={c.key} value={c.key}>{c.label}{c.live ? "" : " · mainnet"}</option>
            ))}
          </select>
        </label>
        <label className="sb-field">
          <span className="sb-label">Token</span>
          {isTestnet ? (
            <select value={fromToken} onChange={(e) => { setFromToken(e.target.value); if (e.target.value === toKey) setToKey(TESTNET_TOKENS.find((t) => t.key !== e.target.value)!.key); }}>
              {TESTNET_TOKENS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          ) : (
            <select value="usdc" disabled><option value="usdc">USDC</option></select>
          )}
        </label>
        <label className="sb-field sb-amount">
          <span className="sb-label">Amount</span>
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1.0"
          />
        </label>
        <button type="button" className="sb-flip" onClick={flip} aria-label="Reverse direction" title="Reverse direction">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 16V8m0 0L4 11m3-3l3 3M17 8v8m0 0l3-3m-3 3l-3-3" />
          </svg>
        </button>
        <label className="sb-field">
          <span className="sb-label">To</span>
          <select value={toKey} onChange={(e) => setToKey(e.target.value)}>
            {toOptions.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
        <a className="vg-btn sb-cta" href="/swap">Swap Now <span aria-hidden="true">→</span></a>
      </div>

      <div className="sb-status">
        {statusLine}
        {isTestnet ? <span className="sb-testnet-pill">TESTNET · LIVE</span> : null}
      </div>

      {isTestnet && quote && risk ? (
        <div className="sb-result">
          <div className="sb-quote-path">
            <svg viewBox="0 0 320 64" className="qp-svg" aria-hidden="true">
              <defs>
                <linearGradient id="qp-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#a855f7" />
                  <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
              <path
                id="qp-track"
                d="M16 44 C 90 10, 230 58, 304 20"
                fill="none"
                stroke="url(#qp-grad)"
                strokeWidth="2"
                strokeDasharray="7 7"
                className={anim ? "qp-dash" : undefined}
                opacity="0.85"
              />
              <circle r="6" fill="#a855f7" opacity="0.95">
                {anim ? <animateMotion dur="2.6s" repeatCount="indefinite"><mpath href="#qp-track" /></animateMotion> : null}
              </circle>
              <text x="16" y="60" fill="rgba(196,181,253,.65)" fontSize="10">{fromLabel(fromToken)}</text>
              <text x="304" y="14" fill="rgba(196,181,253,.65)" fontSize="10" textAnchor="end">{fromLabel(toKey)}</text>
            </svg>
            <div className="sb-quote-nums">
              <span className="sb-q-in">{quote.amountIn} {fromLabel(fromToken)}</span>
              <span className="sb-q-arrow">→</span>
              <span className="sb-q-out">≈ {quote.amountOut} {fromLabel(toKey)}</span>
            </div>
          </div>
          <div className="sb-gauge">
            <RiskGauge score={risk.score} verdict={verdict} size={150} animated={anim} scanning={loading} />
            <div className="sb-gauge-notes">
              {risk.reasons.map((r, i) => (
                <div key={i} className="sb-reason">· {r}</div>
              ))}
              <div className="sb-testnet-note">TESTNET · valueless tokens</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
