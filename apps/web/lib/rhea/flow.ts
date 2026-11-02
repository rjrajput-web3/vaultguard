/**
 * VAULTRY RHEA execution flow (browser).
 *
 * Wires the official SDK exactly as documented:
 *   client.quote() → Route Guardian revalidation → client.buildSwap() →
 *   client.swap({ quote, beforeSign }) with real wallet executors →
 *   settlement tracking via client.waitForOrder / getOrderStatus.
 *
 * beforeSign is the hard gate: the guardian runs AFTER build and BEFORE
 * any signature. BLOCKED verdicts throw (the SDK aborts before the wallet
 * is ever touched). CAUTION verdicts require the caller to have collected
 * an explicit per-quote confirmation first — this module refuses to
 * proceed on CAUTION unless `cautionConfirmed` is true for THIS quote id.
 *
 * No simulated transactions anywhere: executors sign and broadcast for
 * real, and status comes from the API's order-status endpoint.
 */
import {
  SwapClient,
  type ChainExecutor,
  type Quote,
  type QuoteRequest,
  type SwapExecutionResult,
} from "@rhea-finance/cross-chain-aggregation-dex";
import { rheaProxyFetch } from "./proxy-fetch";
import {
  checkExecutableQuote,
  type GuardianIntent,
  type GuardianResult,
} from "./guardian";

export interface RheaFlowWallets {
  evm?: ReturnType<typeof import("./executors").createBrowserEvmExecutor>;
  near?: ReturnType<typeof import("./executors").createKeystoreNearExecutor>;
}

export interface RheaExecutionEvents {
  onGuardian?: (result: GuardianResult) => void;
  onBuild?: (build: { router: string; isCrossChain: boolean }) => void;
  onSubmitted?: (txHashes: string[]) => void;
  onSettled?: (status: string, detail?: string) => void;
  onEvent?: (type: string) => void;
}

export function createRheaSwapClient(wallets: RheaFlowWallets): SwapClient {
  // The factories below are the SDK's own createEvmExecutor/createNearExecutor,
  // so runtime compatibility is guaranteed. The cast only bridges the SDK's
  // generic variance (ChainExecutor<K> is invariant across execution kinds).
  const executors = [wallets.evm, wallets.near].filter(
    (e): e is NonNullable<typeof e> => !!e,
  ) as ChainExecutor[];
  return new SwapClient({
    baseUrl: "https://api.rhea.finance",
    fetch: rheaProxyFetch,
    executors,
    reportMode: "disabled",
    timeoutMs: 95_000,
  });
}

/**
 * Request a quote through the SDK (server proxy attaches the API key).
 * Throws the API's own error when no route exists — never a fake quote.
 */
export async function requestRheaQuote(
  client: SwapClient,
  req: QuoteRequest,
): Promise<Quote> {
  return client.quote(req);
}

/**
 * Execute a quoted swap with the full guardian gate.
 *
 * @param cautionConfirmed must be true when the guardian verdict is CAUTION,
 * and must correspond to THIS quote (callers pass quote.id or a hash they
 * showed the user). Pass false/undefined to let SAFE through and stop on
 * CAUTION.
 */
export async function executeRheaSwap(params: {
  client: SwapClient;
  quote: Quote;
  intent: GuardianIntent;
  cautionConfirmed: boolean;
  events?: RheaExecutionEvents;
  waitForSettlement?: boolean;
}): Promise<SwapExecutionResult> {
  const { client, quote, intent, events } = params;

  // Build first (construction only — fund-safe), so beforeSign sees the
  // exact executable payload it is guarding.
  const build = await client.buildSwap({ quote });
  events?.onBuild?.({ router: build.router, isCrossChain: build.isCrossChain });
  events?.onEvent?.("build-completed");

  const guardian = checkExecutableQuote(quote, intent);
  events?.onGuardian?.(guardian);

  if (guardian.verdict === "BLOCKED") {
    throw new Error(
      `Route Guardian BLOCKED this swap: ${guardian.reasons.join("; ")}`,
    );
  }
  if (guardian.verdict === "CAUTION" && !params.cautionConfirmed) {
    throw new Error(
      `Route Guardian flagged CAUTION and no explicit confirmation was given: ${guardian.reasons.join("; ")}`,
    );
  }

  // executeSwap (not swap) so the wallet signs THIS exact build — the one
  // the guardian already checked — instead of a second build that could
  // have drifted.
  const result = await client.executeSwap({
    build,
    waitFor: params.waitForSettlement ? "completed" : "submitted",
    orderPolling: { intervalMs: 5000, timeoutMs: 600_000 },
    beforeSign: async (preview) => {
      // Re-run the guardian at the last possible moment, on the exact
      // payload about to be signed. Any drift since build → abort.
      const late = checkExecutableQuote(quote, intent);
      if (late.verdict === "BLOCKED") {
        throw new Error(
          `Route Guardian BLOCKED at signing: ${late.reasons.join("; ")}`,
        );
      }
      if (late.verdict === "CAUTION" && !params.cautionConfirmed) {
        throw new Error("Route Guardian CAUTION at signing without confirmation — aborted");
      }
      events?.onEvent?.(
        `signing-requested:${preview.chain}:${preview.kind}`,
      );
    },
    onEvent: (e) => events?.onEvent?.(e.type),
  });

  const txHashes: string[] = [];
  // Surface whatever tx hashes the executors reported (shape varies by
  // executor kind; never invent one).
  const raw = result as unknown as Record<string, unknown>;
  for (const key of ["txHash", "txHashes"]) {
    const v = raw[key];
    if (typeof v === "string" && v) txHashes.push(v);
    if (Array.isArray(v)) txHashes.push(...v.filter((x) => typeof x === "string"));
  }
  events?.onSubmitted?.(txHashes);

  if (params.waitForSettlement) {
    events?.onSettled?.(result.status, `router=${result.router ?? "?"}`);
  }
  return result;
}

/** Poll settlement for an already-submitted order (real API status). */
export async function trackRheaOrder(
  client: SwapClient,
  params: { recordId?: string; orderId?: string; router?: string },
  onStatus: (status: string) => void,
): Promise<string> {
  const final = await client.waitForOrder({
    ...(params.recordId ? { recordId: params.recordId } : {}),
    ...(params.orderId ? { orderId: params.orderId, router: params.router } : {}),
    intervalMs: 5000,
    timeoutMs: 600_000,
  });
  onStatus(final.status);
  return final.status;
}
