/**
 * VAULTRY multi-chain keystore — CLIENT-SIDE ONLY.
 *
 * Stores ONE encrypted BIP39 mnemonic (AES-GCM via WebCrypto, same scheme as
 * lib/wallet/keys.ts) plus the derived public addresses. The mnemonic is
 * NEVER transmitted to any server — this module performs zero network calls.
 * Per-chain secrets are derived into memory only, for the session, and only
 * after the user unlocks with their password.
 */

import {
  encryptSecret,
  decryptSecret,
  type EncryptedPayload,
} from "./keys";
import {
  normalizeMnemonic,
  isValidMnemonic,
  deriveAllAddresses,
  deriveAllSecrets,
  type MultiChainAddresses,
  type MultiChainSecrets,
} from "./multichain-derive";
import "../polyfills";

function assertBrowser(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("multichain-store is client-only");
  }
}

export const MULTICHAIN_KEYSTORE_KEY = "vaultguard.wallet.multichain.v1";

export interface MultiChainKeystore {
  version: 1;
  /** Public addresses — safe to read without unlocking. */
  addresses: MultiChainAddresses;
  crypto: EncryptedPayload;
  createdAt: string;
}

export type StoreResult = { ok: true } | { ok: false; error: string };

/** Save a NEW multi-chain wallet: validates the mnemonic, derives addresses,
 *  encrypts the mnemonic with the password, stores. */
export async function saveMultiChainWallet(
  mnemonic: string,
  password: string
): Promise<StoreResult> {
  assertBrowser();
  try {
    const norm = normalizeMnemonic(mnemonic);
    if (!isValidMnemonic(norm)) {
      return { ok: false, error: "That is not a valid 12/24-word recovery phrase" };
    }
    const addresses = deriveAllAddresses(norm);
    const crypto = await encryptSecret(password, norm);
    const store: MultiChainKeystore = {
      version: 1,
      addresses,
      crypto,
      createdAt: new Date().toISOString(),
    };
    window.localStorage.setItem(MULTICHAIN_KEYSTORE_KEY, JSON.stringify(store));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save wallet" };
  }
}

/** Read public addresses without unlocking (for the dashboard header). */
export function loadMultiChainMeta(): { ok: true; store: MultiChainKeystore } | { ok: false; error: string } {
  assertBrowser();
  try {
    const raw = window.localStorage.getItem(MULTICHAIN_KEYSTORE_KEY);
    if (!raw) return { ok: false, error: "No multi-chain wallet saved on this device yet" };
    const parsed = JSON.parse(raw) as MultiChainKeystore;
    if (parsed.version !== 1 || !parsed.addresses || !parsed.crypto) {
      return { ok: false, error: "Saved wallet data is corrupted or from an unknown version" };
    }
    return { ok: true, store: parsed };
  } catch {
    return { ok: false, error: "Saved wallet data is corrupted" };
  }
}

/** Unlock: decrypt the mnemonic into memory. Returns mnemonic (caller derives). */
export async function unlockMultiChainMnemonic(
  password: string
): Promise<{ ok: true; mnemonic: string } | { ok: false; error: string }> {
  assertBrowser();
  const meta = loadMultiChainMeta();
  if (!meta.ok) return { ok: false, error: meta.error };
  try {
    const mnemonic = await decryptSecret(password, meta.store.crypto);
    return { ok: true, mnemonic };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Decryption failed" };
  }
}

/** Unlock + derive per-chain secrets into a memory-only session object. */
export async function unlockMultiChainSession(
  password: string
): Promise<
  | { ok: true; addresses: MultiChainAddresses; secrets: MultiChainSecrets }
  | { ok: false; error: string }
> {
  const u = await unlockMultiChainMnemonic(password);
  if (!u.ok) return u;
  try {
    const secrets = deriveAllSecrets(u.mnemonic);
    const addresses = deriveAllAddresses(u.mnemonic);
    return { ok: true, addresses, secrets };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Key derivation failed" };
  }
}

export function clearMultiChainWallet(): void {
  assertBrowser();
  window.localStorage.removeItem(MULTICHAIN_KEYSTORE_KEY);
}
