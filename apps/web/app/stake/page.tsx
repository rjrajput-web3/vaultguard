"use client";

import AppShell from "../../components/AppShell";

function StakeInner() {
  return (
    <div className="vg-wrap">
      <section className="vg-section" style={{ paddingTop: 40 }}>
        <div className="vg-eyebrow">VAULTRY · Stake</div>
        <h2 className="vg-h2">
          Staking <span className="grad-text">coming soon</span>
        </h2>
        <p className="vg-sub">
          Native staking with Route Guardian protection is on the roadmap.
          This page will go live with real on-chain staking only — no
          mockups, no simulated yields.
        </p>
        <div className="glass glass-pad">
          <div className="vg-trail">
            Planned: stake NEAR and EVM assets through audited contracts, with
            the same pre-flight risk scoring that guards every VAULTRY swap.
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
            <a className="vg-btn" href="/swap">Try the live swap</a>
            <a className="vg-btn vg-btn-ghost" href="/security">Route Guardian</a>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function StakePage() {
  return (
    <AppShell>
      <StakeInner />
    </AppShell>
  );
}
