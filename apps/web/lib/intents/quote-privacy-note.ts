/**
 * PRIVACY_NOTE — exactly which identifiers the POST /api/intents/quote
 * backend route receives and why.
 *
 * (Moved here from app/api/intents/quote/route.ts — Next.js route modules
 * may only export route handlers and route segment config; arbitrary
 * exports fail the production type check.)
 *
 * The route is a POST passthrough to the keyless 1Click dry-run endpoint.
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
