# NEAR AI Cloud — Research Findings

**Research date:** 2026-11-02 (all sources crawled same day)
**Scope:** Official sources only — near.ai, docs.near.ai, official NEAR GitHub orgs (nearai, near-examples).
**Purpose:** Prerequisite research for VAULTRY Module 3 (Privacy & Private AI). Research only; no product code.
**Honesty standard:** every claim below carries an official URL + short quote. Where official docs are silent, that is stated explicitly rather than filled in.

---

## 1. Current product surface of NEAR AI Cloud

NEAR AI Cloud is a **confidential (TEE-hosted) AI inference platform with an OpenAI-compatible REST API**, plus agent hosting and a consumer chat product.

- "NEAR AI Cloud offers developers access to secure, private, verifiable AI models through a unified API." — https://docs.near.ai/cloud/quickstart
- "NEAR AI Cloud, every request runs inside Intel TDX and NVIDIA Confidential Computing hardware where data is processed in a sealed, isolated environment inaccessible even to NEAR AI or the hardware owner." — https://near.ai/blog/introducing-near-ai-cloud-private-chat
- Core surface today:
  1. **Confidential inference API** — OpenAI-compatible `/v1` REST API ("The NEAR AI Cloud API is a REST API served from a single base URL." — https://docs.near.ai/api-reference/introduction). Catalog of open-weight models (GLM, Qwen, GPT-OSS, DeepSeek etc.) plus provider models (OpenAI, Anthropic, Gemini routed through NEAR AI — see staking announcement).
  2. **Attestation/verification endpoints** — Intel Trust Authority (ITA) signed attestation JWTs; model attestation reports; response signatures; TLS connection binding; image provenance. Verification Center in the browser.
  3. **IronClaw agent hosting** — open-source agent runtime (Rust), one-click deploy on NEAR AI Cloud inside TEEs; stake-to-compute can fund it ("Stake at least 50 NEAR and your first agent is live in about 30 seconds." — https://near.ai/blog/staking-for-near-ai).
  4. **Private Chat** — consumer chat UI running on NEAR AI Cloud (not a developer API).
  5. **Distribution via OpenRouter** — NEAR AI Cloud is a provider on OpenRouter (slug `near-ai`, currently one model: GLM 5.3 Flash). Note: "For confidential inference, come to NEAR AI directly" — the OpenRouter route is NOT confidential inference. — https://near.ai/blog/near-ai-cloud-on-openrouter

## 2. Public API: base URL, auth, pricing, signup

**Base URL:** `https://cloud-api.near.ai/v1`
- "Connect through the NEAR AI Cloud Gateway at `cloud-api.near.ai`." and example call `curl https://cloud-api.near.ai/v1/chat/completions` — https://docs.near.ai/cloud/quickstart
- Integration guides confirm `apiBase: https://cloud-api.near.ai/v1` — https://docs.near.ai/cloud/guides/integrations/continue/

**Auth:** bearer token in the `Authorization` header; four token types.
- "Every request is authenticated with a bearer <redacted> in the `Authorization` header. The API accepts four token types; for programmatic access you almost always want an API key."
- API key (`sk-` prefix): "Create keys in the Developer Dashboard." — https://docs.near.ai/api-reference/introduction

**Signup flow (official quickstart, verbatim steps):**
1. "Create your account - Sign up at cloud.near.ai"
2. "Add Credits - Go to the 'Credits' section and purchase credits based on your needs"
3. "Generate API Key - Go to the 'API Keys' section and generate a new key"
— https://docs.near.ai/cloud/quickstart

**Pricing:** pay-as-you-go per token, no minimums.
- "Per token no minimums — Only pay for the tokens you use, every open model, attested on every request." / "No subscriptions or commitments" — https://near.ai/
- Live per-model pricing is published on near.ai ("live pricing from the NEAR AI Cloud API").

**Free tier:** **None documented.** The official quickstart's step 2 is *purchase* credits; the pricing page lists only Pay-as-you-go and Enterprise. No free credits, free tier, or keyless inference is documented anywhere on docs.near.ai or near.ai.

**Alternative payment — stake-to-compute (official, near.ai/blog/staking-for-near-ai):**
- "Today, we are introducing Staking for NEAR AI, which removes the credit card from the loop. Lock NEAR, and it converts into monthly credits that can be used to pay for your confidential inference from NEAR AI Cloud, for hosting IronClaw, and for other NEAR AI services."
- "Staking for NEAR AI gives you access to models from providers like Anthropic, OpenAI, and Google."
- Agent hosting formula: "staked NEAR ÷ 100 = your monthly credit budget, denominated in dollars, at current policy. Stake 500 NEAR and you receive $5 in credits every month".
- Inference credits come from staking yield; stake stays yours.

**Signup identity method:** **Not verifiable from official docs.** cloud.near.ai is a JS app; its fetchable text only shows "Sign in / Sign up" with a Terms-of-Service agreement. The docs do not say whether signup is email, Google/GitHub OAuth, or NEAR wallet. Do not assume.

**Answer to Q2:** There is **no public keyless/free-tier inference endpoint**. Inference requires an `sk-` API key from a cloud.near.ai account funded with purchased credits (or staked NEAR). Signup is open (not waitlisted) per the quickstart, and no KYC is documented — but credits cost money, which is the gate.

## 3. TEE: hardware, remote attestation, web-app verification

**Hardware:** Intel TDX + NVIDIA confidential computing.
- "NEAR AI Cloud combines Intel TDX and NVIDIA TEE technologies to create isolated, secure environments for AI computation" — https://docs.near.ai/cloud/private-inference
- "Inference executes in an Intel TDX + NVIDIA confidential-GPU enclave. Memory is sealed from the host and operators." — https://near.ai/

**Remote attestation a third party can check: YES, and one endpoint is fully public/keyless.**
- "Each TEE environment generates cryptographic proofs of its integrity and configuration, enabling independent verification of the secure execution environment." — https://docs.near.ai/cloud/private-inference
- Public, keyless endpoint (official API reference): **"Get Intel Trust Authority signed attestation JWTs for the gateway and, when requested, compatible model provider evidence. Public endpoint — this is an explicit, documented decision (nearai/infra#193): the response carries only ITA-signed TEE evidence (no customer or key-scoped data), public access lets third parties verify the platform without an account"** — https://docs.near.ai/api-reference/attestation/get-intel-trust-authority-attestation-token
- "You can check the attestation report against Intel and NVIDIA rather than against us, and the report is free and needs no account." — https://near.ai/blog/near-ai-cloud-on-openrouter
- Note the nuance: the *per-request model attestation report* (`/v1/attestation/report`) requires an API key but "report retrieval is non-billable" (search-cached API reference). The ITA token endpoint needs no account at all.

**Documented verification flow usable from a web app: YES.**
- "Verify requests sent through the NEAR AI Cloud Gateway." — verification index: https://docs.near.ai/cloud/verification/index.md
- Browser-based, no code: "Use the Verification Center at cloud.near.ai/verify to inspect a model's hardware attestation and a reply's signature without writing code."
- Programmatic flow: verify gateway attestation → verify model attestations → optionally bind the TLS connection → verify response signature after the completion. Response header `X-Request-Id` on gateway responses.
- Official verifier code: "A more complete verifier is available in the NEAR AI Cloud Verifier (nearai/nearai-cloud-verifier) repo." plus example at near-examples/nearai-cloud-verification-example.

**Answer to Q3:** Yes — Intel TDX + NVIDIA GPU TEE, with Intel Trust Authority-signed attestation JWTs fetchable from a **public, keyless** endpoint, and a fully documented verification flow (docs + browser tool + open-source verifier libs) that a web app can implement without an account.

## 4. SDKs

**There is no current NEAR-specific inference SDK to learn.** Official guidance is to use the standard OpenAI SDKs:
- "Drop-in replacement for the OpenAI SDK. Swap the base URL and your stack keeps working." — https://near.ai/
- "If you've used OpenAI, you're done in 30 seconds. No new SDK to learn. Change the base URL, keep your code, and gain end-to-end attestation for free." — https://near.ai/
- The quickstart shows curl, Python, and JavaScript tabs against the OpenAI-compatible API — https://docs.near.ai/cloud/quickstart
- The old `nearai` Python package (github.com/nearai/nearai) is **archived**: "Deprecated – check out our newest work at https://near.ai". The `private-ml-sdk` repo is likewise archived.
- For attestation verification (the part OpenAI SDKs don't do): official open-source Python — **nearai/nearai-cloud-verifier** (MIT) and example **near-examples/nearai-cloud-verification-example**.

**Answer to Q4:** No official NEAR AI Cloud TS/Python SDK exists today (old one deprecated). Use `openai` (npm) / `openai` (PyPI) with `baseURL`/`base_url = "https://cloud-api.near.ai/v1"`. Verification helpers live in the two GitHub repos above.

## 5. Shade Agents / AI contracts: live or not?

**Shade Agents are DEPRECATED and must not be used.**
- "After April 19th, 2026, the Shade Agent Framework will no longer maintained as standalone developer tooling. … While the framework remains open source, it will no longer be actively maintained." — https://docs.near.org/ai/shade-agents/getting-started/introduction
- "The Shade Agent Framework is experimental and contains known critical vulnerabilities. It must not be used in production or on mainnet and is intended solely for testing and non-critical use on testnet." — https://docs.near.org/ai/shade-agents/tutorials/ai-dao/deploying.md (still live, unmaintained)
- Docs moved to the monorepo: https://github.com/NearDeFi/shade-agent-framework/tree/main/docs

**The live agent path is IronClaw**, not Shade Agents:
- IronClaw: "An open-source agent for your busywork — in encrypted enclaves, where your secrets never touch the model." Built by NEAR Foundation, Rust, "1-CLICK CLOUD DEPLOYMENT" — https://www.ironclaw.com/
- Source: https://github.com/nearai/ironclaw (official nearai org).

**Answer to Q5:** Shade Agents are deprecated/unmaintained as of April 19, 2026 — do NOT build on them (and they were never mainnet-safe). The supported agent story is IronClaw on NEAR AI Cloud.

---

## VERDICT — what is genuinely usable by us TODAY

**Usable with ZERO new paid keys/accounts:**
1. **Public ITA attestation endpoint** — fetch Intel Trust Authority-signed TEE evidence for the NEAR AI Cloud gateway and models, no account, no key, free. A web app can implement the documented verification flow against it today.
2. **Verification Center** (cloud.near.ai/verify) — browser-based attestation/signature inspection, no code, no account.
3. **Open-source verifier repos** (nearai/nearai-cloud-verifier, near-examples example) — read/integrate verification logic locally, MIT licensed.
4. **The API spec itself** — OpenAI-compatible; integration code can be written and tested against any OpenAI-compatible mock today.

**Requires signup + money (NOT usable under zero-investment today):**
5. **Confidential inference API** — needs cloud.near.ai account + `sk-` key + *purchased* credits. No free tier, no trial credits documented. Signup identity method unverified (JS app; docs only say "Sign up at cloud.near.ai"). KYC not documented.
6. **Stake-to-compute** — real and live (removes the credit card), but requires locking NEAR (e.g. ≥50 NEAR activates first IronClaw agent; hosting $5/mo per 500 NEAR staked). That is capital lockup, not zero-investment.
7. **IronClaw agent hosting** — live, one-click, open-source; but activation is via the paid/staked tiers above. Not verified as free.

**Do not touch:**
8. **Shade Agents** — deprecated, unmaintained, known critical vulnerabilities, mainnet-prohibited.
9. **Old `nearai` Python SDK / `private-ml-sdk`** — archived/deprecated.

## RECOMMENDED INTEGRATION (for VAULTRY Module 3)

Because no keyless confidential-inference endpoint exists, the honest architecture is layered:

1. **Primary (ships now, zero cost, genuinely private): client-side private analysis.** Run the wallet-risk analysis entirely in the user's browser/device. Claim exactly this: "analysis runs on your device — data never leaves it." Do NOT claim TEE execution or attestation here.
2. **Secondary (ships now, zero cost, official): live NEAR AI Cloud attestation verification.** Implement the documented verification flow against the **public, keyless ITA attestation endpoint** — fetch the gateway/model attestation JWTs and verify them (Intel/NVIDIA trust roots) inside the app's Testing Lab / Privacy module. This is a real, working integration of NEAR AI Cloud's verifiability layer with no account. Label it precisely: "Verifies NEAR AI Cloud's live TEE attestation evidence (Intel TDX + NVIDIA)."
3. **Tertiary (BYOK, clearly labeled, wiring optional): confidential inference.** Provide a clearly-marked settings field for the user to paste their own NEAR AI Cloud `sk-` API key; when present, route analysis through `https://cloud-api.near.ai/v1` with the standard OpenAI SDK and verify each response's attestation. Label: "Requires your NEAR AI Cloud account with credits (paid) or staked NEAR." Never present this as included/free.
4. **Honesty guardrails (binding):** never display "TEE-verified" or "private inference" badges for the client-side path; never claim Module 3 runs inside Intel TDX/NVIDIA enclaves unless path 3 is active with a real key and passing verification. The demo must distinguish "data never leaves your device" (true today) from "hardware-attested confidential inference" (only via path 3).

**What NOT to do:** build on Shade Agents (deprecated); promise free confidential inference; invent endpoints (none were invented in this doc — every URL above is copied verbatim from official sources).
