/**
 * VAULTRY agent — deterministic natural-language intent parser.
 *
 * This parser is the RELIABLE core of the NL interface: it works with zero
 * external dependencies (no LLM needed), so the agent functions on every
 * host including Vercel. The optional LLM layer (via /api/agent) only
 * rephrases into this same strict plan schema — it can never invent a new
 * action kind.
 *
 * Supported intents (all testnet-only):
 *  - portfolio        "show my testnet portfolio / balances / transaction history"
 *  - token_research   "research this token" / "is this contract suspicious"
 *  - swap_research    "find the safest swap route" / "compare swap providers"
 *  - swap_prepare     "prepare a cross-chain swap" (quote+guardian+policy, then explicit sign)
 *  - explain_guardian "why did guardian block this"
 *  - explain_tx       "explain my transaction in simple language"
 *  - faucet_guide     "how do I fund / get testnet tokens"
 *  - policy_status    "show my policy / spending limits"
 *  - help             anything unrecognized -> honest help, never a guess
 */

export type AgentIntent =
  | "portfolio"
  | "token_research"
  | "swap_research"
  | "swap_prepare"
  | "explain_guardian"
  | "explain_tx"
  | "faucet_guide"
  | "policy_status"
  | "help";

export interface AgentPlan {
  intent: AgentIntent;
  /** extracted entities — always validated before use */
  params: Record<string, string>;
  /** what the parser understood, in plain words */
  summary: string;
  /** 0..1 — below 0.5 the executor asks for clarification instead of acting */
  confidence: number;
}

/** TidePool testnet tokens the agent can actually quote. */
export const KNOWN_TOKENS = ["usdc", "usdt", "wnear", "wbtc", "eth"] as const;

const CHAIN_ALIASES: Record<string, string> = {
  sepolia: "sepolia",
  ethereum: "sepolia",
  "eth sepolia": "sepolia",
  base: "base-sepolia",
  "base sepolia": "base-sepolia",
  solana: "solana-devnet",
  "solana devnet": "solana-devnet",
  sol: "solana-devnet",
  near: "near-testnet",
  "near testnet": "near-testnet",
};

function extractAddresses(text: string): { evm: string[]; solana: string[]; near: string[] } {
  const evm = [...text.matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0]);
  const b58 = [...text.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)].map((m) => m[0]);
  const hex64 = [...text.matchAll(/\b[0-9a-f]{64}\b/g)].map((m) => m[0]);
  const named = [...text.matchAll(/\b[a-z0-9][a-z0-9\-_.]{1,62}\.testnet\b/gi)].map((m) => m[0].toLowerCase());
  // base58 regex also matches hex64 — dedupe
  const solana = b58.filter((a) => !hex64.includes(a));
  return { evm, solana, near: [...hex64, ...named] };
}

function extractAmount(text: string): string | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(usdc|usdt|wnear|wbtc|eth|near|sol)?/i);
  return m ? m[1] : null;
}

function extractTokens(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  return (KNOWN_TOKENS as readonly string[]).filter((t) => lower.includes(t));
}

function extractChain(text: string): string | null {
  const lower = text.toLowerCase();
  const keys = Object.keys(CHAIN_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) if (lower.includes(k)) return CHAIN_ALIASES[k];
  return null;
}

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

export function parseCommand(raw: string): AgentPlan {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (!text) {
    return { intent: "help", params: {}, summary: "Empty command.", confidence: 1 };
  }

  // ---- explain my transaction -------------------------------------------
  if (has(lower, "explain my transaction", "explain this transaction", "what happened in", "explain tx", "simple language")) {
    const addrs = extractAddresses(text);
    const hash = addrs.evm[0] ?? addrs.solana[0] ?? addrs.near[0] ?? "";
    // tx hashes: evm 0x+64hex, solana base58 sig, near base58-ish — reuse address extractors loosely
    const txm = text.match(/0x[0-9a-fA-F]{64}/) ?? text.match(/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/);
    return {
      intent: "explain_tx",
      params: { hash: txm?.[0] ?? hash, chain: extractChain(text) ?? "" },
      summary: txm?.[0] ?? hash
        ? `Explain transaction ${(txm?.[0] ?? hash).slice(0, 16)}… in simple language.`
        : "Explain a transaction — but no transaction hash was found in the command.",
      confidence: txm?.[0] ?? hash ? 0.9 : 0.4,
    };
  }

  // ---- why did guardian block --------------------------------------------
  if (has(lower, "why did guardian block", "why was this blocked", "guardian blocked", "explain the block", "blocked this")) {
    return {
      intent: "explain_guardian",
      params: {},
      summary: "Explain the last Route Guardian verdict in plain language.",
      confidence: 0.85,
    };
  }

  // ---- swap research (before prepare: "safest route" is research, not execution)
  if (has(lower, "safest", "compare", "providers", "best route", "route")) {
    const tokens = extractTokens(text);
    const amount = extractAmount(text) ?? "1";
    if (tokens.length >= 2) {
      const ordered = [...tokens].sort((a, b) => lower.indexOf(a) - lower.indexOf(b));
      return {
        intent: "swap_research",
        params: { from: ordered[0], to: ordered[1], amount },
        summary: `Research the safest testnet route for ${amount} ${ordered[0].toUpperCase()} → ${ordered[1].toUpperCase()} from real quotes.`,
        confidence: 0.85,
      };
    }
    return {
      intent: "swap_research",
      params: { from: tokens[0] ?? "", to: tokens[1] ?? "", amount },
      summary: "Compare swap routes — tell me the pair, e.g. “safest route USDC to wNEAR”.",
      confidence: 0.45,
    };
  }

  // ---- prepare a swap (explicit preparation verbs only) ----------------------
  if (has(lower, "prepare a swap", "prepare swap", "prepare a cross-chain swap", "cross-chain swap", "make a swap", "execute a swap", "do a swap")) {
    const tokens = extractTokens(text);
    const amount = extractAmount(text);
    if (tokens.length >= 2 && amount) {
      const ordered = [...tokens].sort((a, b) => lower.indexOf(a) - lower.indexOf(b));
      return {
        intent: "swap_prepare",
        params: { from: ordered[0], to: ordered[1], amount },
        summary: `Prepare a testnet swap of ${amount} ${ordered[0].toUpperCase()} → ${ordered[1].toUpperCase()} (quote + guardian + policy, then your explicit signature).`,
        confidence: 0.9,
      };
    }
    return {
      intent: "swap_prepare",
      params: {},
      summary: "Prepare a swap — but I need the pair and amount, e.g. “prepare a swap of 2 USDC to wNEAR”.",
      confidence: 0.4,
    };
  }

  // ---- token research ---------------------------------------------------------
  if (has(lower, "research", "suspicious", "is this token", "check this token", "contract", "looks legit", "scam")) {
    const addrs = extractAddresses(text);
    const contract = addrs.evm[0] ?? addrs.solana[0] ?? addrs.near[0] ?? "";
    const tokens = extractTokens(text);
    return {
      intent: "token_research",
      params: { contract, token: tokens[0] ?? "", chain: extractChain(text) ?? "" },
      summary: contract
        ? `Research contract ${contract.slice(0, 16)}… against real sources.`
        : tokens[0]
          ? `Research test token ${tokens[0].toUpperCase()} from the live registry.`
          : "Research a token — paste a contract address or token name.",
      confidence: contract || tokens[0] ? 0.85 : 0.4,
    };
  }

  // ---- policy (before portfolio: "show my spending limits" is policy, not portfolio)
  if (has(lower, "policy", "spending limit", "limits", "my rules", "permissions")) {
    return {
      intent: "policy_status",
      params: {},
      summary: "Show the Policy Console state: pause, spending limits, permissions.",
      confidence: 0.9,
    };
  }

  // ---- portfolio --------------------------------------------------------------
  if (has(lower, "portfolio", "my balances", "show my", "balances", "transaction history", "my history", "holdings")) {
    return {
      intent: "portfolio",
      params: {},
      summary: "Show live testnet portfolio balances and recent transaction history.",
      confidence: 0.9,
    };
  }

  // ---- faucet -------------------------------------------------------------------
  if (has(lower, "faucet", "fund", "get testnet", "test tokens", "no balance", "empty wallet", "top up")) {
    return {
      intent: "faucet_guide",
      params: { chain: extractChain(text) ?? "" },
      summary: "Guide to funding a testnet wallet from official faucets.",
      confidence: 0.85,
    };
  }

  // ---- fallback: honest help ---------------------------------------------------------
  return {
    intent: "help",
    params: {},
    summary:
      "I can: show your testnet portfolio · research a token contract · find the safest swap route · " +
      "prepare a testnet swap (you always sign explicitly) · explain a guardian verdict · explain a " +
      "transaction simply · guide testnet funding · show your policy. Try: “prepare a swap of 2 USDC to wNEAR”.",
    confidence: 1,
  };
}
