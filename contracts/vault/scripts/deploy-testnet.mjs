#!/usr/bin/env node
/**
 * VAULTGUARD testnet deploy — TESTNET ONLY.
 *
 * Deploys build/contract.wasm to a fresh NEAR testnet subaccount and
 * initializes it (guardian, per-tx cap, allowed assets). Dry-run by default.
 *
 *   node scripts/deploy-testnet.mjs --dry-run   # print plan, touch nothing
 *   node scripts/deploy-testnet.mjs --deploy    # create subaccount, deploy, init, verify
 *
 * Env (see .env.example; .env is gitignored — never commit keys):
 *   NEAR_DEPLOYER_ACCOUNT  e.g. xyzcryp0.testnet        (required for --deploy)
 *   NEAR_DEPLOYER_KEY      ed25519:... private key      (required for --deploy)
 *   VAULT_SUBACCOUNT       default: vaultguard.<deployer> (must not exist yet)
 *   GUARDIAN_ACCOUNT       default: <deployer account>
 *   MAX_SPEND_PER_TX_USDC  default: 1000
 *
 * No mainnet. No real funds. No seed phrases are generated or stored here.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as nearAPI from "near-api-js";

const { connect, keyStores, KeyPair, utils } = nearAPI;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WASM_PATH = join(ROOT, "build", "contract.wasm");
const POLICY_PATH = join(ROOT, "..", "..", "apps", "guardian", "config", "policy.json");

const args = new Set(process.argv.slice(2));
const DRY_RUN = !args.has("--deploy");

function env(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    console.error(`missing env: ${name} (see contracts/vault/.env.example)`);
    process.exit(2);
  }
  return v;
}

function loadPolicy() {
  if (!existsSync(POLICY_PATH)) return { allowedAssets: [] };
  return JSON.parse(readFileSync(POLICY_PATH, "utf8"));
}

async function main() {
  if (!existsSync(WASM_PATH)) {
    console.error(`wasm not found: ${WASM_PATH} — run the contract build first`);
    process.exit(1);
  }
  const wasm = readFileSync(WASM_PATH);
  console.log(`wasm: ${WASM_PATH} (${wasm.length} bytes)`);

  const deployerAccount = DRY_RUN ? env("NEAR_DEPLOYER_ACCOUNT", "<NEAR_DEPLOYER_ACCOUNT>") : env("NEAR_DEPLOYER_ACCOUNT");
  const subaccount = env("VAULT_SUBACCOUNT", `vaultguard.${deployerAccount}`);
  const guardian = env("GUARDIAN_ACCOUNT", deployerAccount);
  const maxSpendUsdc = Number(env("MAX_SPEND_PER_TX_USDC", "1000"));
  const policy = loadPolicy();
  const allowedAssets = policy.allowedAssets ?? [];
  // Contract takes smallest units; USDC has 6 decimals.
  const maxSpendPerTx = (BigInt(Math.round(maxSpendUsdc * 1e6))).toString();

  const initArgs = { guardian, max_spend_per_tx: maxSpendPerTx, allowed_assets: allowedAssets };
  console.log("plan:");
  console.log(`  deployer   : ${deployerAccount}`);
  console.log(`  new account: ${subaccount}`);
  console.log(`  init args  : ${JSON.stringify(initArgs)}`);

  if (DRY_RUN) {
    console.log("\ndry-run: nothing was sent. Re-run with --deploy to execute.");
    return;
  }

  const deployerKey = env("NEAR_DEPLOYER_KEY");
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", deployerAccount, KeyPair.fromString(deployerKey));
  const near = await connect({
    networkId: "testnet",
    nodeUrl: "https://rpc.testnet.near.org",
    walletUrl: "https://testnet.mynearwallet.com",
    helperUrl: "https://helper.testnet.near.org",
    keyStore,
  });
  const deployer = await near.account(deployerAccount);

  // 1. Create the vault subaccount (fails cleanly if it already exists).
  console.log(`\ncreating subaccount ${subaccount}...`);
  try {
    await deployer.createAccount(
      subaccount,
      (await keyStore.getKey("testnet", deployerAccount)).getPublicKey(),
      utils.format.parseNearAmount("3"), // enough for contract storage + init
    );
    console.log("subaccount created");
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/already exists|already claimed/i.test(msg)) {
      console.log("subaccount already exists — reusing");
    } else {
      throw e;
    }
  }

  // Subaccount was created with the deployer's public key as its full-access
  // key, so the same keypair signs for it. Register it in the keystore.
  await keyStore.setKey("testnet", subaccount, KeyPair.fromString(deployerKey));

  // 2. Deploy the wasm.
  console.log("deploying contract...");
  const vault = await near.account(subaccount);
  await vault.deployContract(wasm);
  console.log("contract deployed");

  // 3. Initialize.
  console.log("initializing...");
  await vault.functionCall({
    contractId: subaccount,
    methodName: "init",
    args: initArgs,
    gas: "300000000000000",
  });
  console.log("initialized");

  // 4. Verify via view call.
  const status = await vault.viewFunction({ contractId: subaccount, methodName: "get_status", args: {} });
  console.log("\nget_status:", JSON.stringify(status, null, 2));
  console.log("\nDONE — testnet vault live at", subaccount);
}

main().catch((e) => {
  console.error("deploy failed:", e?.message ?? e);
  process.exit(1);
});
