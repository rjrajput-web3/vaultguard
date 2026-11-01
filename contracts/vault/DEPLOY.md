# VAULTGUARD testnet deploy

TESTNET ONLY. No mainnet, no real funds.

## Status

- [x] Contract builds to `build/contract.wasm` (near-sdk-js 2.0.0, verified 2026-11-01)
- [x] Deploy script ready: `scripts/deploy-testnet.mjs`
- [ ] **BLOCKED on one step from him** (see below) — no testnet deployer key exists yet

## His one step (on his own device, ~2 minutes)

1. Create a free testnet wallet at **https://wallet.testnet.near.org**
   (comes with testnet NEAR; no real money, no card, no KYC).
2. In the wallet, export the account's **private key** (`ed25519:...` format).
3. Send it to Muse via a Secure Vault link (never paste keys in chat).

Then deploy is one command:

```bash
cd ~/workspace/vaultguard/contracts/vault
cp .env.example .env   # fill NEAR_DEPLOYER_ACCOUNT + NEAR_DEPLOYER_KEY
npm run deploy:testnet
```

## What the script does

1. Creates subaccount `vaultguard.<deployer>.testnet` (reuses it if it exists)
2. Deploys `build/contract.wasm`
3. Calls `init` with guardian = deployer, per-tx cap = 1000 USDC
   (from `apps/guardian/config/policy.json`), allowed assets = Base USDC + NEAR USDC
4. Verifies with a `get_status` view call

## Rebuild

```bash
npm run build   # near-sdk-js → build/contract.wasm
```
