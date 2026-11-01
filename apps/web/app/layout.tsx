import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VAULTGUARD — Self-Protecting Cross-Chain Vault",
  description:
    "Pre-flight risk scanner, route guardian, spending limits, and depeg auto-hedge/auto-pause on RHEA X Chain SDK + NEAR Intents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0a0f1e", color: "#e8ecf4" }}>
        {children}
      </body>
    </html>
  );
}
