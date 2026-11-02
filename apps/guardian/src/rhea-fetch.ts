/**
 * Authenticated fetch shim for the official RHEA X Chain SDK.
 *
 * The official @rhea-finance/cross-chain-aggregation-dex SDK performs its HTTP
 * calls with `Authorization: Bearer <token>`. VAULTRY's API JWT lives in the
 * custom.rhea connector vault and is NEVER materialized on this VM — the
 * runtime swaps the credential in only on approved outbound requests made
 * through the connector's own helpers. A Node process cannot hold the raw
 * JWT, so the SDK client created in ./rhea-client.ts does NOT call
 * api.rhea.finance directly. Instead it uses THIS function as its `fetch`
 * implementation, which delegates the actual HTTP to the local bridge script
 * (scripts/rhea_bridge.py) — the bridge attaches the credential via the
 * connector's dynamic_credentials surrogate and returns the RAW API
 * envelope, which the SDK then normalizes exactly as it would over the wire.
 *
 * Wired (fund-safe) endpoints:
 *   GET  /get_chain_prices?chain=<id>
 *   GET  /api/swap/supported_to_tokens?chain=<id>
 *   POST /api/v2/swap/quote            (read-only pricing)
 *   POST /api/v2/swap/swap             (build: transaction CONSTRUCTION only —
 *                                       no signing, no broadcast)
 *   GET  /api/swap/order-status        (settlement tracking, read-only)
 *
 * Submission endpoints (/api/swap/order-submit, /api/swap/report) are
 * DELIBERATELY NOT wired: nothing in this service can finalize a swap.
 * Signing and broadcast happen ONLY in wallet adapters owned by an explicit,
 * user-confirmed flow (web UI beforeSign + wallet prompt, or the
 * scripts/rhea-execute.ts harness with its confirmation gate). Every
 * executable quote passes the Route Guardian before any signature.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const BRIDGE = path.join(__dirname, "..", "scripts", "rhea_bridge.py");
const BRIDGE_TIMEOUT_MS = 90_000;
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Run the bridge with an optional stdin payload. Uses spawn (async, typed)
 * because @types/node 26 removed `input` from the async execFile options.
 */
function runPython(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [BRIDGE, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* already exited */
      }
      reject(new Error(`rhea_bridge failed: ${msg.slice(0, 300)}`));
    };
    const timer = setTimeout(() => fail("bridge timed out"), BRIDGE_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
      if (stdout.length > MAX_BUFFER) fail("bridge output exceeded buffer");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (e) => fail(e.message));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout);
      else reject(new Error(`rhea_bridge failed: ${(stderr || `exit ${code}`).slice(0, 300)}`));
    });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** Any Authorization header the SDK attaches is ignored — the bridge owns auth. */
function dropAuthHeader(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const h = new Headers(headers);
  h.delete("authorization");
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function runBridge(args: string[], stdin?: string): Promise<string> {
  // The credential never exists in this process or its environment — the
  // bridge's connector helper attaches it at the outbound request boundary.
  return runPython(args, stdin);
}

function jsonResponse(bodyText: string): Response {
  // Validate it is JSON before handing it to the SDK; the SDK's ApiClient
  // expects the unified envelope {code, msg, data} and raises API_ERROR
  // itself when code !== 0.
  JSON.parse(bodyText);
  return new Response(bodyText, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function rheaFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  const pathname = url.pathname;

  dropAuthHeader(init?.headers); // intentionally ignored; documented above

  if (method === "GET" && pathname === "/get_chain_prices") {
    const chain = url.searchParams.get("chain");
    if (!chain) throw new Error("rheaFetch: missing chain param");
    return jsonResponse(await runBridge(["from-tokens", chain]));
  }
  if (method === "GET" && pathname === "/api/swap/supported_to_tokens") {
    const chain = url.searchParams.get("chain");
    if (!chain) throw new Error("rheaFetch: missing chain param");
    return jsonResponse(await runBridge(["to-tokens", chain]));
  }
  if (method === "POST" && pathname === "/api/v2/swap/quote") {
    const body = typeof init?.body === "string" ? init.body : "";
    if (!body) throw new Error("rheaFetch: empty quote body");
    return jsonResponse(await runBridge(["quote"], body));
  }
  if (method === "POST" && pathname === "/api/v2/swap/swap") {
    const body = typeof init?.body === "string" ? init.body : "";
    if (!body) throw new Error("rheaFetch: empty build body");
    return jsonResponse(await runBridge(["build"], body));
  }
  if (method === "GET" && pathname === "/api/swap/order-status") {
    const recordId = url.searchParams.get("recordId") ?? "";
    const orderId = url.searchParams.get("orderId") ?? "";
    const router = url.searchParams.get("router") ?? "";
    if (!recordId && !orderId) throw new Error("rheaFetch: order-status needs recordId or orderId");
    const args = ["order-status", recordId, orderId, router].map((s) => s || "-");
    return jsonResponse(await runBridge(args));
  }
  throw new Error(
    `rheaFetch: endpoint not wired (submission paths stay unwired by design): ${method} ${pathname}`,
  );
}
