/**
 * VAULTRY Privacy module — DATA_FLOWS single source of truth (workstream M3).
 *
 * Every row: one product feature → the data it uses → where that data goes.
 * The Privacy page renders this table verbatim; nothing here is marketing
 * copy — each destination is the real endpoint or the real local boundary.
 */

export type DataDestination =
  | "local-device"
  | "1click-api"
  | "near-rpc"
  | "faucet"
  | "oracle-pyth"
  | "explorer-api"
  | "near-ai-cloud-public"
  | "near-ai-cloud-byok";

export interface DataFlow {
  feature: string;
  dataUsed: string[];
  destination: DataDestination;
  /** Human label for the destination, shown in the dashboard. */
  destinationLabel: string;
  /** Honest note: why the data goes there, and what does NOT go. */
  notes: string;
}

export const DATA_FLOWS: DataFlow[] = [
  {
    feature: "Wallet key management",
    dataUsed: ["seed phrase", "private keys (NEAR / EVM / Solana)"],
    destination: "local-device",
    destinationLabel: "Your device only",
    notes:
      "Generated, encrypted (AES-GCM via WebCrypto) and stored client-side. " +
      "lib/wallet/keys.ts performs zero network calls — proven by the privacy audit, not by promise.",
  },
  {
    feature: "Private swap analysis",
    dataUsed: [
      "redacted swap features (asset IDs, amount, slippage, router)",
      "SHA-256 hashes of identifiers (never raw addresses)",
    ],
    destination: "local-device",
    destinationLabel: "Your device only",
    notes:
      "analyzeSwapPrivately() makes zero network calls by construction. " +
      "Raw addresses, amounts-as-typed and keys never leave the function.",
  },
  {
    feature: "Swap quotes (dry-run)",
    dataUsed: [
      "originAssetId",
      "destinationAssetId",
      "amountBaseUnits",
      "slippageBps",
      "recipient",
      "refundTo",
    ],
    destination: "1click-api",
    destinationLabel: "1Click API via /api/intents/quote",
    notes:
      "recipient / refundTo are REQUIRED by the 1Click dry-run API " +
      "(dry:true — no funds can move). Disabled entirely at data-sharing level “nothing”.",
  },
  {
    feature: "Risk analysis",
    dataUsed: ["quote amounts", "registry token metadata", "your policy"],
    destination: "local-device",
    destinationLabel: "Your device only",
    notes: "assessSwapRisk() is a pure function — no network, no fabricated numbers.",
  },
  {
    feature: "NEAR testnet faucet",
    dataUsed: ["newAccountId", "newAccountPublicKey"],
    destination: "faucet",
    destinationLabel: "helper.testnet.near.org (official NEAR testnet helper)",
    notes: "A public key is public by design. No private material is ever sent.",
  },
  {
    feature: "Oracle monitor",
    dataUsed: ["token price queries (no wallet data)"],
    destination: "oracle-pyth",
    destinationLabel: "Pyth Hermes (hermes.pyth.network)",
    notes: "Price feeds only — no identifiers, no keys, no amounts leave the device.",
  },
  {
    feature: "Transaction history lookup",
    dataUsed: ["NEAR account ID"],
    destination: "explorer-api",
    destinationLabel: "testnet.nearblocks.io",
    notes: "Public account IDs only. Read-only.",
  },
  {
    feature: "NEAR AI Cloud attestation verification",
    dataUsed: ["client-generated random nonce only"],
    destination: "near-ai-cloud-public",
    destinationLabel: "cloud-api.near.ai (public, keyless)",
    notes:
      "Verifies NEAR AI Cloud's live TEE evidence (Intel TDX). Sends no user " +
      "data and no key. This does NOT mean our analysis runs inside their TEE — " +
      "it verifies their infrastructure.",
  },
  {
    feature: "Confidential AI analysis (BYOK)",
    dataUsed: ["your pasted API key", "redacted features only"],
    destination: "near-ai-cloud-byok",
    destinationLabel: "cloud-api.near.ai (your key, direct from your browser)",
    notes:
      "OPT-IN ONLY. The key lives in your browser's localStorage " +
      "(vg_byok_nearaicloud) and is sent browser → NEAR AI Cloud directly — " +
      "never to VAULTRY servers. Needs paid credits or staked NEAR on your own " +
      "NEAR AI Cloud account.",
  },
];

/* ------------------------------------------------------------------ */
/* Data-sharing levels + per-module consent                            */
/* ------------------------------------------------------------------ */

export type DataSharingLevel = "nothing" | "anonymized" | "full";

export const DATA_LEVEL_INFO: Record<
  DataSharingLevel,
  { title: string; description: string }
> = {
  nothing: {
    title: "Nothing leaves",
    description:
      "Local-only analysis. Quote fetching is DISABLED — the 1Click API needs " +
      "asset IDs, amounts and recipient/refundTo addresses, so with this level " +
      "no quote is fetched and risk verdicts may come back unknown. Nothing " +
      "about your wallet leaves the device, period.",
  },
  anonymized: {
    title: "Anonymized (default)",
    description:
      "The redaction pipeline runs first: identifiers are SHA-256 hashed, " +
      "secrets are dropped, and only the minimal feature set is used. " +
      "recipient / refundTo are still sent to the 1Click API because dry-run " +
      "quotes functionally require them — that is documented per route, not hidden.",
  },
  full: {
    title: "Full (explicit opt-in)",
    description:
      "You explicitly acknowledge every data flow in the table below. " +
      "Technically the flows are the same as “anonymized” today — this level " +
      "records your informed opt-in rather than unlocking new transmissions. " +
      "If that ever changes, this text changes first.",
  },
};

export type ConsentModuleId =
  | "swap-quotes"
  | "risk-analysis"
  | "faucet"
  | "oracle-monitor";

export const CONSENT_MODULES: Array<{
  id: ConsentModuleId;
  label: string;
  whatItDoes: string;
}> = [
  {
    id: "swap-quotes",
    label: "Swap quotes",
    whatItDoes: "Fetches dry-run quotes (asset IDs, amount, recipient/refundTo → 1Click API).",
  },
  {
    id: "risk-analysis",
    label: "Risk analysis",
    whatItDoes: "Runs the SAFE / CAUTION / BLOCKED engine on quotes, locally.",
  },
  {
    id: "faucet",
    label: "Faucet",
    whatItDoes: "Requests testnet NEAR (account ID + public key → official helper).",
  },
  {
    id: "oracle-monitor",
    label: "Oracle monitor",
    whatItDoes: "Reads Pyth price feeds for the depeg guard (no wallet data).",
  },
];

export interface PrivacyConsent {
  level: DataSharingLevel;
  modules: Record<ConsentModuleId, boolean>;
  updatedAt: string; // ISO
}

/** localStorage key for the consent object (level + module toggles). */
export const CONSENT_STORAGE_KEY = "vg_privacy_consent";
/**
 * localStorage key for the user's OWN NEAR AI Cloud key (BYOK).
 * Browser-only storage; it is attached solely to requests the browser makes
 * directly to https://cloud-api.near.ai — never to VAULTRY servers.
 */
export const BYOK_STORAGE_KEY = "vg_byok_nearaicloud";

export const DEFAULT_CONSENT: PrivacyConsent = {
  level: "anonymized",
  modules: {
    "swap-quotes": true,
    "risk-analysis": true,
    faucet: true,
    "oracle-monitor": true,
  },
  updatedAt: "",
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadConsent(): PrivacyConsent {
  if (!isBrowser()) return { ...DEFAULT_CONSENT, modules: { ...DEFAULT_CONSENT.modules } };
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONSENT, modules: { ...DEFAULT_CONSENT.modules } };
    const parsed = JSON.parse(raw) as Partial<PrivacyConsent>;
    const modules = { ...DEFAULT_CONSENT.modules, ...(parsed.modules ?? {}) };
    const level: DataSharingLevel =
      parsed.level === "nothing" || parsed.level === "full" ? parsed.level : "anonymized";
    return { level, modules, updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "" };
  } catch {
    return { ...DEFAULT_CONSENT, modules: { ...DEFAULT_CONSENT.modules } };
  }
}

export function saveConsent(consent: PrivacyConsent): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({ ...consent, updatedAt: new Date().toISOString() }),
  );
}

/** The user's own NEAR AI Cloud key, or null. Browser localStorage only. */
export function loadByokKey(): string | null {
  if (!isBrowser()) return null;
  const v = window.localStorage.getItem(BYOK_STORAGE_KEY);
  return v && v.trim().length > 0 ? v.trim() : null;
}

export function saveByokKey(key: string): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(BYOK_STORAGE_KEY, key.trim());
}

export function clearByokKey(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(BYOK_STORAGE_KEY);
}
