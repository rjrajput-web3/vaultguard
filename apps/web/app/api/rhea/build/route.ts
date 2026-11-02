/**
 * Server-side proxy: POST /api/v2/swap/swap (build) on api.rhea.finance.
 *
 * This constructs the executable transaction payload ONLY — no signing and
 * no broadcast happen here or anywhere server-side. Signing happens in the
 * user's own wallet (browser), gated by the Route Guardian in beforeSign
 * and an explicit on-screen confirmation.
 *
 * Same security contract as ../quote/route.ts: RHEA_API_KEY is server-env
 * only, never logged, never in responses; 503 RHEA_NOT_CONFIGURED when
 * absent. Route modules may only export handlers + segment config.
 */
import { NextResponse } from "next/server";

const RHEA_API = "https://api.rhea.finance";

export async function POST(req: Request) {
  const apiKey = process.env.RHEA_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "RHEA_NOT_CONFIGURED",
        message: "RHEA execution is not configured on this deployment (server env RHEA_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "BUILD_FAILED", message: "invalid JSON body" },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${RHEA_API}/api/v2/swap/swap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "BUILD_FAILED",
        message: `rhea upstream unreachable: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
