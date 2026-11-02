/**
 * Motion tiers — the visual system degrades gracefully, never to black.
 *
 * Tiers:
 *  - "full":   capable devices — full 3D (12-layer extrusion, 78-node
 *              network, orbit rings, shine sweeps, parallax).
 *  - "lite":   mid-range / constrained devices (e.g. 4GB Android phones) —
 *              the transformation STAYS VISIBLE: 6-layer extrusion, 34-node
 *              network, slower wobble, no blur-heavy orbs. Nothing goes
 *              fully static here.
 *  - "static": prefers-reduced-motion, or truly ancient hardware — final
 *              static state, zero movement. The ONLY tier with no motion.
 *
 * 2026-11-02 fix: the old binary kill-switch (cores<=4 || mem<=4 → all
 * animation dead) hid the entire 3D transformation on his Redmi 13C
 * (deviceMemory 4). "Halka glow ko 3D mat kehna" — and a static page is
 * not a fallback, it's a removal.
 */
"use client";

import { useEffect, useState } from "react";

export type MotionTier = "full" | "lite" | "static";

export interface NavigatorLike {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

/** Pure — testable in node with a mocked navigator. */
export function getMotionTier(
  nav?: NavigatorLike,
  reducedMotion?: boolean,
): MotionTier {
  const reduced =
    reducedMotion ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false);
  if (reduced) return "static";
  const n: NavigatorLike =
    nav ?? (typeof navigator !== "undefined" ? (navigator as unknown as NavigatorLike) : {});
  const cores = n.hardwareConcurrency ?? 8;
  const mem = n.deviceMemory ?? 8;
  // Truly ancient hardware → static. Everything else keeps the show.
  if (cores <= 2 || mem <= 1) return "static";
  // Mid-range / constrained → lite: visible 3D, fewer particles, no heavy blur.
  if (cores <= 4 || mem <= 4) return "lite";
  return "full";
}

/** Pure-ish — safe on server (returns "full"). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Legacy gate: true unless fully static. Kept for existing call sites. */
export function motionAllowed(): boolean {
  return getMotionTier() !== "static";
}

/** Legacy: true only on constrained-but-animated devices. */
export function isLowPowerDevice(nav?: NavigatorLike): boolean {
  return getMotionTier(nav) === "lite";
}

/**
 * Applies the tier to <html data-anim="full|lite|static"> so CSS picks the
 * right animation set without a React re-render. "lite" SIMPLIFIES —
 * it never kills the transformation.
 */
export function applyMotionGate(): void {
  if (typeof document === "undefined") return;
  const tier = getMotionTier();
  document.documentElement.dataset.anim = tier;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(prefersReducedMotion());
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function useMotionTier(): MotionTier {
  const [tier, setTier] = useState<MotionTier>("full");
  useEffect(() => {
    const compute = () => {
      const t = getMotionTier();
      setTier(t);
      applyMotionGate();
    };
    compute();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", compute);
    return () => mq.removeEventListener("change", compute);
  }, []);
  return tier;
}

/** Legacy hook: true unless fully static. */
export function useLowPower(): boolean {
  const tier = useMotionTier();
  return tier === "lite";
}

/** The one gate every animated component reads. False = fully static. */
export function useAnimEnabled(): boolean {
  const tier = useMotionTier();
  return tier !== "static";
}
