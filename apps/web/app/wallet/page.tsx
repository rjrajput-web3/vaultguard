"use client";

/**
 * VAULTGUARD wallet page — workstream B (wallet core).
 *
 * HONESTY CONTRACT shown to users throughout this UI:
 * - NEAR keys are generated + encrypted + stored on THIS device only.
 *   They are never sent to any server.
 * - EVM/Solana work ONLY through injected external wallets (MetaMask,
 *   Phantom, …). No wallet detected → we say so, never fake it.
 * - NEAR side is testnet only. Balances that fail to load show
 *   "unavailable" — never a made-up number.
 */

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  generateWallet,
  saveKeystore,
  loadKeystoreMeta,
  unlockKeystore,
  clearKeystore,
  keyPairFromSeedPhrase,
  keyPairFromSecretKey,
  type GeneratedWallet,
} from "../../lib/wallet/keys";
import {
  createTestnetConnection,
  getNearBalance,
  getSignerAccount,
  estimateSendFee,
  sendNear,
  getRecentTransactions,
  isValidAccountId,
  NEAR_EXPLORER,
  type TestnetConnection,
  type NearBalance,
  type FeeEstimate,
  type TxRecord,
} from "../../lib/wallet/near";
import {
  connectEvm,
  getEvmBalance,
  detectEvmProvider,
  type EvmConnectResult,
} from "../../lib/wallet/evm";
import {
  connectSolana,
  getSolanaBalance,
  detectSolanaProvider,
  type SolanaConnectResult,
} from "../../lib/wallet/solana";

/* ---------------- small UI helpers ---------------- */

const card: React.CSSProperties = {
  background: "rgba(13,20,38,0.75)",
  border: "1px solid rgba(125,211,252,0.14)",
  borderRadius: 14,
  padding: 22,
  marginBottom: 18,
};
const input: React.CSSProperties = {
  width: "100%",
  background: "rgba(7,11,22,0.8)",
  border: "1px solid rgba(125,211,252,0.25)",
  borderRadius: 8,
  color: "#e9eef7",
  padding: "11px 13px",
  fontSize: 15,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 13, color: "#93a0b8", marginBottom: 6, display: "block" };
const errBox: React.CSSProperties = {
  background: "rgba(239,68,68,0.1)",
  border: "1px solid rgba(239,68,68,0.35)",
  borderRadius: 8,
  color: "#fca5a5",
  padding: "10px 13px",
  fontSize: 14,
  marginTop: 12,
};
const okBox: React.CSSProperties = {
  background: "rgba(34,197,94,0.08)",
  border: "1px solid rgba(34,197,94,0.3)",
  borderRadius: 8,
  color: "#86efac",
  padding: "10px 13px",
  fontSize: 14,
  marginTop: 12,
};
const hint: React.CSSProperties = { fontSize: 13, color: "#5b6a84", lineHeight: 1.6 };

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={label}>{title}</label>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div style={errBox}>⚠ {message}</div>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="vg-btn vg-btn-ghost"
      style={{ padding: "6px 12px", fontSize: 13 }}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "✓ Copied" : "Copy"}
    </button>
  );
}

/* ---------------- session state ---------------- */

interface WalletSession {
  accountId: string;
  secretKey: string; // in memory only — never persisted unencrypted
}

type MainTab = "dashboard" | "create" | "import" | "connect";
type ConnectTab = "evm" | "solana";

/* ---------------- page ---------------- */

export default function WalletPage() {
  const [tab, setTab] = useState<MainTab>("dashboard");
  const [conn, setConn] = useState<TestnetConnection | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [savedAccountId, setSavedAccountId] = useState<string | null>(null);

  useEffect(() => {
    setConn(createTestnetConnection());
    try {
      const meta = loadKeystoreMeta();
      if (meta.ok) setSavedAccountId(meta.keystore.accountId);
    } catch {
      /* client-only module; ignore on SSR pass */
    }
  }, []);

  return (
    <div className="vg-wrap" style={{ paddingTop: 100, paddingBottom: 60, maxWidth: 880 }}>
      <div className="vg-eyebrow">VAULTGUARD · WALLET</div>
      <h1 className="vg-h2" style={{ marginBottom: 6 }}>
        Your keys. <span className="grad-text">Your device. Nobody else.</span>
      </h1>
      <p className="vg-sub" style={{ marginBottom: 22 }}>
        NEAR keys are generated, encrypted and stored on this device only — they are never sent
        to any server. Ethereum and Solana work through your own external wallet extensions.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        {(
          [
            ["dashboard", "Dashboard"],
            ["create", "Create wallet"],
            ["import", "Import wallet"],
            ["connect", "Connect external"],
          ] as [MainTab, string][]
        ).map(([k, t]) => (
          <button
            key={k}
            className={tab === k ? "vg-btn" : "vg-btn vg-btn-ghost"}
            onClick={() => setTab(k)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <Dashboard
          conn={conn}
          session={session}
          savedAccountId={savedAccountId}
          onUnlock={(s) => setSession(s)}
          onForget={() => {
            try {
              clearKeystore();
            } catch {
              /* noop */
            }
            setSession(null);
            setSavedAccountId(null);
          }}
          goTo={(t) => setTab(t)}
        />
      )}
      {tab === "create" && conn && (
        <CreateFlow
          onDone={(s) => {
            setSession(s);
            setSavedAccountId(s.accountId);
            setTab("dashboard");
          }}
        />
      )}
      {tab === "import" && conn && (
        <ImportFlow
          onDone={(s) => {
            setSession(s);
            setSavedAccountId(s.accountId);
            setTab("dashboard");
          }}
        />
      )}
      {tab === "connect" && <ExternalWallets />}
    </div>
  );
}

/* ================= DASHBOARD ================= */

function Dashboard(props: {
  conn: TestnetConnection | null;
  session: WalletSession | null;
  savedAccountId: string | null;
  onUnlock: (s: WalletSession) => void;
  onForget: () => void;
  goTo: (t: MainTab) => void;
}) {
  const { conn, session } = props;
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const [balance, setBalance] = useState<NearBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [history, setHistory] = useState<TxRecord[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [fee, setFee] = useState<FeeEstimate | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [qrDrawn, setQrDrawn] = useState(false);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  const refreshBalance = async () => {
    if (!conn || !session) return;
    setLoadingBalance(true);
    setBalanceError(null);
    try {
      setBalance(await getNearBalance(conn.provider, session.accountId));
    } catch (e) {
      setBalance(null);
      setBalanceError(e instanceof Error ? e.message : "Balance unavailable");
    } finally {
      setLoadingBalance(false);
    }
  };

  const refreshHistory = async () => {
    if (!session) return;
    const r = await getRecentTransactions(session.accountId, 25);
    if (r.status === "ok") {
      setHistory(r.txs);
      setHistoryError(null);
    } else {
      setHistory(null);
      setHistoryError(r.error ?? "Transaction history unavailable");
    }
  };

  useEffect(() => {
    if (conn && session) {
      refreshBalance();
      refreshHistory();
      setQrDrawn(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, session]);

  useEffect(() => {
    if (session && qrRef.current && !qrDrawn) {
      QRCode.toCanvas(qrRef.current, session.accountId, { width: 180, margin: 1 }).then(
        () => setQrDrawn(true),
        () => setQrDrawn(false)
      );
    }
  }, [session, qrDrawn]);

  /* ---- locked / empty states ---- */

  if (!session) {
    return (
      <div style={card}>
        {props.savedAccountId ? (
          <>
            <h3 style={{ margin: "0 0 6px" }}>Wallet saved on this device</h3>
            <p style={hint}>
              Account <b style={{ color: "#e9eef7", fontFamily: "monospace" }}>{props.savedAccountId}</b> is
              stored encrypted. Enter your password to unlock it. The key never leaves this device.
            </p>
            <Field title="Wallet password">
              <input
                type="password"
                style={input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doUnlock();
                }}
                placeholder="••••••••"
              />
            </Field>
            <button className="vg-btn" disabled={unlocking || !password} onClick={doUnlock}>
              {unlocking ? "Unlocking…" : "Unlock wallet"}
            </button>
            {unlockError && <ErrorBox message={unlockError} />}
          </>
        ) : (
          <>
            <h3 style={{ margin: "0 0 6px" }}>No wallet on this device yet</h3>
            <p style={hint}>
              Create a new NEAR testnet wallet (keys generated + encrypted locally) or import an
              existing one. Nothing is created on-chain until you fund an account.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button className="vg-btn" onClick={() => props.goTo("create")}>Create wallet</button>
              <button className="vg-btn vg-btn-ghost" onClick={() => props.goTo("import")}>Import wallet</button>
            </div>
          </>
        )}
      </div>
    );
  }

  async function doUnlock() {
    setUnlocking(true);
    setUnlockError(null);
    try {
      const r = await unlockKeystore(password);
      if (!r.ok) {
        setUnlockError(r.error);
        return;
      }
      const meta = loadKeystoreMeta();
      const accountId = meta.ok ? meta.keystore.accountId : "";
      props.onUnlock({ accountId, secretKey: r.secretKey });
      setPassword("");
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setUnlocking(false);
    }
  }

  /* ---- send flow ---- */

  async function previewSend() {
    setSendError(null);
    setFeeError(null);
    setTxHash(null);
    if (!isValidAccountId(sendTo)) {
      setSendError(`"${sendTo}" is not a valid NEAR account ID`);
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(sendAmount.trim()) || Number(sendAmount) <= 0) {
      setSendError("Enter a valid positive NEAR amount");
      return;
    }
    try {
      setFee(await estimateSendFee());
      setConfirming(true);
    } catch (e) {
      setFeeError(e instanceof Error ? e.message : "Could not estimate the network fee");
    }
  }

  async function confirmSend() {
    if (!conn || !session) return;
    setSending(true);
    setSendError(null);
    try {
      const account = getSignerAccount({
        provider: conn.provider,
        accountId: session.accountId,
        secretKey: session.secretKey,
      });
      const r = await sendNear({ account, receiverId: sendTo.trim(), amountNear: sendAmount.trim() });
      setTxHash(r.txHash);
      setConfirming(false);
      setSendTo("");
      setSendAmount("");
      refreshBalance();
      refreshHistory();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setSending(false);
    }
  }

  /* ---- dashboard view ---- */

  return (
    <div>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={label}>NEAR TESTNET ACCOUNT</div>
            <div style={{ fontFamily: "monospace", fontSize: 19, fontWeight: 700, wordBreak: "break-all" }}>
              {session.accountId}
            </div>
          </div>
          <CopyButton text={session.accountId} />
        </div>
        <div style={{ display: "flex", gap: 26, marginTop: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={label}>BALANCE (LIVE)</div>
            {loadingBalance ? (
              <div style={{ fontSize: 30, fontWeight: 800 }}>…</div>
            ) : balance ? (
              <div style={{ fontSize: 30, fontWeight: 800 }}>
                {balance.near} <span style={{ fontSize: 15, color: "#93a0b8" }}>NEAR</span>
              </div>
            ) : (
              <div style={{ fontSize: 16, color: "#fca5a5" }}>Balance unavailable</div>
            )}
            {balanceError && <div style={{ ...hint, color: "#fca5a5", maxWidth: 320 }}>{balanceError}</div>}
          </div>
          <button className="vg-btn vg-btn-ghost" onClick={refreshBalance} disabled={loadingBalance}>
            ↻ Refresh
          </button>
        </div>
        {balanceError && balanceError.includes("not found") && (
          <div style={{ ...hint, marginTop: 10 }}>
            New account? Fund it on the{" "}
            <a href="https://near-faucet.io" target="_blank" rel="noreferrer" style={{ color: "#22d3ee" }}>
              NEAR testnet faucet ↗
            </a>{" "}
            (free testnet tokens), then refresh.
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* RECEIVE */}
        <div style={card}>
          <h3 style={{ margin: "0 0 12px" }}>Receive</h3>
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 14px" }}>
            <canvas ref={qrRef} style={{ borderRadius: 8, background: "#fff", padding: 8 }} />
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 13, wordBreak: "break-all", color: "#93a0b8", marginBottom: 10 }}>
            {session.accountId}
          </div>
          <CopyButton text={session.accountId} />
        </div>

        {/* SEND */}
        <div style={card}>
          <h3 style={{ margin: "0 0 12px" }}>Send NEAR (testnet)</h3>
          {!confirming ? (
            <>
              <Field title="Destination account">
                <input style={input} value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="receiver.testnet" />
              </Field>
              <Field title="Amount (NEAR)">
                <input style={input} value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} placeholder="0.5" inputMode="decimal" />
              </Field>
              <button className="vg-btn" onClick={previewSend}>Preview transfer</button>
              {feeError && <ErrorBox message={feeError} />}
              {sendError && <ErrorBox message={sendError} />}
              {txHash && (
                <div style={okBox}>
                  ✓ Sent. Transaction hash:
                  <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", marginTop: 6 }}>{txHash}</div>
                  <a href={`${NEAR_EXPLORER}/transactions/${txHash}`} target="_blank" rel="noreferrer" style={{ color: "#22d3ee", fontSize: 13 }}>
                    Verify on explorer ↗
                  </a>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ ...hint, marginBottom: 14, color: "#e9eef7" }}>
                <b>Review before signing.</b> This builds a real on-chain transfer on NEAR testnet.
              </div>
              <div className="vg-kv" style={{ marginBottom: 16 }}>
                <div><dt>From</dt><dd style={{ fontFamily: "monospace", fontSize: 13 }}>{session.accountId}</dd></div>
                <div><dt>To</dt><dd style={{ fontFamily: "monospace", fontSize: 13 }}>{sendTo.trim()}</dd></div>
                <div><dt>Amount</dt><dd>{sendAmount.trim()} NEAR</dd></div>
                <div><dt>Network fee (est. upper bound)</dt><dd>{fee ? `≤ ${fee.feeNearUpperBound} NEAR` : "—"}</dd></div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="vg-btn" disabled={sending} onClick={confirmSend}>
                  {sending ? "Broadcasting…" : "Confirm & sign"}
                </button>
                <button className="vg-btn vg-btn-ghost" disabled={sending} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
              {sendError && <ErrorBox message={sendError} />}
              <p style={{ ...hint, marginTop: 12 }}>
                Signing happens locally with the key on this device. No server ever sees it.
              </p>
            </>
          )}
        </div>
      </div>

      {/* HISTORY */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Transaction history</h3>
          <button className="vg-btn vg-btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={refreshHistory}>
            ↻
          </button>
        </div>
        {historyError ? (
          <p style={{ ...hint, color: "#fca5a5" }}>{historyError}</p>
        ) : history === null ? (
          <p style={hint}>Loading…</p>
        ) : history.length === 0 ? (
          <p style={hint}>No transactions found for this account on testnet yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {history.map((t) => (
              <div
                key={t.hash}
                style={{
                  border: "1px solid rgba(125,211,252,0.12)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 13,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "monospace", color: "#e9eef7" }}>
                    {t.hash.slice(0, 24)}…{t.hash.slice(-6)}
                  </span>
                  <span
                    style={{
                      color: t.succeeded === false ? "#fca5a5" : "#86efac",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {t.succeeded === false ? "FAILED" : "✓ " + t.kind.toUpperCase()}
                  </span>
                </div>
                <div style={{ color: "#5b6a84", marginTop: 4 }}>
                  {t.signerId} → {t.receiverId}
                </div>
                <a href={`${NEAR_EXPLORER}/transactions/${t.hash}`} target="_blank" rel="noreferrer" style={{ color: "#22d3ee", fontSize: 12 }}>
                  Verify on explorer ↗
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <h3 style={{ margin: "0 0 8px" }}>Device & security</h3>
        <p style={hint}>
          The encrypted key for <b style={{ color: "#e9eef7" }}>{session.accountId}</b> lives in this
          browser's local storage. "Forget this device" wipes it — make sure your recovery phrase
          is backed up first.
        </p>
        <button className="vg-btn vg-btn-ghost" onClick={props.onForget} style={{ borderColor: "rgba(239,68,68,0.4)", color: "#fca5a5" }}>
          Forget this device
        </button>
      </div>
    </div>
  );
}

/* ================= CREATE FLOW ================= */

function CreateFlow({ onDone }: { onDone: (s: WalletSession) => void }) {
  const [accountId, setAccountId] = useState("");
  const [wallet, setWallet] = useState<GeneratedWallet | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function generate() {
    setError(null);
    const id = accountId.trim();
    if (!isValidAccountId(id)) {
      setError(`"${id || "(empty)"}" is not a valid NEAR account ID (use lowercase letters, digits, . - _)`);
      return;
    }
    try {
      setWallet(generateWallet());
      setBackedUp(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Key generation failed");
    }
  }

  async function save() {
    setError(null);
    if (!wallet) return;
    if (!backedUp) {
      setError("Confirm you have backed up the recovery phrase before continuing");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      const r = await saveKeystore(accountId.trim(), wallet.publicKey, wallet.secretKey, password);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone({ accountId: accountId.trim(), secretKey: wallet.secretKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saving failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={card}>
        <h3 style={{ margin: "0 0 6px" }}>1 · Choose your testnet account ID</h3>
        <p style={hint}>
          This creates the <b>keys</b> on this device. The account itself becomes usable once it
          exists on NEAR testnet (e.g. funded via the{" "}
          <a href="https://near-faucet.io" target="_blank" rel="noreferrer" style={{ color: "#22d3ee" }}>
            testnet faucet ↗
          </a>
          ).
        </p>
        <Field title="Testnet account ID">
          <input style={input} value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="myname.testnet" disabled={!!wallet} />
        </Field>
        {!wallet && (
          <button className="vg-btn" onClick={generate}>
            Generate keys
          </button>
        )}
        {error && <ErrorBox message={error} />}
      </div>

      {wallet && (
        <div style={card}>
          <h3 style={{ margin: "0 0 6px" }}>2 · Back up your recovery phrase</h3>
          <p style={hint}>
            Write these 12 words down <b>in order</b> and store them somewhere safe. Anyone with
            them controls this account. VaultGuard never sees or stores them anywhere but this
            device.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
              margin: "14px 0",
            }}
          >
            {wallet.seedPhrase.split(" ").map((w, i) => (
              <div
                key={i}
                style={{
                  background: "rgba(7,11,22,0.8)",
                  border: "1px solid rgba(125,211,252,0.25)",
                  borderRadius: 8,
                  padding: "9px 10px",
                  fontFamily: "monospace",
                  fontSize: 15,
                }}
              >
                <span style={{ color: "#5b6a84", marginRight: 8, fontSize: 12 }}>{i + 1}</span>
                {w}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <CopyButton text={wallet.seedPhrase} />
            <span style={hint}>Public key: <span style={{ fontFamily: "monospace" }}>{wallet.publicKey}</span></span>
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 18, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={backedUp}
              onChange={(e) => setBackedUp(e.target.checked)}
              style={{ width: 18, height: 18, marginTop: 2, accentColor: "#22d3ee" }}
            />
            <span style={{ fontSize: 14 }}>
              <b>I have backed up my 12-word recovery phrase.</b> I understand that losing it means
              losing access to this account, and no one — not even VaultGuard — can recover it.
            </span>
          </label>

          <h3 style={{ margin: "0 0 6px" }}>3 · Encrypt with a password</h3>
          <p style={hint}>
            The private key is encrypted with this password (AES-GCM, PBKDF2 key derivation)
            before it is stored in this browser. VaultGuard cannot decrypt it without the password.
          </p>
          <Field title="Password (min. 8 characters)">
            <input type="password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field title="Confirm password">
            <input type="password" style={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
          </Field>
          <button className="vg-btn" disabled={saving || !backedUp} onClick={save}>
            {saving ? "Encrypting & saving…" : "Encrypt & save wallet"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ================= IMPORT FLOW ================= */

type ImportKind = "phrase" | "key";

function ImportFlow({ onDone }: { onDone: (s: WalletSession) => void }) {
  const [kind, setKind] = useState<ImportKind>("phrase");
  const [accountId, setAccountId] = useState("");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function doImport() {
    setError(null);
    const id = accountId.trim();
    if (!isValidAccountId(id)) {
      setError(`"${id || "(empty)"}" is not a valid NEAR account ID`);
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      const keyPair =
        kind === "phrase"
          ? keyPairFromSeedPhrase(secret)
          : keyPairFromSecretKey(secret);
      const secretKey = keyPair.toString();
      const publicKey = keyPair.getPublicKey().toString();
      const r = await saveKeystore(id, publicKey, secretKey, password);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSecret("");
      onDone({ accountId: id, secretKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed — check your phrase/key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 6px" }}>Import an existing NEAR testnet wallet</h3>
      <p style={hint}>
        Your phrase or private key is parsed and encrypted <b>on this device only</b> — it is never
        sent to any server. After import it is cleared from this form.
      </p>
      <div style={{ display: "flex", gap: 10, margin: "14px 0 18px" }}>
        {(
          [
            ["phrase", "Recovery phrase"],
            ["key", "Private key"],
          ] as [ImportKind, string][]
        ).map(([k, t]) => (
          <button key={k} className={kind === k ? "vg-btn" : "vg-btn vg-btn-ghost"} onClick={() => setKind(k)}>
            {t}
          </button>
        ))}
      </div>
      <Field title="Testnet account ID">
        <input style={input} value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="myname.testnet" />
      </Field>
      <Field title={kind === "phrase" ? "12-word recovery phrase" : "Private key (ed25519:…)"}>
        <textarea
          style={{ ...input, minHeight: 74, resize: "vertical" }}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={kind === "phrase" ? "word1 word2 … word12" : "ed25519:…"}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field title="New encryption password (min. 8 characters)">
        <input type="password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </Field>
      <Field title="Confirm password">
        <input type="password" style={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
      </Field>
      <button className="vg-btn" disabled={saving || !secret.trim()} onClick={doImport}>
        {saving ? "Encrypting & importing…" : "Encrypt & import"}
      </button>
      {error && <ErrorBox message={error} />}
    </div>
  );
}

/* ================= EXTERNAL WALLETS (EVM / SOLANA) ================= */

function ExternalWallets() {
  const [ctab, setCtab] = useState<ConnectTab>("evm");
  return (
    <div>
      <div style={card}>
        <h3 style={{ margin: "0 0 6px" }}>Connect an external wallet</h3>
        <p style={hint}>
          Ethereum and Solana accounts connect through <b>your own wallet extensions</b>
          (MetaMask, Phantom, …). VaultGuard never asks for their keys and never manages them.
          If no wallet is detected, we say so — one connector never pretends to cover every chain.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className={ctab === "evm" ? "vg-btn" : "vg-btn vg-btn-ghost"} onClick={() => setCtab("evm")}>
            Ethereum
          </button>
          <button className={ctab === "solana" ? "vg-btn" : "vg-btn vg-btn-ghost"} onClick={() => setCtab("solana")}>
            Solana
          </button>
        </div>
      </div>
      {ctab === "evm" ? <EvmPanel /> : <SolanaPanel />}
    </div>
  );
}

function EvmPanel() {
  const [result, setResult] = useState<EvmConnectResult | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setBalance(null);
    setBalanceError(null);
    const r = await connectEvm();
    setResult(r);
    if (r.status === "connected") {
      try {
        const b = await getEvmBalance(r.address);
        setBalance(b.eth);
      } catch (e) {
        setBalanceError(e instanceof Error ? e.message : "Balance unavailable");
      }
    }
    setBusy(false);
  }

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 6px" }}>Ethereum · external wallet</h3>
      {result === null && (
        <>
          <p style={hint}>
            {detectEvmProvider()
              ? "An injected EVM wallet was detected in this browser."
              : "No EVM wallet extension detected in this browser."}
          </p>
          <button className="vg-btn" disabled={busy} onClick={connect}>
            {busy ? "Waiting for wallet…" : "Connect EVM wallet"}
          </button>
        </>
      )}
      {result?.status === "not-detected" && (
        <div style={errBox}>
          <b>No EVM wallet detected.</b> Install MetaMask or another EVM wallet extension in this
          browser, then try again. VaultGuard cannot create or manage Ethereum keys for you.
        </div>
      )}
      {result?.status === "rejected" && <ErrorBox message={result.message} />}
      {result?.status === "error" && <ErrorBox message={result.message} />}
      {result?.status === "connected" && (
        <>
          <div style={{ ...okBox, marginBottom: 12 }}>✓ Connected</div>
          <div style={label}>ADDRESS</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, wordBreak: "break-all", marginBottom: 14 }}>
            {result.address}
          </div>
          <div style={label}>BALANCE (READ-ONLY, ETHEREUM MAINNET)</div>
          {balance !== null ? (
            <div style={{ fontSize: 24, fontWeight: 800 }}>
              {balance} <span style={{ fontSize: 14, color: "#93a0b8" }}>ETH</span>
            </div>
          ) : (
            <div style={{ color: "#fca5a5", fontSize: 15 }}>{balanceError ?? "Loading…"}</div>
          )}
          <p style={{ ...hint, marginTop: 12 }}>
            Sending from this address happens in your wallet's own UI — VaultGuard never signs
            Ethereum transactions on your behalf.
          </p>
          <button className="vg-btn vg-btn-ghost" onClick={() => { setResult(null); setBalance(null); }}>
            Disconnect view
          </button>
        </>
      )}
    </div>
  );
}

function SolanaPanel() {
  const [result, setResult] = useState<SolanaConnectResult | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setBalance(null);
    setBalanceError(null);
    const r = await connectSolana();
    setResult(r);
    if (r.status === "connected") {
      try {
        const b = await getSolanaBalance(r.address);
        setBalance(b.sol);
      } catch (e) {
        setBalanceError(e instanceof Error ? e.message : "Balance unavailable");
      }
    }
    setBusy(false);
  }

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 6px" }}>Solana · external wallet</h3>
      {result === null && (
        <>
          <p style={hint}>
            {detectSolanaProvider()
              ? "An injected Solana wallet was detected in this browser."
              : "No Solana wallet extension detected in this browser."}
          </p>
          <button className="vg-btn" disabled={busy} onClick={connect}>
            {busy ? "Waiting for wallet…" : "Connect Solana wallet"}
          </button>
        </>
      )}
      {result?.status === "not-detected" && (
        <div style={errBox}>
          <b>No Solana wallet detected.</b> Install Phantom or another Solana wallet extension in
          this browser, then try again. VaultGuard cannot create or manage Solana keys for you.
        </div>
      )}
      {result?.status === "rejected" && <ErrorBox message={result.message} />}
      {result?.status === "error" && <ErrorBox message={result.message} />}
      {result?.status === "connected" && (
        <>
          <div style={{ ...okBox, marginBottom: 12 }}>✓ Connected</div>
          <div style={label}>ADDRESS</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, wordBreak: "break-all", marginBottom: 14 }}>
            {result.address}
          </div>
          <div style={label}>BALANCE (READ-ONLY, SOLANA MAINNET)</div>
          {balance !== null ? (
            <div style={{ fontSize: 24, fontWeight: 800 }}>
              {balance} <span style={{ fontSize: 14, color: "#93a0b8" }}>SOL</span>
            </div>
          ) : (
            <div style={{ color: "#fca5a5", fontSize: 15 }}>{balanceError ?? "Loading…"}</div>
          )}
          <p style={{ ...hint, marginTop: 12 }}>
            Sending from this address happens in your wallet's own UI — VaultGuard never signs
            Solana transactions on your behalf.
          </p>
          <button className="vg-btn vg-btn-ghost" onClick={() => { setResult(null); setBalance(null); }}>
            Disconnect view
          </button>
        </>
      )}
    </div>
  );
}
