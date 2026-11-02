# VAULTGUARD — submission form fields (NEAR "Build Beyond Boundaries")
# Prepared 2026-11-02. DO NOT submit — parent agent handles repo + form submit.

## Project name
VAULTGUARD

## One-line description
A self-protecting cross-chain vault on RHEA X Chain SDK + NEAR Intents — pre-flight risk
scanning, smart route fallback, user spending limits, and on-chain enforcement. Never blind swaps.

## Long description
In April 2026, a single flawed swap function drained $18.4M from RHEA. VAULTGUARD is an
independent safety and recovery layer wrapped around cross-chain execution: (1) a pre-flight
risk scanner scoring every quote 0–100 with SAFE/CAUTION/BLOCKED verdicts; (2) a smart route
guardian that falls back to healthy alternatives (NEAR Intents fallback when RHEA degrades)
with a human-readable decision trail; (3) user-defined spending limits and asset permissions
via a policy editor; (4) stablecoin depeg detection with automatic vault pause; (5) a NEAR
smart contract enforcing the per-transaction spend cap and pause flag on-chain as the final
authority. Proven on NEAR testnet: 6 real transactions — 500 USDC approved, 2000 USDC rejected
by the contract, guardian pause/unpause recovery end-to-end. 100% original work, solo build.

## Track
Unstoppable DeFi

## Tech stack
NEAR (near-sdk-js smart contract, testnet), RHEA X Chain SDK, NEAR Intents 1Click API,
TypeScript, Next.js 14, Node.js

## Repository URL
[TO FILL — public GitHub repo, created at submission time]

## Demo video URL
[TO FILL — public YouTube link, <3 min]
Local file: ~/workspace/vaultguard/demo/vaultguard-demo.mp4

## Live demo / contract
NEAR testnet contract: vaultguard.vgdeployer.testnet
Web UI: run locally per README (npm run dev)

## Payout address (NEAR mainnet)
exxxmusk.tg

## Team
Solo — Rohit Rajput

## Originality statement
100% original work built Nov 1–2, 2026 for this hackathon. No templates or tutorial
redeploys. Repo source matches the deployed testnet contract byte-for-byte
(reproducible build). AI-assisted development disclosed.
