"use client";

/**
 * VAULTGUARD swap UI — transaction history (workstream G).
 *
 * Reads ONLY from localStorage key `vg_swap_history`. Never seeds fake
 * entries — an empty history renders "No swaps yet". When the execution
 * workstream lands, it appends real entries via appendSwapHistory(); this
 * component simply renders them honestly.
 */

import { useEffect, useState } from "react";

export const SWAP_HISTORY_KEY = "vg_swap_history";

export interface SwapHistoryEntry {
  id: string;
  /** epoch ms when the entry was recorded */
  ts: number;
  fromChain: string;
  toChain: string;
  fromSymbol: string;
  toSymbol: string;
  amountIn: string;
  amountOut?: string;
  /** Real tx hash only — never fabricated. Omit when not yet known. */
  txHash?: string;
  status: "pending" | "confirmed" | "failed";
}

/**
 * Appends a REAL executed-swap entry to history. Called by the execution
 * workstream only, with a genuine on-chain tx hash. Never call with
 * placeholder data.
 */
export function appendSwapHistory(entry: SwapHistoryEntry): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(SWAP_HISTORY_KEY);
    const list: SwapHistoryEntry[] = raw ? (JSON.parse(raw) as SwapHistoryEntry[]) : [];
    list.unshift(entry);
    window.localStorage.setItem(SWAP_HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    // storage unavailable — history is best-effort, never blocks execution
  }
}

function readHistory(): SwapHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SWAP_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SwapHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export default function SwapHistory() {
  const [entries, setEntries] = useState<SwapHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setEntries(readHistory());
    setLoaded(true);
  }, []);

  return (
    <div className="glass glass-pad" aria-label="Swap history">
      <div className="vg-label" style={{ marginBottom: 16 }}>
        Transaction history
      </div>
      {!loaded ? (
        <div className="vg-trail t-dim">loading history…</div>
      ) : entries.length === 0 ? (
        <div className="vg-trail t-dim">
          No swaps yet — executed swaps will appear here once on-chain
          execution wiring lands.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {entries.map((e) => (
            <li
              key={e.id}
              style={{
                border: "1px solid rgba(125,211,252,0.14)",
                borderRadius: 10,
                padding: "12px 14px",
                fontSize: 13.5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontWeight: 700 }}>
                  {e.amountIn} {e.fromSymbol} → {e.toSymbol}
                </span>
                <span
                  className={`vg-badge ${e.status === "confirmed" ? "ok" : e.status === "failed" ? "no" : "info"}`}
                >
                  {e.status}
                </span>
              </div>
              <div className="vg-trail" style={{ marginTop: 6 }}>
                <span className="t-dim">
                  {e.fromChain} → {e.toChain} · {new Date(e.ts).toLocaleString()}
                </span>
                {e.txHash && (
                  <div className="t-dim" style={{ wordBreak: "break-all" }}>
                    tx: {e.txHash}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
