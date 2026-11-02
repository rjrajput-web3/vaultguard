/**
 * Motion gate — one ANIM_ENABLED switch for every animated component.
 *
 * - prefers-reduced-motion (OS setting): everything renders in its final
 *   static state. No movement at all — not slowed-down movement.
 * - Low-power devices (hardwareConcurrency <= 4 or deviceMemory <= 4):
 *   drop to lightweight static mode — no canvas loop, no 3D transforms,
 *   plain fades only.
 *
 * Sync helpers (motionAllowed) are safe to call in effects before starting
 * any rAF loop — no flash of animation on weak devices. Hooks are for
 * render-time decisions (conditional classes / conditional SMIL).
 */
"use client";

import { useEffect, useState } from "react";

export interface NavigatorLike {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

/** Pure — testable in node with a mocked navigator. */
export function isLowPowerDevice(nav?: NavigatorLike): boolean {
  const n: NavigatorLike =
    nav ?? (typeof navigator !== "undefined" ? (navigator as unknown as NavigatorLike) : {});
  const cores = n.hardwareConcurrency ?? 8;
  const mem = n.deviceMemory ?? 8;
  return cores <= 4 || mem <= 4;
}

/** Pure-ish — safe on server (returns false). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Single ANIM_ENABLED gate. False = render everything static. */
export function motionAllowed(): boolean {
  return !prefersReducedMotion() && !isLowPowerDevice();
}

/** Applies the low-power kill-switch to <html data-anim="off"> so CSS
 *  animations (3D float, tilts, radar) die without a React re-render. */
export function applyMotionGate(): void {
  if (typeof document === "undefined") return;
  if (isLowPowerDevice() && !prefersReducedMotion()) {
    document.documentElement.dataset.anim = "off";
  }
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

export function useLowPower(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => {
    setLow(isLowPowerDevice());
    applyMotionGate();
  }, []);
  return low;
}

/** The one gate every animated component reads. */
export function useAnimEnabled(): boolean {
  const reduced = useReducedMotion();
  const low = useLowPower();
  return !(reduced || low);
}
