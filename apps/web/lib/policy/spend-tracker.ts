/**
 * Testnet spend tracker — device-local (2026-11-02).
 *
 * Records each executed testnet swap's USD estimate in localStorage, keyed
 * by UTC date. Used by the Route Guardian's daily-cap check. Never leaves
 * the device; never faked — only real executed swaps are recorded.
 */

const STORAGE_KEY = "vaultry.spend.testnet.v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // UTC date
}

function readAll(): Record<string, number> {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** USD spent on testnet swaps today (UTC). 0 when unknown. */
export function getTodaySpendUsd(): number {
  return readAll()[todayKey()] ?? 0;
}

/** Record a real executed swap. Call only after on-chain settlement. */
export function recordSpendUsd(usd: number): void {
  if (!isBrowser()) return;
  if (!Number.isFinite(usd) || usd <= 0) return;
  try {
    const all = readAll();
    const k = todayKey();
    all[k] = (all[k] ?? 0) + usd;
    // Keep 30 days of history; drop the rest.
    const keys = Object.keys(all).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - 30))) delete all[old];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage full/blocked — spend tracking degrades silently, caps stay safe */
  }
}
