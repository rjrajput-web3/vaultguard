/**
 * Server-side proxy: GET /api/swap/order-status on api.rhea.finance.
 *
 * Read-only settlement tracking for a submitted order. Same security
 * contract as the sibling routes: RHEA_API_KEY is server-env only, never
 * logged, never in responses; 503 RHEA_NOT_CONFIGURED when absent.
 * Route modules may only export handlers + segment config.
 */
import { NextResponse } from "next/server";

const RHEA_API = "https://api.rhea.finance";

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const recordId = url.searchParams.get("recordId") ?? "";
  const orderId = url.searchParams.get("orderId") ?? "";
  const router = url.searchParams.get("router") ?? "";
  if (!recordId && !orderId) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "order-status needs recordId or orderId" },
      { status: 400 },
    );
  }

  const qs = new URLSearchParams();
  if (recordId) qs.set("recordId", recordId);
  if (orderId) qs.set("orderId", orderId);
  if (router) qs.set("router", router);

  let upstream: Response;
  try {
    upstream = await fetch(`${RHEA_API}/api/swap/order-status?${qs.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "manual",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "STATUS_FAILED",
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
