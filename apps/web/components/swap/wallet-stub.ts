/**
 * VAULTGUARD swap UI — wallet integration STUB (workstream G).
 *
 * ------------------------------------------------------------------
 * TODO (wallet workstream): replace every stub below with the real
 * wallet adapter once wallet signing/connection lands. This file exists
 * so the swap UI can be built WITHOUT faking balances or addresses.
 * ------------------------------------------------------------------
 *
 * HONESTY CONTRACT for consumers of this module:
 *  - getBalance() returns null until a real wallet is wired — the swap
 *    UI renders "—" for balances, never a fabricated number.
 *  - getConnectedAddress() returns null until a real wallet is wired —
 *    the UI shows a "connect wallet" prompt, never a fake address.
 *  - connectWallet() resolves with { connected: false } and a
 *    human-readable reason, so the UI can say "wallet wiring in
 *    progress" instead of pretending a connection happened.
 */

export interface WalletConnectionResult {
  connected: boolean;
  address: string | null;
  /** Honest reason shown in the UI when connected === false. */
  reason: string;
}

/** True while this stub is active (i.e. no real wallet adapter wired yet). */
export const WALLET_STUB_ACTIVE = true;

/**
 * TODO (wallet workstream): return the connected wallet's address.
 * Currently always null — the swap UI shows a "connect wallet" prompt.
 */
export async function getConnectedAddress(): Promise<string | null> {
  return null;
}

/**
 * TODO (wallet workstream): return the on-chain balance (base units) of
 * `assetId` for the connected wallet.
 * Currently always null — the swap UI renders "—" for balances.
 */
export async function getBalance(_assetId: string): Promise<string | null> {
  return null;
}

/**
 * TODO (wallet workstream): open the real wallet connect flow and return
 * the connected address. Currently reports "not wired yet".
 */
export async function connectWallet(): Promise<WalletConnectionResult> {
  return {
    connected: false,
    address: null,
    reason: "wallet connection wiring in progress — handled by the wallet workstream",
  };
}
