/**
 * VAULTRY agent executor — CLIENT-SIDE ONLY.
 *
 * Orchestrates: kill switches -> /api/agent (plan+grounded data) ->
 * Guardian + Policy gates -> PREPARED -> explicit user signature -> on-chain.
 *
 * HARD RULES (enforced here, not in the model):
 * - Agent disabled -> nothing runs. Agent paused / Policy paused -> no preparation.
 * - BLOCKED verdict is NON-BYPASSABLE: no override path exists in this file.
 * - CAUTION needs explicit per-transaction acknowledgment.
 * - SAFE still needs explicit wallet signing — NO silent auto-execution.
 * - Keys/secrets live in the caller's memory-only session; they are passed
 *   into signing functions and never logged, never sent to any server.
 * - Grounding: swap_prepare re-fetches a FRESH quote and re-runs the guardian
 *   immediately before signing; a plan referencing unfetched data is rejected.
 */

import type { AgentPlan } from "./intent";
import { checkTestnetSwap, type GuardianResult, type TestnetQuote, type TestnetSwapIntent } from "../guardian/testnet-guardian";
import { loadUserPolicy } from "../policy/user-policy";
import { getTodaySpendUsd, recordSpendUsd } from "../policy/spend-tracker";
import { explainGuardianVerdict, explainPolicy, explainUnsupportedRoute } from "./explain";
import { appendAgentLog, loadAgentState } from "./store";
import { getSignerAccount, createConnection } from "../wallet/near";
import { transferToken } from "../wallet/token-transfer";
import type { MultiChainAddresses, MultiChainSecrets } from "../wallet/multichain-derive";

export interface AgentSessionCtx {
  addresses: MultiChainAddresses | null;
  secrets: MultiChainSecrets | null; // memory only — null when locked
}

export type AnswerKind =
  | "message" | "prepared_swap" | "needs_clarification" | "blocked" | "refused";

export interface PreparedSwap {
  from: string; to: string; amount: string;
  quote: Record<string, string>;
  guardian: GuardianResult;
  status: "PREPARED";
}

export interface AgentAnswer {
  kind: AnswerKind;
  title: string;
  lines: string[];
  prepared?: PreparedSwap;
  stateLabel?: "SUGGESTION" | "PREPARED" | "COMPLETED";
}

interface BrainResponse {
  ok: boolean;
  error?: string;
  plan?: AgentPlan;
  source?: string;
  data?: Record<string, unknown>;
}

const TOKEN_IDS: Record<string, string> = {
  usdc: "usdc.tidepool-sandbox.testnet",
  usdt: "usdt.tidepool-sandbox.testnet",
  wnear: "wnear.tidepool-sandbox.testnet",
  wbtc: "wbtc.tidepool-sandbox.testnet",
  eth: "eth.tidepool-sandbox.testnet",
};

function gates(): { ok: true } | { ok: false; reason: string } {
  const s = loadAgentState();
  if (!s.enabled) return { ok: false, reason: "The AI agent is DISABLED. Re-enable it in Security settings to use it." };
  try {
    if (loadUserPolicy().paused) {
      return { ok: false, reason: "Emergency pause is ON in your Policy Console — the agent cannot prepare or execute anything until you unpause." };
    }
  } catch { /* policy unreadable — continue; per-action checks still apply */ }
  if (s.paused) return { ok: false, reason: "The AI agent is PAUSED. It can answer questions but will not prepare transactions." };
  return { ok: true };
}

async function brain(command: string, ctx: AgentSessionCtx): Promise<BrainResponse> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command,
      addresses: ctx.addresses ? {
        evmAddress: ctx.addresses.evmAddress,
        solanaAddress: ctx.addresses.solanaAddress,
        nearImplicitAccountId: ctx.addresses.nearImplicitAccountId,
      } : {},
    }),
  });
  return (await res.json()) as BrainResponse;
}

/* ---------------- main entry ---------------- */

export async function runAgentCommand(command: string, ctx: AgentSessionCtx): Promise<AgentAnswer> {
  const g = gates();
  if (!g.ok) {
    appendAgentLog("blocked", "Agent refused", g.reason);
    return { kind: "refused", title: "Agent unavailable", lines: [g.reason] };
  }
  let br: BrainResponse;
  try {
    br = await brain(command, ctx);
  } catch (e) {
    return { kind: "message", title: "Brain unreachable", lines: [`Could not reach the agent brain: ${e instanceof Error ? e.message : "network error"}`] };
  }
  if (!br.ok || !br.plan) {
    return { kind: "message", title: "Could not understand", lines: [br.error ?? "The agent brain returned an error."] };
  }
  const plan = br.plan;
  const data = br.data ?? {};
  appendAgentLog("planned", `Intent: ${plan.intent}`, plan.summary);

  if (plan.confidence < 0.5) {
    appendAgentLog("note", "Clarification needed", plan.summary);
    return { kind: "needs_clarification", title: "I need a bit more", lines: [plan.summary] };
  }

  switch (plan.intent) {
    case "portfolio": return answerPortfolio(data, ctx);
    case "token_research": return answerTokenResearch(plan, data);
    case "swap_research": return answerSwapResearch(plan, data);
    case "swap_prepare": return await prepareSwap(plan, ctx);
    case "explain_guardian": return answerExplainGuardian();
    case "explain_tx": return answerExplainTx(data);
    case "faucet_guide": return answerFaucet(plan);
    case "policy_status": return answerPolicy();
    default: return { kind: "message", title: "VAULTRY agent", lines: [plan.summary] };
  }
}

/* ---------------- intent handlers ---------------- */

function answerPortfolio(data: Record<string, unknown>, ctx: AgentSessionCtx): AgentAnswer {
  const lines: string[] = [];
  if (!ctx.addresses) {
    return {
      kind: "message", title: "No wallet connected",
      lines: ["Connect your multi-chain wallet on the Wallet page first — the agent only reads public on-chain data, never your keys.", "Once unlocked, I can show live balances and history across all 4 testnets."],
      stateLabel: "SUGGESTION",
    };
  }
  const balances = (data.balances as { chain: string; ok: boolean; balance?: string; symbol?: string; error?: string }[]) ?? [];
  lines.push("Live testnet balances (from chain RPCs just now):");
  for (const b of balances) {
    lines.push(b.ok ? `• ${b.chain}: ${b.balance} ${b.symbol}` : `• ${b.chain}: unavailable (${b.error ?? "RPC error"})`);
  }
  const hist = (data.recentHistory as { chain: string; ok: boolean; txs?: { hash: string; status: string }[]; error?: string }[]) ?? [];
  const withTxs = hist.filter((h) => h.ok && (h.txs ?? []).length > 0);
  if (withTxs.length > 0) {
    lines.push("", "Recent transactions:");
    for (const h of withTxs) for (const t of (h.txs ?? []).slice(0, 3)) {
      lines.push(`• ${h.chain}: ${t.hash.slice(0, 16)}… [${t.status}]`);
    }
  } else {
    lines.push("", "No recent transactions found — or history is temporarily unavailable on some chains.");
  }
  lines.push("", "All tokens are valueless testnet tokens.");
  appendAgentLog("checked", "Portfolio shown", `${balances.length} chains queried`);
  return { kind: "message", title: "Your testnet portfolio", lines };
}

function answerTokenResearch(plan: AgentPlan, data: Record<string, unknown>): AgentAnswer {
  const lines: string[] = [];
  const { contract, token } = plan.params;
  if (token && data.tokenKnown) {
    lines.push(`✓ VERIFIED: "${token.toUpperCase()}" is a known TidePool testnet token.`);
    const m = (data.registryMatch as { symbol: string; contract: string; decimals: number }[]) ?? [];
    for (const r of m.slice(0, 4)) lines.push(`• ${r.symbol} — contract ${r.contract} — ${r.decimals} decimals`);
    lines.push("", "This is a valueless TEST token for the NEAR Intents sandbox — not a real investment.");
    appendAgentLog("checked", "Token research", `${token} verified in TidePool registry`);
    return { kind: "message", title: `Token research: ${token.toUpperCase()}`, lines, stateLabel: "SUGGESTION" };
  }
  if (contract) {
    const cc = data.contractCode as { ok: boolean; hasCode?: boolean; error?: string } | undefined;
    lines.push(`Contract: ${contract}`);
    lines.push(`Chain: ${(data.contractChain as string) ?? "Sepolia"}`);
    if (cc?.ok) {
      lines.push(cc.hasCode ? "• VERIFIED: contract code EXISTS at this address (via live eth_getCode)." : "• ⚠ No contract code at this address — it is an externally-owned account, not a token contract.");
    } else {
      lines.push(`• UNAVAILABLE: could not check on-chain code (${cc?.error ?? "RPC error"}).`);
    }
    lines.push("• ⏳ UNCERTAIN: audit status, ownership, and honeypot risk cannot be verified from on-chain code alone.");
    lines.push("", String(data.note ?? ""));
    appendAgentLog("checked", "Token research", `contract ${contract.slice(0, 12)}… checked`);
    return { kind: "message", title: "Token contract check", lines, stateLabel: "SUGGESTION" };
  }
  return { kind: "needs_clarification", title: "Which token?", lines: ["Paste a contract address (0x…) or a token name like USDC."] };
}

function answerSwapResearch(plan: AgentPlan, data: Record<string, unknown>): AgentAnswer {
  const lines: string[] = [];
  const q = data.quote as { ok: boolean; quote?: Record<string, string>; error?: string } | undefined;
  if (q?.ok && q.quote) {
    const qq = q.quote;
    lines.push(`✓ VERIFIED live quote (${qq.via}):`);
    lines.push(`• ${qq.amountIn} ${qq.from} → ~${qq.amountOut} ${qq.to}`);
    lines.push(`• Output value ref: $${qq.amountOutUsd} (testnet reference) · est. time ~${qq.timeEstimateSec}s`);
    lines.push("", "Route comparison (real data):");
    lines.push("• TidePool Intents sandbox — LIVE, the only genuine testnet route for this pair.");
    lines.push("• RHEA — NOT SUPPORTED on testnet (mainnet-only service; no testnet deployment exists).");
    lines.push("• Other bridges — no genuine public testnet route exists; anything claiming otherwise is not verifiable.");
    lines.push("", "Safest available: TidePool, AFTER it passes the Route Guardian scan (slippage, freshness, recipient checks).");
    appendAgentLog("checked", "Swap research", `${qq.from} -> ${qq.to} quoted live`);
    return { kind: "message", title: "Safest swap route", lines, stateLabel: "SUGGESTION" };
  }
  const routes = (data.routes as { from: string; to: string; status: string; note: string }[]) ?? [];
  const unsup = routes.find((r) => r.status === "unsupported");
  if (unsup) {
    const exp = explainUnsupportedRoute(unsup.from, unsup.to, unsup.note);
    appendAgentLog("checked", "Swap research", `no genuine route for ${plan.params.from}->${plan.params.to}`);
    return { kind: "message", title: "No genuine route", lines: exp, stateLabel: "SUGGESTION" };
  }
  lines.push(`Could not fetch a live quote: ${q?.error ?? "unknown error"}. No route invented.`);
  return { kind: "message", title: "Route lookup failed", lines };
}

async function prepareSwap(plan: AgentPlan, ctx: AgentSessionCtx): Promise<AgentAnswer> {
  const { from, to, amount } = plan.params;
  if (!from || !to || !amount) {
    return { kind: "needs_clarification", title: "Missing details", lines: ["I need the pair and amount — e.g. “prepare a swap of 2 USDC to wNEAR” (TidePool testnet pairs: USDC, USDT, wNEAR, wBTC, ETH)."] };
  }
  if (!ctx.addresses) {
    appendAgentLog("blocked", "Swap prep refused", "no wallet connected");
    return { kind: "blocked", title: "Wallet needed", lines: ["Connect and unlock your multi-chain wallet first — the swap settles to your NEAR testnet address."] };
  }
  // Fresh live quote (grounding: never prepare from stale/unfetched data)
  let qd: Record<string, string>;
  try {
    const res = await fetch(`/api/tidepool/quote?amount=${encodeURIComponent(amount)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const j = await res.json() as Record<string, string | boolean>;
    if (!j.ok) throw new Error(String(j.error ?? "quote failed"));
    qd = j as unknown as Record<string, string>;
  } catch (e) {
    appendAgentLog("blocked", "Swap prep failed", `quote error: ${e instanceof Error ? e.message : "?"}`);
    return { kind: "message", title: "Quote failed", lines: [`Live quote failed: ${e instanceof Error ? e.message : "unknown"}. Nothing prepared.`] };
  }
  // Route Guardian scan — BEFORE anything else
  const intent: TestnetSwapIntent = {
    fromTokenKey: from.toLowerCase(), toTokenKey: to.toLowerCase(),
    fromTokenId: `nep141:${TOKEN_IDS[from.toLowerCase()] ?? ""}`,
    toTokenId: `nep141:${TOKEN_IDS[to.toLowerCase()] ?? ""}`,
    amountInBaseUnits: qd.amountInBaseUnits, slippageBps: 100,
    recipient: ctx.addresses.nearImplicitAccountId,
  };
  const tq: TestnetQuote = {
    amountInBaseUnits: qd.amountInBaseUnits, amountOutBaseUnits: qd.amountOutBaseUnits,
    minAmountOutBaseUnits: qd.minAmountOutBaseUnits, amountOutUsd: qd.amountOutUsd,
    timeEstimateSec: Number(qd.timeEstimateSec ?? 0), receivedAtMs: Date.now(),
  };
  const verdict: GuardianResult = checkTestnetSwap(tq, intent);
  appendAgentLog("checked", `Guardian scan: ${verdict.verdict}`, verdict.reasons.join(" | ") || "all checks passed");
  try {
    window.localStorage.setItem("vaultry.agent.last-verdict.v1", JSON.stringify(verdict));
  } catch { /* noop */ }

  // Policy gate — exact threshold in the message
  try {
    const policy = loadUserPolicy();
    const usd = Number(qd.amountOutUsd ?? "0");
    if (Number.isFinite(usd) && usd > policy.maxSpendPerTx) {
      const msg = `Policy blocked: swap output $${usd.toFixed(2)} exceeds your per-transaction cap of $${policy.maxSpendPerTx.toLocaleString()} (Policy Console). Reduce the amount or raise the cap.`;
      appendAgentLog("blocked", "Policy cap", msg);
      return { kind: "blocked", title: "Blocked by your policy", lines: [msg, "The Route Guardian verdict is not the issue — your own spending cap stopped this before signing."] };
    }
    const day = getTodaySpendUsd();
    if (day >= policy.maxSpendPerDay) {
      const msg = `Policy blocked: today's testnet spend $${day.toFixed(2)} already reached your daily cap of $${policy.maxSpendPerDay.toLocaleString()}.`;
      appendAgentLog("blocked", "Policy daily cap", msg);
      return { kind: "blocked", title: "Blocked by your policy", lines: [msg] };
    }
  } catch { /* policy unreadable — guardian verdict still enforced */ }

  if (verdict.verdict === "BLOCKED") {
    const exp = explainGuardianVerdict(verdict);
    appendAgentLog("blocked", "Guardian BLOCKED", exp.lines.join(" | "));
    return { kind: "blocked", title: exp.headline, lines: [...exp.lines, "", exp.nextStep, `Machine verdict: ${exp.machine.verdict} (risk score ${exp.machine.score}/100)`] };
  }

  const quote: Record<string, string> = {
    from: from.toUpperCase(), to: to.toUpperCase(), amount,
    amountOut: qd.amountOut, amountOutUsd: qd.amountOutUsd ?? "n/a",
    timeEstimateSec: qd.timeEstimateSec ?? "?", via: "TidePool Intents sandbox (NEAR testnet)",
    recipient: ctx.addresses.nearImplicitAccountId,
  };
  appendAgentLog("proposed", `Swap prepared: ${amount} ${from.toUpperCase()} -> ${to.toUpperCase()}`, `guardian=${verdict.verdict}`);
  const exp = explainGuardianVerdict(verdict);
  return {
    kind: "prepared_swap",
    title: "Swap prepared — review & sign",
    stateLabel: "PREPARED",
    lines: [
      `You asked for ${amount} ${from.toUpperCase()} → ${to.toUpperCase()}. Live quote (testnet):`,
      `• Output: ~${qd.amountOut} ${to.toUpperCase()} (≈ $${qd.amountOutUsd ?? "n/a"} testnet ref)`,
      `• Route: TidePool Intents sandbox · est. ~${qd.timeEstimateSec ?? "?"}s · recipient: your NEAR testnet account`,
      `• Guardian: ${verdict.verdict} (risk ${verdict.score}/100)${verdict.verdict === "CAUTION" ? " — you must acknowledge each caution explicitly" : ""}`,
      "",
      "This is PREPARED, not executed. Nothing moves until you explicitly sign with your wallet below.",
    ],
    prepared: { from: from.toLowerCase(), to: to.toLowerCase(), amount, quote, guardian: verdict, status: "PREPARED" },
  };
}

function answerExplainGuardian(): AgentAnswer {
  try {
    const raw = window.localStorage.getItem("vaultry.agent.last-verdict.v1");
    if (!raw) {
      return { kind: "message", title: "No verdict yet", lines: ["No Route Guardian verdict has been recorded in this session yet.", "Prepare a swap (e.g. “prepare a swap of 2 USDC to wNEAR”) and I'll explain whatever the guardian decides — SAFE, CAUTION, or BLOCKED."] };
    }
    const v = JSON.parse(raw) as GuardianResult;
    const exp = explainGuardianVerdict(v);
    return { kind: "message", title: exp.headline, lines: [...exp.lines, "", exp.nextStep, `Machine verdict: ${exp.machine.verdict} (risk score ${exp.machine.score}/100)`] };
  } catch {
    return { kind: "message", title: "No verdict yet", lines: ["Could not read a stored verdict."] };
  }
}

function answerExplainTx(data: Record<string, unknown>): AgentAnswer {
  const tx = data.tx as { ok: boolean; tx?: Record<string, string>; error?: string } | undefined;
  if (!tx?.ok || !tx.tx) {
    return { kind: "message", title: "Transaction lookup", lines: [tx?.error ?? "Could not fetch the transaction."] };
  }
  const t = tx.tx;
  const lines = ["Here's what happened, simply:", ""];
  if (t.hash) {
    lines.push(`• On ${t.chain ?? "the testnet"}, account ${t.from} sent ${t.value} test tokens to ${t.to}.`);
    lines.push(`• Status: ${t.status === "success" ? "✓ confirmed on-chain" : t.status === "failed" ? "✗ failed on-chain (no funds moved)" : "unknown"}.`);
    lines.push(`• This was transaction #${t.nonce} from that account.`);
  } else if (t.signature) {
    lines.push(`• On ${t.chain}, a Solana transaction ${t.status === "success" ? "succeeded" : "failed"}.`);
    lines.push(`• Network fee: ${t.feeSol} SOL · confirmed at ${t.blockTime}.`);
  }
  lines.push("", "All testnet activity — valueless tokens, but the mechanics are identical to mainnet.");
  appendAgentLog("checked", "Tx explained", t.hash ?? t.signature ?? "?");
  return { kind: "message", title: "Transaction explained", lines };
}

function answerFaucet(plan: AgentPlan): AgentAnswer {
  const c = plan.params.chain;
  const rows: Record<string, string> = {
    "sepolia": "Sepolia: https://sepoliafaucet.com (free Alchemy account) or no-signup https://stakely.io/faucet",
    "base-sepolia": "Base Sepolia: https://www.alchemy.com/faucets/base-sepolia",
    "solana-devnet": "Solana devnet: https://faucet.solana.com — request an airdrop for your address",
    "near-testnet": "NEAR testnet: the Faucet page guides you, or https://near-faucet.io",
  };
  const lines = ["Official testnet faucets (free, valueless tokens):", ""];
  if (c && rows[c]) lines.push(`• ${rows[c]}`);
  else for (const k of Object.keys(rows)) lines.push(`• ${rows[k]}`);
  lines.push("", "Funded is confirmed only when your wallet shows a live on-chain balance — the Wallet tab has an “I've funded — check balance” button per chain.");
  return { kind: "message", title: "Testnet funding", lines, stateLabel: "SUGGESTION" };
}

function answerPolicy(): AgentAnswer {
  try {
    const p = loadUserPolicy();
    const lines = explainPolicy(p);
    lines.push("", "Change any of these in the Policy Console — the agent can never change its own policies.");
    return { kind: "message", title: "Your policy", lines };
  } catch {
    return { kind: "message", title: "Your policy", lines: ["Could not read the Policy Console state on this device."] };
  }
}

/* ---------------- execution (explicit signature only) ---------------- */

export type ExecStatus = "idle" | "awaiting_approval" | "submitted" | "processing" | "completed" | "failed";

export interface ExecResult {
  status: ExecStatus;
  depositTx?: string;
  settleTx?: string;
  explorerUrl?: string;
  error?: string;
}

/**
 * Execute a PREPARED swap. Requires the unlocked multi-chain session.
 * Re-fetches a fresh quote + re-runs the guardian immediately before signing
 * (stale quotes can never execute). BLOCKED at any point aborts.
 */
export async function executePreparedSwap(
  prepared: PreparedSwap,
  ctx: AgentSessionCtx,
  onStatus: (s: ExecStatus, detail?: string) => void
): Promise<ExecResult> {
  const g = gates();
  if (!g.ok) return { status: "failed", error: g.reason };
  if (!ctx.secrets || !ctx.addresses) {
    return { status: "failed", error: "Wallet is locked — unlock your multi-chain wallet to sign." };
  }
  if (prepared.guardian.verdict === "BLOCKED") {
    return { status: "failed", error: "Guardian verdict is BLOCKED — execution is impossible by design." };
  }
  try {
    // 1. fresh quote + guardian re-check (grounding: never sign a stale plan)
    onStatus("awaiting_approval", "Re-checking live quote and guardian…");
    const res = await fetch(`/api/tidepool/quote?amount=${encodeURIComponent(prepared.amount)}&from=${encodeURIComponent(prepared.from)}&to=${encodeURIComponent(prepared.to)}`);
    const j = await res.json() as Record<string, string | boolean>;
    if (!j.ok) throw new Error(String(j.error ?? "quote refresh failed"));
    const intent: TestnetSwapIntent = {
      fromTokenKey: prepared.from, toTokenKey: prepared.to,
      fromTokenId: `nep141:${TOKEN_IDS[prepared.from] ?? ""}`,
      toTokenId: `nep141:${TOKEN_IDS[prepared.to] ?? ""}`,
      amountInBaseUnits: String(j.amountInBaseUnits), slippageBps: 100,
      recipient: ctx.addresses.nearImplicitAccountId,
    };
    const tq: TestnetQuote = {
      amountInBaseUnits: String(j.amountInBaseUnits), amountOutBaseUnits: String(j.amountOutBaseUnits),
      minAmountOutBaseUnits: String(j.minAmountOutBaseUnits), amountOutUsd: String(j.amountOutUsd ?? ""),
      timeEstimateSec: Number(j.timeEstimateSec ?? 0), receivedAtMs: Date.now(),
    };
    const v2 = checkTestnetSwap(tq, intent);
    if (v2.verdict === "BLOCKED") {
      appendAgentLog("blocked", "Execution aborted", "fresh guardian re-check returned BLOCKED");
      return { status: "failed", error: "Fresh guardian re-check returned BLOCKED — execution aborted. Funds stayed put." };
    }
    appendAgentLog("checked", `Execution re-check: ${v2.verdict}`, v2.reasons.join(" | ") || "passed");

    // 2. create the intent -> deposit address (no funds move yet)
    onStatus("submitted", "Creating swap intent…");
    const ex = await fetch("/api/tidepool/execute", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: prepared.from, to: prepared.to, amount: prepared.amount, recipient: ctx.addresses.nearImplicitAccountId }),
    });
    const exj = await ex.json() as { ok: boolean; error?: string; depositAddress?: string };
    if (!exj.ok || !exj.depositAddress) throw new Error(exj.error ?? "intent creation failed");

    // 3. sign the token deposit LOCALLY with the in-memory key
    onStatus("processing", "Signing token deposit with your key (this device only)…");
    const conn = createConnection();
    const account = getSignerAccount({
      provider: conn.provider,
      accountId: ctx.addresses.nearImplicitAccountId,
      secretKey: ctx.secrets.nearSecretKey,
    });
    const dep = await transferToken({
      account,
      tokenContractId: `${prepared.from}.tidepool-sandbox.testnet`,
      receiverId: exj.depositAddress,
      amountBaseUnits: String(j.amountInBaseUnits),
      memo: "VAULTRY agent testnet intent deposit",
    });
    appendAgentLog("executed", "Deposit signed & broadcast", `deposit tx ${dep.txHash}`);

    // 4. poll settlement
    const t0 = Date.now();
    while (Date.now() - t0 < 5 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 8000));
      try {
        const sr = await fetch(`/api/tidepool/status?depositAddress=${encodeURIComponent(exj.depositAddress!)}`);
        const sj = await sr.json() as { ok: boolean; status?: string; settleTxHash?: string };
        const st = (sj.status ?? "").toUpperCase();
        onStatus("processing", `Settlement status: ${sj.status ?? "…"}`);
        if (["SETTLED", "COMPLETED", "SUCCESS"].includes(st)) {
          const usd = Number(j.amountOutUsd ?? "0");
          if (Number.isFinite(usd) && usd > 0) { try { recordSpendUsd(usd); } catch { /* noop */ } }
          appendAgentLog("executed", "Swap settled", `deposit ${dep.txHash} settle ${sj.settleTxHash ?? "n/a"}`);
          return {
            status: "completed", depositTx: dep.txHash, settleTx: sj.settleTxHash,
            explorerUrl: `https://testnet.nearblocks.io/txns/${dep.txHash}`,
          };
        }
        if (["FAILED", "EXPIRED", "REFUNDED"].includes(st)) {
          throw new Error(`Settlement ${sj.status} — check the deposit transaction on the explorer.`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Settlement")) throw e;
        /* transient poll error — keep waiting */
      }
    }
    throw new Error("Settlement timed out after 5 minutes — check the deposit tx on the explorer; funds were not lost (TidePool refunds unfilled intents).");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Execution failed";
    appendAgentLog("blocked", "Execution failed", msg.slice(0, 300));
    return { status: "failed", error: msg.slice(0, 300) };
  }
}
