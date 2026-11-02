/**
 * Per-user policy store — client-side (2026-11-02 audit).
 *
 * WHY THIS EXISTS: /api/policy PUT writes to the server filesystem, which
 * on Vercel serverless is ephemeral per-instance (a "saved" policy can
 * vanish on the next cold start), and worse, it is GLOBAL — one visitor's
 * save overwrites every other visitor's policy. Both are broken for a
 * "per-user Policy Console".
 *
 * This module stores each visitor's policy in their own browser
 * localStorage, seeded from the server defaults (GET /api/policy). Saves
 * are instant, survive reloads, and never leak between users. The UI must
 * label this honestly: "stored on this device only".
 */

export interface UserPolicy {
  vaultId: string;
  guardian: string;
  paused: boolean;
  maxSpendPerTx: number;
  maxSpendPerDay: number;
  allowedAssets: string[];
  allowedRouters: string[];
  maxHedgeSlippagePct: number;
  maxHedgeFeePct: number;
}

export const DEFAULT_USER_POLICY: UserPolicy = {
  vaultId: "vaultry-testnet",
  guardian: "route-guardian",
  paused: false,
  maxSpendPerTx: 1000,
  maxSpendPerDay: 5000,
  allowedAssets: [
    "nep141:usdc.tidepool-sandbox.testnet",
    "nep141:usdt.tidepool-sandbox.testnet",
    "nep141:wnear.tidepool-sandbox.testnet",
    "nep141:wbtc.tidepool-sandbox.testnet",
    "nep141:eth.tidepool-sandbox.testnet",
  ],
  // Testnet-only: the TidePool Intents sandbox is the sole swap router.
  allowedRouters: ["tidepool-intents"],
  maxHedgeSlippagePct: 2,
  maxHedgeFeePct: 1,
};

const STORAGE_KEY = "vaultry.policy.v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function sanitize(raw: unknown): UserPolicy {
  const p = (raw ?? {}) as Partial<UserPolicy>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.map(String).filter((s) => s.trim().length > 0) : [];
  return {
    vaultId: String(p.vaultId ?? DEFAULT_USER_POLICY.vaultId),
    guardian: String(p.guardian ?? DEFAULT_USER_POLICY.guardian),
    paused: p.paused === true,
    maxSpendPerTx: num(p.maxSpendPerTx, DEFAULT_USER_POLICY.maxSpendPerTx) || DEFAULT_USER_POLICY.maxSpendPerTx,
    maxSpendPerDay: num(p.maxSpendPerDay, DEFAULT_USER_POLICY.maxSpendPerDay) || DEFAULT_USER_POLICY.maxSpendPerDay,
    allowedAssets: strArr(p.allowedAssets).length > 0 ? strArr(p.allowedAssets) : [...DEFAULT_USER_POLICY.allowedAssets],
    allowedRouters: strArr(p.allowedRouters).length > 0 ? strArr(p.allowedRouters) : [...DEFAULT_USER_POLICY.allowedRouters],
    maxHedgeSlippagePct: num(p.maxHedgeSlippagePct, DEFAULT_USER_POLICY.maxHedgeSlippagePct),
    maxHedgeFeePct: num(p.maxHedgeFeePct, DEFAULT_USER_POLICY.maxHedgeFeePct),
  };
}

/** Load the visitor's policy. Falls back to server defaults, then built-ins. */
export function loadUserPolicy(serverDefaults?: Partial<UserPolicy> | null): UserPolicy {
  const base = sanitize(serverDefaults ?? DEFAULT_USER_POLICY);
  if (!isBrowser()) return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    // User overrides win over server defaults, field by field.
    const saved = JSON.parse(raw) as Partial<UserPolicy>;
    return sanitize({ ...base, ...saved });
  } catch {
    return base;
  }
}

/** Persist the visitor's policy on this device only. Never touches the network. */
export function saveUserPolicy(policy: UserPolicy): { ok: true } | { ok: false; error: string } {
  if (!isBrowser()) return { ok: false, error: "Storage is not available" };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(policy)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save on this device" };
  }
}

/** True when the visitor has customized anything away from the server defaults. */
export function hasUserOverrides(serverDefaults?: Partial<UserPolicy> | null): boolean {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function resetUserPolicy(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
