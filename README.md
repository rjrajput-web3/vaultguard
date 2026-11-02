# VAULTRY — Guardian-Scored Cross-Chain Swaps. Refuses to Swap Blind.

> **Built as VAULTGUARD and renamed VAULTRY for public launch — the underlying
> NEAR security contract remains `vaultguard.vgdeployer.testnet`.**
> **100% TESTNET-ONLY.** Every token is valueless. No mainnet, no real funds — by design.

**NEAR Hackathon "Build Beyond Boundaries" · Nov 1–14, 2026**
**Primary track: Unstoppable DeFi · Secondary track: AI Security & Defense**

In April 2026, a single flawed swap function drained **$18.4M**. DeFi keeps dying the same
way: blind swaps, no pre-flight checks, no limits. VAULTRY is the fix: **every cross-chain
swap is risk-scored by the Route Guardian BEFORE anything is signed** — SAFE executes,
CAUTION needs your explicit per-quote approval, BLOCKED cannot execute. Your Policy Console
(spending caps, router allow-list, emergency pause) is enforced by the guardian on every
swap, not just displayed.

> **Never blind swaps.** The guardian is the gate, not a badge.

🎬 **Demo video:** _(YouTube link added at submission)_
🔗 **VAULTRY security contract (NEAR testnet):** `vaultguard.vgdeployer.testnet`
🌐 **Live demo:** https://vaultry.vercel.app

## What VAULTRY does that others don't

1. **Route Guardian (the core)** — every quote is scored 0–100 from live data before signing:
   intent revalidation, slippage bands, quote freshness, recipient validation, spending caps,
   emergency pause, router allow-list. Verdicts: **SAFE / CAUTION / BLOCKED**. BLOCKED swaps
   cannot be overridden. CAUTION needs an explicit checkbox for *that specific quote*.
2. **Policy Console (your fund-protection controls)** — per-transaction and per-day spending
   caps, allowed routers, emergency pause. Stored on your device only, enforced by the
   guardian before every signature. A limit that doesn't enforce is a broken promise —
   these do (8/8 enforcement proofs pass; see below).
3. **Executable testnet swaps** — live TidePool Intents quotes → guardian scan → policy
   gate → your keystore signs the deposit → on-chain settlement with real tx hashes.
   Pairs with no genuine testnet route are labeled **unsupported**, never faked.
4. **Multi-chain testnet wallet** — one recovery phrase, per-chain addresses (NEAR testnet
   live; Solana devnet + Base/Arbitrum Sepolia verified, building out). Keys never leave
   your browser — encrypted client-side, never transmitted.
5. **Device-side privacy** — keys, policies, and session data stay in your browser's
   localStorage. No account, no server-side profile, no tracking.

## Judge walkthrough (reproducible, ~5 minutes, fresh visitor)

> Start in a fresh browser/incognito. Everything below works with zero setup.

**1. See the guardian refuse a blind swap (30s)**
- Open https://vaultry.vercel.app/security
- Click **"Run live scan"** → a LIVE TidePool testnet quote is fetched and scored.
- See: risk score /100, SAFE/CAUTION/BLOCKED verdict, the exact reasons.
- *Try it:* add `vgdeployer.testnet` to the **Denylist**, re-run → the scan flags it.

**2. Feel the Policy Console enforce (60s)**
- Open https://vaultry.vercel.app/policy
- Set **Max spend per tx** to `$0.01`, save.
- Go to https://vaultry.vercel.app/swap → get a quote → guardian verdict is now
  **BLOCKED**: "exceeds your per-transaction cap".
- Flip **Emergency pause** ON → every swap is BLOCKED until you unpause.
- *This is the differentiator:* the limits aren't UI labels — they gate execution.

**3. Execute a real testnet swap (2 min)**
- Open https://vaultry.vercel.app/wallet → **Create wallet** → save the 12-word phrase
  (backup verification required) → fund it via the **testnet faucet** link.
- Click **"Get test tokens (faucet)"** on https://vaultry.vercel.app/swap for test USDC.
- On /swap: enter amount → **"Get live quote"** → watch the guardian radar scan →
  verdict → **"Execute swap"** → unlock with your password → deposit signed →
  settlement polled → **both tx hashes with explorer links**.
- *CAUTION path:* raise the amount until slippage triggers CAUTION → the checkbox
  appears → execution stays disabled until you explicitly acknowledge *that quote*.

**4. Verify on-chain (30s)**
- Every tx hash links to testnet.nearblocks.io. The security contract
  `vaultguard.vgdeployer.testnet` is verifiable on the explorer.

## Proven on-chain (NEAR testnet, real transactions)

**Spending-guard contract** `vaultguard.vgdeployer.testnet` — 6 transactions, verdict **PASS**:

| # | Action | Result |
|---|--------|--------|
| 1 | Withdraw 500 USDC (within 1000 cap) | ✅ APPROVED — `EEHfcL14YnABocSomyUJGNTozoBQFrLRHqinPAa2na5j` |
| 2 | Withdraw 2000 USDC (over cap) | ❌ REJECTED — `VAULTGUARD: amount exceeds per-tx spend cap` |
| 3 | Guardian `set_paused(true)` | ✅ OK — `Dq8R4nZqRoSsUYnHD2MTh4NNVjrMF9k5cRLhBJ3PcdWo` |
| 4 | Withdraw 100 USDC while paused | ❌ REJECTED — `VAULTGUARD: vault is paused — guardian halt in effect` |
| 5 | Guardian `set_paused(false)` | ✅ OK — `FR5g2Xm9fCK63Tj9sG91jGcTLYbpQxdGERo1Vb2nvkfB` |
| 6 | Withdraw 100 USDC after unpause | ✅ APPROVED — `Goz6hbkT5LyVdKCP7sv4SZqMJ4dE98hqRB3CaHqYgbNy` |

**TidePool testnet swap E2E** (2026-11-02, 1 test USDC → ~0.2494 test wNEAR):

| Step | Tx hash |
|---|---|
| Deposit (ft_transfer) | `4gXiMecSKJ3DU4hmg3149pX7kFwVZnBxfDUhznvmaWNZ` |
| Settlement | `2cCAGm9gaXofQQ9wD27WXJnyc8rqaYyh2R4HhjYvwcvo` |

**Guardian enforcement proofs** (8/8 PASS, `apps/web/lib/guardian/guardian-proof.ts`):
normal quote → SAFE · paused → BLOCKED · over per-tx cap → BLOCKED ·
router disallowed → BLOCKED · extreme slippage → BLOCKED · 1.5% slippage → CAUTION ·
invalid recipient → BLOCKED · amount mismatch → BLOCKED.

**Wallet crypto E2E** (all pass): phrase→keypair derivation matches shown address ·
AES-GCM/PBKDF2-210k encrypt/decrypt roundtrip · wrong password rejected ·
invalid phrases rejected · import restores the same address.

## Supporting infra (how to try it)

- **Wallet:** `/wallet` — create/import NEAR testnet wallet, encrypted keystore on-device.
- **Faucets:** NEAR testnet (official helper, integrated in lab) + TidePool test-token
  faucet (`/api/tidepool/faucet`, rate-limited per account) + "Get test tokens" on /swap.
- **Testnets:** NEAR testnet (live). Solana devnet, Base Sepolia, Arbitrum Sepolia
  RPC-verified — see `PHASE1-NETWORK-MATRIX.md` for the full 13-chain matrix.
- **Live Testing Lab:** `/lab` — 8-step visitor session (wallet → faucet → quote →
  risk scan → detectors → policy → contract → review), per-visitor isolated.
- **Policy Console:** `/policy` — device-local, per-visitor.

## Architecture

```
Visitor browser (keys, policy, session — never leave the device)
    │  live quotes (dry-run)          signed txs (testnet RPC)
    ▼                                 ▼
/api/tidepool/* ──→ TidePool sandbox ──→ NEAR testnet
    │  (quote/execute/status/faucet proxies, testnet-only)
    ▼
Route Guardian (checkTestnetSwap) ──→ SAFE/CAUTION/BLOCKED
    │  reads device-local policy (pause, caps, routers)
    ▼
Keystore unlock (password, client-side) → ft_transfer → settlement polling
```

**Honesty rules (enforced in code):** no fake quotes — unsupported pairs are labeled
unsupported; no fake balances — empty states say so; RHEA/LI.FI are mainnet-only and
NOT SUPPORTED (code removed from the active tree; preserved in git history + docs).

## Run locally

```bash
cd apps/web && npm install && npm run dev   # http://localhost:3000
npx tsc --noEmit && npx next build          # must both pass
```

Deployed: https://vaultry.vercel.app (Vercel, auto-deploys `main`).
