/** VAULTGUARD demo UI — Phase B: policy editor wired, live quote loop via guardian. */
import Link from "next/link";

const SAMPLE_REPORT = {
  pair: "Base USDC → NEAR USDC",
  amount: "1.0 USDC",
  router: "nearintents",
  estimatedOut: "0.9990 USDC",
  minAmountOut: "0.9980 USDC",
  slippage: "0.10%",
  score: 1.5,
  verdict: "SAFE" as const,
  alternatives: 3,
};

function Badge({ verdict }: { verdict: "SAFE" | "CAUTION" | "BLOCKED" }) {
  const colors = { SAFE: "#22c55e", CAUTION: "#f59e0b", BLOCKED: "#ef4444" } as const;
  return (
    <span
      style={{
        background: colors[verdict],
        color: "#0a0f1e",
        fontWeight: 800,
        padding: "4px 14px",
        borderRadius: 999,
        fontSize: 13,
        letterSpacing: 1,
      }}
    >
      {verdict}
    </span>
  );
}

export default function Home() {
  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px" }}>
      <div
        style={{
          background: "#f59e0b22",
          border: "1px solid #f59e0b",
          borderRadius: 8,
          padding: "10px 16px",
          fontSize: 13,
          marginBottom: 32,
        }}
      >
        Sample result — demo data. Live RHEA quotes connect in the next build phase.
      </div>

      <nav style={{ display: "flex", gap: 20, marginBottom: 8, fontSize: 14 }}>
        <span style={{ fontWeight: 800, color: "#e8ecf4" }}>Risk scanner</span>
        <Link href="/policy" style={{ color: "#7dd3fc" }}>Vault policy</Link>
      </nav>

      <h1 style={{ fontSize: 40, margin: "0 0 8px" }}>VAULTGUARD</h1>
      <p style={{ color: "#9aa4b8", marginTop: 0 }}>
        Self-protecting cross-chain vault — pre-flight risk scanner on RHEA X Chain SDK + NEAR
        Intents. Unstoppable DeFi track, NEAR Hackathon “Build Beyond Boundaries”.
      </p>

      <section
        style={{
          background: "#111a2e",
          border: "1px solid #22304d",
          borderRadius: 12,
          padding: 24,
          marginTop: 24,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Pre-flight risk report</h2>
          <Badge verdict={SAMPLE_REPORT.verdict} />
        </div>
        <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginTop: 20 }}>
          {[
            ["Route", SAMPLE_REPORT.pair],
            ["Amount", SAMPLE_REPORT.amount],
            ["Best router", SAMPLE_REPORT.router],
            ["Estimated out", SAMPLE_REPORT.estimatedOut],
            ["Min out", SAMPLE_REPORT.minAmountOut],
            ["Implied slippage", SAMPLE_REPORT.slippage],
            ["Risk score", `${SAMPLE_REPORT.score} / 100`],
            ["Fallback routes", `${SAMPLE_REPORT.alternatives} alternatives`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt style={{ color: "#9aa4b8", fontSize: 12, textTransform: "uppercase" }}>{k}</dt>
              <dd style={{ margin: "4px 0 0", fontSize: 17, fontWeight: 600 }}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {[
          ["Route guardian", "Primary router degrades → guardian falls back via excludeDexs or alternatives[], showing why."],
          ["Depeg auto-hedge", "Depeg confirmed → risk/slippage/fees/exit-cost calc → user limits check → safe route? auto-hedge to USDC via NEAR Intents : pause vault + alert."],
          ["Spending limits", "Per-tx + per-day caps and allowed assets enforced on-chain by the vault contract."],
        ].map(([title, body]) => (
          <div key={title} style={{ background: "#111a2e", border: "1px solid #22304d", borderRadius: 12, padding: 18 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>
            <p style={{ margin: 0, color: "#9aa4b8", fontSize: 14 }}>{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
