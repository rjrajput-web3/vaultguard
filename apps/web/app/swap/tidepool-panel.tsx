"use client";

/**
 * TidePool TESTNET intents panel for /swap.
 *
 * Shows a live dry-run quote from the TidePool NEAR testnet Intents sandbox
 * plus the verified E2E settlement proof. Everything here is TESTNET-ONLY
 * and clearly labeled — tokens are valueless, and this panel never touches
 * mainnet. Mainnet swaps stay on the RHEA panel above.
 */
import { useEffect, useState } from "react";

interface TidePoolQuoteState {
  ok: boolean;
  network: string;
  pair?: string;
  amountIn?: string;
  amountOut?: string;
  amountOutUsd?: string;
  timeEstimateSec?: number;
  disclaimer?: string;
  error?: string;
}

// Verified on-chain 2026-11-02 via fastnear RPC (testnet). Real tx hashes.
const E2E_PROOF = {
  depositTx: "4gXiMecSKJ3DU4hmg3149pX7kFwVZnBxfDUhznvmaWNZ",
  settlementTx: "2cCAGm9gaXofQQ9wD27WXJnyc8rqaYyh2R4HhjYvwcvo",
  pair: "1 test USDC → ~0.2494 test wNEAR",
  explorer: "https://testnet.nearblocks.com/txns/",
};

export default function TidePoolPanel() {
  const [quote, setQuote] = useState<TidePoolQuoteState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tidepool/quote");
        const data = (await res.json()) as TidePoolQuoteState;
        if (!cancelled) setQuote(data);
      } catch (e) {
        if (!cancelled)
          setQuote({
            ok: false,
            network: "testnet",
            error: e instanceof Error ? e.message : String(e),
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="glass"
      style={{
        border: "1px solid rgba(245,158,11,0.35)",
        borderRadius: 16,
        padding: 24,
        marginTop: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Testnet Intents</h3>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            padding: "3px 10px",
            borderRadius: 999,
            background: "rgba(245,158,11,0.15)",
            border: "1px solid rgba(245,158,11,0.5)",
            color: "#fbbf24",
          }}
        >
          TESTNET · VALUELESS
        </span>
        <span style={{ fontSize: 12, color: "var(--t-dim)" }}>powered by TidePool sandbox</span>
      </div>

      <p style={{ fontSize: 13, color: "var(--t-dim)", margin: "10px 0 0" }}>
        Live NEAR testnet intent quotes while the mainnet 1Click solver is down. Quotes are
        dry-run (no funds move). The full flow — live quote → Route Guardian gate → deposit →
        on-chain settlement — is verified with real testnet transactions below.
      </p>

      <div style={{ marginTop: 16 }}>
        {loading && <div style={{ fontSize: 13, color: "var(--t-dim)" }}>Fetching testnet quote…</div>}
        {!loading && quote?.ok && (
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
              margin: 0,
            }}
          >
            <div>
              <dt style={{ fontSize: 11, color: "var(--t-dim)" }}>Pair (testnet)</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{quote.pair}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, color: "var(--t-dim)" }}>In</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{quote.amountIn} test USDC</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, color: "var(--t-dim)" }}>Out (est.)</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{quote.amountOut} test wNEAR</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, color: "var(--t-dim)" }}>Settle ETA</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>~{quote.timeEstimateSec ?? "?"}s</dd>
            </div>
          </dl>
        )}
        {!loading && quote && !quote.ok && (
          <div style={{ fontSize: 13, color: "#f87171" }}>
            Testnet quote unavailable: {quote.error ?? "unknown error"}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 14,
          borderRadius: 12,
          background: "rgba(139,92,246,0.07)",
          border: "1px solid rgba(139,92,246,0.25)",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>
          ✓ VERIFIED E2E ON TESTNET (2026-11-02)
        </div>
        <div style={{ fontSize: 12, color: "var(--t-dim)", marginBottom: 8 }}>{E2E_PROOF.pair}</div>
        <div style={{ fontSize: 12, wordBreak: "break-all" }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: "var(--t-dim)" }}>Deposit&nbsp;</span>
            <a
              href={`${E2E_PROOF.explorer}${E2E_PROOF.depositTx}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#a78bfa" }}
            >
              {E2E_PROOF.depositTx}
            </a>
          </div>
          <div>
            <span style={{ color: "var(--t-dim)" }}>Settlement&nbsp;</span>
            <a
              href={`${E2E_PROOF.explorer}${E2E_PROOF.settlementTx}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#a78bfa" }}
            >
              {E2E_PROOF.settlementTx}
            </a>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--t-dim)", marginTop: 8 }}>
          Both verified SuccessValue via fastnear RPC. Route Guardian gate (chains, tokens,
          amount, recipient, expiry, slippage) passed before the deposit.
        </div>
      </div>
    </div>
  );
}
