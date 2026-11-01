/**
 * VAULTGUARD policy persistence — the off-chain twin of the on-chain vault policy.
 *
 * The policy editor UI (apps/web/app/policy) reads/writes the JSON file this
 * module manages; the quote loop reads it to pre-check every quote against the
 * user's limits. The on-chain contract (contracts/vault) remains the final
 * authority — this file is the pre-flight UX layer.
 */
import * as fs from "fs";
import * as path from "path";
import { VaultPolicy } from "./policy";

/** Sensible first-run defaults. Mirrors the on-chain contract's init values. */
export const DEFAULT_POLICY: VaultPolicy = {
  vaultId: "vaultguard-demo.near",
  guardian: "guardian.vaultguard-demo.near",
  paused: false,
  maxSpendPerTx: 1000, // USDC
  maxSpendPerDay: 5000, // USDC
  // "chain:address" keys, lowercased. Demo pair: Base USDC + NEAR USDC.
  allowedAssets: [
    "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  ],
  allowedRouters: ["nearintents", "lifi", "1inch", "rango"],
  maxHedgeSlippagePct: 2,
  maxHedgeFeePct: 1,
};

const KNOWN_ROUTERS = [
  "nearintents",
  "lifi",
  "rango",
  "1inch",
  "paraswap",
  "zerox",
  "okx",
  "bitget",
  "binance",
  "openocean",
  "cow",
  "jupiter",
  "kyber",
];

/** Absolute path to the policy file. Env override for deployments. */
export function resolvePolicyPath(): string {
  if (process.env.VAULTGUARD_POLICY_PATH) return path.resolve(process.env.VAULTGUARD_POLICY_PATH);
  return path.resolve(__dirname, "..", "config", "policy.json");
}

export function loadPolicy(policyPath?: string): VaultPolicy {
  const p = policyPath ?? resolvePolicyPath();
  if (!fs.existsSync(p)) {
    savePolicy(DEFAULT_POLICY, p);
    return { ...DEFAULT_POLICY };
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<VaultPolicy>;
  // Merge over defaults so older files stay forward-compatible.
  return { ...DEFAULT_POLICY, ...raw };
}

export function savePolicy(policy: VaultPolicy, policyPath?: string): void {
  const p = policyPath ?? resolvePolicyPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(policy, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p); // atomic replace
}

/** Human-readable validation errors. Empty = valid. */
export function validatePolicy(policy: VaultPolicy): string[] {
  const errs: string[] = [];
  if (!policy.vaultId.trim()) errs.push("vaultId is required");
  if (policy.maxSpendPerTx <= 0) errs.push("maxSpendPerTx must be > 0");
  if (policy.maxSpendPerDay <= 0) errs.push("maxSpendPerDay must be > 0");
  if (policy.maxSpendPerDay < policy.maxSpendPerTx) {
    errs.push("maxSpendPerDay should be >= maxSpendPerTx (else the per-tx cap is unreachable)");
  }
  if (policy.maxHedgeSlippagePct < 0 || policy.maxHedgeSlippagePct > 100) {
    errs.push("maxHedgeSlippagePct must be 0–100");
  }
  if (policy.maxHedgeFeePct < 0 || policy.maxHedgeFeePct > 100) {
    errs.push("maxHedgeFeePct must be 0–100");
  }
  for (const a of policy.allowedAssets) {
    if (!/^[^:]+:[^:]+$/.test(a.trim())) errs.push(`allowed asset "${a}" must be "chain:address"`);
  }
  for (const r of policy.allowedRouters) {
    if (!KNOWN_ROUTERS.includes(r.trim().toLowerCase())) {
      errs.push(`unknown router "${r}" (known: ${KNOWN_ROUTERS.join(", ")})`);
    }
  }
  return errs;
}

export function knownRouters(): string[] {
  return [...KNOWN_ROUTERS];
}
