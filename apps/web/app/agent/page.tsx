"use client";

/**
 * /agent — VAULTRY Agentic Wallet dashboard (TESTNET ONLY).
 *
 * Sections: agent status · NL command box · automation rules · portfolio
 * monitoring (real testnet balances) · suggested actions (SUGGESTION) ·
 * pending approvals (PREPARED — explicit signature only) · transaction
 * history (COMPLETED + explorer links) · security & permission settings.
 *
 * The agent NEVER sees keys: reads use public addresses; signing needs the
 * multi-chain wallet unlocked in-memory for that action only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { runAgentCommand, executePreparedSwap, type AgentAnswer, type PreparedSwap, type ExecStatus, type AgentSessionCtx } from "../../lib/agent/executor";
import { explainAgentStates } from "../../lib/agent/explain";
import {
  appendAgentLog, readAgentLog, clearAgentLog, loadAgentState, saveAgentState,
  loadAutomationRules, saveAutomationRule, deleteAutomationRule,
  type AgentLogEntry, type AutomationRule,
} from "../../lib/agent/store";
import { loadMultiChainMeta, unlockMultiChainSession } from "../../lib/wallet/multichain-store";
import type { MultiChainAddresses, MultiChainSecrets } from "../../lib/wallet/multichain-derive";
import { CORE_CHAINS } from "../../lib/wallet/chains";

const card: React.CSSProperties = {
  background: "rgba(13,20,38,0.75)", border: "1px solid rgba(125,211,252,0.14)",
  borderRadius: 14, padding: 22, marginBottom: 18,
};
const input: React.CSSProperties = {
  width: "100%", background: "rgba(7,11,22,0.8)", border: "1px solid rgba(125,211,252,0.25)",
  borderRadius: 8, color: "#e9eef7", padding: "11px 13px", fontSize: 15,
  fontFamily: "inherit", boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 13, color: "#93a0b8", marginBottom: 6, display: "block" };
const hint: React.CSSProperties = { fontSize: 13, color: "#5b6a84", lineHeight: 1.6 };

const STATE_COLORS: Record<string, string> = {
  SUGGESTION: "#93a0b8", PREPARED: "#fbbf24", COMPLETED: "#86efac",
};

interface ChatMsg { role: "user" | "agent"; answer?: AgentAnswer; text?: string; }

function AgentPageInner() {
  const [agentOn, setAgentOn] = useState(true);
  const [agentPaused, setAgentPaused] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [addresses, setAddresses] = useState<MultiChainAddresses | null>(null);
  const [secrets, setSecrets] = useState<MultiChainSecrets | null>(null);
  const [unlockPw, setUnlockPw] = useState("");
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null);
  const [log, setLog] = useState<AgentLogEntry[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pending, setPending] = useState<PreparedSwap | null>(null);
  const [cautionAck, setCautionAck] = useState(false);
  const [execStatus, setExecStatus] = useState<ExecStatus>("idle");
  const [execDetail, setExecDetail] = useState("");
  const [execResult, setExecResult] = useState<{ depositTx?: string; settleTx?: string; explorerUrl?: string; error?: string } | null>(null);
  const [ruleForm, setRuleForm] = useState({ kind: "balance_watch", chain: "sepolia", threshold: "", minOut: "" });
  const chatEnd = useRef<HTMLDivElement | null>(null);

  const refreshAll = useCallback(() => {
    const s = loadAgentState();
    setAgentOn(s.enabled); setAgentPaused(s.paused);
    setLog(readAgentLog(30));
    setRules(loadAutomationRules());
    try {
      const m = loadMultiChainMeta();
      setAddresses(m.ok ? m.store.addresses : null);
    } catch { setAddresses(null); }
  }, []);

  useEffect(() => { refreshAll(); }, [refreshAll]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  /* automation rules -> suggestions only (never auto-execute) */
  useEffect(() => {
    if (!addresses || rules.length === 0) return;
    (async () => {
      const out: string[] = [];
      for (const r of rules) {
        try {
          if (r.kind === "balance_watch") {
            const addr = r.params.chain === "solana-devnet" ? addresses.solanaAddress
              : r.params.chain === "near-testnet" ? addresses.nearImplicitAccountId : addresses.evmAddress;
            const res = await fetch("/api/chains/balance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: r.params.chain, address: addr }) });
            const j = await res.json() as { ok: boolean; balance?: string };
            if (j.ok && Number(j.balance) < Number(r.params.threshold)) {
              out.push(`Balance watch: ${r.params.chain} balance is ${j.balance} — below your ${r.params.threshold} threshold. Fund via the faucet if you need it.`);
            }
          } else if (r.kind === "rate_watch") {
            const res = await fetch(`/api/tidepool/quote?amount=${encodeURIComponent(r.params.amount ?? "1")}&from=${encodeURIComponent(r.params.from ?? "usdc")}&to=${encodeURIComponent(r.params.to ?? "wnear")}`);
            const j = await res.json() as { ok: boolean; amountOut?: string };
            if (j.ok && Number(j.amountOut) >= Number(r.params.minOut)) {
              out.push(`Rate watch: ${(r.params.amount ?? "1").toUpperCase()} ${(r.params.from ?? "usdc").toUpperCase()} → ${(r.params.to ?? "wnear").toUpperCase()} now quotes ${j.amountOut} — above your ${r.params.minOut} target.`);
            }
          }
        } catch { /* rule evaluation is best-effort */ }
      }
      setSuggestions(out);
    })();
  }, [addresses, rules]);

  async function send() {
    const cmd = command.trim();
    if (!cmd || busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: cmd }]);
    setCommand("");
    try {
      const ctx: AgentSessionCtx = { addresses, secrets };
      const ans = await runAgentCommand(cmd, ctx);
      setMsgs((m) => [...m, { role: "agent", answer: ans }]);
      if (ans.kind === "prepared_swap" && ans.prepared) {
        setPending(ans.prepared); setCautionAck(false); setExecStatus("idle"); setExecResult(null);
      }
      setLog(readAgentLog(30));
    } catch (e) {
      setMsgs((m) => [...m, { role: "agent", answer: { kind: "message", title: "Error", lines: [e instanceof Error ? e.message : "Agent failed"] } }]);
    } finally { setBusy(false); }
  }

  async function unlockForSigning() {
    setUnlockMsg(null);
    if (!unlockPw) { setUnlockMsg("Enter your wallet password to unlock signing."); return; }
    const r = await unlockMultiChainSession(unlockPw);
    if (!r.ok) { setUnlockMsg(r.error); return; }
    setSecrets(r.secrets); setAddresses(r.addresses); setUnlockPw("");
    setUnlockMsg("✓ Wallet unlocked in memory for this signing action only.");
    appendAgentLog("note", "Wallet unlocked", "in-memory session for signing (never persisted, never sent)");
  }

  async function signAndExecute() {
    if (!pending) return;
    if (pending.guardian.verdict === "CAUTION" && !cautionAck) {
      setExecResult({ error: "Acknowledge each CAUTION reason explicitly before signing." });
      return;
    }
    if (!secrets || !addresses) {
      setExecResult({ error: "Unlock your wallet above first — signing happens on this device only." });
      return;
    }
    setExecStatus("awaiting_approval"); setExecResult(null);
    const r = await executePreparedSwap(pending, { addresses, secrets }, (s, d) => {
      setExecStatus(s); setExecDetail(d ?? "");
    });
    setExecResult(r);
    if (r.status === "completed") {
      setPending(null);
      setMsgs((m) => [...m, {
        role: "agent",
        answer: {
          kind: "message", title: "✓ Swap completed on testnet", stateLabel: "COMPLETED",
          lines: [
            `Deposit tx: ${r.depositTx}`,
            r.settleTx ? `Settlement tx: ${r.settleTx}` : "Settlement tx: pending — check the deposit on the explorer.",
            "Both are real on-chain testnet transactions.",
          ],
        },
      }]);
    }
    setLog(readAgentLog(30));
  }

  function addRule() {
    if (ruleForm.kind === "balance_watch" && !ruleForm.threshold) return;
    if (ruleForm.kind === "rate_watch" && !ruleForm.minOut) return;
    const params: Record<string, string> =
      ruleForm.kind === "balance_watch"
        ? { chain: ruleForm.chain, threshold: ruleForm.threshold }
        : { from: "usdc", to: "wnear", amount: "1", minOut: ruleForm.minOut ?? "" };
    saveAutomationRule({
      kind: ruleForm.kind as "balance_watch" | "rate_watch",
      name: ruleForm.kind === "balance_watch" ? `Balance watch ${ruleForm.chain} < ${ruleForm.threshold}` : `Rate watch USDC→wNEAR ≥ ${ruleForm.minOut}`,
      params,
    });
    setRules(loadAutomationRules());
    appendAgentLog("note", "Automation rule added", ruleForm.kind);
  }

  const statusLabel = !agentOn ? "DISABLED" : agentPaused ? "PAUSED" : "ACTIVE";

  return (
    <div className="vg-wrap" style={{ paddingTop: 100, paddingBottom: 60, maxWidth: 960 }}>
      <div className="vg-eyebrow">VAULTRY · AGENTIC WALLET</div>
      <h1 className="vg-h2" style={{ marginBottom: 6 }}>
        Your AI <span className="grad-text">DeFi assistant</span>
      </h1>
      <p className="vg-sub" style={{ marginBottom: 18 }}>
        Natural-language research and testnet swap preparation — every action gated by the
        Route Guardian and your Policy Console. The AI never sees your keys, never signs
        silently, and a BLOCKED verdict can never be overridden.
      </p>

      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: "#fbbf24", background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 999, padding: "8px 16px", marginBottom: 18 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", boxShadow: "0 0 10px #f59e0b" }} />
        TESTNET MODE · VALUELESS TOKENS ONLY
      </div>

      {/* STATUS */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={label}>AI AGENT STATUS</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: statusLabel === "ACTIVE" ? "#86efac" : statusLabel === "PAUSED" ? "#fbbf24" : "#fca5a5" }}>
              {statusLabel === "ACTIVE" ? "●" : statusLabel === "PAUSED" ? "◐" : "○"} {statusLabel}
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#93a0b8" }}>
            Wallet: {addresses ? "connected (public addresses only)" : "not connected — visit the Wallet page"}
            {secrets ? " · signing unlocked (memory only)" : ""}
          </div>
        </div>
        <div style={{ ...hint, marginTop: 10 }}>
          {explainAgentStates().map((s) => (
            <div key={s.state} style={{ marginBottom: 4 }}>
              <b style={{ color: STATE_COLORS[s.state] }}>{s.state}</b> — {s.meaning}
            </div>
          ))}
        </div>
      </div>

      {/* COMMAND BOX */}
      <div style={card}>
        <div style={label}>NATURAL-LANGUAGE COMMAND</div>
        <div style={{ border: "1px solid rgba(125,211,252,0.12)", borderRadius: 10, padding: 14, maxHeight: 380, overflowY: "auto", marginBottom: 12, background: "rgba(7,11,22,0.5)" }}>
          {msgs.length === 0 && (
            <p style={hint}>Try: “show my testnet portfolio” · “prepare a swap of 2 USDC to wNEAR” · “is this contract suspicious 0x…” · “find the safest swap route” · “explain my transaction in simple language”.</p>
          )}
          {msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              {m.role === "user" ? (
                <div style={{ textAlign: "right" }}>
                  <span style={{ display: "inline-block", background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.4)", borderRadius: 12, padding: "8px 14px", fontSize: 14, textAlign: "left" }}>{m.text}</span>
                </div>
              ) : (
                <div style={{ background: "rgba(13,20,38,0.9)", border: "1px solid rgba(125,211,252,0.14)", borderRadius: 12, padding: "10px 14px", fontSize: 14 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {m.answer?.title}
                    {m.answer?.stateLabel && (
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: "3px 10px", borderRadius: 999, color: STATE_COLORS[m.answer.stateLabel], border: `1px solid ${STATE_COLORS[m.answer.stateLabel]}55`, background: `${STATE_COLORS[m.answer.stateLabel]}11` }}>
                        {m.answer.stateLabel}
                      </span>
                    )}
                  </div>
                  {(m.answer?.lines ?? []).map((l, k) => (
                    <div key={k} style={{ color: l.startsWith("•") || l.startsWith("✓") || l.startsWith("🛡") || l.startsWith("⚠") ? "#c9d4e8" : "#5b6a84", marginBottom: 3, whiteSpace: "pre-wrap" }}>{l || " "}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={chatEnd} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input style={input} value={command} onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Ask in plain words — e.g. prepare a swap of 2 USDC to wNEAR" disabled={busy} />
          <button className="vg-btn" onClick={send} disabled={busy || !command.trim()}>{busy ? "…" : "Ask"}</button>
        </div>
      </div>

      {/* PENDING APPROVALS */}
      {pending && (
        <div style={{ ...card, border: "1px solid rgba(251,191,36,0.45)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Pending approval <span style={{ fontSize: 11, color: "#fbbf24", border: "1px solid rgba(251,191,36,0.45)", borderRadius: 999, padding: "3px 10px", marginLeft: 8 }}>PREPARED</span></h3>
            <button className="vg-btn vg-btn-ghost" style={{ fontSize: 12 }} onClick={() => { setPending(null); setExecStatus("idle"); }}>Dismiss</button>
          </div>
          <div className="vg-kv" style={{ margin: "14px 0" }}>
            <div><dt>Swap</dt><dd>{pending.amount} {pending.quote.from} → {pending.quote.to}</dd></div>
            <div><dt>Expected output</dt><dd>~{pending.quote.amountOut} {pending.quote.to} (≈ ${pending.quote.amountOutUsd})</dd></div>
            <div><dt>Route</dt><dd>{pending.quote.via}</dd></div>
            <div><dt>Guardian</dt><dd style={{ color: pending.guardian.verdict === "SAFE" ? "#86efac" : "#fbbf24", fontWeight: 700 }}>{pending.guardian.verdict} (risk {pending.guardian.score}/100)</dd></div>
            <div><dt>Recipient</dt><dd style={hint}><span style={{ fontFamily: "monospace", fontSize: 12 }}>{pending.quote.recipient.slice(0, 24)}… (your NEAR testnet account)</span></dd></div>
          </div>
          {pending.guardian.verdict === "CAUTION" && (
            <div style={{ marginBottom: 12 }}>
              {pending.guardian.reasons.map((r, i) => <div key={i} style={{ fontSize: 13, color: "#fbbf24", marginBottom: 4 }}>⚠ {r.replace(/^CAUTION:\s*/, "")}</div>)}
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10, cursor: "pointer", fontSize: 14 }}>
                <input type="checkbox" checked={cautionAck} onChange={(e) => setCautionAck(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "#fbbf24" }} />
                <span>I have reviewed each caution above and accept the risk <b>for this transaction only</b>.</span>
              </label>
            </div>
          )}
          {!secrets ? (
            <div>
              <div style={label}>Unlock wallet to sign (keys stay on this device)</div>
              <div style={{ display: "flex", gap: 10 }}>
                <input type="password" style={{ ...input, maxWidth: 280 }} value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} placeholder="Wallet password" onKeyDown={(e) => { if (e.key === "Enter") unlockForSigning(); }} />
                <button className="vg-btn vg-btn-ghost" onClick={unlockForSigning}>Unlock</button>
              </div>
              {unlockMsg && <div style={{ fontSize: 13, marginTop: 8, color: unlockMsg.startsWith("✓") ? "#86efac" : "#fca5a5" }}>{unlockMsg}</div>}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: "#86efac", marginBottom: 10 }}>✓ Wallet unlocked in memory — signing happens locally.</div>
              <button className="vg-btn" disabled={execStatus !== "idle" && execStatus !== "failed"} onClick={signAndExecute}>
                {execStatus === "idle" || execStatus === "failed" ? "Sign & execute swap" : "Executing…"}
              </button>
              <button className="vg-btn vg-btn-ghost" style={{ marginLeft: 10 }} onClick={() => { setSecrets(null); setUnlockMsg(null); }}>Lock wallet</button>
            </div>
          )}
          {execStatus !== "idle" && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <b>Status:</b> <span style={{ color: "#22d3ee" }}>{execStatus.replace(/_/g, " ").toUpperCase()}</span>
              {execDetail && <span style={{ color: "#93a0b8" }}> — {execDetail}</span>}
              <div style={{ fontSize: 12, color: "#5b6a84", marginTop: 4 }}>Quoted → Awaiting Approval → Submitted → Processing → Completed / Failed</div>
            </div>
          )}
          {execResult && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              {execResult.error && <div style={{ color: "#fca5a5" }}>⚠ {execResult.error}</div>}
              {execResult.depositTx && <div style={{ color: "#86efac" }}>✓ Deposit tx: <span style={{ fontFamily: "monospace", fontSize: 12 }}>{execResult.depositTx}</span></div>}
              {execResult.settleTx && <div style={{ color: "#86efac" }}>✓ Settlement tx: <span style={{ fontFamily: "monospace", fontSize: 12 }}>{execResult.settleTx}</span></div>}
              {execResult.explorerUrl && <a href={execResult.explorerUrl} target="_blank" rel="noreferrer" style={{ color: "#22d3ee" }}>Verify on explorer ↗</a>}
            </div>
          )}
        </div>
      )}

      {/* AUTOMATION RULES + SUGGESTIONS */}
      <div style={card}>
        <h3 style={{ margin: "0 0 6px" }}>Automation rules</h3>
        <p style={hint}>Rules only create <b>SUGGESTIONS</b> — they can never execute transactions. No silent auto-execution exists anywhere in the agent.</p>
        {suggestions.length > 0 && (
          <div style={{ margin: "10px 0" }}>
            {suggestions.map((s, i) => <div key={i} style={{ fontSize: 13, color: "#fbbf24", marginBottom: 6 }}>💡 {s}</div>)}
          </div>
        )}
        {rules.length === 0 && <p style={hint}>No rules yet.</p>}
        {rules.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid rgba(125,211,252,0.12)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 8 }}>
            <span>{r.name}</span>
            <button className="vg-btn vg-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => { deleteAutomationRule(r.id); setRules(loadAutomationRules()); }}>Remove</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
          <div>
            <label style={label}>Rule type</label>
            <select style={input} value={ruleForm.kind} onChange={(e) => setRuleForm({ ...ruleForm, kind: e.target.value })}>
              <option value="balance_watch">Balance watch (alert below threshold)</option>
              <option value="rate_watch">Rate watch (alert when quote ≥ target)</option>
            </select>
          </div>
          {ruleForm.kind === "balance_watch" ? (
            <>
              <div>
                <label style={label}>Chain</label>
                <select style={input} value={ruleForm.chain} onChange={(e) => setRuleForm({ ...ruleForm, chain: e.target.value })}>
                  {CORE_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.testnetName}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Alert below</label>
                <input style={input} value={ruleForm.threshold} onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })} placeholder="0.5" inputMode="decimal" />
              </div>
            </>
          ) : (
            <div>
              <label style={label}>Alert when 1 USDC → wNEAR ≥</label>
              <input style={input} value={ruleForm.minOut ?? ""} onChange={(e) => setRuleForm({ ...ruleForm, minOut: e.target.value })} placeholder="0.25" inputMode="decimal" />
            </div>
          )}
          <button className="vg-btn vg-btn-ghost" onClick={addRule}>Add rule</button>
        </div>
      </div>

      {/* TRANSACTION HISTORY (from activity log) */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Agent activity log</h3>
          <button className="vg-btn vg-btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => { clearAgentLog(); setLog([]); }}>Clear log</button>
        </div>
        {log.length === 0 ? <p style={hint}>No agent activity yet. Ask something above.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
            {log.map((e) => (
              <div key={e.id} style={{ border: "1px solid rgba(125,211,252,0.12)", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ color: e.kind === "blocked" ? "#fca5a5" : e.kind === "executed" ? "#86efac" : "#e9eef7" }}>
                    [{e.kind.toUpperCase()}] {e.title}
                  </b>
                  <span style={{ color: "#5b6a84" }}>{new Date(e.ts).toLocaleString()}</span>
                </div>
                <div style={{ color: "#93a0b8", marginTop: 4, wordBreak: "break-word" }}>{e.detail}</div>
              </div>
            ))}
          </div>
        )}
        <p style={{ ...hint, marginTop: 10 }}>The log records plans, guardian verdicts, policy results, and tx hashes — never secrets.</p>
      </div>

      {/* SECURITY */}
      <div style={{ ...card, border: "1px solid rgba(239,68,68,0.25)" }}>
        <h3 style={{ margin: "0 0 6px" }}>Security & permissions</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 14 }}>
            <input type="checkbox" checked={agentOn} onChange={(e) => { const s = { enabled: e.target.checked, paused: agentPaused && e.target.checked }; saveAgentState(s); setAgentOn(s.enabled); appendAgentLog("note", e.target.checked ? "Agent enabled" : "Agent DISABLED", "master kill switch"); }} style={{ width: 18, height: 18, marginTop: 2, accentColor: "#22d3ee" }} />
            <span><b>Agent enabled</b> — master kill switch. Off = the agent does nothing at all.</span>
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 14 }}>
            <input type="checkbox" checked={agentPaused} disabled={!agentOn} onChange={(e) => { const s = { enabled: agentOn, paused: e.target.checked }; saveAgentState(s); setAgentPaused(s.paused); appendAgentLog("note", e.target.checked ? "Agent paused" : "Agent unpaused", "soft pause"); }} style={{ width: 18, height: 18, marginTop: 2, accentColor: "#fbbf24" }} />
            <span><b>Pause agent</b> — answers questions but prepares nothing. (The Policy Console emergency pause also freezes the agent.)</span>
          </label>
          <div style={{ ...hint }}>
            What the agent can never do: see your keys or seed phrase · sign or execute without your explicit wallet approval ·
            override a BLOCKED verdict · change its own policies or risk thresholds · invent quotes, balances, or tx status.
          </div>
          {secrets && <button className="vg-btn vg-btn-ghost" style={{ alignSelf: "flex-start", borderColor: "rgba(239,68,68,0.4)", color: "#fca5a5" }} onClick={() => { setSecrets(null); appendAgentLog("note", "Signing session locked", "in-memory secrets cleared"); }}>Revoke signing session now</button>}
        </div>
      </div>
    </div>
  );
}

export default function AgentPage() {
  return (
    <AppShell>
      <AgentPageInner />
    </AppShell>
  );
}
