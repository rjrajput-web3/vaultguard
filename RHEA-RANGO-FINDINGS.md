# RHEA Rango "Invalid wallet" — Investigation Findings (2026-11-02)

## Symptom
`buildSwap` via the `rango` router fails with:
`"Invalid wallet for SOLANA: 0x53CFA0C9EB10E352fC5B4DaAC1A9Eac2267303F9"`
for a valid EVM sender on a Base→Solana swap.

## Evidence (all verified live 2026-11-02 via rhea_bridge.py)

1. **Base→Ethereum (EVM→EVM) via rango: BUILD SUCCEEDS.**
   Real tx payload returned (chainId 8453, valid EVM calldata). Rango works
   when source and destination are both EVM.

2. **Base→Solana via rango, EVM sender (correct for Base): BUILD FAILS.**
   `"Invalid wallet for SOLANA: 0x53CF..."` — the sender is validated
   against the DESTINATION chain (Solana) instead of the source (Base).

3. **Base→Solana via rango, Solana sender (wrong for Base, test only):
   BUILD FAILS.**
   `"Invalid wallet for BASE: G2B8..."` — now the sender is validated
   against the SOURCE chain instead.

4. **"Invalid wallet" appears nowhere in the SDK source** (v2.1.9) — it is a
   RHEA API-side error (errorCode 1201).

## Verdict: RHEA-SIDE BUG
RHEA's rango router adapter validates the `sender` wallet address against the
wrong chain — inconsistently against source or destination — making rango
unusable for Base→Solana (and likely any EVM→non-EVM route) regardless of
which address is supplied. **This cannot be fixed from our side.** It is not
an SDK usage error: the sender/recipient pair is correct per RHEA's own API
contract (sender = source-chain wallet, recipient = destination-chain wallet).

## Resolution (honest, no workarounds)
- **LI.FI is the working fallback** for Base→Solana: builds succeed
  (`excludeDexs:["rango"]`), verified with executionId + real tx payload.
- The guardian/web panel keeps `excludeDexs:["rango"]` for Solana
  destinations. Rango remains available for EVM→EVM routes where it builds
  correctly.
- No fabricated quotes or transactions: a failed rango build surfaces as an
  honest error, never as a success.
- If RHEA fixes their adapter, removing the exclusion re-enables rango —
  no code changes needed on our side.
