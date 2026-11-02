/**
 * VAULTGUARD wallet core — EVM connector (injected external wallets only).
 *
 * We never manage EVM keys ourselves. We only talk to an injected provider
 * (MetaMask and other window.ethereum wallets). If none is detected we say
 * so honestly — one connector is never presented as covering every chain.
 * Read-only data (balances) goes through a public RPC; no key is needed.
 */

/* ---------------- window provider types (no `any` in public API) ---------------- */

export interface EvmJsonRpcProvider {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EvmJsonRpcProvider;
  }
}

/* ---------------- public types ---------------- */

export type EvmConnectResult =
  | { status: "connected"; address: string; provider: EvmJsonRpcProvider }
  | { status: "not-detected" }
  | { status: "rejected"; message: string }
  | { status: "error"; message: string };

export interface EvmBalance {
  wei: string;
  eth: string;
}

/** Primary read-only EVM RPC. Overridable per-call; failures must surface, never fake data. */
export const EVM_PUBLIC_RPC = "https://ethereum-rpc.publicnode.com";

/* ---------------- detection / connect ---------------- */

/** Return the injected provider, or null when no wallet extension is present. */
export function detectEvmProvider(): EvmJsonRpcProvider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export async function connectEvm(): Promise<EvmConnectResult> {
  const provider = detectEvmProvider();
  if (!provider) return { status: "not-detected" };
  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[] | null;
    if (!accounts || accounts.length === 0) {
      return { status: "rejected", message: "No accounts were shared by the wallet" };
    }
    return { status: "connected", address: accounts[0], provider };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/rejected|denied|user/i.test(msg)) {
      return { status: "rejected", message: "Connection request was rejected in the wallet" };
    }
    return { status: "error", message: `EVM wallet connection failed: ${msg.slice(0, 160)}` };
  }
}

/**
 * Read-only ETH balance for an address via a public RPC. Throws a readable
 * error on failure — callers must render "unavailable", never a fake balance.
 */
export async function getEvmBalance(address: string, rpcUrl: string = EVM_PUBLIC_RPC): Promise<EvmBalance> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address.trim())) throw new Error(`"${address}" is not a valid EVM address`);
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "vg-evm-balance",
        method: "eth_getBalance",
        params: [address.trim(), "latest"],
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach the EVM RPC (${e instanceof Error ? e.message : "network error"})`);
  }
  if (!res.ok) throw new Error(`EVM RPC responded ${res.status} — balance unavailable`);
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (typeof json.result !== "string") {
    throw new Error(`EVM RPC error: ${json.error?.message ?? "no result"} — balance unavailable`);
  }
  const wei = BigInt(json.result);
  return { wei: wei.toString(), eth: weiToEth(wei) };
}

function weiToEth(wei: bigint): string {
  const whole = wei / BigInt(1e18);
  const frac = (wei % BigInt(1e18)).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * Injected wallets disconnect from their own UI — there is no programmatic
 * disconnect for window.ethereum. We return a status the UI can render.
 */
export function disconnectEvm(): { status: "disconnected" } {
  return { status: "disconnected" };
}
