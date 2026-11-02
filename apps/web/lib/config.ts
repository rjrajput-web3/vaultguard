/**
 * Product scope flags — single source of truth (2026-11-02).
 *
 * VAULTRY is TESTNET-ONLY until Rohit explicitly approves mainnet.
 * - MAINNET_ENABLED=false: all mainnet code paths (RHEA executable panel,
 *   1Click dry-run section, EVM/Solana external connects, mainnet keystore)
 *   are compiled but NOT reachable from any user-facing UI. The code stays
 *   clean and isolated so future mainnet support needs no rewrite.
 * - No mainnet transaction may be built, signed, or executed from the UI
 *   while this is false. Testnet only, always.
 */
export const MAINNET_ENABLED = false;

/** Persistent product-mode label shown across the UI. */
export const PRODUCT_MODE_LABEL = "TESTNET MODE";
