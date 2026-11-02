/** Guardian enforcement proof — runs checkTestnetSwap against real scenarios. */
// Minimal localStorage shim for Node.
const store: Record<string, string> = {};
(global as any).window = { localStorage: {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
}};

import { checkTestnetSwap } from "./testnet-guardian";
import { saveUserPolicy, loadUserPolicy, DEFAULT_USER_POLICY } from "../policy/user-policy";

const intent = {
  fromTokenKey: "usdc",
  toTokenKey: "wnear",
  fromTokenId: "nep141:usdc.tidepool-sandbox.testnet",
  toTokenId: "nep141:wnear.tidepool-sandbox.testnet",
  amountInBaseUnits: "1000000",
  slippageBps: 100,
  recipient: "vgdeployer.testnet",
};
const quote = {
  amountInBaseUnits: "1000000",
  amountOutBaseUnits: "252532830837563453232000",
  minAmountOutBaseUnits: "250007502529187818699680",
  amountOutUsd: "0.9950",
  timeEstimateSec: 10,
  receivedAtMs: Date.now(),
};

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — ${detail}`); }
}

// 1. Normal quote, default policy -> SAFE
saveUserPolicy({ ...DEFAULT_USER_POLICY });
let r = checkTestnetSwap(quote, intent);
check("normal quote -> SAFE", r.verdict === "SAFE", JSON.stringify(r));

// 2. Emergency pause -> BLOCKED
saveUserPolicy({ ...DEFAULT_USER_POLICY, paused: true });
r = checkTestnetSwap(quote, intent);
check("paused -> BLOCKED", r.verdict === "BLOCKED" && r.reasons.some((x: string) => x.includes("pause")), JSON.stringify(r.reasons));

// 3. Over per-tx cap -> BLOCKED
saveUserPolicy({ ...DEFAULT_USER_POLICY, paused: false, maxSpendPerTx: 0.5 });
r = checkTestnetSwap(quote, intent);
check("over per-tx cap -> BLOCKED", r.verdict === "BLOCKED" && r.reasons.some((x: string) => x.includes("per-transaction cap")), JSON.stringify(r.reasons));

// 4. Router not allowed -> BLOCKED
saveUserPolicy({ ...DEFAULT_USER_POLICY, allowedRouters: ["some-other-router"] });
r = checkTestnetSwap(quote, intent);
check("router disallowed -> BLOCKED", r.verdict === "BLOCKED" && r.reasons.some((x: string) => x.includes("allow-list")), JSON.stringify(r.reasons));

// 5. High slippage (minOut far below out) -> CAUTION or BLOCKED (slippage > tolerance blocks)
saveUserPolicy({ ...DEFAULT_USER_POLICY });
const badSlip = { ...quote, minAmountOutBaseUnits: "100000000000000000000" }; // ~99.96% slippage
r = checkTestnetSwap(badSlip, intent);
check("extreme slippage -> BLOCKED", r.verdict === "BLOCKED", JSON.stringify(r.reasons));

// 6. Elevated slippage (1.2%, within 1%+0.01 tolerance? No — 1.2 > 1.01, so it BLOCKS.
//    Use tolerance 200bps intent for a true CAUTION at 1.5%.)
const intent200 = { ...intent, slippageBps: 200 };
const outBig = BigInt(quote.amountOutBaseUnits);
const modMin = ((outBig * BigInt(98500)) / BigInt(100000)).toString(); // 1.5% slip
const modSlip = { ...quote, minAmountOutBaseUnits: modMin };
r = checkTestnetSwap(modSlip, intent200);
check("1.5% slippage @2% tolerance -> CAUTION", r.verdict === "CAUTION", JSON.stringify(r));

// 7. Wrong recipient -> BLOCKED
r = checkTestnetSwap(quote, { ...intent, recipient: "not an account!!!" });
check("invalid recipient -> BLOCKED", r.verdict === "BLOCKED", JSON.stringify(r.reasons));

// 8. Amount mismatch -> BLOCKED
r = checkTestnetSwap({ ...quote, amountInBaseUnits: "9999999" }, intent);
check("amount mismatch -> BLOCKED", r.verdict === "BLOCKED", JSON.stringify(r.reasons));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
