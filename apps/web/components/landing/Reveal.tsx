/**
 * Reveal — restrained fade-up on scroll via IntersectionObserver.
 * Professional, not flashy. Falls back to visible if IO is unavailable
 * or the user prefers reduced motion.
 */
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAnimEnabled } from "./useMotion";

export default function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const anim = useAnimEnabled();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!anim) {
      // Reduced-motion / low-power: render in final static state, no movement.
      setInView(true);
      return;
    }
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [anim]);

  return (
    <div
      ref={ref}
      className={`reveal${inView ? " in" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
