/**
 * VAULTGUARD wallet core — Solana connector (injected external wallets only).
 *
 * We never manage Solana keys ourselves. We only talk to an injected provider
 * (Phantom and other window.solana wallets). If none is detected we say so
 * honestly. Read-only balances go through a public RPC; no key is needed.
 */

/* ---------------- window provider types (no `any` in public API) ---------------- */

export interface SolanaPublicKeyLike {
  toBase58(): string;
}

export interface SolanaInjectedProvider {
  isPhantom?: boolean;
  publicKey?: SolanaPublicKeyLike | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: SolanaPublicKeyLike }>;
  disconnect: () => Promise<void>;
}

declare global {
  interface Window {
    solana?: SolanaInjectedProvider;
    phantom?: { solana?: SolanaInjectedProvider };
  }
}

/* ---------------- public types ---------------- */

export type SolanaConnectResult =
  | { status: "connected"; address: string; provider: SolanaInjectedProvider }
  | { status: "not-detected" }
  | { status: "rejected"; message: string }
  | { status: "error"; message: string };

export interface SolanaBalance {
  lamports: number;
  sol: string;
}

export const SOLANA_PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

/* ---------------- detection / connect ---------------- */

/** Return the injected provider, or null when no wallet extension is present. */
export function detectSolanaProvider(): SolanaInjectedProvider | null {
  if (typeof window === "undefined") return null;
  return window.phantom?.solana ?? window.solana ?? null;
}

export async function connectSolana(): Promise<SolanaConnectResult> {
  const provider = detectSolanaProvider();
  if (!provider) return { status: "not-detected" };
  try {
    const resp = await provider.connect();
    const address = resp.publicKey.toBase58();
    return { status: "connected", address, provider };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/rejected|denied|user/i.test(msg)) {
      return { status: "rejected", message: "Connection request was rejected in the wallet" };
    }
    return { status: "error", message: `Solana wallet connection failed: ${msg.slice(0, 160)}` };
  }
}

/**
 * Read-only SOL balance for an address via a public RPC. Throws a readable
 * error on failure — callers must render "unavailable", never a fake balance.
 */
export async function getSolanaBalance(
  address: string,
  rpcUrl: string = SOLANA_PUBLIC_RPC
): Promise<SolanaBalance> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim())) {
    throw new Error(`"${address}" is not a valid Solana address`);
  }
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "vg-sol-balance",
        method: "getBalance",
        params: [address.trim()],
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach the Solana RPC (${e instanceof Error ? e.message : "network error"})`);
  }
  if (!res.ok) throw new Error(`Solana RPC responded ${res.status} — balance unavailable`);
  const json = (await res.json()) as { result?: { value?: number }; error?: { message?: string } };
  const lamports = json.result?.value;
  if (typeof lamports !== "number") {
    throw new Error(`Solana RPC error: ${json.error?.message ?? "no result"} — balance unavailable`);
  }
  return { lamports, sol: (lamports / 1_000_000_000).toFixed(9).replace(/\.?0+$/, "") || "0" };
}

/** Disconnect the injected Solana provider. */
export async function disconnectSolana(provider: SolanaInjectedProvider): Promise<{ status: "disconnected" }> {
  await provider.disconnect().catch(() => undefined);
  return { status: "disconnected" };
}
