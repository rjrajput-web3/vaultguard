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
 * PRIVACY_NOTE — exactly which identifiers this backend route receives and why.
 *
 * This route is a POST passthrough to the keyless 1Click dry-run endpoint.
 * It receives the six fields below from the client and forwards them to
 * https://1click.chaindefuser.com/v0/quote (dry:true — no funds can move).
 *
 *   - originAssetId / destinationAssetId / amountBaseUnits / slippageBps:
 *     required to compute the quote. No identifier content.
 *   - recipient (destination-chain account) and refundTo (origin-chain
 *     address): REQUIRED by the 1Click API itself for dry-run quotes — the
 *     API rejects the request without them. They are identifiers, so they
 *     are listed here and in lib/privacy/data-flows.ts rather than hidden.
 *
 * This route NEVER receives, reads, or forwards: privateKey, seedPhrase,
 * mnemonic, or any wallet secret. At data-sharing level "nothing" the
 * client must not call this route at all (see lib/privacy/data-flows.ts).
 */
export const PRIVACY_NOTE = {
  route: "POST /api/intents/quote",
  forwardsTo: "https://1click.chaindefuser.com/v0/quote (dry:true)",
  receives: [
    { field: "originAssetId", kind: "asset id", why: "required — identifies the input asset" },
    { field: "destinationAssetId", kind: "asset id", why: "required — identifies the output asset" },
    { field: "amountBaseUnits", kind: "amount", why: "required — the quoted input amount" },
    { field: "slippageBps", kind: "tolerance", why: "optional — slippage tolerance for the quote" },
    {
      field: "recipient",
      kind: "identifier (destination-chain account)",
      why: "REQUIRED by the 1Click API for dry-run quotes; no funds move on dry runs",
    },
    {
      field: "refundTo",
      kind: "identifier (origin-chain address)",
      why: "REQUIRED by the 1Click API for dry-run quotes; no funds move on dry runs",
    },
  ],
  neverReceives: ["privateKey", "seedPhrase", "mnemonic", "secretKey"],
} as const;

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
