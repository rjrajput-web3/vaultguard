# VAULTRY Phase 1 — Supported Network Matrix

**Verified 2026-11-02 ~23:45 IST. Every RPC below was actually called — nothing assumed.**
Product scope: 100% TESTNET-ONLY. No mainnet on any roadmap.

## EVM Testnets

| Chain | Testnet | RPC (verified) | Latency | Chain ID OK | Signing lib | Faucet (official) | Explorer | Verdict |
|---|---|---|---|---|---|---|---|---|
| Base | Base Sepolia | https://sepolia.base.org | 597ms | 84532 ✓ | ethers v6 (to install) | coinbase.com/faucets (account req.) | sepolia.basescan.org | **SUPPORTED** |
| Arbitrum | Arbitrum Sepolia | https://sepolia-rollup.arbitrum.io/rpc | 421ms | 421614 ✓ | ethers v6 (to install) | faucet.quicknode.com (account req.) | sepolia.arbiscan.io | **SUPPORTED** |
| Avalanche | Fuji | https://api.avax-test.network/ext/bc/C/rpc | 609ms | 43113 ✓ | ethers v6 (to install) | faucet.avax.network | testnet.snowtrace.io | **SUPPORTED** |
| Optimism | OP Sepolia | https://sepolia.optimism.io | 6225ms | 11155420 ✓ | ethers v6 (to install) | app.optimism.io/faucet | sepolia-optimism.etherscan.io | **PARTIAL** — RPC works but 6.2s latency; deprioritize |
| BNB Chain | BNB Testnet | https://data-seed-prebsc-1-s1.binance.org:8545 | 4562ms | 97 ✓ | ethers v6 (to install) | testnet.bnbchain.org/faucet-smart | testnet.bscscan.com | **PARTIAL** — RPC works but 4.6s latency; deprioritize |
| Ethereum | Sepolia | ALL FAILED — publicnode 403, rpc2.sepolia.org timeout | — | — | ethers v6 | sepoliafaucet.com (account req.) | sepolia.etherscan.io | **NOT SUPPORTED** — no reachable RPC from this environment |
| Polygon | Amoy | ALL FAILED — connection closed on both endpoints | — | — | ethers v6 | — | amoy.polygonscan.com | **NOT SUPPORTED** — no reachable RPC from this environment |

## Non-EVM

| Chain | Testnet | RPC (verified) | Latency | Signing lib | Faucet (official) | Explorer | Verdict |
|---|---|---|---|---|---|---|---|
| NEAR | Testnet | https://rpc.testnet.fastnear.com | 688ms | near-api-js ✓ (have) | helper.testnet.near.org ✓ (integrated) | testnet.nearblocks.io | **SUPPORTED** — already proven E2E |
| Solana | Devnet | https://api.devnet.solana.com | 1198ms | @solana/web3.js (to install) | faucet.solana.com / requestAirdrop (no account) | explorer.solana.com?cluster=devnet | **SUPPORTED** |
| Sui | Testnet | JSON-RPC **deprecated** on public fullnodes (must use gRPC/GraphQL) | — | @mysten/sui (not installed) | — | — | **NOT SUPPORTED** — no usable RPC without gRPC/GraphQL integration work |
| TRON | Nile | https://nile.trongrid.io OK | 1560ms | tronweb (not installed) | — | nile.tronscan.org | **NOT SUPPORTED** — out of Phase 2 scope; wallet+tx not built |
| TON | Testnet | https://testnet.toncenter.com OK | 1184ms | ton libs (not installed) | — | testnet.tonscan.org | **NOT SUPPORTED** — out of Phase 2 scope; wallet+tx not built |
| Bitcoin | Testnet3 | https://blockstream.info/testnet OK (height 5260519) | 1614ms | bitcoinjs-lib (not installed) | — | blockstream.info/testnet | **NOT SUPPORTED** — out of Phase 2 scope; wallet+tx not built |

## Cross-chain testnet solvers/bridges

| Route | Solver | Testnet support | Evidence | Verdict |
|---|---|---|---|---|
| NEAR-leg Intents | TidePool sandbox | YES | Live quotes + dry:false deposit intents + /v0/status polling + faucet — all called 2026-11-02 | **SUPPORTED** — the live swap rail |
| EVM↔EVM testnet | none found | NO | No public testnet bridge with usable API (LayerZero/Across testnets need deployed contracts) | **NOT SUPPORTED** — pairs labeled unsupported, never faked |
| EVM↔Solana testnet | none found | NO | Same as above | **NOT SUPPORTED** |
| RHEA / LI.FI | mainnet-only | NO | RHEA code removed from active tree 2026-11-02 per his order | **NOT SUPPORTED** |

## Phase 2 recommendation (3–4 reliable networks, complete E2E)

1. **NEAR Testnet** — proven (wallet, faucet, swaps, guardian all live)
2. **Solana Devnet** — RPC fast (1.2s), faucet needs no account, @solana/web3.js standard
3. **Base Sepolia** — RPC fast (597ms), ethers v6, shares EVM derivation with #4
4. **Arbitrum Sepolia** — RPC fastest EVM (421ms), same EVM stack as #3

EVM chains share one BIP39 phrase → m/44'/60'/0'/0/0 (same address on Base + Arbitrum).
Solana: m/44'/501'/0' (ed25519). NEAR: m/44'/397'/0' (ed25519, existing).

**Faucet honesty note:** EVM testnet faucets (Coinbase, QuickNode, Alchemy) require accounts —
his step. Solana devnet airdrop + NEAR helper faucet + TidePool faucet work without accounts.
Funding is verified by ACTUAL balance update, never fake success.
