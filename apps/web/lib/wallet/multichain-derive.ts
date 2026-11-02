/**
 * VAULTRY multi-chain BIP44 derivation — CLIENT-SIDE ONLY.
 *
 * HONESTY / SECURITY CONTRACT (binding, same as lib/wallet/keys.ts):
 * - One BIP39 mnemonic -> per-chain keys via standard BIP44 paths:
 *     EVM    m/44'/60'/0'/0/0   (shared address across EVM testnets)
 *     Solana m/44'/501'/0'/0'
 *     NEAR   m/44'/397'/0'      (implicit 64-hex account)
 * - This module performs ZERO network calls. No fetch() anywhere below.
 * - Browser-only: throws during SSR (WebCrypto/subtle not needed here, but
 *   the module is still client-only by policy — keys must never exist
 *   server-side).
 */

import { mnemonicToSeedSync, validateMnemonic } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";
import { Wallet as EthersWallet } from "ethers";
import { KeyPair, type KeyPairString } from "near-api-js";
import bs58 from "bs58";
import "../polyfills";

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error("multichain-derive is client-only: keys must never exist server-side");
  }
}

export interface MultiChainAddresses {
  /** EVM address (0x…), shared across Sepolia + Base Sepolia */
  evmAddress: string;
  /** Solana devnet address (base58) */
  solanaAddress: string;
  /** NEAR implicit account id (64 hex chars) */
  nearImplicitAccountId: string;
  /** NEAR public key (ed25519:…) */
  nearPublicKey: string;
}

/** Raw per-chain secrets — memory only, never persisted except encrypted. */
export interface MultiChainSecrets {
  /** EVM private key (0x…) */
  evmPrivateKey: string;
  /** Solana secret key (base58, 64 bytes) */
  solanaSecretKey: string;
  /** NEAR secret key (ed25519:… base58, 64 bytes) */
  nearSecretKey: string;
}

export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isValidMnemonic(mnemonic: string): boolean {
  const n = normalizeMnemonic(mnemonic);
  const words = n.split(" ");
  return (words.length === 12 || words.length === 24) && validateMnemonic(n);
}

/**
 * Derive ALL chain addresses from one mnemonic. Pure computation —
 * deterministic, no network. Throws on invalid mnemonic.
 */
export function deriveAllAddresses(mnemonic: string): MultiChainAddresses {
  assertBrowser();
  const norm = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(norm)) throw new Error("Invalid recovery phrase");
  const seed = mnemonicToSeedSync(norm); // 64-byte BIP39 seed

  // EVM — ethers default derivation is exactly m/44'/60'/0'/0/0
  const evmWallet = EthersWallet.fromPhrase(norm);
  const evmAddress = evmWallet.address;

  // Solana — SLIP-0010 ed25519 via m/44'/501'/0'/0'
  const solDerived = derivePath("m/44'/501'/0'/0'", seed.toString("hex"));
  const solKeypair = Keypair.fromSeed(solDerived.key);
  const solanaAddress = solKeypair.publicKey.toBase58();

  // NEAR — ed25519 via m/44'/397'/0'; implicit account = hex(pubkey)
  const nearDerived = derivePath("m/44'/397'/0'", seed.toString("hex"));
  const nearKeypair = Keypair.fromSeed(nearDerived.key);
  const nearPubBytes = nearKeypair.publicKey.toBytes();
  const nearImplicitAccountId = Buffer.from(nearPubBytes).toString("hex");
  const secret64 = nearKeypair.secretKey; // 64 bytes: seed||pubkey
  const nearSecretKey = `ed25519:${bs58.encode(secret64)}`;
  const nearPublicKey = KeyPair.fromString(nearSecretKey as KeyPairString).getPublicKey().toString();

  return { evmAddress, solanaAddress, nearImplicitAccountId, nearPublicKey };
}

/**
 * Derive the raw per-chain secrets. MEMORY ONLY — the caller must never
 * persist these except through the encrypted keystore (multichain-store.ts).
 */
export function deriveAllSecrets(mnemonic: string): MultiChainSecrets {
  assertBrowser();
  const norm = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(norm)) throw new Error("Invalid recovery phrase");
  const seed = mnemonicToSeedSync(norm);

  const evmWallet = EthersWallet.fromPhrase(norm);
  const evmPrivateKey = evmWallet.privateKey;

  const solDerived = derivePath("m/44'/501'/0'/0'", seed.toString("hex"));
  const solKeypair = Keypair.fromSeed(solDerived.key);
  const solanaSecretKey = bs58.encode(solKeypair.secretKey);

  const nearDerived = derivePath("m/44'/397'/0'", seed.toString("hex"));
  const nearKeypair = Keypair.fromSeed(nearDerived.key);
  const nearSecretKey = `ed25519:${bs58.encode(nearKeypair.secretKey)}`;

  return { evmPrivateKey, solanaSecretKey, nearSecretKey };
}
