import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VAULTRY — Multichain Wallet & Cross-Chain Security",
  description:
    "Pre-flight risk scanner, route guardian, depeg protection, spending limits and on-chain enforcement on RHEA X Chain SDK + NEAR Intents. NEAR Hackathon: Build Beyond Boundaries — Unstoppable DeFi.",
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
