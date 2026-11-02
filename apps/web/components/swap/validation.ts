/**
 * VAULTGUARD swap UI — destination/refund address validation (workstream G).
 *
 * Validates per destination chain:
 *  - Solana ("sol"): base58, 32–44 chars
 *  - NEAR ("near"): NEAR account id (e.g. name.near / name.testnet)
 *  - Everything else: EVM-shaped 0x + 40 hex. The live Intents registry
 *    does not label chains as EVM/non-EVM, so this is an explicitly
 *    documented assumption, not a verified chain-type lookup.
 */

export type AddrValidation = { ok: true } | { ok: false; reason: string };

const BASE58_ALPHABET = /^[1-9A-HJ-NP-Za-km-z]+$/;
/** NEAR account ids: 2–64 chars, lowercase alnum + _ + -, dot-separated. */
const NEAR_ACCOUNT = /^(?=.{2,64}$)([a-z0-9_-]+\.)*[a-z0-9_-]+$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isNearChain(chain: string): boolean {
  return chain.trim().toLowerCase() === "near";
}

export function validateChainAddress(address: string, chain: string): AddrValidation {
  const v = address.trim();
  if (!v) return { ok: false, reason: "address is required" };
  const c = chain.trim().toLowerCase();

  if (c === "sol") {
    if (v.length >= 32 && v.length <= 44 && BASE58_ALPHABET.test(v)) return { ok: true };
    return { ok: false, reason: "not a valid Solana address (base58, 32–44 characters)" };
  }
  if (c === "near") {
    if (NEAR_ACCOUNT.test(v.toLowerCase())) return { ok: true };
    return { ok: false, reason: "not a valid NEAR account id (e.g. name.near)" };
  }
  if (EVM_ADDRESS.test(v)) return { ok: true };
  return {
    ok: false,
    reason: `expected an EVM-style 0x address for chain "${chain}"`,
  };
}
