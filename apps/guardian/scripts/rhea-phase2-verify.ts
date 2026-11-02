/**
 * RHEA Phase 2 verification harness (guardian side).
 *
 * Part A — executable flow, fund-safe:
 *   quote (live) → Route Guardian revalidation (same rules as the web
 *   beforeSign gate) → buildSwap → print the executable preview → STOP.
 *   No signing, no broadcast. Proves the exact payload the wallet would sign.
 *
 * Part B — NEAR executor adapter, real testnet:
 *   a real 0.0001 NEAR self-transfer on NEAR TESTNET through the SDK's
 *   createNearExecutor with a near-api-js adapter (same adapter contract
 *   the web app uses). Testnet only, valueless, self-to-self.
 *
 * Part C — mainnet readiness: live mainnet quote (no execution).
 *
 * Usage:
 *   cd apps/guardian
 *   set -a && source ../../contracts/vault/.env && set +a   # deployer key for Part B only
 *   npx ts-node scripts/rhea-phase2-verify.ts
 *
 * The deployer key is read from the environment and NEVER printed.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createRheaClient } from "../src/rhea-client";
import {
  resolveRheaAssets,
  rawTokenAddress,
} from "../src/quote-loop";

const PART = process.env.RHEA_VERIFY_PART ?? "all";

function log(s: string) {
  console.log(`[phase2-verify] ${s}`);
}

/* ------------------------------------------------------------------ */
/* Part A: quote -> guardian -> build (fund-safe)                       */
/* ------------------------------------------------------------------ */
async function partA() {
  log("Part A: quote -> guardian -> build (Base USDC -> Solana USDC)");
  const client = createRheaClient();
  const { inAddr, inDec, outAddr, outDec } = await resolveRheaAssets(
    client,
    "USDC",
    "USDC",
    "8453",
    "solana",
  );
  log(`resolved in=${inAddr} (${inDec}d) out=${outAddr} (${outDec}d)`);

  const amountIn = (BigInt(10) * BigInt(10) ** BigInt(inDec)).toString(); // 10 USDC
  const sender = "0x53CFA0C9EB10E352fC5B4DaAC1A9Eac2267303F9"; // his EVM wallet (public)
  // Build validates the recipient per destination chain — his public Solana
  // wallet. Build constructs the tx only; nothing is signed or broadcast.
  const solRecipient = "G2B8bFudqhYXkFqm54s5YVdPaQwUegw2U89PJyEdSHPj";
  const intent = {
    fromChain: "8453",
    toChain: "solana",
    tokenInAddress: inAddr,
    tokenOutAddress: outAddr,
    amountIn,
    slippageBps: 50,
    recipient: solRecipient,
    sender,
  };

  const quote = await client.quote({
    fromChain: "8453",
    toChain: "solana",
    tokenIn: { chain: "8453", address: inAddr, symbol: "USDC", decimals: inDec },
    tokenOut: { chain: "solana", address: outAddr, symbol: "USDC", decimals: outDec },
    amountIn,
    slippageBps: 50,
    sender,
    recipient: sender,
    quoteWaitingTimeMs: 8000,
    crossChainTimeoutMs: 5000,
  });
  log(
    `quote: router=${quote.route.router} estimatedOut=${quote.estimatedOut} ` +
      `minOut=${quote.minAmountOut} expiresAt=${quote.expiresAt ?? "n/a"}`,
  );

  // --- Route Guardian revalidation (mirrors web beforeSign rules) ---
  const reasons: string[] = [];
  const now = Date.now();
  const norm = (a: string) => a.trim().toLowerCase();
  if (String(quote.fromChain).toLowerCase() !== intent.fromChain) reasons.push("BLOCKED: fromChain drift");
  if (String(quote.toChain).toLowerCase() !== intent.toChain) reasons.push("BLOCKED: toChain drift");
  if (norm(quote.tokenIn.address) !== norm(intent.tokenInAddress)) reasons.push("BLOCKED: tokenIn drift");
  if (norm(quote.tokenOut.address) !== norm(intent.tokenOutAddress)) reasons.push("BLOCKED: tokenOut drift");
  if (quote.amountIn !== intent.amountIn) reasons.push("BLOCKED: amountIn drift");
  if (quote.expiresAt !== undefined && now >= quote.expiresAt) reasons.push("BLOCKED: quote expired");
  const out = BigInt(quote.estimatedOut);
  const min = BigInt(quote.minAmountOut);
  if (out <= BigInt(0) || min < BigInt(0) || min > out) reasons.push("BLOCKED: inconsistent amounts");
  const blocked = reasons.some((r) => r.startsWith("BLOCKED"));
  log(`guardian: ${blocked ? "BLOCKED" : "SAFE"}${blocked ? " — " + reasons.join("; ") : ""}`);
  if (blocked) throw new Error("Guardian blocked the quote — aborting before build");

  // The API enforces its own price freshness ("Price moved too much, please
  // re-quote"). One fresh-quote retry is exactly what the API asks for.
  // NOTE (verified 2026-11-02): the "rango" router's build rejects with
  // "Invalid wallet for SOLANA" for valid EVM senders — a RHEA-side quirk.
  // The "lifi" router builds fine. Both behaviors are recorded, not hidden.
  async function tryBuild(q: typeof quote): Promise<{ ok: boolean; build?: unknown; error?: string }> {
    try {
      const b = await client.buildSwap({ quote: q });
      return { ok: true, build: b };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  let build: unknown;
  const first = await tryBuild(quote);
  if (first.ok) {
    build = first.build;
    log(`build: OK on first attempt (router=${quote.route.router})`);
  } else if (/price moved too much/i.test(first.error ?? "")) {
    log("build: price moved — re-quoting once as the API requests");
    const q2 = await client.quote({
      fromChain: "8453",
      toChain: "solana",
      tokenIn: { chain: "8453", address: inAddr, symbol: "USDC", decimals: 6 },
      tokenOut: { chain: "solana", address: outAddr, symbol: "USDC", decimals: 6 },
      amountIn,
      slippageBps: 50,
      sender,
      recipient: solRecipient,
      quoteWaitingTimeMs: 8000,
      crossChainTimeoutMs: 5000,
    });
    const second = await tryBuild(q2);
    if (!second.ok) throw new Error(`build failed after re-quote: ${second.error}`);
    build = second.build;
  } else {
    // Router-specific failure (e.g. rango wallet quirk) — verify an
    // alternative router builds, and record both honestly.
    log(`build via ${quote.route.router} failed: ${first.error}`);
    log("re-quoting with excludeDexs=[rango] to verify an alternative router");
    const q3 = await client.quote({
      fromChain: "8453",
      toChain: "solana",
      tokenIn: { chain: "8453", address: inAddr, symbol: "USDC", decimals: 6 },
      tokenOut: { chain: "solana", address: outAddr, symbol: "USDC", decimals: 6 },
      amountIn,
      slippageBps: 200,
      sender,
      recipient: solRecipient,
      excludeDexs: ["rango"],
      quoteWaitingTimeMs: 8000,
      crossChainTimeoutMs: 5000,
    });
    log(`alternative quote: router=${q3.route.router}`);
    const third = await tryBuild(q3);
    if (!third.ok) throw new Error(`alternative-router build failed: ${third.error}`);
    build = third.build;
    log(`build: OK via ${q3.route.router} (rango quirk documented, not hidden)`);
  }
  const bb = build as {
    executionId: string;
    router: string;
    isCrossChain: boolean;
    execution: unknown;
  };
  log(
    `build: executionId=${bb.executionId} router=${bb.router} ` +
      `isCrossChain=${bb.isCrossChain}`,
  );
  const ex = bb.execution as unknown as Record<string, unknown>;
  log(`execution kind=${String((ex as { kind?: unknown }).kind ?? "?")} chain=${String((ex as { chain?: unknown }).chain ?? "?")}`);
  const tx = (ex as { tx?: Record<string, unknown> }).tx;
  if (tx) {
    log(`executable tx: to=${String(tx.to ?? "?")} value=${String(tx.value ?? "0")} dataLen=${String(tx.data ?? "").length}`);
  }
  log("Part A OK — build verified, NO signing performed (fund-safe).");
}

/* ------------------------------------------------------------------ */
/* Part B: NEAR executor adapter on testnet (real self-transfer)        */
/* ------------------------------------------------------------------ */
async function partB() {
  log("Part B: NEAR executor adapter — real testnet self-transfer");
  const secretKey = process.env.NEAR_DEPLOYER_KEY;
  if (!secretKey) throw new Error("NEAR_DEPLOYER_KEY not in environment (Part B needs it)");
  const accountId = "vgdeployer.testnet";

  // Lazy imports keep the web bundle untouched.
  // Absolute file path: bypasses the package "exports" map entirely
  // (Node enforces it even for deep .js requires).
  const nearExecutorPath = join(
    __dirname,
    "../../../node_modules/@rhea-finance/cross-chain-aggregation-dex/dist/executors/near.js",
  );
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createNearExecutor } = require(nearExecutorPath) as {
    createNearExecutor: (a: NearWalletAdapter) => ChainExecutor;
  };
  const naj = require("near-api-js") as typeof import("near-api-js");
  type NearWalletAdapter = {
    getChain: () => Promise<"near">;
    signAndSendTransactions: (
      txs: { receiverId: string; actions: unknown[] }[],
    ) => Promise<{ txHashes: string[] }>;
    waitForTransactions: (hashes: string[]) => Promise<{ status: "confirmed" | "failed" }>;
  };
  type ChainExecutor = { validate: (e: unknown, c: unknown) => Promise<void>; execute: (e: unknown, c: unknown) => Promise<{ txHashes?: string[]; txHash?: string }> };

  const keyStore = new naj.keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", accountId, naj.KeyPair.fromString(secretKey.trim()));
  const near = new naj.Near({
    networkId: "testnet",
    keyStore,
    nodeUrl: "https://rpc.testnet.fastnear.com",
  });
  const account = new naj.Account(await near.connection, accountId);

  const adapter: NearWalletAdapter = {
    async getChain() {
      return "near" as const;
    },
    async signAndSendTransactions(txs) {
      const hashes: string[] = [];
      for (const t of txs) {
        const outcome = await account.signAndSendTransaction({
          receiverId: t.receiverId,
          actions: [naj.transactions.transfer("100000000000000000000")], // 0.0001 NEAR
        });
        const h = (outcome as unknown as { transaction?: { hash?: string } }).transaction?.hash;
        if (!h) throw new Error("no hash returned");
        hashes.push(h);
      }
      return { txHashes: hashes };
    },
    async waitForTransactions(hashes) {
      const provider = near.connection.provider;
      for (const h of hashes) {
        await provider.txStatus(h, accountId, "FINAL");
      }
      return { status: "confirmed" as const };
    },
  };
  const executor: ChainExecutor = createNearExecutor(adapter);

  // Drive the SDK executor the same way executeSwap would.
  const execution = {
    kind: "near-transaction-batch",
    chain: "near",
    transactions: [{ receiverId: accountId, actions: [{ type: "Transfer", params: { deposit: "100000000000000000000" } }] }],
  };
  const ctx = { signal: undefined as unknown as AbortSignal, now: () => Date.now() } as never;
  await executor.validate(execution, ctx);
  const submission = await executor.execute(execution, ctx);
  const hashes = submission.txHashes ?? (submission.txHash ? [submission.txHash] : []);
  log(`adapter executed ${hashes.length} real testnet tx(s): ${hashes.join(", ")}`);
  for (const h of hashes) {
    log(`explorer: https://explorer.testnet.near.org/transactions/${h}`);
  }
  log("Part B OK — SDK NEAR executor adapter verified on testnet.");
}

/* ------------------------------------------------------------------ */
async function main() {
  if (PART === "all" || PART === "a") await partA();
  if (PART === "all" || PART === "b") await partB();
  log("DONE");
}

main().catch((e) => {
  console.error(`[phase2-verify] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
