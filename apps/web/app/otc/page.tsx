"use client";

import AppShell from "../../components/AppShell";

function OtcInner() {
  return (
    <div className="vg-wrap">
      <section className="vg-section" style={{ paddingTop: 40 }}>
        <div className="vg-eyebrow">VAULTRY · OTC</div>
        <h2 className="vg-h2">
          Private OTC desk <span className="grad-text">coming soon</span>
        </h2>
        <p className="vg-sub">
          Negotiated private deals settled through the same guarded execution
          pipeline as swaps. This page will go live with real settlement
          only — nothing simulated.
        </p>
        <div className="glass glass-pad">
          <div className="vg-trail">
            Planned: private deal board, counter-offers, and on-chain
            settlement with full Route Guardian screening on every leg.
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

export default function OtcPage() {
  return (
    <AppShell>
      <OtcInner />
    </AppShell>
  );
}
