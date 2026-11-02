import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VAULTGUARD — Self-Protecting Cross-Chain Vault",
  description:
    "Pre-flight risk scanner, route guardian, depeg protection, spending limits and on-chain enforcement on RHEA X Chain SDK + NEAR Intents. NEAR Hackathon: Build Beyond Boundaries — Unstoppable DeFi.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
