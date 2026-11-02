/**
 * /proofs — Enforcement Proofs (2026-11-03).
 *
 * "Don't trust. Verify." Every fund-safety claim VAULTRY makes, backed by
 * on-chain evidence: real transaction hashes, verified contract code, and
 * the exact enforcement proofs. TESTNET-ONLY — all evidence below is from
 * NEAR testnet / supported testnets. Nothing here is mocked.
 */

import Link from "next/link";
import BrandMark from "../../components/BrandMark";

const EXPLORER = "https://testnet.nearblocks.io/txns/";
const CONTRACT = "vaultguard.vgdeployer.testnet";
const CODE_HASH = "7Ezgjsjic8QDwWCfZg1mFaQnyYHzFG1fPHetXBixQeRD";
const REPO = "https://github.com/rjrajput-web3/vaultguard";

interface Proof {
  claim: string;
  result: "PASS" | "BLOCKED" | "ENFORCED";
  detail: string;
  tx?: string;
  note?: string;
}

const SPENDING_PROOFS: Proof[] = [
  {
    claim: "500 USDC transfer approved",
    result: "PASS",
    detail: "Within the 1,000 USDC per-transaction cap — contract approved on-chain.",
    tx: "EEHfcL14YnABocSomyUJGNTozoBQFrLRHqinPAa2na5j",
  },
  {
    claim: "2,000 USDC transfer rejected",
    result: "BLOCKED",
    detail: "Over the 1,000 USDC cap — contract refused. The limit is real.",
    tx: "BLLd3UdF36pSjjotwodNcj5SZXEp4itwf96guHwZf5b1",
  },
  {
    claim: "Emergency pause engaged",
    result: "ENFORCED",
    detail: "Owner paused the vault — all movement frozen until unpaused.",
    tx: "Dq8R4nZqRoSsUYnHD2MTh4NNVjrMF9k5cRLhBJ3PcdWo",
  },
  {
    claim: "Withdraw while paused rejected",
    result: "BLOCKED",
    detail: "Pause is not advisory — the contract rejected the withdrawal.",
    tx: "g6xTryWvhgtdkzTd5Nf438uvxoPXajGXow3m32fCKDK",
  },
  {
    claim: "Vault unpaused",
    result: "PASS",
    detail: "Owner resumed normal operation on-chain.",
    tx: "FR5g2Xm9fCK63Tj9sG91jGcTLYbpQxdGERo1Vb2nvkfB",
  },
  {
    claim: "100 USDC transfer approved",
    result: "PASS",
    detail: "Post-unpause flow confirmed working end-to-end.",
    tx: "Goz6hbkT5LyVdKCP7sv4SZqMJ4dE98hqRB3CaHqYgbNy",
  },
];

const POLICY_PROOFS: string[] = [
  "Emergency pause blocks wallet sends — verified, not just claimed",
  "Emergency pause blocks Agentic Wallet execution mid-flow",
  "Per-transaction cap enforced against live quote amounts (exact threshold shown in the rejection)",
  "Daily cap enforced across wallet + agent + swap surfaces",
  "Disallowed router blocked at the guardian before any signing prompt",
  "Disallowed asset blocked at the guardian before any signing prompt",
  "Expired quotes rejected — execution re-fetches and re-validates",
  "Policy lives on this device only — no server can weaken it",
];

const GUARDIAN_PROOFS: string[] = [
  "Every swap is scored by the Route Guardian before any signing prompt appears",
  "SAFE verdict still requires explicit wallet signing — zero silent execution",
  "CAUTION requires explicit user review and approval",
  "BLOCKED is non-bypassable — no override path exists in the code (verified by inspection)",
  "The AI agent cannot modify policies, thresholds, or verdicts",
  "The AI agent never receives private keys, seeds, or signing credentials",
];

function ProofRow({ p }: { p: Proof }) {
  const pill =
    p.result === "PASS"
      ? "ok"
      : p.result === "BLOCKED"
        ? "no"
        : "info";
  return (
    <div
      className="glass"
      style={{ padding: 18, marginBottom: 12, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}
    >
      <span className={`vg-badge ${pill}`} style={{ marginTop: 2, flexShrink: 0 }}>
        {p.result}
      </span>
      <div style={{ flex: "1 1 260px" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{p.claim}</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: p.tx ? 8 : 0 }}>{p.detail}</div>
        {p.tx && (
          <a
            href={`${EXPLORER}${p.tx}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: "monospace", fontSize: 12, color: "#7dd3fc", wordBreak: "break-all" }}
          >
            {p.tx} ↗
          </a>
        )}
      </div>
    </div>
  );
}

function CheckList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((it) => (
        <li key={it} style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: 14, color: "#dbe4f3" }}>
          <span style={{ color: "#4ade80", fontWeight: 800, flexShrink: 0 }}>✓</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 56 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: "#7dd3fc", marginBottom: 8 }}>{kicker}</div>
      <h2 className="vg-h2" style={{ fontSize: "clamp(22px, 3vw, 32px)", marginBottom: 16 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function ProofsPage() {
  return (
    <>
      <nav className="vg-nav">
        <div className="vg-nav-inner">
          <Link className="vg-brand" href="/"><BrandMark size={32} /> VAULTRY</Link>
          <div className="vg-nav-links">
            <Link href="/swap">Swap</Link>
            <Link href="/wallet">Wallet</Link>
            <Link href="/security">Route Guardian</Link>
          </div>
          <span className="vg-badge info" style={{ marginLeft: 8 }}>ENFORCEMENT PROOFS</span>
        </div>
      </nav>

      <div className="vg-wrap" style={{ paddingTop: 100, paddingBottom: 60, maxWidth: 860 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <span className="vg-badge info">TESTNET ONLY</span>
          <span className="vg-badge ok">ALL EVIDENCE ON-CHAIN</span>
        </div>
        <h1 className="vg-h2">Don&apos;t trust. Verify.</h1>
        <p className="vg-sub" style={{ maxWidth: 700 }}>
          VAULTRY&apos;s #1 goal is keeping your funds safe. Below is every fund-safety
          claim we make — each backed by a real transaction hash, verified contract
          code, or an enforcement proof you can reproduce. A limit that
          doesn&apos;t enforce is a broken promise. Ours do.
        </p>

        <Section id="spending-guard" kicker="01 · ON-CHAIN" title="Spending guard — live on NEAR testnet">
          <div className="glass glass-pad" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>CONTRACT</div>
            <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{CONTRACT}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>CODE HASH (verified on-chain)</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", color: "#7dd3fc", marginBottom: 12 }}>{CODE_HASH}</div>
            <div style={{ fontSize: 13.5, color: "#dbe4f3" }}>
              Cap: <b>1,000 USDC per transaction</b> · Demo run 2026-11-02 — every row below
              links to its real testnet transaction. Click any hash to inspect it on the explorer.
            </div>
          </div>
          {SPENDING_PROOFS.map((p) => (
            <ProofRow key={p.claim} p={p} />
          ))}
        </Section>

        <Section id="policy-console" kicker="02 · ENFORCEMENT" title="Policy Console — 8/8 proofs">
          <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 20, maxWidth: 700 }}>
            Your fund-protection controls, enforced by the execution layer — not merely
            explained. Verified end-to-end 2026-11-02:
          </p>
          <div className="glass glass-pad">
            <CheckList items={POLICY_PROOFS} />
          </div>
        </Section>

        <Section id="route-guardian" kicker="03 · PRE-SIGNING" title="Route Guardian — every swap scored">
          <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 20, maxWidth: 700 }}>
            VAULTRY refuses to swap blind. The deterministic guardian scores every route
            before your wallet ever sees a signing prompt:
          </p>
          <div className="glass glass-pad">
            <CheckList items={GUARDIAN_PROOFS} />
          </div>
          <div style={{ marginTop: 16 }}>
            <Link className="vg-btn vg-btn-ghost" href="/security">Try the live guardian →</Link>
          </div>
        </Section>

        <Section id="settlement" kicker="04 · SETTLEMENT" title="Real swap, real settlement">
          <div className="glass glass-pad">
            <div style={{ fontSize: 14, color: "#dbe4f3", marginBottom: 12 }}>
              End-to-end testnet swap via TidePool (NEAR Intents sandbox):{" "}
              <b>1 test USDC → ~0.2494 test wNEAR</b>, guardian-scored before signing.
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>DEPOSIT TX</div>
              <a href={`${EXPLORER}4gXiMecSKJ3DU4hmg3149pX7kFwVZnBxfDUhznvmaWNZ`} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: "monospace", fontSize: 12, color: "#7dd3fc", wordBreak: "break-all" }}>
                4gXiMecSKJ3DU4hmg3149pX7kFwVZnBxfDUhznvmaWNZ ↗
              </a>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>SETTLEMENT TX</div>
              <a href={`${EXPLORER}2cCAGm9gaXofQQ9wD27WXJnyc8rqaYyh2R4HhjYvwcvo`} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: "monospace", fontSize: 12, color: "#7dd3fc", wordBreak: "break-all" }}>
                2cCAGm9gaXofQQ9wD27WXJnyc8rqaYyh2R4HhjYvwcvo ↗
              </a>
            </div>
          </div>
        </Section>

        <Section id="verify" kicker="05 · REPRODUCE" title="Verify it yourself">
          <div className="glass glass-pad" style={{ fontSize: 14, color: "#dbe4f3", lineHeight: 1.7 }}>
            <div style={{ marginBottom: 10 }}>
              <b>1. Read the contract</b> — <span style={{ fontFamily: "monospace", fontSize: 12.5 }}>{CONTRACT}</span> on{" "}
              <a href="https://testnet.nearblocks.io/address/vaultguard.vgdeployer.testnet" target="_blank" rel="noopener noreferrer" style={{ color: "#7dd3fc" }}>
                testnet.nearblocks.io ↗
              </a>
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>2. Read the code</b> — public repo{" "}
              <a href={REPO} target="_blank" rel="noopener noreferrer" style={{ color: "#7dd3fc" }}>
                github.com/rjrajput-web3/vaultguard ↗
              </a>{" "}(contracts/vault)
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>3. Run the demo</b> — full spending-limit transcript:{" "}
              <span style={{ fontFamily: "monospace", fontSize: 12.5 }}>docs/spending-limit-demo-transcript-2026-11-02.txt</span>
            </div>
            <div>
              <b>4. Try the product</b> —{" "}
              <Link href="/swap" style={{ color: "#7dd3fc" }}>swap</Link>,{" "}
              <Link href="/policy" style={{ color: "#7dd3fc" }}>policy console</Link>,{" "}
              <Link href="/agent" style={{ color: "#7dd3fc" }}>AI agent</Link> — all testnet, all
              guardian-gated.
            </div>
          </div>
        </Section>

        <Section id="gaps" kicker="06 · HONESTY" title="What we don't claim">
          <div className="glass glass-pad" style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.7 }}>
            RHEA / LI.FI routing is <b style={{ color: "#dbe4f3" }}>not supported</b> (mainnet-only
            services; the UI says so honestly). Funded live sends need a user faucet step.
            Mobile 390px layout is unverified in our lab. We&apos;d rather show you the gaps
            than let you discover them.
          </div>
        </Section>

        <div style={{ textAlign: "center", marginTop: 40 }}>
          <Link className="vg-btn" href="/swap">Try a guardian-scored swap →</Link>
        </div>
      </div>
    </>
  );
}
