/**
 * VAULTGUARD wallet core — client-side key management.
 *
 * HONESTY / SECURITY CONTRACT (binding):
 * - Private keys and recovery phrases are generated, encrypted and stored
 *   CLIENT-SIDE ONLY (localStorage, AES-GCM via WebCrypto).
 * - They are NEVER transmitted to any server. This module performs zero
 *   network calls. Read the code: there is no fetch() anywhere below.
 * - This module only runs in the browser. Calling it during SSR throws.
 */

import { KeyPair, type KeyPairString } from "near-api-js";
import { generateSeedPhrase, parseSeedPhrase } from "near-seed-phrase";
import { validateMnemonic } from "bip39";

/** Normalize user-entered phrase text (case, spacing) before any crypto use. */
export function normalizeSeedPhrase(seedPhrase: string): string {
  return seedPhrase.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True only for a well-formed 12-word BIP39 phrase. near-seed-phrase's own
 *  parser derives a key from ANY string, so we must validate first. */
export function isValidSeedPhrase(seedPhrase: string): boolean {
  const normalized = normalizeSeedPhrase(seedPhrase);
  return normalized.split(" ").length === 12 && validateMnemonic(normalized);
}

/* ---------------- types ---------------- */

export interface GeneratedWallet {
  seedPhrase: string;
  publicKey: string; // ed25519:... (NEAR implicit/public key format)
  secretKey: string; // ed25519:... private key — handle with care
}

export interface EncryptedKeystore {
  version: 1;
  accountId: string;
  publicKey: string;
  /** PBKDF2(salt) -> AES-GCM(256) encrypted JSON of the raw secret key */
  crypto: EncryptedPayload;
  createdAt: string; // ISO timestamp
}

export interface EncryptedPayload {
  kdf: "pbkdf2-sha256";
  iterations: number;
  saltB64: string;
  ivB64: string;
  dataB64: string;
}

export type KeystoreSaveResult =
  | { ok: true }
  | { ok: false; error: string };

export type KeystoreLoadResult =
  | { ok: true; keystore: EncryptedKeystore }
  | { ok: false; error: string };

export type DecryptResult =
  | { ok: true; secretKey: string }
  | { ok: false; error: string };

/* ---------------- guards ---------------- */

function assertBrowser(): void {
  if (typeof window === "undefined" || typeof window.crypto?.subtle === "undefined") {
    throw new Error("wallet/keys is client-only: WebCrypto is unavailable on the server");
  }
}

const KEYSTORE_KEY = "vaultguard.wallet.keystore.v1";
const PBKDF2_ITERATIONS = 210_000;

/* ---------------- base64 helpers (browser-safe, no Buffer) ---------------- */

function u8ToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToU8(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

/* ---------------- key generation ---------------- */

/** Generate a fresh Ed25519 wallet: 12-word recovery phrase + NEAR keypair. Client-side only. */
export function generateWallet(): GeneratedWallet {
  assertBrowser();
  const { seedPhrase, publicKey, secretKey } = generateSeedPhrase();
  return { seedPhrase, publicKey, secretKey };
}

/** Derive a NEAR keypair from a 12-word recovery phrase. Throws on invalid phrase. */
export function keyPairFromSeedPhrase(seedPhrase: string): KeyPair {
  assertBrowser();
  const normalized = normalizeSeedPhrase(seedPhrase);
  if (!isValidSeedPhrase(normalized)) {
    throw new Error("That is not a valid 12-word recovery phrase — check the word order and spelling");
  }
  const { secretKey } = parseSeedPhrase(normalized);
  return KeyPair.fromString(secretKey as KeyPairString);
}

/** Parse a raw ed25519 secret key (ed25519:... format). Throws on invalid key. */
export function keyPairFromSecretKey(secretKey: string): KeyPair {
  assertBrowser();
  return KeyPair.fromString(secretKey.trim() as KeyPairString);
}

/* ---------------- password encryption (WebCrypto AES-GCM) ---------------- */

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  assertBrowser();
  const enc = new TextEncoder();
  const base = await window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(password: string, secretKey: string): Promise<EncryptedPayload> {
  assertBrowser();
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const plain = new TextEncoder().encode(secretKey);
  const data = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    plain.buffer as ArrayBuffer
  );
  return {
    kdf: "pbkdf2-sha256",
    iterations: PBKDF2_ITERATIONS,
    saltB64: u8ToB64(salt),
    ivB64: u8ToB64(iv),
    dataB64: u8ToB64(new Uint8Array(data)),
  };
}

export async function decryptSecret(password: string, payload: EncryptedPayload): Promise<string> {
  assertBrowser();
  const key = await deriveAesKey(password, b64ToU8(payload.saltB64));
  const dec = new TextDecoder();
  try {
    const ivBytes = b64ToU8(payload.ivB64);
    const dataBytes = b64ToU8(payload.dataB64);
    const plain = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes.buffer as ArrayBuffer },
      key,
      dataBytes.buffer as ArrayBuffer
    );
    return dec.decode(plain);
  } catch {
    throw new Error("Wrong password — could not decrypt the stored key");
  }
}

/* ---------------- localStorage keystore ---------------- */

export async function saveKeystore(
  accountId: string,
  publicKey: string,
  secretKey: string,
  password: string
): Promise<KeystoreSaveResult> {
  assertBrowser();
  try {
    const cryptoPayload = await encryptSecret(password, secretKey);
    const store: EncryptedKeystore = {
      version: 1,
      accountId: accountId.trim(),
      publicKey,
      crypto: cryptoPayload,
      createdAt: new Date().toISOString(),
    };
    window.localStorage.setItem(KEYSTORE_KEY, JSON.stringify(store));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save keystore" };
  }
}

export function loadKeystoreMeta(): KeystoreLoadResult {
  assertBrowser();
  try {
    const raw = window.localStorage.getItem(KEYSTORE_KEY);
    if (!raw) return { ok: false, error: "No wallet saved on this device yet" };
    const parsed = JSON.parse(raw) as EncryptedKeystore;
    if (parsed.version !== 1 || !parsed.accountId || !parsed.crypto) {
      return { ok: false, error: "Saved wallet data is corrupted or from an unknown version" };
    }
    return { ok: true, keystore: parsed };
  } catch {
    return { ok: false, error: "Saved wallet data is corrupted" };
  }
}

export async function unlockKeystore(password: string): Promise<DecryptResult> {
  assertBrowser();
  const meta = loadKeystoreMeta();
  if (!meta.ok) return { ok: false, error: meta.error };
  try {
    const secretKey = await decryptSecret(password, meta.keystore.crypto);
    return { ok: true, secretKey };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Decryption failed" };
  }
}

export function clearKeystore(): void {
  assertBrowser();
  window.localStorage.removeItem(KEYSTORE_KEY);
}
