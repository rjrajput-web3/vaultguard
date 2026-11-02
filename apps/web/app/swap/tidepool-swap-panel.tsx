"use client";

/**
 * TidePoolSwapPanel — executable TESTNET cross-chain swap (2026-11-02).
 *
 * The fund-safety flow, enforced in order — VAULTRY refuses to swap blind:
 *   1. Live quote (real numbers from /api/tidepool/quote, dry-run)
 *   2. Route Guardian scan (checkTestnetSwap — SAFE/CAUTION/BLOCKED)
 *   3. Policy gate (emergency pause + spending caps, device-local)
 *   4. Keystore unlock (password, client-side only) + ft_transfer deposit
 *   5. Settlement polling → both tx hashes + explorer links
 *
 * BLOCKED verdicts cannot be overridden. CAUTION needs an explicit
 * per-quote checkbox. Nothing is signed before the guardian passes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkTestnetSwap,
  isValidTestnetAccount,
  type GuardianResult,
  type TestnetQuote,
  type TestnetSwapIntent,
} from "../../lib/guardian/testnet-guardian";
import { loadUserPolicy } from "../../lib/policy/user-policy";
import { getTodaySpendUsd, recordSpendUsd } from "../../lib/policy/spend-tracker";
import { NEAR_TESTNET } from "../../lib/wallet/network";
import { unlockKeystore, loadKeystoreMeta } from "../../lib/wallet/keys";
import { createConnection, getSignerAccount } from "../../lib/wallet/near";
import { transferToken } from "../../lib/wallet/token-transfer";

const TOKENS = [
  { key: "usdc", label: "test USDC", contract: "usdc.tidepool-sandbox.testnet", decimals: 6 },
  { key: "usdt", label: "test USDT", contract: "usdt.tidepool-sandbox.testnet", decimals: 6 },
  { key: "wnear", label: "test wNEAR", contract: "wnear.tidepool-sandbox.testnet", decimals: 24 },
  { key: "wbtc", label: "test wBTC", contract: "wbtc.tidepool-sandbox.testnet", decimals: 8 },
  { key: "eth", label: "test ETH", contract: "eth.tidepool-sandbox.testnet", decimals: 18 },
] as const;

type Phase =
  | "inputs"
  | "quoting"
  | "quoted" // guardian scanning
  | "approved" // guardian passed, ready to execute
  | "executing" // deposit intent created
  | "signing" // keystore unlock + deposit broadcast
  | "settling" // polling for settlement
  | "done"
  | "failed";

interface QuoteData {
  amountIn: string;
  amountInBaseUnits: string;
  amountOut: string;
  amountOutBaseUnits: string;
  minAmountOutBaseUnits?: string;
  amountOutUsd?: string;
  timeEstimateSec?: number;
  receivedAtMs: number;
}

const card: React.CSSProperties = {
  background: "rgba(13,10,28,0.72)",
  border: "1px solid rgba(168,85,247,0.22)",
  borderRadius: 16,
  padding: 22,
};
const input: React.CSSProperties = {
  width: "100%",
  background: "rgba(4,7,15,0.7)",
  border: "1px solid rgba(168,85,247,0.25)",
  borderRadius: 10,
  color: "var(--text)",
  padding: "12px 14px",
  fontSize: 15,
};
const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
  color: "var(--t-dim)",
  marginBottom: 6,
  display: "block",
};

function verdictColor(v: GuardianResult["verdict"]): string {
  return v === "SAFE" ? "#34d399" : v === "CAUTION" ? "#fbbf24" : "#f87171";
}

/** Animated risk gauge: needle sweeps to the score, number counts up. */
function RiskGauge({ score, verdict }: { score: number; verdict: GuardianResult["verdict"] }) {
  const [shown, setShown] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    const t0 = performance.now();
    const dur = 1200;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(score * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [score]);
  const angle = -90 + (shown / 100) * 180;
  const color = verdictColor(verdict);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width="120" height="72" viewBox="0 0 120 72">
        <path d="M 12 64 A 48 48 0 0 1 108 64" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M 12 64 A 48 48 0 0 1 108 64"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(shown / 100) * 151} 151`}
          style={{ transition: "stroke .3s", filter: `drop-shadow(0 0 6px ${color})` }}
        />
        <line
          x1="60" y1="64" x2={60 + 40 * Math.cos((angle * Math.PI) / 180)} y2={64 + 40 * Math.sin((angle * Math.PI) / 180)}
          stroke="#fff" strokeWidth="3" strokeLinecap="round"
        />
        <circle cx="60" cy="64" r="6" fill="#fff" />
      </svg>
      <div>
        <div style={{ fontSize: 34, fontWeight: 800, color }}>{shown}</div>
        <div style={{ fontSize: 11, color: "var(--t-dim)", letterSpacing: 1 }}>RISK SCORE / 100</div>
        <div style={{ fontSize: 15, fontWeight: 800, color, marginTop: 4 }}>{verdict}</div>
      </div>
    </div>
  );
}

/** Radar scan animation shown while the guardian scores the quote. */
function RadarScan() {
  return (
    <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto" }}>
      <style>{`
        @keyframes vg-radar-sweep { to { transform: rotate(360deg); } }
        @keyframes vg-radar-ring { 0% { transform: scale(.3); opacity: .9; } 100% { transform: scale(1.4); opacity: 0; } }
      `}</style>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(168,85,247,0.4)" }} />
      <div style={{ position: "absolute", inset: 24, borderRadius: "50%", border: "1px solid rgba(168,85,247,0.3)" }} />
      <div style={{ position: "absolute", inset: 44, borderRadius: "50%", border: "1px solid rgba(168,85,247,0.25)" }} />
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: "conic-gradient(from 0deg, rgba(168,85,247,0.55), transparent 90deg)",
          animation: "vg-radar-sweep 1.6s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(168,85,247,0.6)",
          animation: "vg-radar-ring 1.6s ease-out infinite",
        }}
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#c4b5fd", letterSpacing: 1 }}>
        SCAN
      </div>
    </div>
  );
}

export default function TidePoolSwapPanel() {
  const [fromKey, setFromKey] = useState("usdc");
  const [toKey, setToKey] = useState("wnear");
  const [amount, setAmount] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [phase, setPhase] = useState<Phase>("inputs");
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [guardian, setGuardian] = useState<GuardianResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cautionAck, setCautionAck] = useState(false);
  const [error, setError] = useState("");
  const [depositAddress, setDepositAddress] = useState("");
  const [password, setPassword] = useState("");
  const [depositTx, setDepositTx] = useState("");
  const [settleStatus, setSettleStatus] = useState("");
  const [todaySpend, setTodaySpend] = useState(0);
  const [policyPaused, setPolicyPaused] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState("");
  const [faucetBusy, setFaucetBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fromToken = TOKENS.find((t) => t.key === fromKey)!;
  const toToken = TOKENS.find((t) => t.key === toKey)!;

  useEffect(() => {
    try {
      const meta = loadKeystoreMeta(NEAR_TESTNET.keystoreKey);
      setHasWallet(meta.ok);
      if (meta.ok && !recipient) setRecipient(meta.keystore.accountId);
    } catch { /* no wallet */ }
    try {
      setPolicyPaused(loadUserPolicy().paused);
      setTodaySpend(getTodaySpendUsd());
    } catch { /* defaults */ }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getQuote = useCallback(async () => {
    setError("");
    setGuardian(null);
    setCautionAck(false);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 10000) {
      setError("Enter an amount between 0 and 10,000.");
      return;
    }
    if (fromKey === toKey) {
      setError("Source and destination tokens must differ.");
      return;
    }
    if (!isValidTestnetAccount(recipient)) {
      setError("Recipient must be a NEAR testnet account (e.g. you.testnet).");
      return;
    }
    setPhase("quoting");
    try {
      const res = await fetch(
        `/api/tidepool/quote?amount=${encodeURIComponent(amount)}&from=${fromKey}&to=${toKey}`,
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        amountIn?: string;
        amountInBaseUnits?: string;
        amountOut?: string;
        amountOutBaseUnits?: string;
        minAmountOut?: string;
        amountOutUsd?: string;
        timeEstimateSec?: number;
      };
      if (!data.ok) {
        setError(`Quote failed: ${data.error ?? "unknown error"}`);
        setPhase("failed");
        return;
      }
      const q: QuoteData = {
        amountIn: data.amountIn!,
        amountInBaseUnits: data.amountInBaseUnits!,
        amountOut: data.amountOut!,
        amountOutBaseUnits: data.amountOutBaseUnits!,
        minAmountOutBaseUnits: data.minAmountOut,
        amountOutUsd: data.amountOutUsd,
        timeEstimateSec: data.timeEstimateSec,
        receivedAtMs: Date.now(),
      };
      setQuote(q);
      // Route Guardian scan — animated, then the real verdict.
      setPhase("quoted");
      setScanning(true);
      await new Promise((r) => setTimeout(r, 1700));
      const intent: TestnetSwapIntent = {
        fromTokenKey: fromKey,
        toTokenKey: toKey,
        fromTokenId: `nep141:${fromToken.contract}`,
        toTokenId: `nep141:${toToken.contract}`,
        amountInBaseUnits: q.amountInBaseUnits,
        slippageBps: 100,
        recipient: recipient.trim(),
      };
      const tq: TestnetQuote = {
        amountInBaseUnits: q.amountInBaseUnits,
        amountOutBaseUnits: q.amountOutBaseUnits,
        minAmountOutBaseUnits: q.minAmountOutBaseUnits,
        amountOutUsd: q.amountOutUsd,
        timeEstimateSec: q.timeEstimateSec,
        receivedAtMs: q.receivedAtMs,
      };
      setGuardian(checkTestnetSwap(tq, intent));
      setScanning(false);
      setPhase("approved");
    } catch (e) {
      setError(`Quote failed: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("failed");
    }
  }, [amount, fromKey, toKey, recipient, fromToken, toToken]);

  const execute = useCallback(async () => {
    if (!quote || !guardian) return;
    if (guardian.verdict === "BLOCKED") {
      setError("Guardian verdict is BLOCKED — this swap cannot be executed.");
      return;
    }
    if (guardian.verdict === "CAUTION" && !cautionAck) {
      setError("Please acknowledge the CAUTION reasons for this specific quote first.");
      return;
    }
    setError("");
    setPhase("executing");
    try {
      const res = await fetch("/api/tidepool/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromKey, to: toKey, amount, recipient: recipient.trim() }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        depositAddress?: string;
        amountOutUsd?: string;
      };
      if (!data.ok) {
        setError(`Execution setup failed: ${data.error ?? "unknown error"}`);
        setPhase("failed");
        return;
      }
      // Re-verify the deposit intent matches the quoted amount (guardian re-check).
      setDepositAddress(data.depositAddress!);
      setPhase("signing");
    } catch (e) {
      setError(`Execution setup failed: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("failed");
    }
  }, [quote, guardian, cautionAck, fromKey, toKey, amount, recipient]);

  const signAndDeposit = useCallback(async () => {
    if (!quote || !depositAddress) return;
    setError("");
    try {
      const unlocked = await unlockKeystore(password, NEAR_TESTNET.keystoreKey);
      if (!unlocked.ok) {
        setError(`Wallet unlock failed: ${unlocked.error}`);
        return;
      }
      const meta = loadKeystoreMeta(NEAR_TESTNET.keystoreKey);
      if (!meta.ok) {
        setError("Saved wallet not found.");
        return;
      }
      const conn = createConnection();
      const account = getSignerAccount({
        provider: conn.provider,
        accountId: meta.keystore.accountId,
        secretKey: unlocked.secretKey,
      });
      setPassword(""); // never keep the password in state longer than needed
      const res = await transferToken({
        account,
        tokenContractId: fromToken.contract,
        receiverId: depositAddress,
        amountBaseUnits: quote.amountInBaseUnits,
        memo: "VAULTRY TidePool testnet intent deposit",
      });
      setDepositTx(res.txHash);
      setPhase("settling");
      // Poll for settlement.
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const r = await fetch(
            `/api/tidepool/status?depositAddress=${encodeURIComponent(depositAddress)}`,
          );
          const d = (await r.json()) as { ok: boolean; status?: string };
          if (d.ok && d.status) {
            setSettleStatus(d.status);
            if (["SETTLED", "COMPLETED", "SUCCESS"].includes(d.status.toUpperCase())) {
              if (pollRef.current) clearInterval(pollRef.current);
              const usd = Number(quote.amountOutUsd ?? "0");
              if (Number.isFinite(usd) && usd > 0) {
                recordSpendUsd(usd);
                setTodaySpend(getTodaySpendUsd());
              }
              setPhase("done");
            } else if (["FAILED", "EXPIRED", "REFUNDED"].includes(d.status.toUpperCase())) {
              if (pollRef.current) clearInterval(pollRef.current);
              setError(`Settlement ${d.status} — check the deposit transaction on the explorer.`);
              setPhase("failed");
            }
          }
        } catch {
          /* transient poll failure — keep polling */
        }
        if (attempts >= 30) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError("Settlement is taking longer than 5 minutes — check the deposit tx on the explorer.");
          setPhase("failed");
        }
      }, 10000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [quote, depositAddress, password, fromToken]);

  const requestFaucet = useCallback(async () => {
    if (!isValidTestnetAccount(recipient)) {
      setFaucetMsg("Enter a valid *.testnet account first.");
      return;
    }
    setFaucetBusy(true);
    setFaucetMsg("");
    try {
      const res = await fetch("/api/tidepool/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: recipient.trim().toLowerCase() }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; drips?: { symbol: string; amount: string }[] };
      if (!data.ok) {
        setFaucetMsg(`Faucet: ${data.error ?? "failed"}`);
      } else {
        const list = (data.drips ?? []).map((d) => `${d.amount} ${d.symbol}`).join(", ");
        setFaucetMsg(`Faucet sent: ${list || "test tokens"} — check your balance shortly.`);
      }
    } catch (e) {
      setFaucetMsg(`Faucet error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFaucetBusy(false);
    }
  }, [recipient]);

  const canExecute =
    phase === "approved" &&
    guardian &&
    guardian.verdict !== "BLOCKED" &&
    (guardian.verdict === "SAFE" || cautionAck);

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Testnet Intents Swap</h3>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: "3px 10px", borderRadius: 999, background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.5)", color: "#fbbf24" }}>
          TESTNET · VALUELESS
        </span>
        <span style={{ fontSize: 12, color: "var(--t-dim)" }}>powered by TidePool sandbox</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--t-dim)", margin: "0 0 18px" }}>
        Every swap is scored by the Route Guardian <b>before</b> anything is signed.
        BLOCKED swaps cannot execute. Your Policy Console limits are enforced too.
      </p>

      {/* ---- inputs ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div>
          <span style={label}>FROM (test token)</span>
          <select style={input} value={fromKey} onChange={(e) => setFromKey(e.target.value)} disabled={phase !== "inputs" && phase !== "failed" && phase !== "approved"}>
            {TOKENS.filter((t) => ["usdc", "usdt"].includes(t.key)).map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <span style={label}>TO (test token)</span>
          <select style={input} value={toKey} onChange={(e) => setToKey(e.target.value)} disabled={phase !== "inputs" && phase !== "failed" && phase !== "approved"}>
            {TOKENS.filter((t) => t.key !== fromKey).map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <span style={label}>AMOUNT</span>
          <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.0" inputMode="decimal" disabled={phase !== "inputs" && phase !== "failed" && phase !== "approved"} />
        </div>
        <div>
          <span style={label}>RECIPIENT (testnet account)</span>
          <input style={input} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="you.testnet" disabled={phase !== "inputs" && phase !== "failed" && phase !== "approved"} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <button className="vg-btn" onClick={() => void getQuote()} disabled={phase === "quoting" || phase === "executing" || phase === "signing" || phase === "settling"}>
          {phase === "quoting" ? "Fetching live quote…" : "1 · Get live quote"}
        </button>
        <button className="vg-btn vg-btn-ghost" onClick={() => void requestFaucet()} disabled={faucetBusy} title="Get free test tokens from the TidePool faucet">
          {faucetBusy ? "Requesting…" : "Get test tokens (faucet)"}
        </button>
        {!hasWallet && (
          <a href="/wallet" style={{ fontSize: 13, color: "#22d3ee", alignSelf: "center" }}>
            Create a testnet wallet first →
          </a>
        )}
      </div>
      {faucetMsg && <div style={{ fontSize: 13, color: "#a5b4fc", marginBottom: 8 }}>{faucetMsg}</div>}
      {error && (
        <div style={{ background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 10, padding: "10px 14px", fontSize: 13.5, color: "#fca5a5", marginBottom: 12 }} role="alert">
          {error}
        </div>
      )}

      {/* ---- quote + guardian ---- */}
      {quote && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.25)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 10, color: "#c4b5fd" }}>
            LIVE QUOTE (testnet)
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, margin: "0 0 16px" }}>
            <div><dt style={{ fontSize: 11, color: "var(--t-dim)" }}>You send</dt><dd style={{ margin: 0, fontWeight: 700 }}>{quote.amountIn} {fromToken.label.replace("test ", "")}</dd></div>
            <div><dt style={{ fontSize: 11, color: "var(--t-dim)" }}>You receive (est.)</dt><dd style={{ margin: 0, fontWeight: 700 }}>{quote.amountOut} {toToken.label.replace("test ", "")}</dd></div>
            <div><dt style={{ fontSize: 11, color: "var(--t-dim)" }}>Settle ETA</dt><dd style={{ margin: 0, fontWeight: 700 }}>~{quote.timeEstimateSec ?? "?"}s</dd></div>
            <div><dt style={{ fontSize: 11, color: "var(--t-dim)" }}>Today&apos;s testnet spend</dt><dd style={{ margin: 0, fontWeight: 700 }}>${todaySpend.toFixed(2)}</dd></div>
          </dl>

          {scanning && <RadarScan />}
          {!scanning && guardian && (
            <div style={{ borderTop: "1px solid rgba(168,85,247,0.2)", paddingTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 10, color: "#c4b5fd" }}>
                ROUTE GUARDIAN VERDICT
              </div>
              <RiskGauge score={guardian.score} verdict={guardian.verdict} />
              <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--t-dim)" }}>
                {guardian.reasons.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4, color: r.startsWith("BLOCKED") ? "#fca5a5" : r.startsWith("CAUTION") ? "#fcd34d" : undefined }}>{r}</li>
                ))}
              </ul>
              {policyPaused && (
                <div style={{ marginTop: 10, fontSize: 13, color: "#fca5a5", fontWeight: 700 }}>
                  Emergency pause is ON in your Policy Console — execution is frozen until you unpause.
                </div>
              )}
              {guardian.verdict === "CAUTION" && (
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={cautionAck} onChange={(e) => setCautionAck(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>I have read the CAUTION reasons above and accept the risk for <b>this specific quote only</b>.</span>
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- execute ---- */}
      {phase === "approved" && (
        <div style={{ marginTop: 16 }}>
          <button className="vg-btn" onClick={() => void execute()} disabled={!canExecute || !hasWallet} style={{ width: "100%", justifyContent: "center", opacity: canExecute && hasWallet ? 1 : 0.5 }}>
            2 · {guardian?.verdict === "BLOCKED" ? "Blocked by Guardian — cannot execute" : "Execute swap (guardian-approved)"}
          </button>
          {!hasWallet && <div style={{ fontSize: 13, color: "#fbbf24", marginTop: 8 }}>Create or import a testnet wallet on the <a href="/wallet" style={{ color: "#22d3ee" }}>Wallet page</a> to sign the deposit.</div>}
        </div>
      )}

      {/* ---- sign ---- */}
      {(phase === "executing" || phase === "signing") && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.25)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Deposit intent created</div>
          <div style={{ fontSize: 12, color: "var(--t-dim)", wordBreak: "break-all", marginBottom: 12 }}>
            Deposit address: <span style={{ color: "#a5b4fc", fontFamily: "monospace" }}>{depositAddress}</span>
          </div>
          {phase === "signing" && (
            <>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                Unlock your testnet wallet to sign the <b>{amount} {fromToken.label}</b> deposit.
                Your password never leaves this browser.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input type="password" style={{ ...input, maxWidth: 280 }} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Wallet password" onKeyDown={(e) => { if (e.key === "Enter") void signAndDeposit(); }} />
                <button className="vg-btn" onClick={() => void signAndDeposit()} disabled={!password}>
                  3 · Sign &amp; deposit
                </button>
              </div>
            </>
          )}
          {phase === "executing" && <div style={{ fontSize: 13, color: "var(--t-dim)" }}>Creating the deposit intent…</div>}
        </div>
      )}

      {/* ---- settling / done ---- */}
      {(phase === "settling" || phase === "done") && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: phase === "done" ? "rgba(52,211,153,0.06)" : "rgba(251,191,36,0.06)", border: `1px solid ${phase === "done" ? "rgba(52,211,153,0.35)" : "rgba(251,191,36,0.35)"}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            {phase === "done" ? "✓ Swap settled on testnet" : `Settling… (${settleStatus || "waiting for TidePool"})`}
          </div>
          <div style={{ fontSize: 12, wordBreak: "break-all", marginBottom: 6 }}>
            <span style={{ color: "var(--t-dim)" }}>Deposit tx&nbsp;</span>
            <a href={NEAR_TESTNET.explorerTxUrl(depositTx)} target="_blank" rel="noreferrer" style={{ color: "#a78bfa", fontFamily: "monospace" }}>{depositTx}</a>
          </div>
          <div style={{ fontSize: 12, color: "var(--t-dim)" }}>
            Deposit address: <span style={{ fontFamily: "monospace" }}>{depositAddress}</span>
          </div>
          {phase === "done" && (
            <div style={{ fontSize: 12, color: "var(--t-dim)", marginTop: 8 }}>
              Output sent to <b>{recipient.trim()}</b>. Spend recorded in your Policy Console.
            </div>
          )}
        </div>
      )}

      {(phase === "failed" || phase === "done") && (
        <button className="vg-btn vg-btn-ghost" style={{ marginTop: 16 }} onClick={() => { setPhase("inputs"); setQuote(null); setGuardian(null); setError(""); setDepositTx(""); setDepositAddress(""); }}>
          Start a new swap
        </button>
      )}
    </div>
  );
}
