/**
 * Logo3D — the official purple V as a genuinely 3D object.
 *
 * Layered extrusion (visible side walls), dramatic top lighting, a moving
 * specular shine, a rotating conic glow ring, a floor reflection, and a
 * slow continuous rotateY wobble. It must read as 3D at first glance —
 * "halka glow ko 3D mat kehna".
 *
 * Pure CSS 3D (GPU-composited transforms, no WebGL). Tier-aware:
 *  - full:   12 extrusion layers, shine sweep, orbit ring, fast wobble
 *  - lite:   6 layers, slower wobble, no shine sweep / orbit (still 3D)
 *  - static: single flat badge, zero animation
 */
"use client";

import { useMotionTier, type MotionTier } from "./useMotion";

const LAYERS: Record<MotionTier, number> = { full: 12, lite: 6, static: 1 };

export default function Logo3D({ size = 230 }: { size?: number }) {
  const tier = useMotionTier();
  const layers = LAYERS[tier];
  const depth = 3; // px per extrusion layer

  return (
    <div className="logo3d" data-tier={tier} style={{ width: size, height: size }} aria-hidden="true">
      {/* rotating conic glow ring behind the badge */}
      <div className="logo3d-ring" />
      {/* orbiting satellite dots */}
      <div className="logo3d-orbit">
        <span className="logo3d-sat s1" />
        <span className="logo3d-sat s2" />
        <span className="logo3d-sat s3" />
      </div>

      <div className="logo3d-stage">
        <div className="logo3d-extrude">
          {Array.from({ length: layers }, (_, i) => {
            const isFace = i === layers - 1;
            const shade = isFace ? 1 : Math.max(0.28, 1 - (layers - 1 - i) * 0.09);
            return (
              <span
                key={i}
                className="brand-mark logo3d-layer"
                style={{
                  width: size,
                  height: size,
                  transform: `translateZ(${-i * depth}px)`,
                  filter: `brightness(${shade.toFixed(2)}) saturate(${(0.7 + shade * 0.3).toFixed(2)})`,
                }}
              >
                <img src="/brand/v-mark-transparent.png" alt="" draggable={false} />
              </span>
            );
          })}
          {/* moving specular highlight across the front face */}
          <div className="logo3d-shine" style={{ width: size, height: size, transform: `translateZ(${depth}px)` }} />
          {/* top-light gradient baked over the face */}
          <div className="logo3d-toplight" style={{ width: size, height: size, transform: `translateZ(${depth + 0.5}px)` }} />
        </div>
      </div>

      {/* floor reflection */}
      <div className="logo3d-reflection" style={{ width: size, height: size * 0.42 }}>
        <img src="/brand/v-mark-transparent.png" alt="" draggable={false} />
      </div>
      <div className="logo3d-floorglow" />
    </div>
  );
}
