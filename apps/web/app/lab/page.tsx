"use client";

import AppShell from "../../components/AppShell";

/**
 * VAULTRY — public Live Testing Lab (workstream F).
 *
 * A guided 8-step workflow. Every success state is gated on a REAL
 * response (wallet crypto, faucet RPC confirmation, 1Click dry-run quote,
 * risk engine, detectors, on-chain view call). Nothing is fabricated.
 *
 * ISOLATION: the visitor's wallet, policy and session live in their own
 * browser localStorage only. This page never calls the contract's admin
 * functions and never sees the operator key.
 */

import { useEffect, useState } from "react";
import {
  generateWallet,
  keyPairFromSeedPhrase,
  saveKeystore,
  loadKeystoreMeta,
  unlockKeystore,
  type GeneratedWallet,
} from "../../lib/wallet/keys";
import { NEAR_NETWORKS } from "../../lib/wallet/network";
import {
  createTestnetAccount,
  waitForFunding,
  getFundingStatus,
  FaucetError,
  EXPLORER_TX_URL,
  type CreateAccountResult,
  type FundingStatus,
} from "../../lib/faucet";
import { getIntentsTokens, resolveAssetId, type IntentsToken } from "../../lib/intents/registry";
import type { IntentsQuote } from "../../lib/intents/quotes";
import { analyzeSwapPrivately, type PrivateAnalysisResult } from "../../lib/privacy/pipeline";
import { runAllDetectors, type DetectorResult } from "../../lib/security/detectors";
import {
  loadLabPolicy,
  saveLabPolicy,
  clearLabPolicy,
  loadLabSession,
  saveLabSession,
  updateLabSession,
  clearLabSession,
  decimalToBaseUnits,
  baseUnitsToDecimal,
  DEFAULT_LAB_POLICY,
  type LabPolicy,
  type LabSession,
} from "../../lib/lab/session";
import {
  CONTRACT_ID,
  EXPLORER_TX,
  DEPLOY_GUIDE,
  PHASE_D_TXS,
  getContractStatus,
  type ContractStatus,
} from "../../lib/lab/contract";

/* ------------------------------------------------------------------ */
/* small UI helpers                                                    */
/* ------------------------------------------------------------------ */

type StepStatus = "idle" | "running" | "success" | "error";

const STATUS_COLORS: Record<StepStatus, string> = {
  idle: "#5b6a84",
  running: "#7dd3fc",
  success: "#4ade80",
  error: "#f87171",
};

function StatusPill({ status }: { status: StepStatus }) {
  return (
    <span
      className="vg-badge"
      style={{ color: STATUS_COLORS[status], borderColor: STATUS_COLORS[status] }}
    >
      {status.toUpperCase()}
    </span>
  );
}

function StepCard(props: {
  n: number;
  title: string;
  doThis: string;
  expectThis: string;
  status: StepStatus;
  error: string | null;
  children: React.ReactNode;
}) {
  const { n, title, doThis, expectThis, status, error, children } = props;
  return (
    <div className="glass glass-pad" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "linear-gradient(100deg,#3b82f6,#22d3ee)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 17,
            flex: "0 0 auto",
          }}
        >
          {n}
        </span>
        <h3 style={{ margin: 0, fontSize: 20, letterSpacing: -0.3 }}>{title}</h3>
        <span style={{ marginLeft: "auto" }}>
          <StatusPill status={status} />
        </span>
      </div>
      <div className="grid-2" style={{ margin: "14px 0 18px" }}>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          <span style={{ color: "#7dd3fc", fontWeight: 700 }}>Do this → </span>
          <span style={{ color: "var(--muted)" }}>{doThis}</span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          <span style={{ color: "#4ade80", fontWeight: 700 }}>Expect this → </span>
          <span style={{ color: "var(--muted)" }}>{expectThis}</span>
        </div>
      </div>
      {children}
      {error && (
        <div className="vg-alert err" style={{ marginTop: 16, marginBottom: 0 }}>
          <b>Failed:</b> {error}
        </div>
      )}
    </div>
  );
}

function verdictStyle(decision: string): React.CSSProperties {
  const color = decision === "SAFE" ? "#4ade80" : decision === "CAUTION" ? "#f59e0b" : "#f87171";
  return {
    display: "inline-flex",
    alignItems: "center",
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: 1.5,
    padding: "7px 18px",
    borderRadius: 999,
    background: "rgba(4,7,15,0.5)",
    border: `1px solid ${color}`,
    color,
  };
}

function errMsg(e: unknown): string {
  if (e instanceof FaucetError) return `${e.name} [${e.code}]: ${e.message}${e.detail ? ` — ${e.detail.slice(0, 200)}` : ""}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

interface QuoteCtx {
  origin: IntentsToken;
  dest: IntentsToken;
  quote: IntentsQuote;
  recipient: string;
  refundTo: string;
  amountBaseUnits: string;
  slippageBps: number;
  routeLabel: string;
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

function LabPageInner() {
  const [mounted, setMounted] = useState(false);
  const [policy, setPolicy] = useState<LabPolicy>({ ...DEFAULT_LAB_POLICY });
  const [policyDraft, setPolicyDraft] = useState<LabPolicy>({ ...DEFAULT_LAB_POLICY });
  const [session, setSession] = useState<LabSession | null>(null);
  const [stepState, setStepState] = useState<Record<number, { status: StepStatus; error: string | null }>>({});
  const [liveTokens, setLiveTokens] = useState<IntentsToken[] | null>(null);
  const [quoteCtx, setQuoteCtx] = useState<QuoteCtx | null>(null);

  /* step 1 */
  const [walletMode, setWalletMode] = useState<"create" | "import" | "unlock">("create");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [savedWalletMeta, setSavedWalletMeta] = useState<{ accountId: string; createdAt: string } | null>(null);
  const [generated, setGenerated] = useState<GeneratedWallet | null>(null);

  /* step 2 */
  const [faucetResult, setFaucetResult] = useState<CreateAccountResult | null>(null);
  const [funded, setFunded] = useState<FundingStatus | null>(null);
  const [balanceCheckId, setBalanceCheckId] = useState("");
  const [balanceCheck, setBalanceCheck] = useState<FundingStatus | null>(null);

  /* step 3 */
  const [amount, setAmount] = useState("10");
  const [slippageBps, setSlippageBps] = useState("50");
  const [recipient, setRecipient] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [nearOutageMsg, setNearOutageMsg] = useState<string | null>(null);

  /* step 4 */
  const [riskResult, setRiskResult] = useState<PrivateAnalysisResult | null>(null);

  /* step 5 */
  const [detectorResults, setDetectorResults] = useState<DetectorResult[] | null>(null);

  /* step 7 */
  const [contractStatus, setContractStatus] = useState<ContractStatus | null>(null);

  useEffect(() => {
    setMounted(true);
    setPolicy(loadLabPolicy());
    setPolicyDraft(loadLabPolicy());
    setSession(loadLabSession());
    setAccountName(`vglab-${Math.floor(100000 + Math.random() * 900000)}.testnet`);
    try {
      const meta = loadKeystoreMeta(NEAR_NETWORKS.testnet.keystoreKey);
      if (meta.ok) setSavedWalletMeta({ accountId: meta.keystore.accountId, createdAt: meta.keystore.createdAt });
    } catch {
      /* no saved wallet — fine */
    }
  }, []);

  function setStep(n: number, status: StepStatus, error: string | null = null) {
    setStepState((prev) => ({ ...prev, [n]: { status, error } }));
  }
  function st(n: number): { status: StepStatus; error: string | null } {
    return stepState[n] ?? { status: "idle", error: null };
  }
  function persist(s: LabSession) {
    saveLabSession(s);
    setSession(s);
  }

  /* ---------------- step 1 ---------------- */

  async function runCreateWallet() {
    setStep(1, "running");
    setGenerated(null);
    try {
      const accountId = accountName.trim().toLowerCase();
      if (!accountId.endsWith(".testnet")) throw new Error('Account ID must end with ".testnet"');
      if (!password || password.length < 8) throw new Error("Choose a password of at least 8 characters");
      const w = generateWallet();
      const saved = await saveKeystore(accountId, w.publicKey, w.secretKey, password, NEAR_NETWORKS.testnet.keystoreKey);
      if (!saved.ok) throw new Error(saved.error);
      persist(updateLabSession({ accountId, publicKey: w.publicKey }));
      setSavedWalletMeta({ accountId, createdAt: new Date().toISOString() });
      setGenerated(w);
      setStep(1, "success");
    } catch (e) {
      setStep(1, "error", errMsg(e));
    }
  }

  async function runImportWallet() {
    setStep(1, "running");
    try {
      const accountId = accountName.trim().toLowerCase();
      if (!accountId.endsWith(".testnet")) throw new Error('Account ID must end with ".testnet"');
      if (!password || password.length < 8) throw new Error("Choose a password of at least 8 characters");
      const kp = keyPairFromSeedPhrase(seedInput);
      const secretKey = kp.toString();
      const publicKey = kp.getPublicKey().toString();
      const saved = await saveKeystore(accountId, publicKey, secretKey, password, NEAR_NETWORKS.testnet.keystoreKey);
      if (!saved.ok) throw new Error(saved.error);
      persist(updateLabSession({ accountId, publicKey }));
      setSavedWalletMeta({ accountId, createdAt: new Date().toISOString() });
      setStep(1, "success");
    } catch (e) {
      setStep(1, "error", errMsg(e));
    }
  }

  async function runUnlockWallet() {
    setStep(1, "running");
    try {
      const res = await unlockKeystore(password, NEAR_NETWORKS.testnet.keystoreKey);
      if (!res.ok) throw new Error(res.error);
      const meta = loadKeystoreMeta(NEAR_NETWORKS.testnet.keystoreKey);
      if (!meta.ok) throw new Error(meta.error);
      persist(updateLabSession({ accountId: meta.keystore.accountId, publicKey: meta.keystore.publicKey }));
      setStep(1, "success");
    } catch (e) {
      setStep(1, "error", errMsg(e));
    }
  }

  /* ---------------- step 2 ---------------- */

  async function runFaucet() {
    setStep(2, "running");
    setFaucetResult(null);
    setFunded(null);
    try {
      if (!session?.accountId || !session?.publicKey) {
        throw new Error("Complete Step 1 first — no lab wallet is connected.");
      }
      const created = await createTestnetAccount({ accountId: session.accountId, publicKey: session.publicKey });
      setFaucetResult(created);
      // Show "funded" only after RPC confirms the account exists.
      const status = await waitForFunding(session.accountId, { timeoutMs: 180_000, intervalMs: 5_000 });
      setFunded(status);
      persist(updateLabSession({ faucetTxHash: created.txHash, faucetAt: new Date().toISOString(), fundedBalanceNear: status.balanceNear }));
      setStep(2, "success");
    } catch (e) {
      setStep(2, "error", errMsg(e));
    }
  }

  async function runBalanceCheck() {
    setStep(2, "running");
    setBalanceCheck(null);
    try {
      const status = await getFundingStatus(balanceCheckId.trim().toLowerCase());
      setBalanceCheck(status);
      setStep(2, "success");
    } catch (e) {
      setStep(2, "error", errMsg(e));
    }
  }

  /* ---------------- step 3 ---------------- */

  async function runQuoteRoute(fromChain: string, toChain: string): Promise<QuoteCtx> {
    const tokens = await getIntentsTokens();
    setLiveTokens(tokens);
    const origin = await resolveAssetId("USDC", fromChain);
    const dest = await resolveAssetId("USDC", toChain);
    const bps = parseInt(slippageBps, 10);
    if (!Number.isFinite(bps) || bps < 0 || bps > 5000) throw new Error("Slippage must be 0–5000 bps");
    if (!recipient.trim()) throw new Error(`Enter a destination-chain address (recipient on ${toChain})`);
    if (!refundTo.trim()) throw new Error(`Enter an origin-chain address (refundTo on ${fromChain})`);
    const amountBaseUnits = decimalToBaseUnits(amount, origin.decimals);
    const res = await fetch("/api/intents/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originAssetId: origin.assetId,
        destinationAssetId: dest.assetId,
        amountBaseUnits,
        slippageBps: bps,
        recipient: recipient.trim(),
        refundTo: refundTo.trim(),
      }),
    });
    const data = (await res.json()) as { ok: boolean; quote?: IntentsQuote; code?: string; message?: string };
    if (!data.ok || !data.quote) {
      throw new Error(`${data.code ?? "QUOTE_FAILED"}: ${data.message ?? "quote failed"}`);
    }
    return {
      origin,
      dest,
      quote: data.quote,
      recipient: recipient.trim(),
      refundTo: refundTo.trim(),
      amountBaseUnits,
      slippageBps: bps,
      routeLabel: `Base USDC → ${toChain === "sol" ? "Solana" : "NEAR"} USDC`,
    };
  }

  async function runQuote() {
    setStep(3, "running");
    try {
      const ctx = await runQuoteRoute("base", "sol");
      setQuoteCtx(ctx);
      const s = updateLabSession({
        quotes: [
          ...loadLabSessionSafe().quotes,
          {
            route: ctx.routeLabel,
            amountIn: ctx.quote.amountIn,
            amountOut: ctx.quote.amountOut,
            minAmountOut: ctx.quote.minAmountOut,
            amountOutUsd: ctx.quote.amountOutUsd,
            timeEstimateMs: ctx.quote.timeEstimateMs,
            at: new Date().toISOString(),
          },
        ],
      });
      persist(s);
      setStep(3, "success");
    } catch (e) {
      setStep(3, "error", errMsg(e));
    }
  }

  /** NEAR legs are in a known solver-side outage — show the failure honestly. */
  async function runNearOutageDemo() {
    setStep(3, "running");
    setNearOutageMsg(null);
    try {
      await runQuoteRoute("base", "near");
      // If the outage is fixed, say so honestly instead of showing a stale warning.
      setNearOutageMsg(
        "The NEAR-leg quote SUCCEEDED this time — the solver outage observed on 2026-11-02 appears to be fixed.",
      );
      setStep(3, "success");
    } catch (e) {
      setNearOutageMsg(
        "Honest failure — exactly what the lab expects here. " +
          "NEAR-chain legs (origin OR destination) fail server-side on the 1Click quote endpoint: " +
          `“${errMsg(e)}”. ` +
          "This is a solver-side outage (verified live 2026-11-02, see lib/intents/QUOTE_STATUS.md), not a bug in this page. " +
          "No quote was fabricated — the error above is the API's own message.",
      );
      setStep(3, "success");
    }
  }

  /* ---------------- step 4 ---------------- */

  async function runRiskScan() {
    setStep(4, "running");
    setRiskResult(null);
    try {
      if (!quoteCtx) throw new Error("Run Step 3 first — the scanner needs a real live quote.");
      const result = await analyzeSwapPrivately({
        userAddress: session?.accountId ?? undefined,
        recipient: quoteCtx.recipient,
        refundTo: quoteCtx.refundTo,
        originAssetId: quoteCtx.origin.assetId,
        destinationAssetId: quoteCtx.dest.assetId,
        amountBaseUnits: quoteCtx.amountBaseUnits,
        slippageBps: quoteCtx.slippageBps,
        routerId: "1click",
        quote: quoteCtx.quote,
        originToken: quoteCtx.origin,
        destinationToken: quoteCtx.dest,
        policy: { maxSpendPerTxUsd: policy.maxSpendPerTxUsd, maxSlippagePct: policy.maxSlippagePct },
      });
      setRiskResult(result);
      if (result.verdict) {
        const s = updateLabSession({
          riskVerdicts: [
            ...loadLabSessionSafe().riskVerdicts,
            { route: quoteCtx.routeLabel, decision: result.verdict.decision, score: result.verdict.score, at: new Date().toISOString() },
          ],
        });
        persist(s);
      }
      setStep(4, "success");
    } catch (e) {
      setStep(4, "error", errMsg(e));
    }
  }

  /* ---------------- step 5 ---------------- */

  async function runDetectors() {
    setStep(5, "running");
    setDetectorResults(null);
    try {
      if (!quoteCtx) throw new Error("Run Step 3 first — the detectors need a real live quote.");
      const registry = liveTokens ?? (await getIntentsTokens());
      if (!liveTokens) setLiveTokens(registry);
      const results = runAllDetectors({
        quote: quoteCtx.quote,
        originToken: quoteCtx.origin,
        destinationToken: quoteCtx.dest,
        routerId: "1click",
        policy: { allowedRouters: policy.allowedRouters },
        registry,
        sessionQuoteHistory: ["1click"],
        counterparty: quoteCtx.recipient,
      });
      setDetectorResults(results);
      const counts = {
        pass: results.filter((r) => r.verdict === "pass").length,
        warn: results.filter((r) => r.verdict === "warn").length,
        fail: results.filter((r) => r.verdict === "fail").length,
      };
      const s = updateLabSession({
        detectorScans: [...loadLabSessionSafe().detectorScans, { ...counts, at: new Date().toISOString() }],
      });
      persist(s);
      setStep(5, "success");
    } catch (e) {
      setStep(5, "error", errMsg(e));
    }
  }

  /* ---------------- step 6 ---------------- */

  function savePolicy() {
    const next: LabPolicy = {
      maxSpendPerTxUsd: Number(policyDraft.maxSpendPerTxUsd) || 0,
      maxSlippagePct: Number(policyDraft.maxSlippagePct) || 0,
      allowedRouters: policyDraft.allowedRouters.map((r) => r.trim()).filter(Boolean),
    };
    if (next.maxSpendPerTxUsd <= 0) {
      setStep(6, "error", "Max spend per tx must be a positive number.");
      return;
    }
    saveLabPolicy(next);
    setPolicy(next);
    setStep(6, "success");
  }

  /* ---------------- step 7 ---------------- */

  async function runContractView() {
    setStep(7, "running");
    setContractStatus(null);
    try {
      const status = await getContractStatus();
      setContractStatus(status);
      setStep(7, "success");
    } catch (e) {
      setStep(7, "error", errMsg(e));
    }
  }

  /* ---------------- step 8 ---------------- */

  function startOver() {
    clearLabSession();
    clearLabPolicy();
    setSession({ ...loadLabSession() });
    setPolicy({ ...DEFAULT_LAB_POLICY });
    setPolicyDraft({ ...DEFAULT_LAB_POLICY });
    setStepState({});
    setFaucetResult(null);
    setFunded(null);
    setBalanceCheck(null);
    setQuoteCtx(null);
    setRiskResult(null);
    setDetectorResults(null);
    setContractStatus(null);
    setGenerated(null);
    setNearOutageMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!mounted || !session) {
    return (
      <main className="vg-section">
        <div className="vg-wrap">
          <p style={{ color: "var(--muted)" }}>Loading your isolated lab session…</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="vg-nav">
        <div className="vg-nav-inner">
          <a className="vg-brand" href="/">
            VAULTRY
          </a>
          <nav className="vg-nav-links">
            <a href="/">Home</a>
            <a href="/wallet">Wallet</a>
            <a href="/swap">Swap</a>
            <a href="/security">Security</a>
            <a href="/privacy">Privacy</a>
            <a href="/lab">Live Testing Lab</a>
          </nav>
        </div>
      </div>

      <section className="vg-section" style={{ paddingTop: 120 }}>
        <div className="vg-wrap">
          <span className="vg-eyebrow">Live Testing Lab</span>
          <h1 className="vg-h2">
            Try VAULTRY <span className="grad-text">for real</span>
          </h1>
          <p className="vg-sub">
            Eight guided steps on NEAR testnet with live quotes, real risk scans and the real
            on-chain contract. Every result below comes from a real response — nothing is
            fabricated. Run them in order.
          </p>

          <div className="vg-banner">
            <b>Session isolation:</b> your wallet, policy and progress live in <b>your browser
            only</b> (localStorage). You cannot change other visitors&apos; settings or the
            shared contract — the operator key is never on this page, and the admin functions
            are shown only as historical on-chain records.
          </div>

          {/* ============ STEP 1 ============ */}
          <StepCard
            n={1}
            title="Connect or create a testnet wallet"
            doThis="Create a fresh wallet (encrypted on this device), import a seed phrase, or unlock an existing saved wallet."
            expectThis="An account ID is shown. Keys are generated and encrypted client-side only — they never leave this browser."
            status={st(1).status}
            error={st(1).error}
          >
            <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
              {(["create", "import", "unlock"] as const).map((m) => (
                <span
                  key={m}
                  className={`vg-chip${walletMode === m ? " on" : ""}`}
                  onClick={() => setWalletMode(m)}
                >
                  {m === "create" ? "Create new" : m === "import" ? "Import seed phrase" : "Unlock saved"}
                </span>
              ))}
            </div>

            {walletMode === "create" && (
              <>
                <div className="vg-field">
                  <label className="vg-label">Account ID (funded on testnet in Step 2)</label>
                  <input className="vg-input" value={accountName} onChange={(e) => setAccountName(e.target.value)} spellCheck={false} />
                </div>
                <div className="vg-field">
                  <label className="vg-label">Password (encrypts the key on this device, min 8 chars)</label>
                  <input className="vg-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <button className="vg-btn" onClick={runCreateWallet} disabled={st(1).status === "running"}>
                  {st(1).status === "running" ? "Generating…" : "Generate & encrypt wallet"}
                </button>
                {generated && (
                  <div className="vg-alert err" style={{ marginTop: 16 }}>
                    <b>Write this recovery phrase down NOW — it is shown once.</b>
                    <div className="vg-trail" style={{ color: "#fecaca", marginTop: 8, fontSize: 15 }}>
                      {generated.seedPhrase}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      Public key: <span className="vg-trail" style={{ color: "#fecaca" }}>{generated.publicKey}</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {walletMode === "import" && (
              <>
                <div className="vg-field">
                  <label className="vg-label">Account ID</label>
                  <input className="vg-input" value={accountName} onChange={(e) => setAccountName(e.target.value)} spellCheck={false} />
                </div>
                <div className="vg-field">
                  <label className="vg-label">12-word recovery phrase</label>
                  <textarea className="vg-textarea" value={seedInput} onChange={(e) => setSeedInput(e.target.value)} />
                </div>
                <div className="vg-field">
                  <label className="vg-label">Password (encrypts the key on this device, min 8 chars)</label>
                  <input className="vg-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <button className="vg-btn" onClick={runImportWallet} disabled={st(1).status === "running"}>
                  {st(1).status === "running" ? "Importing…" : "Import & encrypt wallet"}
                </button>
              </>
            )}

            {walletMode === "unlock" && (
              <>
                {savedWalletMeta ? (
                  <>
                    <p style={{ color: "var(--muted)", fontSize: 14 }}>
                      Saved on this device: <b className="vg-trail" style={{ color: "var(--text)" }}>{savedWalletMeta.accountId}</b>
                    </p>
                    <div className="vg-field">
                      <label className="vg-label">Password</label>
                      <input className="vg-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    </div>
                    <button className="vg-btn" onClick={runUnlockWallet} disabled={st(1).status === "running"}>
                      {st(1).status === "running" ? "Unlocking…" : "Unlock wallet"}
                    </button>
                  </>
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: 14 }}>No wallet saved on this device yet — use Create or Import.</p>
                )}
              </>
            )}

            {session.accountId && st(1).status === "success" && (
              <div className="vg-alert ok" style={{ marginTop: 16, marginBottom: 0 }}>
                Wallet ready — address: <b className="vg-trail">{session.accountId}</b>
                {generated ? " (keypair created + encrypted just now)" : " (encrypted key unlocked)"}
              </div>
            )}
          </StepCard>

          {/* ============ STEP 2 ============ */}
          <StepCard
            n={2}
            title="Fund via the faucet"
            doThis="One click creates your testnet account with 10 NEAR through the official helper faucet, then polls real RPC until the balance confirms."
            expectThis="“10 NEAR received” appears ONLY after the RPC confirms the account. The faucet transaction hash links to the explorer."
            status={st(2).status}
            error={st(2).error}
          >
            <button className="vg-btn" onClick={runFaucet} disabled={st(2).status === "running" || !session.accountId}>
              {st(2).status === "running" ? "Funding — waiting for RPC confirmation…" : "Create & fund via faucet"}
            </button>
            {!session.accountId && (
              <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 10 }}>Complete Step 1 first.</p>
            )}
            {faucetResult && (
              <div style={{ marginTop: 16, fontSize: 14, lineHeight: 1.8 }}>
                <div>
                  Faucet tx:{" "}
                  <a className="vg-trail" style={{ color: "var(--cyan)" }} href={EXPLORER_TX_URL(faucetResult.txHash)} target="_blank" rel="noreferrer">
                    {faucetResult.txHash}
                  </a>
                </div>
              </div>
            )}
            {funded?.exists && (
              <div className="vg-alert ok" style={{ marginTop: 16, marginBottom: 0 }}>
                <b>10 NEAR received</b> — confirmed by testnet RPC for <span className="vg-trail">{funded.accountId}</span>
                {" "}(balance: {funded.balanceNear} NEAR).
              </div>
            )}
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid rgba(125,211,252,0.1)" }}>
              <label className="vg-label">…or check any existing testnet account&apos;s real balance</label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  className="vg-input"
                  style={{ maxWidth: 340 }}
                  placeholder="alice.testnet"
                  value={balanceCheckId}
                  onChange={(e) => setBalanceCheckId(e.target.value)}
                  spellCheck={false}
                />
                <button className="vg-btn vg-btn-ghost" onClick={runBalanceCheck} disabled={st(2).status === "running"}>
                  Check balance
                </button>
              </div>
              {balanceCheck && (
                <p style={{ fontSize: 14, marginTop: 10, color: "var(--muted)" }}>
                  {balanceCheck.exists
                    ? <>Account <span className="vg-trail">{balanceCheck.accountId}</span> exists — balance <b>{balanceCheck.balanceNear} NEAR</b> (read from RPC just now).</>
                    : <>Account <span className="vg-trail">{balanceCheck.accountId}</span> does not exist on testnet.</>}
                </p>
              )}
            </div>
          </StepCard>

          {/* ============ STEP 3 ============ */}
          <StepCard
            n={3}
            title="Fetch a real quote"
            doThis="Dry-run a Base USDC → Solana USDC quote through the 1Click Intents API (dry-run: no funds can move, no deposit address created)."
            expectThis="The API's real answer: amountOut, minAmountOut and solver time estimate — or the solver's own failure message when it is offline (e.g. the known NEAR-leg outage). Nothing is ever fabricated."
            status={st(3).status}
            error={st(3).error}
          >
            <div className="grid-2">
              <div className="vg-field">
                <label className="vg-label">Amount (USDC)</label>
                <input className="vg-input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </div>
              <div className="vg-field">
                <label className="vg-label">Slippage tolerance (bps)</label>
                <input className="vg-input" value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="grid-2">
              <div className="vg-field">
                <label className="vg-label">Recipient — your Solana address (dry-run, required by the API)</label>
                <input className="vg-input" value={recipient} onChange={(e) => setRecipient(e.target.value)} spellCheck={false} />
              </div>
              <div className="vg-field">
                <label className="vg-label">RefundTo — your EVM (Base) address (dry-run, required by the API)</label>
                <input className="vg-input" value={refundTo} onChange={(e) => setRefundTo(e.target.value)} spellCheck={false} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className="vg-btn" onClick={runQuote} disabled={st(3).status === "running"}>
                {st(3).status === "running" ? "Quoting…" : "Get Base → Solana quote"}
              </button>
              <button className="vg-btn vg-btn-ghost" onClick={runNearOutageDemo} disabled={st(3).status === "running"}>
                Try a NEAR leg (outage demo)
              </button>
            </div>
            {nearOutageMsg && (
              <div className="vg-banner" style={{ marginTop: 16, marginBottom: 0 }}>
                {nearOutageMsg}
              </div>
            )}
            {quoteCtx && st(3).status === "success" && !nearOutageMsg && (
              <dl className="vg-kv" style={{ marginTop: 18 }}>
                <div><dt>Route</dt><dd style={{ fontSize: 14 }}>{quoteCtx.routeLabel}</dd></div>
                <div><dt>Amount in</dt><dd>{baseUnitsToDecimal(quoteCtx.quote.amountIn, quoteCtx.origin.decimals)} USDC</dd></div>
                <div><dt>Amount out</dt><dd>{baseUnitsToDecimal(quoteCtx.quote.amountOut, quoteCtx.dest.decimals)} USDC</dd></div>
                <div><dt>Min amount out</dt><dd>{baseUnitsToDecimal(quoteCtx.quote.minAmountOut, quoteCtx.dest.decimals)} USDC</dd></div>
                {quoteCtx.quote.amountOutUsd && (
                  <div><dt>Amount out (USD)</dt><dd>${quoteCtx.quote.amountOutUsd}</dd></div>
                )}
                <div><dt>Solver time estimate</dt><dd>{(quoteCtx.quote.timeEstimateMs / 1000).toFixed(0)}s</dd></div>
              </dl>
            )}
          </StepCard>

          {/* ============ STEP 4 ============ */}
          <StepCard
            n={4}
            title="Run the risk scanner"
            doThis="Feed the live quote through the private analysis pipeline — identifiers are SHA-256 hashed on-device, secrets dropped, zero network calls."
            expectThis="A real SAFE / CAUTION / BLOCKED verdict with a per-check breakdown computed from the quote numbers — plus the privacy audit trail."
            status={st(4).status}
            error={st(4).error}
          >
            <button className="vg-btn" onClick={runRiskScan} disabled={st(4).status === "running" || !quoteCtx}>
              {st(4).status === "running" ? "Scanning…" : "Scan this quote"}
            </button>
            {!quoteCtx && (
              <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 10 }}>Run Step 3 first — the scanner needs a real quote.</p>
            )}
            {riskResult?.verdict && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
                  <span style={verdictStyle(riskResult.verdict.decision)}>{riskResult.verdict.decision}</span>
                  <span style={{ color: "var(--muted)", fontSize: 14 }}>score {riskResult.verdict.score}/100 · evaluated {riskResult.verdict.evaluatedAt}</span>
                </div>
                {riskResult.verdict.checks.map((c) => (
                  <div key={c.id} className="glass" style={{ padding: "12px 16px", marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span
                        className="vg-badge"
                        style={{
                          color: c.status === "pass" ? "#4ade80" : c.status === "warn" ? "#f59e0b" : c.status === "fail" ? "#f87171" : "#93a0b8",
                          borderColor: "currentColor",
                        }}
                      >
                        {c.status.toUpperCase()}
                      </span>
                      <b style={{ fontSize: 14 }}>{c.label}</b>
                      {c.value && <span className="vg-trail" style={{ marginLeft: "auto" }}>{c.value}</span>}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>{c.detail}</div>
                  </div>
                ))}
                <p style={{ color: "var(--dim)", fontSize: 13, marginTop: 14 }}>{riskResult.privacyNote}</p>
                <details style={{ fontSize: 13, marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", color: "var(--cyan)" }}>
                    Privacy audit trail ({riskResult.auditTrail.length} entries)
                  </summary>
                  <div className="vg-trail" style={{ marginTop: 10 }}>
                    {riskResult.auditTrail.map((a, i) => (
                      <div key={i} className={a.action === "hashed" ? "t-ok" : a.action === "dropped" ? "t-warn" : "t-dim"}>
                        [{a.action}] {a.field} — {a.reason}
                        {a.evidence && <div style={{ opacity: 0.7 }}>{a.evidence.slice(0, 80)}…</div>}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </StepCard>

          {/* ============ STEP 5 ============ */}
          <StepCard
            n={5}
            title="Run the security detectors"
            doThis="Run the full detector suite on the same live quote: router allowlist, abnormal slippage, liquidity risk, registry verification, route outage, address lists."
            expectThis="One verdict per detector (pass / warn / fail), each citing the exact numbers it used. Unknown data warns — it never passes."
            status={st(5).status}
            error={st(5).error}
          >
            <button className="vg-btn" onClick={runDetectors} disabled={st(5).status === "running" || !quoteCtx}>
              {st(5).status === "running" ? "Detecting…" : "Run all detectors"}
            </button>
            {!quoteCtx && (
              <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 10 }}>Run Step 3 first — the detectors need a real quote.</p>
            )}
            {detectorResults && (
              <div style={{ marginTop: 18 }}>
                {detectorResults.map((d) => (
                  <div key={d.id} className="glass" style={{ padding: "12px 16px", marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span
                        className="vg-badge"
                        style={{
                          color: d.verdict === "pass" ? "#4ade80" : d.verdict === "warn" ? "#f59e0b" : "#f87171",
                          borderColor: "currentColor",
                        }}
                      >
                        {d.verdict.toUpperCase()}
                      </span>
                      <b style={{ fontSize: 14 }}>{d.label}</b>
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>{d.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </StepCard>

          {/* ============ STEP 6 ============ */}
          <StepCard
            n={6}
            title="Your policy, your rules"
            doThis="Edit YOUR session policy — max spend per transaction, slippage ceiling, allowed routers. Saved to this browser only."
            expectThis="The new policy applies to the next risk scan and detector run in this session. Nothing on the shared on-chain contract changes."
            status={st(6).status}
            error={st(6).error}
          >
            <div className="grid-2">
              <div className="vg-field">
                <label className="vg-label">Max spend per tx (USD)</label>
                <input
                  className="vg-input"
                  type="number"
                  min={1}
                  value={policyDraft.maxSpendPerTxUsd}
                  onChange={(e) => setPolicyDraft({ ...policyDraft, maxSpendPerTxUsd: Number(e.target.value) })}
                />
              </div>
              <div className="vg-field">
                <label className="vg-label">Max slippage (%)</label>
                <input
                  className="vg-input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={policyDraft.maxSlippagePct}
                  onChange={(e) => setPolicyDraft({ ...policyDraft, maxSlippagePct: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="vg-field">
              <label className="vg-label">Allowed routers (comma-separated)</label>
              <input
                className="vg-input"
                value={policyDraft.allowedRouters.join(", ")}
                onChange={(e) => setPolicyDraft({ ...policyDraft, allowedRouters: e.target.value.split(",") })}
                spellCheck={false}
              />
            </div>
            <button className="vg-btn" onClick={savePolicy}>
              Save session policy
            </button>
            {st(6).status === "success" && (
              <div className="vg-alert ok" style={{ marginTop: 16, marginBottom: 0 }}>
                Saved to localStorage key <span className="vg-trail">vg_lab_policy</span> — max ${policy.maxSpendPerTxUsd.toLocaleString()}/tx, {policy.maxSlippagePct}% slippage, routers [{policy.allowedRouters.join(", ")}].
                This affects <b>only your session&apos;s</b> evaluations; the shared contract is untouched.
              </div>
            )}
          </StepCard>

          {/* ============ STEP 7 ============ */}
          <StepCard
            n={7}
            title="Contract enforcement — real history"
            doThis="Read the shared contract's LIVE status (view call, no key needed), then study the real Phase-D enforcement transactions on the explorer."
            expectThis="Live paused flag + spend cap from testnet RPC now, plus 6 honestly-labeled historical operator transactions. Admin methods are never called from this page."
            status={st(7).status}
            error={st(7).error}
          >
            <button className="vg-btn" onClick={runContractView} disabled={st(7).status === "running"}>
              {st(7).status === "running" ? "Reading contract…" : "Read live contract status"}
            </button>
            {contractStatus && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                  <span className="vg-badge info">LIVE VIEW — read just now from testnet RPC</span>
                  <span className="vg-badge">{CONTRACT_ID}</span>
                </div>
                <dl className="vg-kv">
                  <div><dt>Paused</dt><dd>{contractStatus.paused ? "YES" : "no"}</dd></div>
                  <div><dt>Max spend per tx</dt><dd style={{ fontSize: 13 }}>{contractStatus.max_spend_per_tx}</dd></div>
                  <div><dt>Guardian</dt><dd style={{ fontSize: 13 }}>{contractStatus.guardian}</dd></div>
                  <div><dt>Allowed assets</dt><dd style={{ fontSize: 13 }}>{contractStatus.allowed_assets.join(", ") || "—"}</dd></div>
                </dl>
              </div>
            )}
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                <h4 style={{ margin: 0 }}>Phase-D enforcement — historical transactions</h4>
                <span className="vg-badge" style={{ color: "#f59e0b", borderColor: "#f59e0b" }}>
                  HISTORICAL OPERATOR DEMO — not replayed by this page
                </span>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
                These calls used the operator key during the Phase-D demo. This page <b>cannot</b> and{" "}
                <b>does not</b> re-send them. To run the same calls yourself, deploy your own contract
                with <span className="vg-trail">{DEPLOY_GUIDE}</span> and use your own key.
              </p>
              <div className="grid-2">
                {PHASE_D_TXS.map((tx, i) => (
                  <div key={tx.hash} className="glass vg-tx" style={{ marginBottom: 0 }}>
                    <span className="vg-tx-num">TX {i + 1}</span>
                    <h4>{tx.title}</h4>
                    <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 8px" }}>{tx.note}</p>
                    <div className="hash">{tx.hash}</div>
                    <a className="exp" href={EXPLORER_TX(tx.hash)} target="_blank" rel="noreferrer">
                      View on explorer ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </StepCard>

          {/* ============ STEP 8 ============ */}
          <StepCard
            n={8}
            title="Review your session"
            doThis="Look over everything this session produced — wallet, funding tx, quotes, verdicts — then start over whenever you like."
            expectThis="A summary built ONLY from records your session actually created. “Start over” clears the session and policy (not your encrypted wallet)."
            status={st(8).status}
            error={st(8).error}
          >
            <dl className="vg-kv" style={{ marginBottom: 18 }}>
              <div><dt>Wallet</dt><dd style={{ fontSize: 13 }}>{session.accountId ?? "—"}</dd></div>
              <div><dt>Faucet tx</dt><dd style={{ fontSize: 12 }}>{session.faucetTxHash ?? "—"}</dd></div>
              <div><dt>Funded balance</dt><dd>{session.fundedBalanceNear ? `${session.fundedBalanceNear} NEAR` : "—"}</dd></div>
            </dl>
            {[
              { label: "Quotes fetched", rows: session.quotes.map((q) => `${q.route} → out ${q.amountOut} (min ${q.minAmountOut}) · ${new Date(q.at).toLocaleString()}`) },
              { label: "Risk verdicts", rows: session.riskVerdicts.map((v) => `${v.route}: ${v.decision} (score ${v.score}) · ${new Date(v.at).toLocaleString()}`) },
              { label: "Detector scans", rows: session.detectorScans.map((d) => `pass ${d.pass} / warn ${d.warn} / fail ${d.fail} · ${new Date(d.at).toLocaleString()}`) },
            ].map((block) => (
              <div key={block.label} style={{ marginBottom: 14 }}>
                <span className="vg-label">{block.label} ({block.rows.length})</span>
                {block.rows.length === 0 ? (
                  <p style={{ color: "var(--dim)", fontSize: 13, margin: "6px 0" }}>None yet — run the step above.</p>
                ) : (
                  <div className="vg-trail" style={{ fontSize: 12.5 }}>
                    {block.rows.map((r, i) => (
                      <div key={i}>• {r}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <button className="vg-btn vg-btn-ghost" onClick={() => { startOver(); setStep(8, "success"); }}>
                Start over (clear session)
              </button>
            </div>
          </StepCard>

          <footer className="vg-footer" style={{ marginTop: 56 }}>
            <div className="vg-footer-bottom">
              <span>VAULTRY Live Testing Lab — everything on this page is computed from real responses.</span>
              <span>Your session is isolated in your browser. The operator key is never here.</span>
            </div>
          </footer>
        </div>
      </section>
    </main>
  );
}

/** Load session without throwing — for use inside async handlers after mount. */
function loadLabSessionSafe() {
  try {
    return loadLabSession();
  } catch {
    return {
      accountId: null,
      publicKey: null,
      faucetTxHash: null,
      faucetAt: null,
      fundedBalanceNear: null,
      quotes: [],
      riskVerdicts: [],
      detectorScans: [],
    };
  }
}

export default function LabPage() {
  return (
    <AppShell>
      <LabPageInner />
    </AppShell>
  );
}
