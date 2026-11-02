/**
 * VAULTRY app shell — sidebar + topbar, purple premium identity.
 *
 * Wraps the functional pages (/swap, /wallet, /security, /privacy, /lab,
 * /faucet). The landing page (/) keeps its own hero. All nav targets are
 * real pages; Stake/OTC are honestly badged "Soon".
 */
"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import BrandMark from "./BrandMark";
import RheaStatusPill from "./RheaStatusPill";

interface NavItem {
  href: string;
  label: string;
  icon: JSX.Element;
  soon?: boolean;
  badge?: string;
}

function icon(path: string): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: icon("M3 10.5 12 3l9 7.5V21H3z M9 21v-6h6v6") },
  { href: "/swap", label: "Swap", icon: icon("M7 16V8m0 0L4 11m3-3 3 3-3 M17 8v8m0 0 3-3m-3 3-3-3") },
  { href: "/wallet", label: "Wallet", icon: icon("M20 7H5a2 2 0 0 1 0-4h13v4 M20 7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5 M18 14h.01") },
  { href: "/security", label: "Route Guardian", icon: icon("M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z M9.5 12l2 2 3.5-4") },
  { href: "/privacy", label: "Privacy", icon: icon("M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z M12 8v4 M12 15h.01") },
  { href: "/lab", label: "Testing Lab", icon: icon("M9 3h6 M10 3v5l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 8V3 M7.5 14h9") },
  { href: "/faucet", label: "Faucet", icon: icon("M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z") },
  { href: "/stake", label: "Stake", icon: icon("M12 3v18 M5 8l7-5 7 5 M5 16l7 5 7-5"), soon: true, badge: "Soon" },
  { href: "/otc", label: "OTC", icon: icon("M8 7h13m0 0-3-3m3 3-3 3 M16 17H3m0 0 3 3m-3-3 3-3"), soon: true, badge: "Soon" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="vaultry-app">
      <style>{`
        .vaultry-app { display: flex; min-height: 100vh; background:
          radial-gradient(1200px 600px at 85% -10%, rgba(124,58,237,0.16), transparent 60%),
          radial-gradient(900px 500px at -10% 110%, rgba(168,85,247,0.10), transparent 60%),
          var(--bg-0); }
        .v-sidebar {
          width: 248px; flex-shrink: 0; position: sticky; top: 0; height: 100vh;
          display: flex; flex-direction: column; gap: 6px; padding: 22px 16px;
          border-right: 1px solid rgba(168,85,247,0.14);
          background: rgba(8,6,18,0.72); backdrop-filter: blur(18px); z-index: 40;
        }
        .v-logo { display: flex; align-items: center; gap: 12px; padding: 4px 10px 18px; text-decoration: none; }
        .v-logo img { width: 40px; height: 40px; border-radius: 12px; object-fit: cover; box-shadow: 0 0 24px rgba(139,92,246,0.45); }
        .v-logo span { font-weight: 800; letter-spacing: 2.5px; font-size: 16px; color: #fff; }
        .v-nav { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
        .v-nav a {
          display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 12px;
          color: var(--muted); text-decoration: none; font-size: 14.5px; font-weight: 500;
          transition: all .18s ease; border: 1px solid transparent;
        }
        .v-nav a:hover { color: #fff; background: rgba(139,92,246,0.10); }
        .v-nav a.active {
          color: #fff; font-weight: 700;
          background: linear-gradient(100deg, rgba(124,58,237,0.55), rgba(139,92,246,0.28));
          border-color: rgba(168,85,247,0.35);
          box-shadow: 0 6px 24px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .v-badge { margin-left: auto; font-size: 10.5px; font-weight: 700; letter-spacing: .6px;
          padding: 3px 9px; border-radius: 20px; background: rgba(168,85,247,0.16);
          color: #c4b5fd; border: 1px solid rgba(168,85,247,0.3); }
        .v-side-foot { margin-top: auto; padding: 14px; border-radius: 14px;
          background: linear-gradient(140deg, rgba(124,58,237,0.22), rgba(34,211,238,0.08));
          border: 1px solid rgba(168,85,247,0.25); }
        .v-side-foot p { margin: 0 0 10px; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
        .v-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .v-topbar {
          position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 14px;
          padding: 14px 28px; border-bottom: 1px solid rgba(168,85,247,0.12);
          background: rgba(4,7,15,0.66); backdrop-filter: blur(16px);
        }
        .v-menu-btn { display: none; background: none; border: 1px solid rgba(168,85,247,0.3);
          color: #fff; border-radius: 10px; padding: 8px 12px; cursor: pointer; font-size: 16px; }
        .v-topbar .v-status { display: flex; align-items: center; gap: 8px; font-size: 13px;
          color: #6ee7b7; background: rgba(34,197,94,0.10); border: 1px solid rgba(34,197,94,0.25);
          padding: 7px 14px; border-radius: 20px; margin-left: auto; white-space: nowrap; }
        .v-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 10px #22c55e; animation: v-pulse 2s infinite; }
        @keyframes v-pulse { 50% { opacity: .5; } }
        .v-content { padding: 28px; max-width: 1240px; width: 100%; margin: 0 auto; }
        @media (max-width: 900px) {
          .v-sidebar { position: fixed; left: 0; transform: translateX(-105%); transition: transform .25s ease; box-shadow: 30px 0 60px rgba(0,0,0,.5); }
          .v-sidebar.open { transform: none; }
          .v-menu-btn { display: block; }
          .v-content { padding: 18px 14px; }
          .v-topbar { padding: 12px 14px; }
        }
        .v-scrim { display: none; }
        @media (max-width: 900px) {
          .v-scrim.open { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 35; }
        }
      `}</style>

      <div className={`v-scrim${open ? " open" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`v-sidebar${open ? " open" : ""}`}>
        <a className="v-logo" href="/" onClick={() => setOpen(false)}>
          <BrandMark size={40} />
          <span>VAULTRY</span>
        </a>
        <nav className="v-nav">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : (pathname ?? "").startsWith(n.href);
            return (
              <a
                key={n.href}
                href={n.href}
                className={active ? "active" : ""}
                onClick={() => setOpen(false)}
              >
                {n.icon}
                {n.label}
                {n.badge && <span className="v-badge">{n.badge}</span>}
              </a>
            );
          })}
        </nav>
        <div className="v-side-foot">
          <p><strong style={{ color: "#fff" }}>Route Guardian</strong><br />Every executable route is risk-scored before anything is signed.</p>
          <a className="vg-btn" style={{ width: "100%", justifyContent: "center", fontSize: 13 }} href="/security">
            Open Guardian
          </a>
        </div>
      </aside>

      <div className="v-main">
        <div className="v-topbar">
          <button className="v-menu-btn" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
          <RheaStatusPill />
        </div>
        <div className="v-content">{children}</div>
      </div>
    </div>
  );
}
