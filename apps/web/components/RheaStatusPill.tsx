/**
 * RheaStatusPill — honest RHEA integration status in the app header.
 *
 * P0 honesty fix (2026-11-02 audit): the header previously hardcoded
 * "Mainnet · RHEA live" even though RHEA_API_KEY is not set on the
 * deployment and /api/rhea/quote answers 503 RHEA_NOT_CONFIGURED.
 * This pill pings the server config endpoint and renders the truth:
 * green "RHEA · live" only when the key exists, amber "RHEA · not
 * configured" otherwise. It never claims live what isn't.
 */
"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "live" | "not-configured" | "unreachable";

export default function RheaStatusPill() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/rhea/quote", { method: "GET" });
        const j = (await r.json()) as { ok?: boolean; configured?: boolean };
        if (cancelled) return;
        setStatus(j.ok && j.configured ? "live" : "not-configured");
      } catch {
        if (!cancelled) setStatus("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const styles: Record<Status, { color: string; bg: string; border: string; dot: string; label: string; title: string }> = {
    checking: {
      color: "#93a0b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.25)",
      dot: "#94a3b8", label: "RHEA · checking…",
      title: "Checking whether RHEA execution is configured on this deployment",
    },
    live: {
      color: "#6ee7b7", bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.25)",
      dot: "#22c55e", label: "RHEA · live",
      title: "RHEA executable swaps are configured on this deployment",
    },
    "not-configured": {
      color: "#fcd34d", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.30)",
      dot: "#f59e0b", label: "RHEA · not configured",
      title: "RHEA_API_KEY is not set on this deployment — executable mainnet swaps are unavailable; testnet + dry-run flows still work",
    },
    unreachable: {
      color: "#93a0b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.25)",
      dot: "#94a3b8", label: "RHEA · unknown",
      title: "Could not reach the status endpoint",
    },
  };
  const s = styles[status];

  return (
    <div
      className="v-status"
      title={s.title}
      style={{ color: s.color, background: s.bg, borderColor: s.border }}
    >
      <span className="v-dot" style={{ background: s.dot, boxShadow: `0 0 10px ${s.dot}` }} />
      {s.label}
    </div>
  );
}
