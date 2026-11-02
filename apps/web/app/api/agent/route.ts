/**
 * POST /api/agent — VAULTRY Agentic Wallet brain (TESTNET ONLY).
 *
 * SECURITY CONTRACT:
 * - The request carries ONLY: the user's typed command + PUBLIC context
 *   (wallet addresses, no keys). This route NEVER receives, reads, or logs
 *   private keys, seed phrases, or signing credentials.
 * - The LLM (optional, via the local zro_bridge.py) receives the same public
 *   context only. It returns a STRICT plan that is schema-validated; anything
 *   else is rejected and the deterministic parser's result is used instead.
 * - Grounding rule: the response's `data` contains ONLY facts fetched live in
 *   this request (balances, quotes, token lists, tx lookups). The client
 *   executor rejects plans referencing unfetched data.
 * - On hosts without the connector (e.g. Vercel), the bridge fails honestly
 *   and the deterministic parser serves every intent — the agent still works.
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { parseCommand, type AgentPlan, KNOWN_TOKENS } from "../../../lib/agent/intent";
import {
  getChainBalance,
  getChainHistory,
  evmHasCode,
  evmGetTransaction,
  solanaGetTransaction,
  tidepoolQuote,
  tidepoolTokens,
} from "../../../lib/wallet/chains-server";
import { CORE_CHAINS, TESTNET_SWAP_ROUTES, getChain } from "../../../lib/wallet/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BRIDGE = path.join(process.cwd(), "app", "api", "agent", "zro_bridge.py");
const BRIDGE_TIMEOUT_MS = 45_000;

interface AgentAddresses {
  evmAddress?: string;
  solanaAddress?: string;
  nearImplicitAccountId?: string;
}

/* ---------------- LLM bridge (optional enhancement) ---------------- */

function runBridge(prompt: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("python3", [BRIDGE], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : "spawn failed" });
      return;
    }
    let stdout = "";
    let settled = false;
    const done = (r: { ok: boolean; text?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* noop */ }
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, error: "bridge timeout" }), BRIDGE_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); done({ ok: false, error: "bridge spawn error" }); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(stdout) as { ok: boolean; text?: string; error?: string };
        done(j.ok ? { ok: true, text: j.text } : { ok: false, error: j.error });
      } catch {
        done({ ok: false, error: "bridge returned invalid JSON" });
      }
    });
    try {
      child.stdin.write(JSON.stringify({ prompt, model: "zro/glm-5.3-flash", max_tokens: 900 }));
      child.stdin.end();
    } catch {
      done({ ok: false, error: "bridge stdin failed" });
    }
  });
}

const KNOWN_INTENTS = ["portfolio", "token_research", "swap_research", "swap_prepare", "explain_guardian", "explain_tx", "faucet_guide", "policy_status", "help"];

function tryParseLlmPlan(text: string): AgentPlan | null {
  try {
    // tolerate code fences
    const clean = text.replace(/```json|```/g, "").trim();
    const j = JSON.parse(clean) as { intent?: string; params?: Record<string, string>; summary?: string; confidence?: number };
    if (!j.intent || !KNOWN_INTENTS.includes(j.intent)) return null;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.params ?? {})) {
      if (typeof v === "string" && v.length < 200) params[k] = v;
    }
    return {
      intent: j.intent as AgentPlan["intent"],
      params,
      summary: typeof j.summary === "string" ? j.summary.slice(0, 500) : "",
      confidence: typeof j.confidence === "number" ? Math.min(Math.max(j.confidence, 0), 1) : 0.6,
    };
  } catch {
    return null;
  }
}

function llmPrompt(command: string, det: AgentPlan, facts: string): string {
  return `You are the VAULTRY DeFi assistant (NEAR hackathon, TESTNET ONLY — all tokens valueless).
The user typed: "${command}"
The system already determined: intent=${det.intent}, params=${JSON.stringify(det.params)}.
GROUNDED FACTS fetched live (the ONLY facts you may mention):
${facts}
Your job: REPHRASE the summary below in clear, friendly plain language. Do NOT change the intent or params. Do NOT mention any number, address, quote, or status not present in the grounded facts above. If facts show an error, state it plainly.
Current summary: "${det.summary}"
Return ONLY strict JSON (no prose, no fences): {"intent": "${det.intent}", "params": ${JSON.stringify(det.params)}, "summary": "your rephrased summary", "confidence": ${det.confidence}}`;
}

/* ---------------- grounding ---------------- */

async function ground(plan: AgentPlan, addrs: AgentAddresses): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  switch (plan.intent) {
    case "portfolio": {
      const balances: Record<string, unknown>[] = [];
      const jobs: [string, string][] = [];
      if (addrs.evmAddress) { jobs.push(["sepolia", addrs.evmAddress], ["base-sepolia", addrs.evmAddress]); }
      if (addrs.solanaAddress) jobs.push(["solana-devnet", addrs.solanaAddress]);
      if (addrs.nearImplicitAccountId) jobs.push(["near-testnet", addrs.nearImplicitAccountId]);
      const results = await Promise.all(jobs.map(([c, a]) => getChainBalance(c, a)));
      jobs.forEach(([c], i) => {
        const chain = getChain(c)!;
        balances.push({ chain: chain.testnetName, ...results[i] });
      });
      data.balances = balances;
      data.hasWallet = jobs.length > 0;
      // recent history per chain (best effort)
      const histJobs = jobs.slice(0, 4);
      const hists = await Promise.all(histJobs.map(([c, a]) => getChainHistory(c, a, 5)));
      data.recentHistory = histJobs.map(([c], i) => ({ chain: getChain(c)!.testnetName, ...hists[i] }));
      break;
    }
    case "token_research": {
      const { contract, token, chain } = plan.params;
      const reg = await tidepoolTokens();
      data.registry = reg;
      if (token) {
        const t = (KNOWN_TOKENS as readonly string[]).includes(token.toLowerCase());
        data.tokenKnown = t;
        if (t && reg.ok) {
          data.registryMatch = (reg.tokens ?? []).filter((r) =>
            r.symbol.toLowerCase().includes(token.toLowerCase())
          );
        }
      }
      if (contract) {
        const c = chain === "base-sepolia" ? "base-sepolia" : "sepolia";
        if (/^0x[0-9a-fA-F]{40}$/.test(contract)) {
          data.contractCode = await evmHasCode(c, contract);
          data.contractChain = getChain(c)!.testnetName;
        } else {
          data.contractCode = { ok: false, error: "Not a recognized EVM contract address format" };
        }
        data.verdict = "UNCERTAIN";
        data.note =
          "Testnet token contracts are not audited. A contract with deployed code is not proof of legitimacy — " +
          "on testnet, treat every unknown contract as experimental. Never send real funds anywhere.";
      }
      break;
    }
    case "swap_research":
    case "swap_prepare": {
      const { from, to, amount } = plan.params;
      const amt = Number(amount) || 1;
      if (from && to) {
        const q = await tidepoolQuote(from.toLowerCase(), to.toLowerCase(), Math.min(amt, 10000));
        data.quote = q;
        data.routes = q.ok
          ? [{ via: "TidePool Intents sandbox", status: "live", note: "The only genuine testnet route for this pair." }]
          : TESTNET_SWAP_ROUTES.filter((r) => r.status === "unsupported").map((r) => ({
              from: r.from, to: r.to, status: r.status, note: r.note,
            }));
      } else {
        data.routes = TESTNET_SWAP_ROUTES;
      }
      break;
    }
    case "explain_tx": {
      const { hash, chain } = plan.params;
      if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) {
        const c = chain === "base-sepolia" ? "base-sepolia" : "sepolia";
        data.tx = await evmGetTransaction(c, hash);
      } else if (hash && hash.length >= 80) {
        data.tx = await solanaGetTransaction(hash);
      } else {
        data.tx = { ok: false, error: "No recognizable transaction hash in the command. Paste an EVM tx hash (0x…) or Solana signature." };
      }
      break;
    }
    default:
      break;
  }
  data.supportedChains = CORE_CHAINS.map((c) => c.testnetName);
  return data;
}

/* ---------------- handler ---------------- */

export async function POST(req: NextRequest) {
  let body: { command?: string; addresses?: AgentAddresses };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const command = String(body.command ?? "").slice(0, 1000).trim();
  if (!command) {
    return NextResponse.json({ ok: false, error: "Empty command" }, { status: 400 });
  }
  const addresses: AgentAddresses = body.addresses ?? {};

  // 1. deterministic parse (always runs — the reliable core)
  const det = parseCommand(command);

  // 2. ground with live data
  const data = await ground(det, addresses);

  // 3. optional LLM rephrase into the same strict schema.
  // HARD RULE (grounding): the LLM may ONLY rephrase the summary. Intent and
  // params must equal the deterministic parse exactly — the model can never
  // invent a new action kind or new entities. Verified live 2026-11-03 that
  // the model otherwise escalates/downgrades intents non-deterministically.
  let plan: AgentPlan = det;
  let source: "deterministic" | "llm" = "deterministic";
  if (det.confidence >= 0.5 && det.confidence < 0.95) {
    const facts = JSON.stringify(data).slice(0, 6000);
    const br = await runBridge(llmPrompt(command, det, facts));
    if (br.ok && br.text) {
      const lp = tryParseLlmPlan(br.text);
      if (lp && lp.intent === det.intent && JSON.stringify(lp.params) === JSON.stringify(det.params)) {
        plan = { ...lp, summary: lp.summary || det.summary };
        source = "llm";
      }
    }
  }

  return NextResponse.json({ ok: true, plan, source, data, network: "testnet" });
}
