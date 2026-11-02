/**
 * NEAR network configs — the single source of truth for testnet/mainnet
 * separation (2026-11-02 audit).
 *
 * HARD RULE: testnet and mainnet state NEVER mix. Each network has its own
 * RPC endpoint, explorer, and encrypted keystore slot in localStorage.
 * A key saved on testnet is invisible to mainnet flows and vice versa.
 */

export type NearNetwork = "testnet" | "mainnet";

export interface NearNetworkConfig {
  network: NearNetwork;
  networkId: string;
  rpcUrl: string;
  explorerTxUrl: (hash: string) => string;
  explorerAccountUrl: (accountId: string) => string;
  /** Nearblocks REST base for read-only tx history (no key needed). */
  nearblocksApi: string;
  /** localStorage slot for this network's encrypted keystore. */
  keystoreKey: string;
  label: string;
  isMainnet: boolean;
  /** Free test-token faucet (testnet only). */
  faucetUrl?: string;
  accountHint: string;
}

export const NEAR_NETWORKS: Record<NearNetwork, NearNetworkConfig> = {
  testnet: {
    network: "testnet",
    networkId: "testnet",
    rpcUrl: "https://rpc.testnet.fastnear.com",
    explorerTxUrl: (h) => `https://explorer.testnet.near.org/transactions/${h}`,
    explorerAccountUrl: (a) => `https://explorer.testnet.near.org/accounts/${a}`,
    nearblocksApi: "https://testnet.nearblocks.io",
    keystoreKey: "vaultguard.wallet.keystore.v1.testnet",
    label: "NEAR Testnet",
    isMainnet: false,
    faucetUrl: "https://near-faucet.io",
    accountHint: "myname.testnet",
  },
  mainnet: {
    network: "mainnet",
    networkId: "mainnet",
    rpcUrl: "https://rpc.mainnet.fastnear.com",
    explorerTxUrl: (h) => `https://explorer.near.org/transactions/${h}`,
    explorerAccountUrl: (a) => `https://explorer.near.org/accounts/${a}`,
    nearblocksApi: "https://api.nearblocks.io",
    keystoreKey: "vaultguard.wallet.keystore.v1.mainnet",
    label: "NEAR Mainnet",
    isMainnet: true,
    accountHint: "you.near",
  },
};

/** Pre-separation storage slot (testnet-only era). Migrated once, then abandoned. */
export const LEGACY_KEYSTORE_KEY = "vaultguard.wallet.keystore.v1";

/**
 * One-time migration: a wallet saved before network separation was always a
 * testnet wallet. Copy it into the testnet slot so existing users keep access.
 * Safe to call repeatedly — no-ops once migrated.
 */
export function migrateLegacyKeystore(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const legacy = window.localStorage.getItem(LEGACY_KEYSTORE_KEY);
    if (!legacy) return;
    const testnetKey = NEAR_NETWORKS.testnet.keystoreKey;
    if (window.localStorage.getItem(testnetKey)) return; // already migrated
    // Sanity: only migrate something that looks like our keystore shape.
    const parsed = JSON.parse(legacy) as { version?: number; accountId?: string };
    if (parsed.version !== 1 || !parsed.accountId) return;
    window.localStorage.setItem(testnetKey, legacy);
  } catch {
    /* corrupted legacy data — leave it alone, user can re-import */
  }
}
