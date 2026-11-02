"use client";

/**
 * VAULTRY multi-chain wallet tab — TESTNET ONLY (2026-11-03).
 *
 * One BIP39 phrase -> BIP44 per-chain keys (EVM m/44'/60'/0'/0/0,
 * Solana m/44'/501'/0'/0', NEAR m/44'/397'/0'). Keys are generated,
 * encrypted and stored on THIS device only — never sent to any server.
 *
 * HONESTY RULES:
 * - Balances come from live RPCs via /api/chains/balance; failures show
 *   "unavailable", never a made-up number.
 * - Faucet "funded" is shown ONLY after the RPC reports a balance.
 * - Sends are real on-chain testnet transactions with real tx hashes.
 * - Emergency pause from the Policy Console blocks sends.
 */

import { useCallback, useEffect, useState } from "react";
import { generateMnemonic } from "bip39";
import { CORE_CHAINS, type ChainDef } from "../../lib/wallet/chains";
import {
  normalizeMnemonic,
  isValidMnemonic,
  type MultiChainAddresses,
  type MultiChainSecrets,
} from "../../lib/wallet/multichain-derive";
import {
  saveMultiChainWallet,
  loadMultiChainMeta,
  unlockMultiChainSession,
  clearMultiChainWallet,
} from "../../lib/wallet/multichain-store";
import {
  sendEvm,
  sendSolana,
  sendNearImplicit,
  fetchAllBalances,
  type SendResult,
} from "../../lib/wallet/chain-rpc";
import { loadUserPolicy } from "../../lib/policy/user-policy";
import "../../lib/polyfills";

/* ---------------- shared UI atoms ---------------- */

const card: React.CSSProperties = {
  background: "rgba(13,20,38,0.75)",
  border: "1px solid rgba(125,211,252,0.14)",
  borderRadius: 14,
  padding: 22,
  marginBottom: 18,
};
const input: React.CSSProperties = {
  width: "100%", background: "rgba(7,11,22,0.8)", border: "1px solid rgba(125,211,252,0.25)",
  borderRadius: 8, color: "#e9eef7", padding: "11px 13px", fontSize: 15,
  fontFamily: "inherit", boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 13, color: "#93a0b8", marginBottom: 6, display: "block" };
const errBox: React.CSSProperties = {
  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8,
  color: "#fca5a5", padding: "10px 13px", fontSize: 14, marginTop: 12,
};
const okBox: React.CSSProperties = {
  background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8,
  color: "#86efac", padding: "10px 13px", fontSize: 14, marginTop: 12,
};
const hint: React.CSSProperties = { fontSize: 13, color: "#5b6a84", lineHeight: 1.6 };
const mono: React.CSSProperties = { fontFamily: "monospace", fontSize: 13, wordBreak: "break-all" };

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div style={{ marginBottom: 16 }}><label style={label}>{title}</label>{children}</div>);
}
function ErrorBox({ message }: { message: string }) { return <div style={errBox}>⚠ {message}</div>; }

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="vg-btn vg-btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }}
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? "✓ Copied" : "Copy"}
    </button>
  );
}

interface Session {
  addresses: MultiChainAddresses;
  secrets: MultiChainSecrets;
}

/* ================= MAIN TAB ================= */

export default function MultiChainTab() {
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"locked" | "create" | "import">("locked");
  const [session, setSession] = useState<Session | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<MultiChainAddresses | null>(null);

  const refreshMeta = useCallback(() => {
    try {
      const m = loadMultiChainMeta();
      if (m.ok) { setHasWallet(true); setSavedAddresses(m.store.addresses); }
      else { setHasWallet(false); setSavedAddresses(null); }
    } catch { setHasWallet(false); }
  }, []);

  useEffect(() => { refreshMeta(); }, [refreshMeta]);

  if (hasWallet === null) return <div style={card}><p style={hint}>Loading…</p></div>;

  if (!hasWallet) {
    return (
      <div>
        <div style={card}>
          <h3 style={{ margin: "0 0 6px" }}>Multi-chain testnet wallet</h3>
          <p style={hint}>
            One recovery phrase derives addresses on all 4 supported testnets via standard
            BIP44 paths (EVM <span style={mono}>m/44'/60'/0'/0/0</span>, Solana{" "}
            <span style={mono}>m/44'/501'/0'/0'</span>, NEAR <span style={mono}>m/44'/397'/0'</span>).
            The phrase is encrypted on this device only — it never leaves your browser.
            All tokens are valueless testnet tokens.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button className="vg-btn" onClick={() => setMode("create")}>Create multi-chain wallet</button>
            <button className="vg-btn vg-btn-ghost" onClick={() => setMode("import")}>Import phrase</button>
          </div>
        </div>
        {mode === "create" && <CreateFlow onDone={(s) => { setSession(s); refreshMeta(); }} />}
        {mode === "import" && <ImportFlow onDone={(s) => { setSession(s); refreshMeta(); }} />}
      </div>
    );
  }

  if (!session) {
    return <UnlockCard savedAddresses={savedAddresses} onUnlock={setSession}
      onForget={() => { try { clearMultiChainWallet(); } catch { /* noop */ } setSession(null); refreshMeta(); }} />;
  }

  return <MultiChainDashboard session={session}
    onLock={() => setSession(null)}
    onForget={() => { try { clearMultiChainWallet(); } catch { /* noop */ } setSession(null); refreshMeta(); }} />;
}

/* ================= UNLOCK ================= */

function UnlockCard({ savedAddresses, onUnlock, onForget }: {
  savedAddresses: MultiChainAddresses | null;
  onUnlock: (s: Session) => void;
  onForget: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doUnlock() {
    setBusy(true); setError(null);
    try {
      const r = await unlockMultiChainSession(password);
      if (!r.ok) { setError(r.error); return; }
      onUnlock({ addresses: r.addresses, secrets: r.secrets });
      setPassword("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unlock failed"); }
    finally { setBusy(false); }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 6px" }}>Multi-chain wallet saved on this device</h3>
      <p style={hint}>Enter your password to unlock. Keys are decrypted in memory only — never sent anywhere.</p>
      {savedAddresses && (
        <div style={{ ...mono, color: "#93a0b8", margin: "10px 0", fontSize: 12 }}>
          <div>EVM: {savedAddresses.evmAddress}</div>
          <div>Solana: {savedAddresses.solanaAddress}</div>
          <div>NEAR: {savedAddresses.nearImplicitAccountId.slice(0, 20)}…</div>
        </div>
      )}
      <Field title="Wallet password">
        <input type="password" style={input} value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") doUnlock(); }} placeholder="••••••••" />
      </Field>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="vg-btn" disabled={busy || !password} onClick={doUnlock}>
          {busy ? "Unlocking…" : "Unlock wallet"}
        </button>
        <button className="vg-btn vg-btn-ghost" onClick={onForget}
          style={{ borderColor: "rgba(239,68,68,0.4)", color: "#fca5a5" }}>Forget this device</button>
      </div>
      {error && <ErrorBox message={error} />}
    </div>
  );
}

/* ================= CREATE ================= */

function CreateFlow({ onDone }: { onDone: (s: Session) => void }) {
  const [phrase, setPhrase] = useState("");
  const [backedUp, setBackedUp] = useState(false);
  const [verifyIdx, setVerifyIdx] = useState<number[]>([]);
  const [verifyWords, setVerifyWords] = useState<string[]>(["", "", ""]);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function generate() {
    setError(null);
    try {
      const p = generateMnemonic(128); // 12 words
      setPhrase(p);
      setBackedUp(false); setVerified(false); setVerifyError(null); setVerifyWords(["", "", ""]);
      const idx = new Set<number>();
      while (idx.size < 3) idx.add(Math.floor(Math.random() * 12));
      setVerifyIdx([...idx].sort((a, b) => a - b));
    } catch (e) { setError(e instanceof Error ? e.message : "Key generation failed"); }
  }

  function checkWords() {
    const words = phrase.split(" ");
    const bad = verifyIdx.findIndex((wi, k) => verifyWords[k].trim().toLowerCase() !== words[wi]);
    if (bad >= 0) { setVerifyError(`Word #${verifyIdx[bad] + 1} does not match — check your backup.`); setVerified(false); return; }
    setVerifyError(null); setVerified(true);
  }

  async function save() {
    setError(null);
    if (!backedUp) { setError("Confirm you have backed up the recovery phrase first"); return; }
    if (!verified) { setError("Verify your backup words first"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true);
    try {
      const r = await saveMultiChainWallet(phrase, password);
      if (!r.ok) { setError(r.error); return; }
      const s = await unlockMultiChainSession(password);
      if (!s.ok) { setError(s.error); return; }
      onDone({ addresses: s.addresses, secrets: s.secrets });
    } catch (e) { setError(e instanceof Error ? e.message : "Saving failed"); }
    finally { setSaving(false); }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 6px" }}>1 · Generate your recovery phrase</h3>
      {!phrase && <button className="vg-btn" onClick={generate}>Generate 12-word phrase</button>}
      {error && <ErrorBox message={error} />}
      {phrase && (
        <div>
          <p style={hint}>Write these 12 words down <b>in order</b>. They derive your keys on all 4 testnets.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "14px 0" }}>
            {phrase.split(" ").map((w, i) => (
              <div key={i} style={{ background: "rgba(7,11,22,0.8)", border: "1px solid rgba(125,211,252,0.25)", borderRadius: 8, padding: "9px 10px", ...mono, fontSize: 15 }}>
                <span style={{ color: "#5b6a84", marginRight: 8, fontSize: 12 }}>{i + 1}</span>{w}
              </div>
            ))}
          </div>
          <div style={{ border: "1px solid rgba(125,211,252,0.2)", borderRadius: 10, padding: 14, marginBottom: 18 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 15 }}>Verify your backup</h4>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              {verifyIdx.map((wi, k) => (
                <div key={wi} style={{ flex: "1 1 120px" }}>
                  <label style={label}>Word #{wi + 1}</label>
                  <input style={input} value={verifyWords[k]} autoComplete="off" spellCheck={false}
                    onChange={(e) => { const n = [...verifyWords]; n[k] = e.target.value; setVerifyWords(n); setVerified(false); }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button className="vg-btn vg-btn-ghost" onClick={checkWords}>Verify words</button>
              {verified && <span style={{ color: "#86efac", fontSize: 14 }}>✓ Backup verified</span>}
            </div>
            {verifyError && <ErrorBox message={verifyError} />}
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 18, cursor: "pointer" }}>
            <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "#22d3ee" }} />
            <span style={{ fontSize: 14 }}><b>I have backed up my 12-word recovery phrase.</b> Losing it means losing access — no one can recover it.</span>
          </label>
          <h3 style={{ margin: "0 0 6px" }}>2 · Encrypt with a password</h3>
          <Field title="Password (min. 8 characters)">
            <input type="password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field title="Confirm password">
            <input type="password" style={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
          </Field>
          <button className="vg-btn" disabled={saving || !backedUp || !verified} onClick={save}>
            {saving ? "Encrypting & saving…" : "Encrypt & save wallet"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ================= IMPORT ================= */

function ImportFlow({ onDone }: { onDone: (s: Session) => void }) {
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function doImport() {
    setError(null);
    const norm = normalizeMnemonic(phrase);
    if (!isValidMnemonic(norm)) { setError("That is not a valid 12/24-word recovery phrase"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true);
    try {
      const r = await saveMultiChainWallet(norm, password);
      if (!r.ok) { setError(r.error); return; }
      const s = await unlockMultiChainSession(password);
      if (!s.ok) { setError(s.error); return; }
      setPhrase("");
      onDone({ addresses: s.addresses, secrets: s.secrets });
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { setSaving(false); }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 6px" }}>Import a recovery phrase</h3>
      <p style={hint}>Parsed and encrypted <b>on this device only</b> — never sent to any server. Cleared from this form after import.</p>
      <Field title="12 or 24-word recovery phrase">
        <textarea style={{ ...input, minHeight: 74, resize: "vertical" }} value={phrase}
          onChange={(e) => setPhrase(e.target.value)} placeholder="word1 word2 … word12"
          autoComplete="off" spellCheck={false} />
      </Field>
      <Field title="New encryption password (min. 8 characters)">
        <input type="password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </Field>
      <Field title="Confirm password">
        <input type="password" style={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
      </Field>
      <button className="vg-btn" disabled={saving || !phrase.trim()} onClick={doImport}>
        {saving ? "Encrypting & importing…" : "Encrypt & import"}
      </button>
      {error && <ErrorBox message={error} />}
    </div>
  );
}

/* ================= DASHBOARD ================= */

type BalState = Record<string, { ok: boolean; balance?: string; symbol?: string; error?: string }>;

function MultiChainDashboard({ session, onLock, onForget }: {
  session: Session;
  onLock: () => void;
  onForget: () => void;
}) {
  const [balances, setBalances] = useState<BalState>({});
  const [loadingBal, setLoadingBal] = useState(false);

  const refreshBalances = useCallback(async () => {
    setLoadingBal(true);
    try { setBalances(await fetchAllBalances(session.addresses)); }
    catch { /* per-chain errors are inline */ }
    finally { setLoadingBal(false); }
  }, [session.addresses]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  return (
    <div>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={label}>MULTI-CHAIN WALLET · UNLOCKED</div>
            <div style={{ fontSize: 15, color: "#e9eef7" }}>4 testnets · one recovery phrase · keys on this device only</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="vg-btn vg-btn-ghost" onClick={refreshBalances} disabled={loadingBal}>
              {loadingBal ? "…" : "↻ Balances"}
            </button>
            <button className="vg-btn vg-btn-ghost" onClick={onLock}>Lock</button>
          </div>
        </div>
      </div>

      {CORE_CHAINS.map((chain) => (
        <ChainCard key={chain.id} chain={chain} session={session}
          balance={balances[chain.id]} onBalanceRefresh={refreshBalances} />
      ))}

      <div style={card}>
        <h3 style={{ margin: "0 0 8px" }}>Device & security</h3>
        <p style={hint}>
          The encrypted recovery phrase lives in this browser's local storage. "Forget this
          device" wipes it — make sure the phrase is backed up first. Policy Console's
          emergency pause blocks all sends from this wallet.
        </p>
        <button className="vg-btn vg-btn-ghost" onClick={onForget}
          style={{ borderColor: "rgba(239,68,68,0.4)", color: "#fca5a5" }}>
          Forget this device
        </button>
      </div>
    </div>
  );
}

/* ================= CHAIN CARD ================= */

interface HistItem { hash: string; from?: string; to?: string; status: string; timestamp?: string; kind?: string; }

function ChainCard({ chain, session, balance, onBalanceRefresh }: {
  chain: ChainDef;
  session: Session;
  balance?: { ok: boolean; balance?: string; symbol?: string; error?: string };
  onBalanceRefresh: () => void;
}) {
  const address =
    chain.kind === "evm" ? session.addresses.evmAddress
    : chain.kind === "solana" ? session.addresses.solanaAddress
    : session.addresses.nearImplicitAccountId;

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [policyBlock, setPolicyBlock] = useState<string | null>(null);
  const [history, setHistory] = useState<HistItem[] | null>(null);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [showSend, setShowSend] = useState(false);

  async function loadHistory() {
    setLoadingHist(true); setHistoryMsg(null);
    try {
      const res = await fetch("/api/chains/history", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chain: chain.id, address, limit: 10 }),
      });
      const j = await res.json() as { ok: boolean; txs?: HistItem[]; error?: string; unavailable?: boolean; explorerUrl?: string };
      if (j.ok && j.txs) { setHistory(j.txs); }
      else {
        setHistory(null);
        setHistoryMsg(j.unavailable
          ? `On-page history unavailable for ${chain.testnetName} — view the full history on the explorer.`
          : (j.error ?? "History unavailable"));
      }
    } catch (e) { setHistory(null); setHistoryMsg(e instanceof Error ? e.message : "History unavailable"); }
    finally { setLoadingHist(false); }
  }

  useEffect(() => { loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [chain.id]);

  function previewSend() {
    setSendError(null); setPolicyBlock(null); setTxHash(null);
    // Policy gate: emergency pause blocks ALL sends. (USD caps apply to swaps; native
    // testnet tokens are valueless so no conversion is invented here.)
    try {
      const policy = loadUserPolicy();
      if (policy.paused) {
        setPolicyBlock("Emergency pause is ON in your Policy Console — sends are frozen until you unpause. Your funds stay put.");
        return;
      }
    } catch { /* policy unreadable -> fail open for reads, but require explicit confirm below */ }
    if (!to.trim() || !amount.trim() || Number(amount) <= 0) {
      setSendError("Enter a destination address and a positive amount");
      return;
    }
    setConfirming(true);
  }

  async function confirmSend() {
    setSending(true); setSendError(null);
    try {
      let r: SendResult | { ok: false; error: string };
      if (chain.kind === "evm") {
        r = await sendEvm({ chainId: chain.id as "sepolia" | "base-sepolia", privateKey: session.secrets.evmPrivateKey, to: to.trim(), amountEth: amount.trim() });
      } else if (chain.kind === "solana") {
        r = await sendSolana({ secretKeyB58: session.secrets.solanaSecretKey, to: to.trim(), amountSol: amount.trim() });
      } else {
        r = await sendNearImplicit({ implicitAccountId: address, secretKey: session.secrets.nearSecretKey, to: to.trim(), amountNear: amount.trim() });
      }
      if (!r.ok) { setSendError(r.error); return; }
      setTxHash(r.hash); setExplorerUrl(r.explorerUrl);
      setConfirming(false); setTo(""); setAmount("");
      onBalanceRefresh(); loadHistory();
    } catch (e) { setSendError(e instanceof Error ? e.message : "Send failed"); }
    finally { setSending(false); }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>
            {chain.name} <span style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 999, padding: "3px 10px", marginLeft: 8 }}>{chain.testnetName}</span>
          </div>
          <div style={{ ...hint, fontSize: 12, marginTop: 4 }}>Derivation: <span style={mono}>{chain.derivationPath}</span></div>
        </div>
        <a href={chain.explorerAddress(address)} target="_blank" rel="noreferrer" style={{ color: "#22d3ee", fontSize: 13 }}>Explorer ↗</a>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <div style={{ ...mono, color: "#e9eef7", flex: "1 1 240px" }}>{address}</div>
        <CopyButton text={address} />
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginTop: 14, flexWrap: "wrap" }}>
        <div>
          <div style={label}>BALANCE (LIVE)</div>
          {!balance ? <div style={{ fontSize: 24, fontWeight: 800 }}>…</div>
          : balance.ok ? <div style={{ fontSize: 24, fontWeight: 800 }}>{balance.balance} <span style={{ fontSize: 13, color: "#93a0b8" }}>{balance.symbol}</span></div>
          : <div style={{ fontSize: 14, color: "#fca5a5" }}>Balance unavailable</div>}
          {balance && !balance.ok && balance.error && <div style={{ ...hint, color: "#fca5a5", fontSize: 12 }}>{balance.error}</div>}
        </div>
      </div>

      {/* Faucet — honest: funded shown only after RPC confirms a balance */}
      <div style={{ marginTop: 12, padding: 12, border: "1px solid rgba(125,211,252,0.12)", borderRadius: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Testnet faucet</div>
        <div style={{ ...hint, fontSize: 12, marginBottom: 8 }}>{chain.faucetNote}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <a className="vg-btn vg-btn-ghost" style={{ padding: "8px 14px", fontSize: 13, textDecoration: "none" }}
            href={chain.faucetUrl} target="_blank" rel="noreferrer">Open official faucet ↗</a>
          <button className="vg-btn vg-btn-ghost" style={{ padding: "8px 14px", fontSize: 13 }} onClick={onBalanceRefresh}>
            I've funded — check balance
          </button>
        </div>
        {balance?.ok && Number(balance.balance) > 0 && (
          <div style={{ color: "#86efac", fontSize: 13, marginTop: 8 }}>✓ Funded — confirmed by live RPC balance.</div>
        )}
      </div>

      {/* Send */}
      <div style={{ marginTop: 12 }}>
        <button className="vg-btn vg-btn-ghost" style={{ fontSize: 13 }} onClick={() => setShowSend(!showSend)}>
          {showSend ? "Hide send" : `Send ${chain.nativeSymbol} (testnet)`}
        </button>
        {showSend && (
          <div style={{ marginTop: 12 }}>
            {!confirming ? (
              <div>
                <Field title={`Destination (${chain.testnetName} address)`}>
                  <input style={input} value={to} onChange={(e) => setTo(e.target.value)} placeholder={chain.kind === "evm" ? "0x…" : chain.kind === "solana" ? "base58 address…" : "account.testnet or 64-hex…"} />
                </Field>
                <Field title={`Amount (${chain.nativeSymbol})`}>
                  <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01" inputMode="decimal" />
                </Field>
                <button className="vg-btn" onClick={previewSend}>Preview transfer</button>
                {policyBlock && <div style={errBox}>🛡 {policyBlock}</div>}
                {sendError && <ErrorBox message={sendError} />}
              </div>
            ) : (
              <div>
                <div style={{ ...hint, marginBottom: 14, color: "#e9eef7" }}>
                  <b>Review before signing.</b> This builds a real on-chain transfer on {chain.testnetName}. Signing happens locally — no server ever sees your key.
                </div>
                <div className="vg-kv" style={{ marginBottom: 16 }}>
                  <div><dt>To</dt><dd style={{ ...mono, fontSize: 12 }}>{to.trim()}</dd></div>
                  <div><dt>Amount</dt><dd>{amount.trim()} {chain.nativeSymbol}</dd></div>
                  <div><dt>Network</dt><dd>{chain.testnetName} (testnet — valueless tokens)</dd></div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="vg-btn" disabled={sending} onClick={confirmSend}>{sending ? "Broadcasting…" : "Confirm & sign"}</button>
                  <button className="vg-btn vg-btn-ghost" disabled={sending} onClick={() => setConfirming(false)}>Cancel</button>
                </div>
                {sendError && <ErrorBox message={sendError} />}
              </div>
            )}
            {txHash && (
              <div style={okBox}>✓ Sent. Transaction hash:
                <div style={{ ...mono, fontSize: 12, marginTop: 6 }}>{txHash}</div>
                {explorerUrl && <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ color: "#22d3ee", fontSize: 13 }}>Verify on explorer ↗</a>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* History */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Transaction history</div>
          <button className="vg-btn vg-btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={loadHistory} disabled={loadingHist}>↻</button>
        </div>
        {loadingHist ? <p style={hint}>Loading…</p>
        : historyMsg ? <p style={{ ...hint, color: "#fca5a5" }}>{historyMsg} <a href={chain.explorerAddress(address)} target="_blank" rel="noreferrer" style={{ color: "#22d3ee" }}>Open explorer ↗</a></p>
        : history && history.length === 0 ? <p style={hint}>No transactions found for this address on {chain.testnetName} yet.</p>
        : history ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((t) => (
              <div key={t.hash} style={{ border: "1px solid rgba(125,211,252,0.12)", borderRadius: 10, padding: "8px 12px", fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={mono}>{t.hash.slice(0, 20)}…{t.hash.slice(-6)}</span>
                  <span style={{ color: t.status === "failed" ? "#fca5a5" : "#86efac", fontWeight: 700, fontSize: 11 }}>
                    {t.status === "failed" ? "FAILED" : t.status === "success" ? "✓" : t.status.toUpperCase()}
                  </span>
                </div>
                <a href={chain.explorerTx(t.hash)} target="_blank" rel="noreferrer" style={{ color: "#22d3ee", fontSize: 11 }}>Verify ↗</a>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
