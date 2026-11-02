/**
 * VAULTRY privacy audit — runnable test (workstream M3).
 *
 * Run:  npx tsx lib/privacy/privacy-audit.test.ts   (from apps/web)
 * Exit 0 = all checks pass. Exit 1 = a violation was found (evidence printed).
 *
 * Checks:
 *  (a) STATIC — scans apps/web/lib/wallet/ for network calls in
 *      key-management code or carrying secret material. Must PASS.
 *  (b) RUNTIME — auditOutboundRequest() must block secrets and report
 *      identifiers on realistic payloads.
 *  (c) CONTRACT — assertMinimal() must throw on forbidden fields.
 *  (d) PIPELINE — analyzeSwapPrivately() on labeled SAMPLE data must redact
 *      (hash identifiers, drop secrets), keep only minimal features, and
 *      return a real risk verdict computed locally.
 */

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { auditWalletSources, auditOutboundRequest } from "./audit";
import { assertMinimal } from "./minimal-features";
import { analyzeSwapPrivately } from "./pipeline";

let failures = 0;

function ok(name: string, detail = ""): void {
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function bad(name: string, detail = ""): void {
  failures += 1;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ */
/* (a) static wallet scan                                               */
/* ------------------------------------------------------------------ */
async function checkStatic(): Promise<void> {
  console.log("\n(a) STATIC — wallet source scan (keys must never leave the device)");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const walletDir = path.resolve(here, "..", "wallet");
  const report = auditWalletSources(walletDir, ["keys.ts"]);
  for (const f of report.files) {
    const calls = f.networkCalls
      .map((c) => `${c.kind}@${c.line}${c.carriesSecrets ? " [CARRIES SECRETS]" : ""}`)
      .join(", ");
    console.log(
      `    ${f.file}${f.isKeyManagement ? " [key-management]" : ""}: ` +
        `${f.networkCalls.length} network call(s)${calls ? ` (${calls})` : ""}`,
    );
  }
  if (report.passed) ok("static audit", report.summary.split("\n")[0]);
  else bad("static audit", `\n${report.summary}`);
}

/* ------------------------------------------------------------------ */
/* (b) runtime outbound-request audit                                   */
/* ------------------------------------------------------------------ */
function checkRuntime(): void {
  console.log("\n(b) RUNTIME — auditOutboundRequest()");

  // 1. Realistic dry-run quote body: identifiers reported, request allowed.
  const quoteBody = {
    dry: true,
    originAsset: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "1000000",
    recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA9e",
    refundTo: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA9e",
  };
  const r1 = auditOutboundRequest("https://1click.chaindefuser.com/v0/quote", quoteBody);
  if (r1.allowed && r1.secrets.length === 0 && r1.identifiers.length >= 2)
    ok("quote body", `allowed, ${r1.identifiers.length} identifier(s) reported (recipient/refundTo)`);
  else bad("quote body", JSON.stringify({ allowed: r1.allowed, secrets: r1.secrets.length, identifiers: r1.identifiers.length }));

  // 2. Secret field name blocks.
  const r2 = auditOutboundRequest("https://example.com/x", { privateKey: "0xabc" });
  if (!r2.allowed && r2.secrets.some((s) => s.kind === "secret-field"))
    ok("secret field name blocked", r2.secrets[0]?.evidence ?? "");
  else bad("secret field name blocked", `allowed=${r2.allowed}`);

  // 3. Secret-shaped value blocks (EVM private key shape).
  const r3 = auditOutboundRequest("https://example.com/x", {
    data: "0x" + "ab".repeat(32),
  });
  if (!r3.allowed && r3.secrets.some((s) => s.kind === "secret-value"))
    ok("private-key-shaped value blocked", r3.secrets[0]?.evidence ?? "");
  else bad("private-key-shaped value blocked", `allowed=${r3.allowed}`);

  // 4. Seed-phrase-shaped value blocks.
  const r4 = auditOutboundRequest("https://example.com/x", {
    note: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  });
  if (!r4.allowed && r4.secrets.some((s) => s.kind === "secret-value"))
    ok("seed-phrase-shaped value blocked");
  else bad("seed-phrase-shaped value blocked", `allowed=${r4.allowed}`);

  // 5. Clean minimal-features payload passes with zero findings.
  const r5 = auditOutboundRequest("https://example.com/x", {
    originAssetId: "nep141:eth-0xa0b8",
    destinationAssetId: "nep141:base-0x8335",
    amountBaseUnits: "1000000",
    slippageBps: "50",
    routerId: "1click",
  });
  if (r5.allowed && r5.secrets.length === 0 && r5.identifiers.length === 0)
    ok("clean minimal payload passes");
  else bad("clean minimal payload passes", JSON.stringify(r5));

  // 6. Address in URL path is reported as identifier.
  const r6 = auditOutboundRequest(
    "https://testnet.nearblocks.io/api/v1/account/alice.testnet/txns",
    {},
  );
  if (r6.allowed && r6.identifiers.some((i) => i.path === "<url>"))
    ok("identifier in URL reported");
  else bad("identifier in URL reported", JSON.stringify(r6.identifiers));
}

/* ------------------------------------------------------------------ */
/* (c) minimal-features contract                                        */
/* ------------------------------------------------------------------ */
function checkContract(): void {
  console.log("\n(c) CONTRACT — assertMinimal()");
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ["raw userAddress rejected", { originAssetId: "x", userAddress: "0xabc" }, true],
    ["privateKey rejected", { originAssetId: "x", privateKey: "0xabc" }, true],
    ["seedPhrase rejected", { originAssetId: "x", seedPhrase: "word ".repeat(12) }, true],
    ["txHistory rejected", { originAssetId: "x", txHistory: [] }, true],
    [
      "minimal payload accepted",
      {
        originAssetId: "a",
        destinationAssetId: "b",
        amountBaseUnits: "1",
        slippageBps: "50",
        routerId: "1click",
      },
      false,
    ],
  ];
  for (const [name, payload, shouldThrow] of cases) {
    let threw = false;
    try {
      assertMinimal(payload, "swapRisk");
    } catch {
      threw = true;
    }
    if (threw === shouldThrow) ok(name);
    else bad(name, `expected throw=${shouldThrow}, got ${threw}`);
  }
}

/* ------------------------------------------------------------------ */
/* (d) pipeline on labeled sample data                                  */
/* ------------------------------------------------------------------ */
async function checkPipeline(): Promise<void> {
  console.log("\n(d) PIPELINE — analyzeSwapPrivately() on SAMPLE data");
  const SAMPLE_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA9e"; // SAMPLE — not a real wallet
  const result = await analyzeSwapPrivately({
    userAddress: SAMPLE_ADDRESS,
    recipient: SAMPLE_ADDRESS,
    refundTo: SAMPLE_ADDRESS,
    privateKey: "0x" + "cd".repeat(32), // SAMPLE — dropped, never used
    seedPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", // SAMPLE
    txHistory: [{ sample: true }],
    originAssetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    destinationAssetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amountHuman: "1",
    amountDecimals: 6,
    slippageBps: 50,
    routerId: "1click",
    quote: {
      amountIn: "1000000",
      amountOut: "999200",
      minAmountOut: "994200",
      amountOutUsd: "0.9992",
      timeEstimateMs: 45000,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      raw: { sample: true },
    },
    originToken: {
      assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "USDC",
      blockchain: "eth",
      decimals: 6,
      price: 1,
    },
    destinationToken: {
      assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      symbol: "USDC",
      blockchain: "base",
      decimals: 6,
      price: 1,
    },
    policy: { maxSpendPerTxUsd: 5000, maxSlippagePct: 2 },
  });

  const trail = result.auditTrail;
  const has = (field: string, action: string) =>
    trail.some((e) => e.field === field && e.action === action);

  if (has("userAddress", "hashed") && has("recipient", "hashed") && has("refundTo", "hashed"))
    ok("identifiers hashed (SHA-256)");
  else bad("identifiers hashed", JSON.stringify(trail));

  const hashEvidence = trail.find((e) => e.field === "userAddress")?.evidence ?? "";
  if (/^sha256:[0-9a-f]{64}$/.test(hashEvidence)) ok("hash is full SHA-256, not truncated");
  else bad("hash is full SHA-256", hashEvidence);

  if (has("privateKey", "dropped") && has("seedPhrase", "dropped") && has("txHistory", "dropped"))
    ok("secrets/history dropped (never hashed, never stored)");
  else bad("secrets/history dropped", JSON.stringify(trail));

  const rawLeak = Object.values(result.redactedFeatures).some((v) => v.includes(SAMPLE_ADDRESS));
  if (!rawLeak) ok("no raw address in redactedFeatures");
  else bad("no raw address in redactedFeatures", "RAW ADDRESS LEAKED");

  if (result.redactedFeatures.amountBaseUnits === "1000000")
    ok("amountHuman → base units converted exactly");
  else bad("amount conversion", result.redactedFeatures.amountBaseUnits);

  if (result.verdict && ["SAFE", "CAUTION", "BLOCKED"].includes(result.verdict.decision))
    ok("real local verdict", `${result.verdict.decision} (score ${result.verdict.score}, ${result.verdict.checks.length} checks)`);
  else bad("real local verdict", "verdict missing");

  console.log("    audit trail:");
  for (const e of trail) {
    console.log(
      `      ${e.field}: ${e.action} — ${e.reason.slice(0, 90)}${e.reason.length > 90 ? "…" : ""}`,
    );
  }
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("VAULTRY privacy audit —", new Date().toISOString());
  await checkStatic();
  checkRuntime();
  checkContract();
  await checkPipeline();
  console.log(failures === 0 ? "\nALL CHECKS PASSED ✓" : `\n${failures} CHECK(S) FAILED ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("audit crashed:", err);
  process.exit(1);
});
