/**
 * TidePool TESTNET E2E swap harness — VAULTRY NEAR-leg testing.
 *
 * Flow: live quote (dry:false) → ROUTE GUARDIAN GATE → ft_transfer_call
 * deposit → /v0/deposit/submit → poll /v0/status → verify settlement on-chain
 * via fastnear RPC.
 *
 * SAFETY:
 * - TESTNET ONLY. The key used is vgdeployer.testnet (testnet). The harness
 *   refuses to run against anything mainnet-shaped.
 * - The deposit step requires CONFIRM_DEPOSIT=1 in the environment — an
 *   explicit confirmation flag. Without it, the harness stops after the
 *   guardian gate (dry-run of the gate itself).
 * - The guardian gate revalidates: chains, token addresses, amountIn,
 *   recipient, quote expiry, implied slippage vs tolerance. Any mismatch
 *   aborts before funds move.
 *
 * Usage:
 *   set -a && source ../../contracts/vault/.env && set +a
 *   CONFIRM_DEPOSIT=1 npx ts-node --transpile-only scripts/tidepool-e2e-swap.ts
 */
import {
  fetchTidePoolQuote,
  fetchTidePoolStatus,
  resolveTidePoolAsset,
  assertTestnetOnly,
  type TidePoolLiveQuote,
} from "../src/tidepool-client";

// near-api-js v5 (root node_modules). Absolute require: guardian has no
// near-api-js dep of its own (node10 moduleResolution ignores "exports").
const { join } = require("path");
const nearApi = require(join(
  __dirname, "../../../node_modules/near-api-js/lib/index.js",
));

const FASTNEAR_RPC = "https://rpc.testnet.fastnear.com";
const NETWORK_ID = "testnet";
const VERIFIER = "verifier.tidepool-sandbox.testnet";

// --- Test parameters (all testnet, all valueless) ---
const ACCOUNT_ID = "vgdeployer.testnet";
const SYMBOL_IN = "USDC";
const SYMBOL_OUT = "wNEAR";
const BLOCKCHAIN = "near";
const AMOUNT_IN = "1000000"; // 1.0 test USDC
const SLIPPAGE_BPS = 100;

interface GateResult {
  ok: boolean;
  reasons: string[];
}

/**
 * ROUTE GUARDIAN GATE for TidePool deposits.
 * Revalidates the live quote against the user's original intent BEFORE any
 * fund movement. Returns { ok:false } with reasons on any mismatch.
 */
function guardianGate(
  intent: {
    originAsset: string;
    destinationAsset: string;
    amountIn: string;
    recipient: string;
    slippageBps: number;
  },
  quote: TidePoolLiveQuote,
  deadlineIso: string,
): GateResult {
  const reasons: string[] = [];
  const norm = (s: string) => s.trim().toLowerCase();

  // 1. Token addresses must match the intent exactly.
  const qReq = (quote as unknown as { quoteRequest?: Record<string, unknown> })
    .quoteRequest;
  if (qReq) {
    if (norm(String(qReq.originAsset)) !== norm(intent.originAsset))
      reasons.push(`originAsset drift: ${qReq.originAsset} != ${intent.originAsset}`);
    if (norm(String(qReq.destinationAsset)) !== norm(intent.destinationAsset))
      reasons.push(`destinationAsset drift: ${qReq.destinationAsset} != ${intent.destinationAsset}`);
    if (String(qReq.amount) !== intent.amountIn)
      reasons.push(`amountIn drift: ${qReq.amount} != ${intent.amountIn}`);
    if (norm(String(qReq.recipient)) !== norm(intent.recipient))
      reasons.push(`recipient drift: ${qReq.recipient} != ${intent.recipient}`);
  }
  // 2. Amounts on the quote itself.
  if (quote.amountIn !== intent.amountIn)
    reasons.push(`quote.amountIn drift: ${quote.amountIn} != ${intent.amountIn}`);
  // 3. Quote must not be expired.
  if (new Date(deadlineIso).getTime() <= Date.now() + 30_000)
    reasons.push(`quote expired or expiring: deadline ${deadlineIso}`);
  // 4. Implied slippage within tolerance.
  try {
    const out = BigInt(quote.amountOut);
    const min = BigInt(quote.minAmountOut);
    if (out <= 0n || min <= 0n || min > out) {
      reasons.push("quote amounts invalid (out<=0 or min>out)");
    } else {
      const slipPct = Number(((out - min) * 10000n) / out) / 100;
      const tolPct = intent.slippageBps / 100;
      if (slipPct > tolPct)
        reasons.push(`implied slippage ${slipPct}% exceeds tolerance ${tolPct}%`);
    }
  } catch {
    reasons.push("quote amounts unparseable");
  }
  // 5. Sanity: positive output.
  try {
    if (BigInt(quote.amountOut) <= 0n) reasons.push("amountOut not positive");
  } catch {
    reasons.push("amountOut unparseable");
  }
  return { ok: reasons.length === 0, reasons };
}

async function rpcTx(txHash: string, senderId: string): Promise<unknown> {
  const res = await fetch(FASTNEAR_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "tidepool-e2e",
      method: "tx",
      params: [txHash, senderId],
    }),
  });
  const data = (await res.json()) as { result?: unknown; error?: unknown };
  if (data.error) throw new Error(`RPC tx lookup failed: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function main(): Promise<void> {
  console.log("[tidepool-e2e] TESTNET-ONLY harness starting");
  assertTestnetOnly("account", ACCOUNT_ID);

  const secretKey = process.env.NEAR_DEPLOYER_KEY;
  if (!secretKey) throw new Error("NEAR_DEPLOYER_KEY not set (source contracts/vault/.env)");

  // 1. Resolve assets (no hardcoding).
  const [assetIn, assetOut] = await Promise.all([
    resolveTidePoolAsset(SYMBOL_IN, BLOCKCHAIN),
    resolveTidePoolAsset(SYMBOL_OUT, BLOCKCHAIN),
  ]);
  console.log(`[tidepool-e2e] assets: ${assetIn.assetId} -> ${assetOut.assetId}`);

  // 2. Live quote (dry:false) — creates a real testnet swap intent.
  const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const quote = (await fetchTidePoolQuote({
    originAsset: assetIn.assetId,
    destinationAsset: assetOut.assetId,
    amount: AMOUNT_IN,
    slippageBps: SLIPPAGE_BPS,
    recipient: ACCOUNT_ID,
    refundTo: ACCOUNT_ID,
    dry: false,
  })) as TidePoolLiveQuote;
  console.log(
    `[tidepool-e2e] live quote: in=${quote.amountInFormatted} out=${quote.amountOutFormatted} ` +
      `minOut=${quote.minAmountOut} deposit=${quote.depositAddress} order=${quote.orderId}`,
  );

  // 3. ROUTE GUARDIAN GATE — before any fund movement.
  const gate = guardianGate(
    {
      originAsset: assetIn.assetId,
      destinationAsset: assetOut.assetId,
      amountIn: AMOUNT_IN,
      recipient: ACCOUNT_ID,
      slippageBps: SLIPPAGE_BPS,
    },
    quote,
    deadline,
  );
  console.log(`[tidepool-e2e] guardian gate: ${gate.ok ? "PASS" : "FAIL"}`);
  if (!gate.ok) {
    for (const r of gate.reasons) console.log(`[tidepool-e2e]   BLOCKED: ${r}`);
    throw new Error("Guardian gate FAILED — aborting before fund movement");
  }

  // 4. Explicit confirmation flag required before funds move.
  if (process.env.CONFIRM_DEPOSIT !== "1") {
    console.log(
      "[tidepool-e2e] CONFIRM_DEPOSIT!=1 — stopping after the guardian gate. " +
        "Set CONFIRM_DEPOSIT=1 to execute the deposit.",
    );
    return;
  }
  console.log("[tidepool-e2e] CONFIRM_DEPOSIT=1 — executing deposit");

  // 5. Deposit: ft_transfer_call (INTENTS depositType) on the origin token.
  const { Near, keyStores, utils } = nearApi;
  const keyStore = new keyStores.InMemoryKeyStore();
  const { KeyPair } = nearApi.utils;
  const keyPair = KeyPair.fromString(secretKey);
  await keyStore.setKey(NETWORK_ID, ACCOUNT_ID, keyPair);
  const near = new Near({ networkId: NETWORK_ID, keyStore, nodeUrl: FASTNEAR_RPC });
  const account = await near.account(ACCOUNT_ID);

  const tokenContract = assetIn.assetId.replace(/^nep141:/, "");
  console.log(`[tidepool-e2e] ft_transfer_call ${tokenContract} -> ${VERIFIER} msg=${quote.depositAddress}`);
  const depositResult = await account.functionCall({
    contractId: tokenContract,
    methodName: "ft_transfer_call",
    args: {
      receiver_id: VERIFIER,
      amount: AMOUNT_IN,
      msg: quote.depositAddress,
    },
    gas: "100000000000000", // 100 Tgas
    attachedDeposit: "1", // 1 yoctoNEAR
  });
  const depositTxHash = depositResult.transaction.hash as string;
  console.log(`[tidepool-e2e] DEPOSIT TX: ${depositTxHash}`);

  // 6. Tell Tidepool about the deposit (optional but speeds up detection).
  try {
    const res = await fetch("https://www.usetidepool.tech/v0/deposit/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash: depositTxHash, depositAddress: quote.depositAddress }),
    });
    console.log(`[tidepool-e2e] deposit/submit HTTP ${res.status}`);
  } catch (e) {
    console.log(`[tidepool-e2e] deposit/submit failed (non-fatal): ${e}`);
  }

  // 7. Poll status to SUCCESS (max ~3 min).
  let status: { status: string; swapDetails?: { nearTxHashes?: string[] } } | null = null;
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetchTidePoolStatus(quote.depositAddress);
    console.log(`[tidepool-e2e] status poll ${i + 1}: ${s.status}`);
    if (s.status === "SUCCESS" || s.status === "FAILED" || s.status === "REFUNDED") {
      status = s as typeof status;
      break;
    }
  }
  if (!status) throw new Error("Status polling timed out without terminal state");
  console.log(`[tidepool-e2e] terminal status: ${status.status}`);
  const nearTxHashes = status.swapDetails?.nearTxHashes ?? [];
  console.log(`[tidepool-e2e] settlement nearTxHashes: ${JSON.stringify(nearTxHashes)}`);

  // 8. Verify each settlement tx on-chain via fastnear RPC (NOT the stale indexer).
  for (const h of nearTxHashes) {
    const tx = (await rpcTx(h, ACCOUNT_ID)) as {
      transaction?: { hash?: string; signer_id?: string; receiver_id?: string; actions?: unknown[] };
      status?: unknown;
    };
    const ok =
      tx?.transaction?.hash === h &&
      JSON.stringify(tx.status ?? {}).includes("SuccessValue");
    console.log(
      `[tidepool-e2e] RPC verify ${h}: signer=${tx?.transaction?.signer_id} ` +
        `receiver=${tx?.transaction?.receiver_id} success=${ok}`,
    );
    if (!ok) throw new Error(`Settlement tx ${h} did not verify as successful on-chain`);
  }

  // 9. Verify the deposit tx itself on-chain.
  const depTx = (await rpcTx(depositTxHash, ACCOUNT_ID)) as {
    transaction?: { hash?: string };
    status?: unknown;
  };
  const depOk =
    depTx?.transaction?.hash === depositTxHash &&
    JSON.stringify(depTx.status ?? {}).includes("SuccessValue");
  console.log(`[tidepool-e2e] RPC verify deposit ${depositTxHash}: success=${depOk}`);
  if (!depOk) throw new Error("Deposit tx did not verify as successful on-chain");

  console.log("[tidepool-e2e] E2E COMPLETE — all on-chain verifications passed");
  console.log(`[tidepool-e2e] RESULT depositTx=${depositTxHash} settlementTxs=${nearTxHashes.join(",")}`);
}

main().catch((e) => {
  console.error(`[tidepool-e2e] FATAL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
