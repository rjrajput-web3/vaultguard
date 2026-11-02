/**
 * Server-side proxy: POST /api/v2/swap/quote on api.rhea.finance.
 *
 * SECURITY CONTRACT (hard rules):
 *  - RHEA_API_KEY is read ONLY from the server environment (never
 *    NEXT_PUBLIC_*, never shipped to the browser, never logged, never
 *    included in any response).
 *  - The request body is forwarded verbatim; the API's envelope is returned
 *    verbatim. This route adds no fields and invents no data.
 *  - If the key is not configured, the route answers 503 RHEA_NOT_CONFIGURED
 *    and the /swap UI keeps its 1Click dry-run flow — nothing breaks.
 *
 * Route modules may only export handlers + segment config.
 */
import { NextResponse } from "next/server";

const RHEA_API = "https://api.rhea.finance";

function missingKey() {
  return NextResponse.json(
    {
      ok: false,
      code: "RHEA_NOT_CONFIGURED",
      message:
        "RHEA execution is not configured on this deployment (server env RHEA_API_KEY missing). The 1Click dry-run flow below still works.",
    },
    { status: 503 },
  );
}

/**
 * GET = config ping. Reveals ONLY whether the server key exists —
 * never the key itself. The UI uses this to decide whether the
 * executable RHEA flow can be offered (else it keeps the 1Click dry-run).
 */
export async function GET() {
  const apiKey = process.env.RHEA_API_KEY;
  return NextResponse.json({
    ok: true,
    configured: !!apiKey && apiKey.trim().length > 0,
  });
}

export async function POST(req: Request) {
  const apiKey = process.env.RHEA_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return missingKey();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "QUOTE_FAILED", message: "invalid JSON body" },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${RHEA_API}/api/v2/swap/quote`, {
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
        code: "QUOTE_FAILED",
        message: `rhea upstream unreachable: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  // Pass the envelope through untouched (status preserved where meaningful).
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
