"use client";

/**
 * VAULTGUARD — cross-chain swap interface (workstream G).
 *
 * Data honesty rules in this file (zero tolerance):
 *  - Chains + tokens come ONLY from the live 1Click registry via
 *    lib/intents/registry.ts. No hardcoded token lists anywhere.
 *  - Quotes come ONLY from POST /api/intents/quote (dry-run, real solver
 *    numbers). Failures render the API's own message verbatim.
 *  - Balances come ONLY from the wallet stub (components/swap/wallet-stub.ts)
 *    until the wallet workstream wires a real adapter. Until then the UI
 *    shows "—", never a fabricated balance.
 *  - NEAR-chain legs are NOT executable: the 1Click solver returns
 *    HTTP 400 "Internal server error" for any NEAR route (verified
 *    2026-11-02, see lib/intents/QUOTE_STATUS.md). NEAR is disabled in
 *    both selectors with the honest reason, and quoting is blocked
 *    client-side with that same reason.
 *  - The "Approve in wallet" button is disabled until on-chain execution
 *    wiring lands. No fake tx hashes are ever shown.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSupportedChains,
  getIntentsTokens,
  type IntentsToken,
} from "../../lib/intents/registry";
import RouteViz, { type RouteStatus } from "../../components/swap/RouteViz";
import SwapHistory from "../../components/swap/SwapHistory";
import { connectWallet, getBalance } from "../../components/swap/wallet-stub";
import { isNearChain, validateChainAddress } from "../../components/swap/validation";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

type RegState = "loading" | "ready" | "error";
type QuoteState = "idle" | "loading" | "ok" | "error";

interface ApiQuote {
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  amountOutUsd?: string;
  timeEstimateMs: number;
  expiresAt: string;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Chain display label. Raw registry id is the fallback — never blocks unknown chains. */
function prettyChain(chain: string): string {
  const map: Record<string, string> = {
    base: "Base",
    eth: "Ethereum",
    sol: "Solana",
    near: "NEAR",
    arb: "Arbitrum",
    op: "Optimism",
    pol: "Polygon",
    bsc: "BNB Chain",
    avax: "Avalanche",
    btc: "Bitcoin",
  };
  return map[chain.toLowerCase()] ?? chain.toUpperCase();
}

function shortAssetId(id: string): string {
  return id.length > 26 ? `${id.slice(0, 14)}…${id.slice(-8)}` : id;
}

function toBaseUnits(amount: string, decimals: number): string {
  const [wholeRaw = "", fracRaw = ""] = amount.trim().split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  const units =
    BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(frac === "" ? "0" : frac);
  return units.toString();
}

function fromBaseUnits(units: string, decimals: number): string {
  const neg = units.startsWith("-");
  const u = (neg ? units.slice(1) : units).replace(/[^0-9]/g, "") || "0";
  const padded = u.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? `.${frac}` : "");
}

function fmtDurationMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `≈ ${s}s`;
  const m = Math.floor(s / 60);
  return `≈ ${m}m ${s % 60}s`;
}

function fmtCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = `${m}`.padStart(2, "0");
  const ss = `${sec}`.padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function SwapPage() {
  /* registry */
  const [regState, setRegState] = useState<RegState>("loading");
  const [regError, setRegError] = useState<string>("");
  const [chains, setChains] = useState<string[]>([]);
  const [tokens, setTokens] = useState<IntentsToken[]>([]);

  /* selection */
  const [fromChain, setFromChain] = useState("base");
  const [toChain, setToChain] = useState("sol");
  const [fromAssetId, setFromAssetId] = useState("");
  const [toAssetId, setToAssetId] = useState("");

  /* form */
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [recipient, setRecipient] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  /* quote */
  const [quoteState, setQuoteState] = useState<QuoteState>("idle");
  const [quote, setQuote] = useState<ApiQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string>("");
  const [now, setNow] = useState(() => Date.now());

  /* wallet (stub) */
  const [balance, setBalance] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);

  /* ---------------- registry load ---------------- */
  const loadRegistry = useCallback(async () => {
    setRegState("loading");
    setRegError("");
    try {
      const [liveChains, liveTokens] = await Promise.all([
        getSupportedChains(),
        // full token list once; per-chain filtering is local and pure
        getIntentsTokens(),
      ]);
      setChains(liveChains);
      setTokens(liveTokens);

      const from = liveChains.includes("base") ? "base" : liveChains[0] ?? "";
      const rest = liveChains.filter((c) => c !== from && !isNearChain(c));
      const to = rest.includes("sol") ? "sol" : rest[0] ?? "";

      const pickDefault = (chain: string): string => {
        const list = liveTokens.filter(
          (t) => t.blockchain.toLowerCase() === chain.toLowerCase(),
        );
        return (
          list.find((t) => t.symbol.toUpperCase() === "USDC")?.assetId ??
          list[0]?.assetId ??
          ""
        );
      };
      setFromChain(from);
      setToChain(to);
      setFromAssetId(pickDefault(from));
      setToAssetId(pickDefault(to));
      setRegState("ready");
    } catch (err) {
      setRegError(err instanceof Error ? err.message : String(err));
      setRegState("error");
    }
  }, []);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  const fromTokens = useMemo(
    () => tokens.filter((t) => t.blockchain.toLowerCase() === fromChain.toLowerCase()),
    [tokens, fromChain],
  );
  const toTokens = useMemo(() => {
    return tokens.filter((t) => t.blockchain.toLowerCase() === toChain.toLowerCase());
  }, [tokens, toChain]);

  const fromToken = fromTokens.find((t) => t.assetId === fromAssetId) ?? null;
  const toToken = toTokens.find((t) => t.assetId === toAssetId) ?? null;

  /* ---------------- wallet stub ---------------- */
  const handleConnect = useCallback(async () => {
    const res = await connectWallet();
    setWalletNote(
      res.connected
        ? `connected: ${res.address ?? ""}`
        : res.reason,
    );
  }, []);

  useEffect(() => {
    // Balance is honest: the stub returns null until the wallet
    // workstream wires a real adapter — UI shows "—".
    if (!fromAssetId) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    void getBalance(fromAssetId).then((b) => {
      if (!cancelled) setBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [fromAssetId]);

  /* ---------------- quote countdown ---------------- */
  useEffect(() => {
    if (!quote) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [quote]);

  const quoteExpired = quote ? Date.now() >= new Date(quote.expiresAt).getTime() : false;

  /* ---------------- quote ---------------- */
  const routeStatus: RouteStatus =
    quoteState === "loading"
      ? "quoting"
      : quoteState === "error"
        ? "error"
        : quote && !quoteExpired
          ? "quoted"
          : "idle";

  const handleGetQuote = useCallback(async () => {
    setFormError(null);
    setQuoteError("");
    setQuote(null);

    if (!fromToken || !toToken) {
      setFormError("select a source and destination token first");
      return;
    }
    if (fromAssetId === toAssetId) {
      setFormError("source and destination tokens must differ");
      return;
    }
    // NEAR legs are not executable — solver outage (verified 2026-11-02).
    if (isNearChain(fromChain) || isNearChain(toChain)) {
      setFormError(
        "NEAR-leg routes are currently unavailable — 1Click solver outage " +
          "(HTTP 400 “Internal server error” for any NEAR route, verified 2026-11-02). " +
          "Pick a non-NEAR pair.",
      );
      return;
    }
    const amt = amount.trim();
    if (!/^\d+(\.\d+)?$/.test(amt) || Number(amt) <= 0) {
      setFormError("enter a valid amount greater than zero");
      return;
    }
    const recipCheck = validateChainAddress(recipient, toChain);
    if (!recipCheck.ok) {
      setFormError(`destination address: ${recipCheck.reason}`);
      return;
    }
    const refundCheck = validateChainAddress(refundTo, fromChain);
    if (!refundCheck.ok) {
      setFormError(`refund address (${prettyChain(fromChain)}): ${refundCheck.reason}`);
      return;
    }

    setQuoteState("loading");
    try {
      const res = await fetch("/api/intents/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originAssetId: fromToken.assetId,
          destinationAssetId: toToken.assetId,
          amountBaseUnits: toBaseUnits(amt, fromToken.decimals),
          slippageBps,
          recipient: recipient.trim(),
          refundTo: refundTo.trim(),
        }),
      });
      const data = (await res.json()) as
        | { ok: true; quote: ApiQuote }
        | { ok: false; code: string; message: string };
      if (!data.ok) {
        // Quote the API's real message verbatim — never invent one.
        setQuoteError(`${data.code}: ${data.message}`);
        setQuoteState("error");
        return;
      }
      setQuote(data.quote);
      setQuoteState("ok");
      setNow(Date.now());
    } catch (err) {
      setQuoteError(
        `quote request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setQuoteState("error");
    }
  }, [fromToken, toToken, fromAssetId, toAssetId, fromChain, toChain, amount, slippageBps, recipient, refundTo]);

  const flip = useCallback(() => {
    setFromChain(toChain);
    setToChain(fromChain);
    setFromAssetId(toAssetId);
    setToAssetId(fromAssetId);
    setQuote(null);
    setQuoteState("idle");
  }, [fromChain, toChain, fromAssetId, toAssetId]);

  const routeLabel = useMemo(() => {
    if (!quote || quoteExpired || !fromToken || !toToken) return null;
    const out = fromBaseUnits(quote.amountOut, toToken.decimals);
    return `${fromBaseUnits(quote.amountIn, fromToken.decimals)} ${fromToken.symbol} → ${out} ${toToken.symbol}`;
  }, [quote, quoteExpired, fromToken, toToken]);

  /* ---------------- render ---------------- */
  return (
    <div className="vg-wrap">
      <style>{`
        .vg-skeleton { border-radius: 10px; background: linear-gradient(90deg, rgba(125,211,252,0.06), rgba(125,211,252,0.14), rgba(125,211,252,0.06)); background-size: 200% 100%; animation: vg-sk 1.4s linear infinite; }
        @keyframes vg-sk { to { background-position: -200% 0; } }
        .vg-select { width: 100%; background: rgba(4,7,15,0.7); border: 1px solid rgba(125,211,252,0.18); border-radius: 10px; color: var(--text); padding: 12px 14px; font-size: 15px; }
        .vg-select:focus { outline: none; border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(34,211,238,0.15); }
        .vg-row { display: flex; gap: 12px; }
        .vg-row > * { flex: 1; }
        .vg-outage { border: 1px solid rgba(245,158,11,0.4); background: rgba(245,158,11,0.08); color: #f5d9a8; border-radius: 10px; padding: 10px 16px; font-size: 13px; margin-bottom: 20px; }
        @media (max-width: 560px) { .vg-row { flex-direction: column; } }
      `}</style>

      <section className="vg-section" style={{ paddingTop: 120 }}>
        <a href="/" style={{ color: "var(--cyan)", fontSize: 14, textDecoration: "none" }}>
          ← back to VAULTGUARD
        </a>
        <div className="vg-eyebrow" style={{ marginTop: 24 }}>
          VAULTGUARD · NEAR Intents
        </div>
        <h2 className="vg-h2">
          Cross-chain <span className="grad-text">swap</span>
        </h2>
        <p className="vg-sub">
          Live dry-run quotes from the NEAR Intents solver — real numbers, no
          funds move. Chains and tokens load from the live registry; anything
          the registry doesn’t list can’t be quoted.
        </p>

        {regState === "loading" && (
          <div className="grid-2">
            <div className="glass glass-pad" aria-busy="true" aria-label="Loading swap interface">
              <div className="vg-skeleton" style={{ height: 22, width: "40%", marginBottom: 16 }} />
              <div className="vg-skeleton" style={{ height: 48, marginBottom: 12 }} />
              <div className="vg-skeleton" style={{ height: 48, marginBottom: 12 }} />
              <div className="vg-skeleton" style={{ height: 48, marginBottom: 12 }} />
              <div className="vg-skeleton" style={{ height: 48 }} />
            </div>
            <div className="glass glass-pad" aria-hidden="true">
              <div className="vg-skeleton" style={{ height: 180, marginBottom: 12 }} />
              <div className="vg-skeleton" style={{ height: 22, width: "60%", margin: "0 auto" }} />
            </div>
          </div>
        )}

        {regState === "error" && (
          <div className="vg-alert err" role="alert">
            <strong>Live registry unavailable.</strong> The swap interface needs
            the Intents token list and it failed to load — nothing is shown
            rather than a stale or invented list.
            <div className="vg-trail" style={{ marginTop: 8 }}>{regError}</div>
            <button className="vg-btn vg-btn-ghost" style={{ marginTop: 16 }} onClick={() => void loadRegistry()}>
              Retry registry load
            </button>
          </div>
        )}

        {regState === "ready" && (
          <div className="grid-2" style={{ alignItems: "start" }}>
            {/* ---------------- swap card ---------------- */}
            <div className="glass glass-pad">
              <div className="vg-outage" role="note">
                <strong>NEAR-leg routes unavailable</strong> — the 1Click solver
                returns HTTP 400 “Internal server error” for any NEAR route
                (verified 2026-11-02). NEAR is disabled below until the solver
                recovers.
              </div>

              {/* FROM */}
              <div className="vg-field">
                <label className="vg-label" htmlFor="swap-from-chain">From · chain</label>
                <select
                  id="swap-from-chain"
                  className="vg-select"
                  value={fromChain}
                  onChange={(e) => {
                    const c = e.target.value;
                    setFromChain(c);
                    const list = tokens.filter(
                      (t) => t.blockchain.toLowerCase() === c.toLowerCase(),
                    );
                    setFromAssetId(
                      list.find((t) => t.symbol.toUpperCase() === fromToken?.symbol.toUpperCase())?.assetId ??
                        list[0]?.assetId ?? "",
                    );
                    setQuote(null);
                    setQuoteState("idle");
                  }}
                >
                  {chains.map((c) => (
                    <option key={c} value={c} disabled={isNearChain(c)}>
                      {prettyChain(c)}
                      {isNearChain(c) ? " — route unavailable (solver outage)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="vg-field">
                <label className="vg-label" htmlFor="swap-from-token">From · token</label>
                <select
                  id="swap-from-token"
                  className="vg-select"
                  value={fromAssetId}
                  onChange={(e) => {
                    setFromAssetId(e.target.value);
                    setQuote(null);
                    setQuoteState("idle");
                  }}
                >
                  {fromTokens.map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} · {shortAssetId(t.assetId)}
                    </option>
                  ))}
                </select>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 8,
                    fontSize: 13,
                    color: "var(--muted)",
                  }}
                >
                  <span>
                    Balance: {balance === null ? "—" : balance}{" "}
                    <span style={{ color: "var(--dim)" }}>(connect wallet for live balance)</span>
                  </span>
                  <button
                    type="button"
                    className="vg-btn vg-btn-ghost"
                    style={{ padding: "6px 14px", fontSize: 12.5 }}
                    onClick={() => void handleConnect()}
                  >
                    Connect wallet
                  </button>
                </div>
                {walletNote && (
                  <div className="vg-trail t-dim" style={{ marginTop: 6 }}>{walletNote}</div>
                )}
              </div>

              <div style={{ textAlign: "center", margin: "4px 0 12px" }}>
                <button
                  type="button"
                  className="vg-btn vg-btn-ghost"
                  style={{ padding: "8px 18px" }}
                  onClick={flip}
                  aria-label="Flip source and destination"
                  title="Flip source and destination"
                >
                  ⇅ flip
                </button>
              </div>

              {/* TO */}
              <div className="vg-field">
                <label className="vg-label" htmlFor="swap-to-chain">To · chain</label>
                <select
                  id="swap-to-chain"
                  className="vg-select"
                  value={toChain}
                  onChange={(e) => {
                    const c = e.target.value;
                    setToChain(c);
                    const list = tokens.filter(
                      (t) => t.blockchain.toLowerCase() === c.toLowerCase(),
                    );
                    setToAssetId(
                      list.find((t) => t.symbol.toUpperCase() === toToken?.symbol.toUpperCase())?.assetId ??
                        list[0]?.assetId ?? "",
                    );
                    setQuote(null);
                    setQuoteState("idle");
                  }}
                >
                  {chains.map((c) => (
                    <option key={c} value={c} disabled={isNearChain(c)}>
                      {prettyChain(c)}
                      {isNearChain(c) ? " — route unavailable (solver outage)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="vg-field">
                <label className="vg-label" htmlFor="swap-to-token">To · token</label>
                <select
                  id="swap-to-token"
                  className="vg-select"
                  value={toAssetId}
                  onChange={(e) => {
                    setToAssetId(e.target.value);
                    setQuote(null);
                    setQuoteState("idle");
                  }}
                >
                  {toTokens.map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} · {shortAssetId(t.assetId)}
                    </option>
                  ))}
                </select>
              </div>

              {/* AMOUNT */}
              <div className="vg-field">
                <label className="vg-label" htmlFor="swap-amount">Amount</label>
                <input
                  id="swap-amount"
                  className="vg-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              {/* ADDRESSES */}
              <div className="vg-field">
                <label className="vg-label" htmlFor="swap-recipient">
                  Destination address · {prettyChain(toChain)}
                </label>
                <input
                  id="swap-recipient"
                  className="vg-input"
                  style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13.5 }}
                  placeholder={
                    toChain === "sol"
                      ? "Solana address (base58)"
                      : isNearChain(toChain)
                        ? "name.near"
                        : "0x…"
                  }
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </div>
              <div className="vg-field">
                <label className="vg-label" htmlFor="swap-refund">
                  Refund address · {prettyChain(fromChain)} (origin chain)
                </label>
                <input
                  id="swap-refund"
                  className="vg-input"
                  style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13.5 }}
                  placeholder={fromChain === "sol" ? "Solana address (base58)" : "0x…"}
                  value={refundTo}
                  onChange={(e) => setRefundTo(e.target.value)}
                />
              </div>

              {/* SLIPPAGE */}
              <div className="vg-field">
                <label className="vg-label" htmlFor="swap-slippage">Slippage tolerance</label>
                <select
                  id="swap-slippage"
                  className="vg-select"
                  value={slippageBps}
                  onChange={(e) => setSlippageBps(Number(e.target.value))}
                >
                  <option value={10}>0.1%</option>
                  <option value={50}>0.5% (default)</option>
                  <option value={100}>1.0%</option>
                </select>
              </div>

              {formError && (
                <div className="vg-alert err" role="alert">{formError}</div>
              )}
              {quoteError && (
                <div className="vg-alert err" role="alert">
                  <strong>Quote failed.</strong>
                  <div className="vg-trail" style={{ marginTop: 6 }}>{quoteError}</div>
                </div>
              )}

              <button
                className="vg-btn"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => void handleGetQuote()}
                disabled={quoteState === "loading"}
              >
                {quoteState === "loading" ? "Requesting live quote…" : "Get quote"}
              </button>
              <div className="vg-trail t-dim" style={{ marginTop: 10, textAlign: "center" }}>
                Dry-run only — no deposit address is created, no funds can move.
              </div>

              {/* QUOTE RESULT */}
              {quote && !quoteExpired && fromToken && toToken && (
                <div style={{ marginTop: 24 }} aria-live="polite">
                  <div className="vg-label">Live quote</div>
                  <dl className="vg-kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div>
                      <dt>You send</dt>
                      <dd>{fromBaseUnits(quote.amountIn, fromToken.decimals)} {fromToken.symbol}</dd>
                    </div>
                    <div>
                      <dt>You receive (est.)</dt>
                      <dd>{fromBaseUnits(quote.amountOut, toToken.decimals)} {toToken.symbol}</dd>
                    </div>
                    <div>
                      <dt>Minimum received</dt>
                      <dd>{fromBaseUnits(quote.minAmountOut, toToken.decimals)} {toToken.symbol}</dd>
                    </div>
                    <div>
                      <dt>Time estimate</dt>
                      <dd>{fmtDurationMs(quote.timeEstimateMs)}</dd>
                    </div>
                    {quote.amountOutUsd && (
                      <div>
                        <dt>USD value (est.)</dt>
                        <dd>≈ ${Number(quote.amountOutUsd).toFixed(4)}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Quote expires in</dt>
                      <dd>{fmtCountdown(new Date(quote.expiresAt).getTime() - now)}</dd>
                    </div>
                  </dl>
                  <div className="vg-trail t-dim" style={{ marginTop: 12 }}>
                    Fees: solver fee included in quote — exact breakdown not
                    exposed by the dry-run endpoint, so no fee numbers are
                    invented here.
                  </div>
                </div>
              )}
              {quote && quoteExpired && (
                <div className="vg-alert err" role="alert" style={{ marginTop: 24 }}>
                  Quote expired — get a fresh quote before reviewing.
                </div>
              )}
            </div>

            {/* ---------------- right column ---------------- */}
            <div style={{ display: "grid", gap: 24 }}>
              <RouteViz
                fromChain={prettyChain(fromChain)}
                toChain={prettyChain(toChain)}
                fromSymbol={fromToken?.symbol ?? "?"}
                toSymbol={toToken?.symbol ?? "?"}
                routeLabel={routeLabel}
                status={routeStatus}
              />

              {/* REVIEW */}
              <div className="glass glass-pad" aria-label="Swap review">
                <div className="vg-label" style={{ marginBottom: 16 }}>
                  Review
                </div>

                {/* RISK-PANEL: wire apps/web/lib/risk/engine.ts assessSwapRisk here when available */}

                {quote && !quoteExpired && fromToken && toToken ? (
                  <>
                    <dl className="vg-kv">
                      <div>
                        <dt>Route</dt>
                        <dd style={{ fontSize: 14 }}>
                          {prettyChain(fromChain)} {fromToken.symbol} → {prettyChain(toChain)} {toToken.symbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Destination</dt>
                        <dd style={{ fontSize: 12.5, wordBreak: "break-all" }}>
                          {recipient.trim() || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Minimum received</dt>
                        <dd>
                          {fromBaseUnits(quote.minAmountOut, toToken.decimals)} {toToken.symbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Fees</dt>
                        <dd style={{ fontSize: 14 }}>solver fee included in quote</dd>
                      </div>
                    </dl>
                    <button
                      className="vg-btn"
                      style={{ width: "100%", justifyContent: "center", marginTop: 20 }}
                      disabled
                      title="On-chain execution wiring lands in a later workstream"
                    >
                      execution wiring in progress
                    </button>
                    <div className="vg-trail t-dim" style={{ marginTop: 10, textAlign: "center" }}>
                      Approval and on-chain execution come in a later workstream —
                      this button stays disabled until then.
                    </div>
                  </>
                ) : (
                  <div className="vg-trail t-dim">
                    Get a live quote to review the swap details here.
                  </div>
                )}
              </div>

              <SwapHistory />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
