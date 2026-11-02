/**
 * Server-side helper for the AI Security & Defense playground.
 *
 * GET /security/api/tokens
 * Returns the live-registry token entries the playground needs
 * (Base USDC, Solana USDC, NEAR USDC) plus the full live registry for the
 * unverified-token detector. All data comes from lib/intents/registry —
 * nothing is hardcoded; a 502 is returned when the registry is unreachable.
 */

import { NextResponse } from "next/server";
import { getIntentsTokens, resolveAssetId } from "../../../../lib/intents/registry";

export async function GET() {
  try {
    const registry = await getIntentsTokens();
    const [baseUsdc, solUsdc, nearUsdc] = await Promise.all([
      resolveAssetId("USDC", "base"),
      resolveAssetId("USDC", "sol"),
      resolveAssetId("USDC", "near"),
    ]);
    return NextResponse.json({
      ok: true,
      tokens: { baseUsdc, solUsdc, nearUsdc },
      registry,
      registrySize: registry.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        message:
          err instanceof Error ? err.message : "registry unreachable — no token metadata",
      },
      { status: 502 },
    );
  }
}
