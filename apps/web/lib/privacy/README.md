# VAULTRY Privacy module — `lib/privacy/` (workstream M3)

Device-side privacy first, honest labeling always. No "military-grade", no
"TEE-secured" — the guarantees below are exactly what the code does.

## What lives here

| File | Purpose |
|---|---|
| `pipeline.ts` | `analyzeSwapPrivately()` — redact → extract → analyze → audit trail. Zero network calls by construction. |
| `minimal-features.ts` | `MINIMAL_FEATURES` allow-lists + `assertMinimal()` fail-closed guard. |
| `data-flows.ts` | `DATA_FLOWS` (single source of truth for the dashboard), data-sharing levels, consent + BYOK localStorage helpers. |
| `audit.ts` | Static wallet-source scan + `auditOutboundRequest()`. Node-only. |
| `privacy-audit.test.ts` | Runnable audit. `npx tsx lib/privacy/privacy-audit.test.ts`. Must exit 0. |
| `attestation.ts` | `verifyAttestationEvidence()` — keyless verification of NEAR AI Cloud's public ITA attestation evidence (probed live 2026-11-02). |
| `tee-interface.ts` | Confidential-compute interface + optional BYOK `analyzeViaConfidentialCompute()` (attestation preflight enforced; not live-tested — no key under zero-investment). |

## Guarantees (exact wording for UIs)

- **Device-side Privacy — swap risk analysis runs on your device; data never leaves it.** (the pipeline)
- **NEAR AI Cloud attestation verification (public endpoint)** — verifies *their* TEE evidence; our analysis does not run inside their TEE.

## Integration contract for other workstreams

1. The swap UI and API routes MUST pass outbound payloads through
   `assertMinimal(payload, "swapRisk")` before sending. It throws on raw
   identifiers/secrets (fail-closed).
2. Consent lives in `localStorage["vg_privacy_consent"]`
   (`{ level: "nothing"|"anonymized"|"full", modules: {...}, updatedAt }`).
   At level `"nothing"`, do not fetch quotes.
3. The user's own NEAR AI Cloud key lives in
   `localStorage["vg_byok_nearaicloud"]` — attach it ONLY to requests the
   browser makes directly to `https://cloud-api.near.ai`, never to VAULTRY
   servers or routes.
4. Every backend route that receives identifiers documents them in an
   exported `PRIVACY_NOTE` (see `app/api/intents/quote/route.ts`).

## Running the audit

```bash
cd apps/web
npx tsx lib/privacy/privacy-audit.test.ts
```

Expected: static scan passes (keys.ts fully offline; connector RPC calls
carry only public params), runtime detector flags secrets and reports
identifiers, pipeline redacts the sample input and returns a real verdict.
