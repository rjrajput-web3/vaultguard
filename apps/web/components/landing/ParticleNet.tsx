/**
 * ParticleNet — lightweight animated blockchain-network background.
 * Canvas 2D (no WebGL): ~60 drifting nodes with connecting lines, slow
 * particle flow. devicePixelRatio-aware, pauses when the tab is hidden,
 * honors prefers-reduced-motion, fewer nodes on small screens.
 */
"use client";

import { useEffect, useRef } from "react";
import { motionAllowed, useMotionTier } from "./useMotion";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const LINK = 130;

const TIER_NODES = { full: 78, lite: 34, static: 0 } as const;

export default function ParticleNet({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tier = useMotionTier();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Tier-aware: full = 78 living nodes, lite = 34 (still visibly alive),
    // static = no canvas animation (reduced-motion).
    const nodeBudget = TIER_NODES[tier];

    let w = 0;
    let h = 0;
    let nodes: Node[] = [];
    let raf = 0;
    let running = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    function seed(count: number) {
      const rect = canvas!.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: 1 + Math.random() * 2.2,
      }));
    }

    function drawFrame() {
      ctx!.clearRect(0, 0, w, h);
      ctx!.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < LINK) {
            const alpha = (1 - d / LINK) * 0.22;
            ctx!.strokeStyle = `rgba(167,139,250,${(alpha * 1.6).toFixed(3)})`;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx!.fillStyle = "rgba(168,85,247,0.55)";
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function step() {
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -20) n.x = w + 20;
        if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        if (n.y > h + 20) n.y = -20;
      }
    }

    // Motion gate: static tier (reduced-motion) → one frozen frame, no loop.
    // lite tier keeps a living network (34 nodes) — degraded, never dead.
    const animated = motionAllowed() && tier !== "static";
    const small = canvas.getBoundingClientRect().width < 640;
    const initialCount = tier === "static" ? 24 : small ? Math.min(nodeBudget, 30) : nodeBudget;
    seed(Math.max(1, initialCount));
    if (!animated) {
      drawFrame(); // frozen starfield, zero movement
      return;
    }

    // Self-throttle: EMA frame time; sustained >24ms → halve nodes;
    // still slow at <=20 nodes → stop loop, keep the static frame.
    let lastT = performance.now();
    let emaDt = 16;
    let slowStreak = 0;

    function tick() {
      if (!running) return;
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      emaDt = emaDt * 0.95 + Math.min(dt, 100) * 0.05;
      if (emaDt > 24) slowStreak++;
      else slowStreak = 0;

      if (slowStreak > 90) {
        if (nodes.length > 20) {
          nodes = nodes.slice(0, Math.floor(nodes.length / 2));
          slowStreak = 0;
          emaDt = 16;
        } else {
          step();
          drawFrame(); // leave a static starfield, stop the loop
          return;
        }
      }

      step();
      drawFrame();
      raf = requestAnimationFrame(tick);
    }

    function onVis() {
      const hidden = document.hidden;
      if (hidden && running) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!hidden && !running) {
        running = true;
        lastT = performance.now();
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    const onResize = () => {
      const small = canvas!.getBoundingClientRect().width < 640;
      const c = small ? Math.min(nodeBudget, 30) : nodeBudget;
      seed(Math.max(1, c));
      if (!running) drawFrame();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} className={`particle-net ${className}`} aria-hidden="true" />;
}
