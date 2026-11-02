/**
 * VAULTRY multi-chain registry — TESTNET ONLY (2026-11-03).
 *
 * Pure configuration. No network calls, no keys. Every RPC URL below was
 * verified with a LIVE call on 2026-11-03 (see docs/NETWORK-MATRIX.md).
 * Core wallet supports 4 testnets E2E; other verified networks are listed
 * as candidates (not yet wired — never claimed as working).
 */

export type ChainKind = "evm" | "solana" | "near";

export interface ChainDef {
  /** stable id used in API routes + UI */
  id: "sepolia" | "base-sepolia" | "solana-devnet" | "near-testnet";
  name: string;
  testnetName: string;
  kind: ChainKind;
  /** EVM chain id (decimal). Undefined for non-EVM. */
  chainId?: number;
  rpcUrl: string;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerTx: (hash: string) => string;
  explorerAddress: (address: string) => string;
  faucetUrl: string;
  faucetNote: string;
  derivationPath: string;
  /** E2E-wired in the wallet UI. */
  supported: true;
}

export const CORE_CHAINS: ChainDef[] = [
  {
    id: "near-testnet",
    name: "NEAR",
    testnetName: "NEAR Testnet",
    kind: "near",
    rpcUrl: "https://rpc.testnet.fastnear.com",
    nativeSymbol: "NEAR",
    nativeDecimals: 24,
    explorerTx: (h) => `https://testnet.nearblocks.io/txns/${h}`,
    explorerAddress: (a) => `https://testnet.nearblocks.io/address/${a}`,
    faucetUrl: "https://near-faucet.io",
    faucetNote: "Official NEAR testnet faucet — or use the VAULTRY faucet page for a guided flow.",
    derivationPath: "m/44'/397'/0'",
    supported: true,
  },
  {
    id: "sepolia",
    name: "Ethereum",
    testnetName: "Sepolia",
    kind: "evm",
    chainId: 11155111,
    rpcUrl: "https://sepolia.gateway.tenderly.co",
    nativeSymbol: "SepoliaETH",
    nativeDecimals: 18,
    explorerTx: (h) => `https://sepolia.etherscan.io/tx/${h}`,
    explorerAddress: (a) => `https://sepolia.etherscan.io/address/${a}`,
    faucetUrl: "https://sepoliafaucet.com",
    faucetNote: "Alchemy Sepolia faucet (free account) or stakely.io/faucet — no signup.",
    derivationPath: "m/44'/60'/0'/0/0",
    supported: true,
  },
  {
    id: "base-sepolia",
    name: "Base",
    testnetName: "Base Sepolia",
    kind: "evm",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    nativeSymbol: "BaseSepoliaETH",
    nativeDecimals: 18,
    explorerTx: (h) => `https://sepolia.basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://sepolia.basescan.org/address/${a}`,
    faucetUrl: "https://www.alchemy.com/faucets/base-sepolia",
    faucetNote: "Alchemy Base Sepolia faucet (free account).",
    derivationPath: "m/44'/60'/0'/0/0",
    supported: true,
  },
  {
    id: "solana-devnet",
    name: "Solana",
    testnetName: "Solana Devnet",
    kind: "solana",
    rpcUrl: "https://api.devnet.solana.com",
    nativeSymbol: "Devnet SOL",
    nativeDecimals: 9,
    explorerTx: (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`,
    explorerAddress: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
    faucetUrl: "https://faucet.solana.com",
    faucetNote: "Official Solana faucet — request a devnet airdrop for your address.",
    derivationPath: "m/44'/501'/0'/0'",
    supported: true,
  },
];

/** Verified-working but NOT yet wired into the wallet — never shown as supported. */
export const CANDIDATE_CHAINS: { name: string; testnet: string; note: string }[] = [
  { name: "Arbitrum", testnet: "Sepolia", note: "RPC verified (chain 421614) — deferred to keep the 4-chain E2E quality bar" },
  { name: "Optimism", testnet: "Sepolia", note: "RPC verified (chain 11155420) — deferred" },
  { name: "Polygon", testnet: "Amoy", note: "RPC verified (chain 80002) — deferred" },
  { name: "BNB Chain", testnet: "Testnet", note: "RPC verified (chain 97) — deferred" },
  { name: "Avalanche", testnet: "Fuji", note: "RPC verified (chain 43113) — deferred" },
];

export function getChain(id: string): ChainDef | undefined {
  return CORE_CHAINS.find((c) => c.id === id);
}

/** Cross-chain testnet swap routes that genuinely exist right now. */
export interface SwapRouteInfo {
  from: string;
  to: string;
  via: string;
  status: "live" | "unsupported";
  note: string;
}

export const TESTNET_SWAP_ROUTES: SwapRouteInfo[] = [
  {
    from: "NEAR Testnet",
    to: "NEAR Testnet",
    via: "TidePool Intents sandbox",
    status: "live",
    note: "USDC / USDT / wNEAR / wBTC / ETH / XAUT test tokens — live quotes, guardian-scored, real on-chain settlement.",
  },
  {
    from: "Ethereum Sepolia",
    to: "Base Sepolia",
    via: "—",
    status: "unsupported",
    note: "No genuine public testnet bridge exists for EVM↔EVM testnet pairs. Not faked — same-chain transfers are never labeled cross-chain swaps.",
  },
  {
    from: "Any EVM testnet",
    to: "Solana Devnet",
    via: "—",
    status: "unsupported",
    note: "No genuine public testnet bridge exists for EVM↔Solana testnet pairs.",
  },
  {
    from: "NEAR Testnet",
    to: "EVM / Solana testnets",
    via: "—",
    status: "unsupported",
    note: "TidePool covers NEAR Intents legs only. Cross-ecosystem testnet settlement has no genuine route today.",
  },
];
