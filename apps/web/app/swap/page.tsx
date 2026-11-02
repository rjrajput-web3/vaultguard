"use client";

/**
 * /swap — VAULTRY testnet cross-chain swap (2026-11-02).
 *
 * TESTNET-ONLY. The live swap is NEAR Intents via the TidePool testnet
 * sandbox: live quote → Route Guardian gate → policy gate → keystore-signed
 * deposit → on-chain settlement. All tokens are valueless test tokens.
 *
 * Mainnet code paths were removed from the active tree 2026-11-02
 * (RHEA work preserved in git history + docs only, per his order).
 */
import AppShell from "../../components/AppShell";
import { PRODUCT_MODE_LABEL } from "../../lib/config";
import TidePoolSwapPanel from "./tidepool-swap-panel";

function SwapPageInner() {
  return (
    <div className="vg-wrap">
      <div className="vg-eyebrow" style={{ marginTop: 24 }}>
        VAULTRY · TESTNET SWAP
      </div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#fbbf24",
          background: "rgba(245,158,11,0.10)",
          border: "1px solid rgba(245,158,11,0.4)",
          borderRadius: 999,
          padding: "8px 16px",
          marginBottom: 18,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#f59e0b",
            boxShadow: "0 0 10px #f59e0b",
          }}
        />
        {PRODUCT_MODE_LABEL} · VALUELESS TEST TOKENS ONLY
      </div>
      <h2 className="vg-h2">
        Cross-chain <span className="grad-text">swap</span>
      </h2>
      <p className="vg-sub">
        Live testnet swaps on NEAR Intents (TidePool sandbox) — real quotes,
        Route Guardian scored, real on-chain settlement. Nothing here touches
        mainnet. Pairs with no genuine testnet route are labeled unsupported —
        never faked.
      </p>

      <TidePoolSwapPanel />
    </div>
  );
}

export default function SwapPage() {
  return (
    <AppShell>
      <SwapPageInner />
    </AppShell>
  );
}
