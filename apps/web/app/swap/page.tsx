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
import { TESTNET_SWAP_ROUTES } from "../../lib/wallet/chains";
import TidePoolSwapPanel from "./tidepool-swap-panel";

/** Honest cross-chain route availability — genuine routes only, the rest labeled. */
function RouteAvailability() {
  return (
    <div
      style={{
        background: "rgba(13,20,38,0.75)",
        border: "1px solid rgba(125,211,252,0.14)",
        borderRadius: 14,
        padding: 22,
        marginTop: 26,
      }}
    >
      <h3 style={{ margin: "0 0 6px" }}>Cross-chain route availability (testnet)</h3>
      <p style={{ fontSize: 13, color: "#5b6a84", lineHeight: 1.6, margin: "0 0 14px" }}>
        Only routes with a genuine, working testnet path are executable. Everything else is
        labeled honestly — a same-chain transfer is never presented as a cross-chain swap.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {TESTNET_SWAP_ROUTES.map((r, i) => (
          <div
            key={i}
            style={{
              border: "1px solid rgba(125,211,252,0.12)",
              borderRadius: 10,
              padding: "12px 14px",
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "#e9eef7", fontWeight: 700 }}>
                {r.from} → {r.to}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1,
                  padding: "4px 12px",
                  borderRadius: 999,
                  color: r.status === "live" ? "#86efac" : "#fca5a5",
                  background: r.status === "live" ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.08)",
                  border: r.status === "live" ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(239,68,68,0.3)",
                }}
              >
                {r.status === "live" ? "● LIVE" : "○ NOT SUPPORTED"}
              </span>
            </div>
            <div style={{ color: "#93a0b8", marginTop: 6 }}>
              {r.via !== "—" && <span style={{ color: "#22d3ee" }}>via {r.via} · </span>}
              {r.note}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
      <RouteAvailability />
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
