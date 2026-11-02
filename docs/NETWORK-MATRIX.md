# VAULTRY Network Matrix — REAL RPC verification (2026-11-03 ~00:05 IST)

Every row below was verified with a LIVE RPC call from the build VM
(`docs/network-matrix-verify.py` + curl follow-ups). Nothing is assumed.
Status reflects what the call returned, not what docs claim.

## Core networks (VAULTRY multi-chain wallet — complete E2E)

| Chain | Testnet | Chain ID | RPC (verified working) | Status | Faucet | Explorer |
|---|---|---|---|---|---|---|
| NEAR | Testnet | testnet | https://rpc.testnet.fastnear.com | ✅ OK — block 275,936,414, 810ms | https://near-faucet.io · TidePool /api/tidepool/faucet | https://testnet.nearblocks.io/txns/{hash} |
| Ethereum | Sepolia | 11155111 | https://sepolia.gateway.tenderly.co | ✅ OK — chainId 0xaa36a7 | https://sepoliafaucet.com · https://stakely.io/faucet | https://sepolia.etherscan.io/tx/{hash} |
| Base | Sepolia | 84532 | https://sepolia.base.org | ✅ OK — chainId 0x14a34 | https://www.alchemy.com/faucets/base-sepolia | https://sepolia.basescan.org/tx/{hash} |
| Solana | Devnet | — | https://api.devnet.solana.com | ✅ OK — getHealth=ok, slot 517,945,931 | https://faucet.solana.com | https://explorer.solana.com/tx/{sig}?cluster=devnet |

Wallet support: one BIP39 phrase → BIP44 derivation —
EVM `m/44'/60'/0'/0/0` (shared address across EVM testnets),
Solana `m/44'/501'/0'/0'`, NEAR `m/44'/397'/0'`.
Tokens: native gas token per chain (real on-chain balance, never invented).
Bridge/solver: TidePool testnet sandbox covers NEAR Intents legs
(USDC/USDT/wNEAR/wBTC/ETH/XAUT test tokens). EVM↔EVM testnet bridging
does NOT exist on any genuine public testnet route → labeled
NOT SUPPORTED, never faked.
Swap status: NEAR-leg testnet swaps LIVE via TidePool (proven E2E on-chain).

## Evaluated — NOT added (honest reasons)

| Chain | Testnet | Result | Verdict |
|---|---|---|---|
| Arbitrum | Sepolia | ✅ RPC OK (chainId 421614) via sepolia-rollup.arbitrum.io | Candidate for later — RPC works, deferred to keep 4-chain E2E quality bar |
| Optimism | Sepolia | ✅ RPC OK (chainId 11155420) via sepolia.optimism.io | Candidate for later — deferred |
| Polygon | Amoy | ✅ RPC OK (chainId 80002) via polygon-amoy.drpc.org | Candidate for later — deferred |
| BNB Chain | Testnet | ✅ RPC OK (chainId 97) via data-seed-prebsc-1-s1.bnbchain.org | Candidate for later — deferred |
| Avalanche | Fuji | ✅ RPC OK (chainId 43113) via api.avax-test.network | Candidate for later — deferred |
| Sui | Testnet | ❌ JSON-RPC deprecated on public fullnodes (migrate to gRPC/GraphQL) | NOT SUPPORTED — no simple genuine integration path |
| Tron | Shasta | ✅ RPC OK (block 69,778,622) | NOT added — different key/address model; out of scope for the 4-chain E2E |
| Bitcoin | Testnet | ✅ API OK (block 5,260,529) | NOT added — UTXO model needs dedicated wallet engineering; out of scope |
| TON | Testnet | ✅ RPC OK (very slow, 22s latency) | NOT added — latency + distinct key model; out of scope |

## Notes
- publicnode.com EVM endpoints returned 403/RemoteDisconnected from this
  VM's egress (IP-based blocking) — replaced with the working endpoints above.
- Blast Sepolia endpoint is discontinued ("Blast API is no longer available").
- Faucets are official links only. Funding is shown as confirmed ONLY after
  the chain's RPC reports a balance — never from a faucet HTTP response.
