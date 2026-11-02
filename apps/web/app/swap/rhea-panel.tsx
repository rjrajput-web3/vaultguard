/**
 * RHEA executable swap panel — the official RHEA SDK wired to real wallets.
 *
 * MAINNET · REAL FUNDS. This is not a dry run: quotes come from RHEA's live
 * API and execution signs real transactions in the user's own wallet.
 * Every executable quote passes the VAULTRY Route Guardian (beforeSign):
 * BLOCKED routes are rejected, CAUTION routes need an explicit per-quote
 * confirmation. Nothing is auto-signed, nothing is simulated.
 *
 * The 1Click dry-run flow above is untouched — this panel is additive.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Quote,
  type SwapTokenListItem,
} from "@rhea-finance/cross-chain-aggregation-dex";
import {
  JsonRpcProvider,
  KeyPairSigner,
  type KeyPairString,
} from "near-api-js";
import { rheaProxyFetch } from "../../lib/rhea/proxy-fetch";
import {
  createRheaSwapClient,
  executeRheaSwap,
} from "../../lib/rhea/flow";
import {
  checkExecutableQuote,
  type GuardianIntent,
  type GuardianResult,
} from "../../lib/rhea/guardian";
import {
  createBrowserEvmExecutor,
  createKeystoreNearExecutor,
} from "../../lib/rhea/executors";
import {
  getSignerAccount,
  isValidAccountId,
} from "../../lib/wallet/near";
import {
  loadKeystoreMeta,
  unlockKeystore,
} from "../../lib/wallet/keys";
import { NEAR_NETWORKS } from "../../lib/wallet/network";
import type {
  ChainRef,
  SwapClient,
} from "@rhea-finance/cross-chain-aggregation-dex";

/* ------------------------------------------------------------------ */

interface RheaChain {
  id: string; // quote fromChain/toChain
  listId: number; // token-list registry id
  label: string;
  kind: "evm" | "solana" | "near";
  explorerTx: (hash: string) => string;
}

const RHEA_CHAINS: RheaChain[] = [
  {
    id: "8453",
    listId: 8453,
    label: "Base",
    kind: "evm",
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
  },
  {
    id: "1",
    listId: 1,
    label: "Ethereum",
    kind: "evm",
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
  },
  {
    id: "solana",
    listId: 501,
    label: "Solana",
    kind: "solana",
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
  },
  {
    id: "near",
    listId: 900001,
    label: "NEAR",
    kind: "near",
    explorerTx: (h) => `https://nearblocks.io/txns/${h}`,
  },
];

/** Raw on-chain address — mirrors apps/guardian rawTokenAddress. */
function rawTokenAddress(r: SwapTokenListItem): string {
  const raw = r.raw as Record<string, unknown> | undefined;
  const candidates = [
    r.contractAddress,
    typeof raw?.address === "string" ? raw.address : undefined,
    typeof raw?.contractAddress === "string" ? raw.contractAddress : undefined,
    r.address,
  ];
  for (const c of candidates) {
    const v = (c ?? "").trim();
    if (v && !/^nep141:/i.test(v) && !/\.omft\.near$/i.test(v)) return v;
  }
  throw new Error(
    `RHEA: no raw on-chain address for ${r.symbol ?? "?"} — refusing to guess`,
  );
}

function pow10(n: number): bigint {
  let r = BigInt(1);
  for (let i = 0; i < n; i++) r *= BigInt(10);
  return r;
}

function toBaseUnits(amount: string, decimals: number): string {
  const [whole = "0", frac = ""] = amount.trim().split(".");
  const f = (frac + "0".repeat(decimals)).slice(0, decimals);
  const v =
    BigInt(whole === "" ? "0" : whole) * pow10(decimals) +
    BigInt(f === "" ? "0" : f);
  return v.toString();
}

function fromBaseUnits(v: string, decimals: number): string {
  try {
    const b = BigInt(v);
    const d = pow10(decimals);
    const whole = b / d;
    const frac = (b % d).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return v;
  }
}

/** Display trim: cap fractional digits at 6 so 18/24-decimal tokens don't flood the UI. */
function fmtDisplay(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(Number(n.toFixed(6)));
}

type Phase =
  | "checking"
  | "unconfigured"
  | "ready"
  | "quoting"
  | "quoted"
  | "confirming"
  | "executing"
  | "tracking"
  | "settled"
  | "failed";

export default function RheaSwapPanel() {
  const [client] = useState<SwapClient>(() =>
    createRheaSwapClient({
      evm: createBrowserEvmExecutor(),
      // NEAR executor is attached lazily after the user unlocks their
      // keystore — the client is rebuilt then.
    }),
  );
  const [phase, setPhase] = useState<Phase>("checking");
  const [configError, setConfigError] = useState("");

  const [fromChainId, setFromChainId] = useState("8453");
  const [toChainId, setToChainId] = useState("solana");
  const [fromTokens, setFromTokens] = useState<SwapTokenListItem[]>([]);
  const [toTokens, setToTokens] = useState<SwapTokenListItem[]>([]);
  const [fromAddr, setFromAddr] = useState("");
  const [toAddr, setToAddr] = useState("");
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState("");

  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [evmNote, setEvmNote] = useState("");
  const [nearAccountId, setNearAccountId] = useState("");
  const [nearPassword, setNearPassword] = useState("");
  const [nearUnlocked, setNearUnlocked] = useState(false);
  const [nearNote, setNearNote] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [guardian, setGuardian] = useState<GuardianResult | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [cautionChecked, setCautionChecked] = useState(false);
  const [execLog, setExecLog] = useState<string[]>([]);
  const [txHashes, setTxHashes] = useState<string[]>([]);
  const [settleStatus, setSettleStatus] = useState("");

  const fromChain = RHEA_CHAINS.find((c) => c.id === fromChainId)!;
  const toChain = RHEA_CHAINS.find((c) => c.id === toChainId)!;
  const fromToken = fromTokens.find((t) => rawAddrOf(t) === fromAddr) ?? null;
  const toToken = toTokens.find((t) => rawAddrOf(t) === toAddr) ?? null;

  function rawAddrOf(t: SwapTokenListItem): string {
    try {
      return rawTokenAddress(t);
    } catch {
      return t.address;
    }
  }

  /* ---------------- config ping ---------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/rhea/quote", { method: "GET" });
        const data = (await res.json()) as { ok: boolean; configured: boolean };
        if (cancelled) return;
        if (data.ok && data.configured) {
          setPhase("ready");
        } else {
          setPhase("unconfigured");
        }
      } catch (err) {
        if (cancelled) return;
        setConfigError(err instanceof Error ? err.message : String(err));
        setPhase("unconfigured");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- token lists ---------------- */
  const loadLists = useCallback(async () => {
    setListsLoading(true);
    setListsError("");
    try {
      const from = RHEA_CHAINS.find((c) => c.id === fromChainId)!;
      const to = RHEA_CHAINS.find((c) => c.id === toChainId)!;
      const [fromRows, toRows, supportedRows] = await Promise.all([
        client.getFromTokens({ chainId: from.listId }),
        client.getFromTokens({ chainId: to.listId }),
        client
          .getCrossChainToTokens({ chainId: to.listId })
          .catch(() => [] as SwapTokenListItem[]),
      ]);
      const supported = new Set(
        supportedRows
          .flatMap((r) => [r.address, r.assetId, r.contractAddress])
          .map((v) => String(v ?? "").toLowerCase())
          .filter(Boolean),
      );
      // Destination: destination chain's from-list (raw addresses the quote
      // API accepts), canonical-variant preferred via the API's own list.
      const dest = toRows
        .filter((r) => {
          try {
            rawTokenAddress(r);
            return true;
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          const sa = supported.has(rawAddrOf(a).toLowerCase()) ? 0 : 1;
          const sb = supported.has(rawAddrOf(b).toLowerCase()) ? 0 : 1;
          return sa - sb;
        });
      setFromTokens(fromRows);
      setToTokens(dest);
      const pickFrom =
        fromRows.find((r) => r.symbol.toUpperCase() === "USDC") ?? fromRows[0];
      const pickTo =
        dest.find((r) => r.symbol.toUpperCase() === "USDC") ?? dest[0];
      setFromAddr(pickFrom ? rawAddrOf(pickFrom) : "");
      setToAddr(pickTo ? rawAddrOf(pickTo) : "");
    } catch (err) {
      setListsError(
        `token lists failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setListsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, fromChainId, toChainId]);

  useEffect(() => {
    if (phase === "ready") void loadLists();
  }, [phase, loadLists]);

  /* ---------------- wallets ---------------- */
  const connectEvm = useCallback(async () => {
    setEvmNote("");
    try {
      const w = window as unknown as {
        ethereum?: { request: (a: { method: string }) => Promise<string[]> };
      };
      if (!w.ethereum) {
        setEvmNote("No injected EVM wallet found in this browser.");
        return;
      }
      const accounts = await w.ethereum.request({ method: "eth_requestAccounts" });
      if (accounts && accounts[0]) {
        setSender(accounts[0]);
        setEvmNote(`connected: ${accounts[0].slice(0, 10)}…`);
      }
    } catch (err) {
      setEvmNote(
        `wallet connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  // Surface a stored keystore account id (no typing needed).
  useEffect(() => {
    try {
      const meta = loadKeystoreMeta(NEAR_NETWORKS.mainnet.keystoreKey);
      if (meta.ok) setNearAccountId(meta.keystore.accountId);
    } catch {
      /* no keystore — user is told on the panel */
    }
  }, []);

  const unlockNear = useCallback(async () => {
    setNearNote("");
    if (!isValidAccountId(nearAccountId)) {
      setNearNote("Enter a valid NEAR account id first.");
      return;
    }
    if (nearAccountId.trim().endsWith(".testnet")) {
      setNearNote(
        "That is a TESTNET account — RHEA settles on MAINNET. Import a mainnet account on the Wallet page first.",
      );
      return;
    }
    const r = await unlockKeystore(nearPassword, NEAR_NETWORKS.mainnet.keystoreKey);
    if (!r.ok) {
      setNearNote(`unlock failed: ${r.error}`);
      return;
    }
    // Verify the key actually belongs to the account id on mainnet before
    // anything else touches it.
    try {
      const provider = new JsonRpcProvider({ url: "https://rpc.mainnet.near.org" });
      const signer = KeyPairSigner.fromSecretKey(
        r.secretKey.trim() as KeyPairString,
      );
      const publicKey = (await signer.getPublicKey()).toString();
      // view_access_key succeeds only if this exact key is on the account.
      await provider.query({
        request_type: "view_access_key",
        account_id: nearAccountId.trim(),
        public_key: publicKey,
        finality: "final",
      });
      setNearUnlocked(true);
      setSender(nearAccountId.trim());
      setNearNote("mainnet account verified — ready to sign.");
    } catch (err) {
      setNearNote(
        `mainnet verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [nearAccountId, nearPassword]);

  /* ---------------- quote ---------------- */
  const intent: GuardianIntent | null = useMemo(() => {
    if (!fromToken || !toToken || !sender) return null;
    let amountIn: string;
    try {
      amountIn = toBaseUnits(amount, fromToken.decimals);
    } catch {
      return null;
    }
    if (BigInt(amountIn) <= BigInt(0)) return null;
    return {
      fromChain: fromChainId,
      toChain: toChainId,
      tokenInAddress: rawAddrOf(fromToken),
      tokenOutAddress: rawAddrOf(toToken),
      amountIn,
      slippageBps,
      recipient: recipient.trim() || sender,
      sender,
    };
  }, [fromToken, toToken, sender, amount, slippageBps, recipient, fromChainId, toChainId]);

  const handleQuote = useCallback(async () => {
    setQuoteError("");
    setQuote(null);
    setGuardian(null);
    setTxHashes([]);
    setSettleStatus("");
    setExecLog([]);
    if (!intent || !fromToken || !toToken) {
      setQuoteError("Fill amount, tokens and sender first.");
      return;
    }
    if (fromChain.kind === "solana") {
      setQuoteError("Solana as a SOURCE is not wired yet — Solana works as a destination.");
      return;
    }
    setPhase("quoting");
    try {
      const q = await client.quote({
        fromChain: fromChainId as ChainRef,
        toChain: toChainId as ChainRef,
        tokenIn: {
          chain: fromChainId as ChainRef,
          address: intent.tokenInAddress,
          symbol: fromToken.symbol,
          decimals: fromToken.decimals,
        },
        tokenOut: {
          chain: toChainId as ChainRef,
          address: intent.tokenOutAddress,
          symbol: toToken.symbol,
          decimals: toToken.decimals,
        },
        amountIn: intent.amountIn,
        slippageBps: intent.slippageBps,
        sender: intent.sender,
        recipient: intent.recipient,
        quoteWaitingTimeMs: 8000,
        crossChainTimeoutMs: 8000,
      });
      const g = checkExecutableQuote(q, intent);
      setQuote(q);
      setGuardian(g);
      setPhase("quoted");
    } catch (err) {
      // The API's own error, verbatim — never a fake quote.
      setQuoteError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  }, [client, intent, fromToken, toToken, fromChain, fromChainId, toChainId]);

  /* ---------------- execute ---------------- */
  const handleExecute = useCallback(async () => {
    if (!quote || !intent || !guardian) return;
    if (guardian.verdict === "BLOCKED") return;
    if (guardian.verdict === "CAUTION" && !cautionChecked) {
      setPhase("confirming");
      return;
    }
    setPhase("executing");
    const log = (m: string) => setExecLog((l) => [...l, m]);
    try {
      // Attach the NEAR executor only when the user unlocked a mainnet
      // keystore account; EVM executor is always available.
      let execClient = client;
      if (fromChain.kind === "near") {
        if (!nearUnlocked) {
          throw new Error("Unlock your NEAR keystore account first.");
        }
        const nearExecutor = createKeystoreNearExecutor(async () => {
          const r = await unlockKeystore(nearPassword, NEAR_NETWORKS.mainnet.keystoreKey);
          if (!r.ok) throw new Error(`keystore unlock failed: ${r.error}`);
          const provider = new JsonRpcProvider({
            url: "https://rpc.mainnet.near.org",
          });
          return getSignerAccount({
            provider,
            accountId: nearAccountId.trim(),
            secretKey: r.secretKey,
          });
        });
        execClient = createRheaSwapClient({
          evm: createBrowserEvmExecutor(),
          near: nearExecutor,
        });
      }
      log(`build requested · router=${quote.route.router}`);
      const result = await executeRheaSwap({
        client: execClient,
        quote,
        intent,
        cautionConfirmed: cautionChecked,
        waitForSettlement: true,
        events: {
          onGuardian: (g) =>
            log(`guardian: ${g.verdict} (score ${g.score})`),
          onBuild: (b) =>
            log(`built: router=${b.router} crossChain=${b.isCrossChain}`),
          onSubmitted: (hashes) => {
            setTxHashes(hashes);
            log(`submitted: ${hashes.join(", ") || "(hashes in wallet)"}`);
          },
          onSettled: (status, detail) => {
            setSettleStatus(status);
            log(`settled: ${status}${detail ? ` · ${detail}` : ""}`);
          },
          onEvent: (t) => log(`event: ${t}`),
        },
      });
      setSettleStatus(result.status);
      setPhase("settled");
    } catch (err) {
      log(`failed: ${err instanceof Error ? err.message : String(err)}`);
      setPhase("failed");
    }
  }, [quote, intent, guardian, cautionChecked, client, fromChain, nearUnlocked, nearPassword, nearAccountId]);

  /* ---------------- render ---------------- */
  if (phase === "checking") {
    return (
      <div className="glass glass-pad">
        <div className="vg-trail t-dim">Checking RHEA execution availability…</div>
      </div>
    );
  }

  if (phase === "unconfigured") {
    return (
      <div className="glass glass-pad">
        <div className="vg-label" style={{ marginBottom: 12 }}>
          RHEA executable swaps
        </div>
        <div className="vg-trail">
          RHEA execution is not configured on this deployment (server key
          missing).
          {configError ? ` ${configError}` : ""} The 1Click dry-run flow above
          still works.
        </div>
      </div>
    );
  }

  const showCautionModal = phase === "confirming" && guardian?.verdict === "CAUTION";

  return (
    <div className="glass glass-pad" aria-label="RHEA executable swap">
      <div
        style={{
          border: "1px solid rgba(248,113,113,0.45)",
          background: "rgba(248,113,113,0.08)",
          color: "#fecaca",
          borderRadius: 10,
          padding: "10px 16px",
          fontSize: 13,
          marginBottom: 20,
        }}
        role="note"
      >
        <strong>MAINNET · real funds.</strong> This flow signs real transactions
        in your own wallet — every quote passes the Route Guardian first.
      </div>

      <div className="vg-label" style={{ marginBottom: 16 }}>
        RHEA executable swap <span className="t-dim">(official SDK)</span>
      </div>

      {listsError && (
        <div className="vg-alert err" role="alert" style={{ marginBottom: 16 }}>
          {listsError}
        </div>
      )}

      <div className="vg-row">
        <div className="vg-field">
          <label className="vg-label" htmlFor="rhea-from-chain">From · chain</label>
          <select
            id="rhea-from-chain"
            className="vg-select"
            value={fromChainId}
            disabled={listsLoading}
            onChange={(e) => {
              setFromChainId(e.target.value);
              setQuote(null);
              setGuardian(null);
              setPhase("ready");
            }}
          >
            {RHEA_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="rhea-to-chain">To · chain</label>
          <select
            id="rhea-to-chain"
            className="vg-select"
            value={toChainId}
            disabled={listsLoading}
            onChange={(e) => {
              setToChainId(e.target.value);
              setQuote(null);
              setGuardian(null);
              setPhase("ready");
            }}
          >
            {RHEA_CHAINS.filter((c) => c.id !== fromChainId).map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="vg-row">
        <div className="vg-field">
          <label className="vg-label" htmlFor="rhea-from-token">From · token</label>
          <select
            id="rhea-from-token"
            className="vg-select"
            value={fromAddr}
            disabled={listsLoading || fromTokens.length === 0}
            onChange={(e) => {
              setFromAddr(e.target.value);
              setQuote(null);
              setGuardian(null);
              setPhase("ready");
            }}
          >
            {fromTokens.map((t) => (
              <option key={`${t.chain}-${t.address}`} value={rawAddrOf(t)}>
                {t.symbol} · {t.name ?? rawAddrOf(t).slice(0, 18) + "…"}
              </option>
            ))}
          </select>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="rhea-to-token">To · token</label>
          <select
            id="rhea-to-token"
            className="vg-select"
            value={toAddr}
            disabled={listsLoading || toTokens.length === 0}
            onChange={(e) => {
              setToAddr(e.target.value);
              setQuote(null);
              setGuardian(null);
              setPhase("ready");
            }}
          >
            {toTokens.map((t) => (
              <option key={`${t.chain}-${t.address}`} value={rawAddrOf(t)}>
                {t.symbol} · {t.name ?? rawAddrOf(t).slice(0, 18) + "…"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="vg-row">
        <div className="vg-field">
          <label className="vg-label" htmlFor="rhea-amount">Amount</label>
          <input
            id="rhea-amount"
            className="vg-input"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="rhea-slippage">Slippage</label>
          <select
            id="rhea-slippage"
            className="vg-select"
            value={slippageBps}
            onChange={(e) => setSlippageBps(Number(e.target.value))}
          >
            <option value={10}>0.1%</option>
            <option value={50}>0.5%</option>
            <option value={100}>1.0%</option>
            <option value={200}>2.0%</option>
          </select>
        </div>
      </div>

      {/* sender wallet */}
      <div className="vg-field">
        <label className="vg-label">Sender · {fromChain.label}</label>
        {fromChain.kind === "evm" && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="vg-btn vg-btn-ghost"
              onClick={() => void connectEvm()}
            >
              {sender ? "Reconnect EVM wallet" : "Connect EVM wallet"}
            </button>
            {evmNote && <span className="vg-trail t-dim">{evmNote}</span>}
          </div>
        )}
        {fromChain.kind === "near" && (
          <div>
            {!nearUnlocked ? (
              <div style={{ display: "grid", gap: 10 }}>
                <input
                  className="vg-input"
                  style={{ fontSize: 13.5 }}
                  placeholder="mainnet account id (e.g. you.near)"
                  value={nearAccountId}
                  onChange={(e) => setNearAccountId(e.target.value)}
                />
                <input
                  className="vg-input"
                  style={{ fontSize: 13.5 }}
                  type="password"
                  placeholder="keystore password"
                  value={nearPassword}
                  onChange={(e) => setNearPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="vg-btn vg-btn-ghost"
                  onClick={() => void unlockNear()}
                >
                  Unlock NEAR keystore (mainnet)
                </button>
              </div>
            ) : (
              <div className="vg-trail">
                unlocked: <strong>{nearAccountId}</strong> (mainnet-verified)
              </div>
            )}
            {nearNote && (
              <div className="vg-trail t-dim" style={{ marginTop: 6 }}>{nearNote}</div>
            )}
          </div>
        )}
        {fromChain.kind === "solana" && (
          <div className="vg-trail t-dim">
            Solana as a source is not wired yet — pick an EVM chain or NEAR as
            the source, or use Solana as the destination.
          </div>
        )}
        {sender && fromChain.kind !== "near" && (
          <div
            className="vg-trail t-dim"
            style={{ marginTop: 6, wordBreak: "break-all" }}
          >
            sender: {sender}
          </div>
        )}
      </div>

      <div className="vg-field">
        <label className="vg-label" htmlFor="rhea-recipient">
          Recipient · {toChain.label} <span className="t-dim">(defaults to sender)</span>
        </label>
        <input
          id="rhea-recipient"
          className="vg-input"
          style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13.5 }}
          placeholder={toChain.kind === "evm" ? "0x…" : toChain.kind === "solana" ? "base58…" : "you.near"}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
      </div>

      {quoteError && (
        <div className="vg-alert err" role="alert" style={{ marginBottom: 16 }}>
          <strong>Quote failed.</strong>
          <div className="vg-trail" style={{ marginTop: 6 }}>{quoteError}</div>
        </div>
      )}

      <button
        className="vg-btn"
        style={{ width: "100%", justifyContent: "center" }}
        onClick={() => void handleQuote()}
        disabled={phase === "quoting" || listsLoading}
      >
        {phase === "quoting" ? "Requesting live RHEA quote…" : "Get RHEA quote"}
      </button>

      {/* quote + guardian */}
      {quote && guardian && fromToken && toToken && (
        <div style={{ marginTop: 24 }} aria-live="polite">
          <div className="vg-label">Live RHEA quote · router {quote.route.router}</div>
          <dl className="vg-kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <dt>You send</dt>
              <dd>{fmtDisplay(fromBaseUnits(quote.amountIn, fromToken.decimals))} {fromToken.symbol}</dd>
            </div>
            <div>
              <dt>You receive (est.)</dt>
              <dd>{fmtDisplay(fromBaseUnits(quote.estimatedOut, toToken.decimals))} {toToken.symbol}</dd>
            </div>
            <div>
              <dt>Minimum received</dt>
              <dd>{fmtDisplay(fromBaseUnits(quote.minAmountOut, toToken.decimals))} {toToken.symbol}</dd>
            </div>
            <div>
              <dt>Route Guardian</dt>
              <dd
                style={{
                  color:
                    guardian.verdict === "SAFE"
                      ? "#6ee7b7"
                      : guardian.verdict === "CAUTION"
                        ? "#fcd34d"
                        : "#fca5a5",
                  fontWeight: 700,
                }}
              >
                {guardian.verdict} · score {guardian.score}
              </dd>
            </div>
          </dl>
          <ul className="vg-trail" style={{ marginTop: 10, paddingLeft: 18 }}>
            {guardian.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>

          {guardian.verdict !== "BLOCKED" && (
            <button
              className="vg-btn"
              style={{ width: "100%", justifyContent: "center", marginTop: 16 }}
              onClick={() => void handleExecute()}
              disabled={phase === "executing" || phase === "tracking"}
            >
              {phase === "executing"
                ? "Executing — approve in your wallet…"
                : phase === "tracking"
                  ? "Tracking settlement…"
                  : "Approve & execute in wallet"}
            </button>
          )}
          {guardian.verdict === "BLOCKED" && (
            <div className="vg-alert err" role="alert" style={{ marginTop: 16 }}>
              The Route Guardian blocked this route — execution is disabled.
            </div>
          )}
        </div>
      )}

      {/* caution modal */}
      {showCautionModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm cautioned swap"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,16,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 20,
          }}
          onClick={() => setPhase("quoted")}
        >
          <div
            className="glass glass-pad"
            style={{ maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="vg-label" style={{ marginBottom: 12, color: "#fcd34d" }}>
              Route Guardian: CAUTION
            </div>
            <ul className="vg-trail" style={{ paddingLeft: 18, marginBottom: 16 }}>
              {guardian.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <label
              style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={cautionChecked}
                onChange={(e) => setCautionChecked(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                I read the warnings above and explicitly confirm THIS swap, on
                mainnet, with real funds.
              </span>
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                className="vg-btn vg-btn-ghost"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => {
                  setPhase("quoted");
                  setCautionChecked(false);
                }}
              >
                Cancel
              </button>
              <button
                className="vg-btn"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!cautionChecked}
                onClick={() => void handleExecute()}
              >
                Confirm & execute
              </button>
            </div>
          </div>
        </div>
      )}

      {/* execution log + settlement */}
      {execLog.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="vg-label" style={{ marginBottom: 8 }}>Execution log</div>
          <ul
            className="vg-trail"
            style={{
              paddingLeft: 18,
              fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              fontSize: 12.5,
            }}
          >
            {execLog.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {txHashes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="vg-label" style={{ marginBottom: 8 }}>Transactions</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {txHashes.map((h) => (
              <li key={h}>
                <a
                  href={fromChain.explorerTx(h)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--cyan)", fontSize: 13, wordBreak: "break-all" }}
                >
                  {h} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {settleStatus && (
        <div className="vg-trail" style={{ marginTop: 12 }}>
          Settlement status: <strong>{settleStatus}</strong>
          {phase === "settled" && " — verify the transactions on the explorer links above."}
        </div>
      )}
      {phase === "failed" && (
        <div className="vg-trail t-dim" style={{ marginTop: 12 }}>
          Execution failed — see the log above. No retry was attempted
          automatically; get a fresh quote to try again.
        </div>
      )}
    </div>
  );
}
