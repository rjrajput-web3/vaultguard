"use client";

/**
 * VAULTGUARD swap UI — animated route visualization (workstream G).
 *
 * Renders an SVG path from the source chain node to the destination chain
 * node. Uses text/symbol badges only — no external image dependencies that
 * could break. The animated dashed stroke reuses the site's vg-flow-line
 * design-system class.
 */

export type RouteStatus = "idle" | "quoting" | "quoted" | "error";

interface RouteVizProps {
  fromChain: string;
  toChain: string;
  fromSymbol: string;
  toSymbol: string;
  /** Human-readable amount line, e.g. "10 USDC → 9.7479 USDC". Null = not quoted. */
  routeLabel: string | null;
  status: RouteStatus;
}

function badgeLabel(chain: string, symbol: string): string {
  const s = (symbol || "?").trim().slice(0, 6).toUpperCase() || "?";
  return s;
}

export default function RouteViz({
  fromChain,
  toChain,
  fromSymbol,
  toSymbol,
  routeLabel,
  status,
}: RouteVizProps) {
  const lineColor =
    status === "error"
      ? "#ef4444"
      : status === "quoted"
        ? "#22c55e"
        : status === "quoting"
          ? "#f59e0b"
          : "#22d3ee";

  return (
    <div className="glass glass-pad" aria-label="Swap route visualization">
      <div className="vg-label" style={{ marginBottom: 16 }}>
        Route
      </div>
      <svg
        viewBox="0 0 560 180"
        width="100%"
        role="img"
        aria-label={`Route from ${fromChain} to ${toChain}`}
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id="vg-route-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>

        {/* animated path */}
        <path
          d="M 90 90 C 200 20, 360 160, 470 90"
          fill="none"
          stroke={status === "error" ? lineColor : "url(#vg-route-grad)"}
          strokeWidth={3}
          strokeLinecap="round"
          className="vg-flow-line"
          opacity={status === "idle" ? 0.45 : 1}
        />
        {/* travelling packet */}
        {status !== "idle" && status !== "error" && (
          <circle r="6" fill="#22d3ee">
            <animateMotion dur="2.2s" repeatCount="indefinite" path="M 90 90 C 200 20, 360 160, 470 90" />
          </circle>
        )}

        {/* source node */}
        <g className="vg-node">
          <circle cx="90" cy="90" r="34" fill="#0a1020" stroke="#3b82f6" strokeWidth="2.5" />
          <text x="90" y="86" textAnchor="middle" fill="#e9eef7" fontSize="15" fontWeight="800">
            {badgeLabel(fromChain, fromSymbol)}
          </text>
          <text x="90" y="106" textAnchor="middle" fill="#93a0b8" fontSize="11">
            {fromChain || "—"}
          </text>
        </g>

        {/* destination node */}
        <g className="vg-node">
          <circle
            cx="470"
            cy="90"
            r="34"
            fill="#0a1020"
            stroke={status === "error" ? "#ef4444" : "#22d3ee"}
            strokeWidth="2.5"
          />
          <text x="470" y="86" textAnchor="middle" fill="#e9eef7" fontSize="15" fontWeight="800">
            {badgeLabel(toChain, toSymbol)}
          </text>
          <text x="470" y="106" textAnchor="middle" fill="#93a0b8" fontSize="11">
            {toChain || "—"}
          </text>
        </g>
      </svg>

      <div
        className="vg-trail"
        style={{ marginTop: 12, textAlign: "center", minHeight: 24 }}
        aria-live="polite"
      >
        {routeLabel ? (
          <span className={status === "error" ? "t-warn" : status === "quoted" ? "t-ok" : "t-dim"}>
            {routeLabel}
          </span>
        ) : (
          <span className="t-dim">select a pair and get a live quote</span>
        )}
      </div>
    </div>
  );
}
