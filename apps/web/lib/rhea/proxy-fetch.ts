/**
 * Browser fetch implementation for the official RHEA SDK client.
 *
 * The API JWT must NEVER reach the browser, so the SDK's authenticated
 * calls are routed through our own server routes (which attach the key
 * server-side). Public token-list endpoints go direct — they need no auth.
 *
 *   GET  /get_chain_prices?chain=<id>            → https://api.rhea.finance (public)
 *   GET  /api/swap/supported_to_tokens?chain=<id> → https://api.rhea.finance (public)
 *   POST /api/v2/swap/quote                       → /api/rhea/quote (server attaches key)
 *   POST /api/v2/swap/swap                        → /api/rhea/build (server attaches key)
 *   GET  /api/swap/order-status?...               → /api/rhea/order-status?... (server attaches key)
 *
 * /api/swap/report and /api/swap/order-submit are NOT proxied: the client
 * runs with reportMode "disabled", and nothing in the UI may finalize an
 * order through a hidden path.
 */
const RHEA_PUBLIC = "https://api.rhea.finance";

export async function rheaProxyFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? new URL(input, window.location.origin)
      : input instanceof URL
        ? input
        : new URL(input.url, window.location.origin);
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.pathname;

  // Public token lists — no auth needed, go direct.
  if (
    method === "GET" &&
    (path === "/get_chain_prices" || path === "/api/swap/supported_to_tokens")
  ) {
    return fetch(`${RHEA_PUBLIC}${path}${url.search}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: init?.signal,
    });
  }

  // Authenticated paths — through our server proxy (key stays server-side).
  if (method === "POST" && path === "/api/v2/swap/quote") {
    return fetch("/api/rhea/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal,
    });
  }
  if (method === "POST" && path === "/api/v2/swap/swap") {
    return fetch("/api/rhea/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal,
    });
  }
  if (method === "GET" && path === "/api/swap/order-status") {
    return fetch(`/api/rhea/order-status${url.search}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: init?.signal,
    });
  }

  throw new Error(
    `rheaProxyFetch: refusing to proxy ${method} ${path} — submission/report paths stay unwired by design`,
  );
}
