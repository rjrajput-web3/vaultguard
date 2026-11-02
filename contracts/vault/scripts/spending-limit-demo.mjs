#!/usr/bin/env node
/**
 * VAULTGUARD on-chain spending-limit demo — TESTNET ONLY.
 *
 * Proves the on-chain contract enforces the guardian policy:
 *   1. get_status view → shows per-tx cap + allowed assets
 *   2. request_withdraw WITHIN cap → SUCCEEDS ("withdraw approved" log)
 *   3. request_withdraw OVER cap    → REJECTS ("amount exceeds per-tx spend cap")
 *   4. guardian set_paused(true)    → request_withdraw REJECTS ("vault is paused")
 *   5. guardian set_paused(false)   → request_withdraw WITHIN cap SUCCEEDS again
 *
 * Vault contract must already be deployed + initialized.
 * Signer = guardian (NEAR_DEPLOYER_ACCOUNT). Key ONLY via env or contracts/vault/.env
 * (gitignored — never commit keys; never print the key).
 *
 *   node scripts/spending-limit-demo.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as nearAPI from "near-api-js";

const { connect, keyStores, KeyPair } = nearAPI;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");

// NEAR mainnet USDC fungible-token address used as the demo asset key.
// (policy.json stores it as "near:<addr>"; contract lowercases everything.)
const USDC_NEAR = "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const GAS = "300000000000000";

function env(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(ENV_PATH)) {
    console.error(`missing env: ${name} (set it, or add to ${ENV_PATH})`);
    process.exit(2);
  }
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && t.slice(0, i).trim() === name) return t.slice(i + 1).trim();
  }
  console.error(`missing env: ${name} (set it, or add to ${ENV_PATH})`);
  process.exit(2);
}

async function main() {
  const guardianAccount = env("NEAR_DEPLOYER_ACCOUNT");
  const guardianKey = env("NEAR_DEPLOYER_KEY");
  const vaultAccount = process.env.VAULT_SUBACCOUNT || `vaultguard.${guardianAccount}`;

  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", guardianAccount, KeyPair.fromString(guardianKey));
  const near = await connect({
    networkId: "testnet",
    nodeUrl: "https://rpc.testnet.near.org",
    keyStore,
  });
  const guardian = await near.account(guardianAccount);

  console.log("vaultguard on-chain spending-limit demo (TESTNET)");
  console.log(`  vault   : ${vaultAccount}`);
  console.log(`  guardian: ${guardianAccount}\n`);

  // 1. Current on-chain status.
  const status = await guardian.viewFunction({
    contractId: vaultAccount, methodName: "get_status", args: {},
  });
  console.log("1) get_status →", JSON.stringify(status));

  async function call(method, args) {
    try {
      const res = await guardian.functionCall({
        contractId: vaultAccount, methodName: method, args, gas: GAS,
      });
      const hash = res?.transaction?.hash ?? res?.transaction_outcome?.id ?? "unknown";
      return { ok: true, hash };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }

  // 2. Withdraw within cap (500 USDC ≤ 1000 USDC cap) → expect SUCCESS.
  const within = await call("request_withdraw", {
    asset: USDC_NEAR, amount: "500000000", recipient: guardianAccount,
  });
  console.log(`2) request_withdraw 500 USDC (≤ cap) → ${within.ok ? `APPROVED  tx ${within.hash}` : `REJECTED: ${within.error}`}`);

  // 3. Withdraw over cap (2000 USDC > 1000 USDC cap) → expect REJECTION.
  const over = await call("request_withdraw", {
    asset: USDC_NEAR, amount: "2000000000", recipient: guardianAccount,
  });
  console.log(`3) request_withdraw 2000 USDC (> cap) → ${over.ok ? `APPROVED (UNEXPECTED!) tx ${over.hash}` : `REJECTED: ${over.error}`}`);

  // 4. Guardian pauses → withdraw must reject as paused.
  const paused = await call("set_paused", { paused: true });
  console.log(`4a) set_paused(true)  → ${paused.ok ? `OK  tx ${paused.hash}` : `FAILED: ${paused.error}`}`);
  const whilePaused = await call("request_withdraw", {
    asset: USDC_NEAR, amount: "100000000", recipient: guardianAccount,
  });
  console.log(`4b) request_withdraw 100 USDC while PAUSED → ${whilePaused.ok ? `APPROVED (UNEXPECTED!) tx ${whilePaused.hash}` : `REJECTED: ${whilePaused.error}`}`);

  // 5. Guardian unpauses → withdraw within cap works again (failure recovery).
  const unpaused = await call("set_paused", { paused: false });
  console.log(`5a) set_paused(false) → ${unpaused.ok ? `OK  tx ${unpaused.hash}` : `FAILED: ${unpaused.error}`}`);
  const after = await call("request_withdraw", {
    asset: USDC_NEAR, amount: "100000000", recipient: guardianAccount,
  });
  console.log(`5b) request_withdraw 100 USDC after unpause → ${after.ok ? `APPROVED  tx ${after.hash}` : `REJECTED: ${after.error}`}`);

  const verdict =
    status && within.ok && !over.ok && /exceeds per-tx spend cap/.test(over.error || "") &&
    paused.ok && !whilePaused.ok && /paused/.test(whilePaused.error || "") &&
    unpaused.ok && after.ok;
  console.log(`\nDEMO VERDICT: ${verdict ? "PASS — cap + pause enforced on-chain, recovery works" : "FAIL — see lines above"}`);
  process.exit(verdict ? 0 : 1);
}

main().catch((e) => { console.error("demo crashed:", e?.message ?? e); process.exit(1); });
