/**
 * Server-side proxy for NEAR Intents dry-run quotes.
 *
 * Browsers calling https://1click.chaindefuser.com/v0 directly may hit CORS.
 * This route is a POST passthrough to the keyless dry-run endpoint — no
 * secrets involved, no funds move (dry:true enforced). Typed errors come
 * straight from lib/intents.
 */

import { NextResponse } from "next/server";
import { QuoteError, getQuote } from "../../../../lib/intents/quotes";

interface ProxyBody {
  originAssetId: string;
  destinationAssetId: string;
  amountBaseUnits: string;
  slippageBps?: number;
  recipient: string;
  refundTo: string;
}

/**
 * PRIVACY_NOTE — exactly which identifiers this backend route receives and why —
 * lives in lib/intents/quote-privacy-note.ts (route modules may only export
 * handlers + segment config; see that file for the full documented contract).
 */

export async function POST(req: Request) {
  let body: ProxyBody;
  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return NextResponse.json(
      { ok: false, code: "QUOTE_FAILED", message: "invalid JSON body" },
      { status: 400 },
    );
  }

  const missing = ["originAssetId", "destinationAssetId", "amountBaseUnits", "recipient", "refundTo"].filter(
    (k) => !body[k as keyof ProxyBody],
  );
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, code: "QUOTE_FAILED", message: `missing fields: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const quote = await getQuote(body);
    return NextResponse.json({ ok: true, quote });
  } catch (err) {
    if (err instanceof QuoteError) {
      const status = err.code === "UNSUPPORTED_ROUTE" ? 422 : 502;
      return NextResponse.json(
        { ok: false, code: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      { ok: false, code: "QUOTE_FAILED", message: "unexpected quote failure" },
      { status: 502 },
    );
  }
}
