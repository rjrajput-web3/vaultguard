/**
 * VAULTRY Live Testing Lab — visitor session storage (workstream F).
 *
 * ISOLATION CONTRACT (binding):
 * - Everything lives in THIS visitor's browser localStorage only.
 * - It never touches the shared on-chain contract, other visitors'
 *   settings, or any admin key. There is no admin key anywhere in this
 *   module, and nothing here is transmitted to any server.
 * - Client-only: reading during SSR throws (guarded with assertBrowser).
 */

export interface LabPolicy {
  /** USD ceiling per transaction used by the risk engine for THIS session. */
  maxSpendPerTxUsd: number;
  /** Hard slippage ceiling in % used by the risk engine for THIS session. */
  maxSlippagePct: number;
  /** Router ids the detectors treat as allowed for THIS session. */
  allowedRouters: string[];
}

export const DEFAULT_LAB_POLICY: LabPolicy = {
  maxSpendPerTxUsd: 500,
  maxSlippagePct: 2,
  allowedRouters: ["1click"],
};

export interface LabQuoteRecord {
  route: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  amountOutUsd?: string;
  timeEstimateMs: number;
  at: string; // ISO
}

export interface LabVerdictRecord {
  route: string;
  decision: string;
  score: number;
  at: string;
}

export interface LabDetectorScanRecord {
  pass: number;
  warn: number;
  fail: number;
  at: string;
}

export interface LabSession {
  accountId: string | null;
  publicKey: string | null;
  faucetTxHash: string | null;
  faucetAt: string | null;
  fundedBalanceNear: string | null;
  quotes: LabQuoteRecord[];
  riskVerdicts: LabVerdictRecord[];
  detectorScans: LabDetectorScanRecord[];
}

export const EMPTY_LAB_SESSION: LabSession = {
  accountId: null,
  publicKey: null,
  faucetTxHash: null,
  faucetAt: null,
  fundedBalanceNear: null,
  quotes: [],
  riskVerdicts: [],
  detectorScans: [],
};

export const LAB_POLICY_KEY = "vg_lab_policy";
const LAB_SESSION_KEY = "vg_lab_session_v1";

function assertBrowser(): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    throw new Error("lab/session is client-only");
  }
}

function readJson<T>(key: string): T | null {
  assertBrowser();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  assertBrowser();
  window.localStorage.setItem(key, JSON.stringify(value));
}

/* ---------------- policy ---------------- */

export function loadLabPolicy(): LabPolicy {
  const stored = readJson<LabPolicy>(LAB_POLICY_KEY);
  if (!stored || typeof stored.maxSpendPerTxUsd !== "number" || !Array.isArray(stored.allowedRouters)) {
    return { ...DEFAULT_LAB_POLICY };
  }
  return {
    maxSpendPerTxUsd: stored.maxSpendPerTxUsd,
    maxSlippagePct: typeof stored.maxSlippagePct === "number" ? stored.maxSlippagePct : 2,
    allowedRouters: stored.allowedRouters.map(String),
  };
}

export function saveLabPolicy(policy: LabPolicy): void {
  writeJson(LAB_POLICY_KEY, policy);
}

export function clearLabPolicy(): void {
  assertBrowser();
  window.localStorage.removeItem(LAB_POLICY_KEY);
}

/* ---------------- session ---------------- */

export function loadLabSession(): LabSession {
  const stored = readJson<LabSession>(LAB_SESSION_KEY);
  if (!stored) return { ...EMPTY_LAB_SESSION, quotes: [], riskVerdicts: [], detectorScans: [] };
  return {
    ...EMPTY_LAB_SESSION,
    ...stored,
    quotes: Array.isArray(stored.quotes) ? stored.quotes : [],
    riskVerdicts: Array.isArray(stored.riskVerdicts) ? stored.riskVerdicts : [],
    detectorScans: Array.isArray(stored.detectorScans) ? stored.detectorScans : [],
  };
}

export function saveLabSession(session: LabSession): void {
  writeJson(LAB_SESSION_KEY, session);
}

export function updateLabSession(patch: Partial<LabSession>): LabSession {
  const next = { ...loadLabSession(), ...patch };
  saveLabSession(next);
  return next;
}

export function clearLabSession(): void {
  assertBrowser();
  window.localStorage.removeItem(LAB_SESSION_KEY);
}

/* ---------------- quote amounts ---------------- */

/** Exact decimal → base-units conversion without floating-point error. */
export function decimalToBaseUnits(human: string, decimals: number): string {
  const s = String(human).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Amount must be a non-negative decimal number, got "${s}"`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Invalid token decimals ${String(decimals)}`);
  }
  const [intPart, fracPart = ""] = s.split(".");
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  return (
    BigInt(intPart === "" ? "0" : intPart) * BigInt(10) ** BigInt(decimals) +
    BigInt(frac === "" ? "0" : frac)
  ).toString();
}

/** Base units → human string with up to `decimals` fraction digits. */
export function baseUnitsToDecimal(baseUnits: string, decimals: number): string {
  try {
    const v = BigInt(baseUnits);
    const y = BigInt(10) ** BigInt(decimals);
    const whole = v / y;
    const frac = (v % y).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${whole.toString()}.${frac}` : whole.toString();
  } catch {
    return baseUnits;
  }
}
