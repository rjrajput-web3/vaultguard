/**
 * NEAR network config — TESTNET ONLY (2026-11-02).
 *
 * VAULTRY is a testnet-only product. There is no mainnet config, no
 * mainnet keystore slot, and no mainnet connection path anywhere in the
 * active codebase (per his explicit order; mainnet work lives in git
 * history + docs only).
 */

export interface NearNetworkConfig {
  networkId: "testnet";
  rpcUrl: string;
  explorerTxUrl: (txHash: string) => string;
  explorerAccountUrl: (accountId: string) => string;
  nearblocksApi: string;
  keystoreKey: string;
  faucetUrl: string;
}

export const NEAR_TESTNET: NearNetworkConfig = {
  networkId: "testnet",
  rpcUrl: "https://rpc.testnet.fastnear.com",
  explorerTxUrl: (txHash) => `https://testnet.nearblocks.io/txns/${txHash}`,
  explorerAccountUrl: (accountId) => `https://testnet.nearblocks.io/address/${accountId}`,
  nearblocksApi: "https://api-testnet.nearblocks.io",
  keystoreKey: "vaultguard.wallet.keystore.v1.testnet",
  faucetUrl: "https://near-faucet.io",
};

/** Pre-audit storage slot (network-less key). Migrated once, then abandoned. */
export const LEGACY_KEYSTORE_KEY = "vaultguard.wallet.keystore.v1";

/**
 * One-time migration: a wallet saved before the audit was always a testnet
 * wallet. Copy it into the testnet slot so existing users keep access.
 * Safe to call repeatedly — no-ops once migrated.
 */
export function migrateLegacyKeystore(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const legacy = window.localStorage.getItem(LEGACY_KEYSTORE_KEY);
    if (!legacy) return;
    if (window.localStorage.getItem(NEAR_TESTNET.keystoreKey)) return;
    const parsed = JSON.parse(legacy) as { version?: number; accountId?: string };
    if (parsed.version !== 1 || !parsed.accountId) return;
    window.localStorage.setItem(NEAR_TESTNET.keystoreKey, legacy);
  } catch {
    /* corrupted legacy data — leave it alone, user can re-import */
  }
}
