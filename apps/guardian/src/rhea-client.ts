/**
 * RHEA X Chain SDK client factory — backend only.
 *
 * AUTH MODEL (honest): the API JWT lives in the custom.rhea connector vault
 * and is NEVER materialized on this VM — not in env, not in files, not in
 * logs. The previous design read RHEA_API_JWT from the environment; that
 * variable can never be populated without exposing the credential, so the
 * SDK path was permanently dormant and every quote fell back to 1Click.
 *
 * The working design: the SDK's HTTP layer is replaced with ./rhea-fetch.ts,
 * a custom `fetch` that delegates each read-only call to the local bridge
 * (scripts/rhea_bridge.py). The bridge performs the real request through the
 * connector helper (dynamic_credentials surrogate — the runtime swaps in the
 * real credential on the approved outbound request to api.rhea.finance) and
 * returns the RAW API envelope, which the SDK normalizes exactly as it would
 * over the wire. No Authorization material ever exists in this process.
 *
 * The client serves quote/token-list/build/order-status through the shim:
 * reportMode "disabled", no executors. Build is transaction CONSTRUCTION
 * only — the guardian's autonomous loop never builds; the explicit harness
 * (scripts/rhea-execute.ts) may build after the Route Guardian passes and
 * the operator confirms. Signing/broadcast live only in wallet adapters
 * behind explicit user confirmation. Submission endpoints stay unwired —
 * see rhea-fetch.ts.
 */
import { SwapClient } from "@rhea-finance/cross-chain-aggregation-dex";
import { rheaFetch } from "./rhea-fetch";

const RHEA_API_BASE = "https://api.rhea.finance";

export function createRheaClient(): SwapClient {
  return new SwapClient({
    baseUrl: RHEA_API_BASE,
    fetch: rheaFetch,
    reportMode: "disabled", // dry-run phase: no real executions to report
    timeoutMs: 95_000, // above the bridge's own 90s budget
  });
}
