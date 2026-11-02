"use client";

import { VERDICT_COLOR, type RiskVerdict } from "./risk";

type Props = {
  score: number;
  verdict: RiskVerdict;
  size?: number;
  animated?: boolean;
  scanning?: boolean;
};

/** SVG radial risk gauge 0–100. score/verdict always come from live data. */
export default function RiskGauge({ score, verdict, size = 220, animated = true, scanning = false }: Props) {
  const s = Math.max(0, Math.min(100, score));
  const color = VERDICT_COLOR[verdict];
  const cx = 100, cy = 95, r = 72;
  const startAngle = 200, endAngle = -20;
  const polar = (deg: number, rad: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return [cx + rad * Math.cos(t), cy + rad * Math.sin(t)];
  };
  const arcPath = (a0: number, a1: number, rad: number) => {
    const [x0, y0] = polar(a0, rad);
    const [x1, y1] = polar(a1, rad);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rad} ${rad} 0 1 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const needleAngle = startAngle - (s / 100) * (startAngle - endAngle);
  const band = (a0: number, a1: number, c: string, op: number) => (
    <path
      key={c}
      d={arcPath(a0, a1, r)}
      fill="none"
      stroke={c}
      strokeWidth={11}
      strokeLinecap="butt"
      opacity={op}
    />
  );
  return (
    <div className="risk-gauge-wrap" style={{ width: size, height: size * 0.82, position: "relative" }}>
      {scanning ? (
        <div className="radar-sweep" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={animated ? "radar-ring" : "radar-ring radar-ring-static"} style={{ animationDelay: `${i * 0.9}s` }} />
          ))}
        </div>
      ) : null}
      <svg viewBox="0 0 200 172" style={{ width: "100%", height: "auto", display: "block", position: "relative", zIndex: 2 }}>
        <path d={arcPath(200, -20, r)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={11} strokeLinecap="round" />
        {band(200, 128, "#34d399", verdict === "SAFE" ? 1 : 0.25)}
        {band(128, 52, "#fbbf24", verdict === "CAUTION" ? 1 : 0.25)}
        {band(52, -20, "#f87171", verdict === "BLOCKED" ? 1 : 0.25)}
        <line
          x1={cx}
          y1={cy}
          x2={polar(needleAngle, r - 8)[0]}
          y2={polar(needleAngle, r - 8)[1]}
          stroke={color}
          strokeWidth={3.5}
          strokeLinecap="round"
          className={animated && !scanning ? "gauge-needle" : "gauge-needle-static"}
          style={animated && !scanning ? ({ "--needle-angle": `${needleAngle}deg` } as React.CSSProperties) : undefined}
        />
        <circle cx={cx} cy={cy} r={7} fill="#0b0b14" stroke={color} strokeWidth={2.5} />
        <text x={cx} y={cy + 34} textAnchor="middle" fill={color} fontSize={26} fontWeight={800} fontFamily="Space Grotesk, sans-serif">
          {Math.round(s)}
        </text>
        <text x={cx} y={cy + 50} textAnchor="middle" fill="rgba(196,181,253,.65)" fontSize={11} fontWeight={600}>
          {verdict} RISK
        </text>
      </svg>
    </div>
  );
}
