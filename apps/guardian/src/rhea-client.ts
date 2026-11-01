/**
 * RHEA X Chain SDK client factory — backend only.
 *
 * The API JWT is NEVER embedded in frontend code. It lives in the
 * guardian service environment (RHEA_API_JWT) and is attached as a
 * Bearer token on every request via getAccessToken.
 */
import { SwapClient } from "@rhea-finance/cross-chain-aggregation-dex";

const RHEA_API_BASE = "https://api.rhea.finance";

let cachedJwt: string | null = null;

/** Read the JWT from env once; throw a clear error if absent. */
export function getRheaJwt(): string {
  if (cachedJwt) return cachedJwt;
  const jwt = process.env.RHEA_API_JWT;
  if (!jwt || jwt.trim().length === 0) {
    throw new Error(
      "RHEA_API_JWT is not set — obtain a key at https://boss.rhea.finance " +
        "(My API Keys → Create API Key) and export it in the guardian environment. " +
        "Never commit it or embed it in frontend code.",
    );
  }
  cachedJwt = jwt.trim();
  return cachedJwt;
}

export function createRheaClient(): SwapClient {
  return new SwapClient({
    baseUrl: RHEA_API_BASE,
    getAccessToken: () => getRheaJwt(),
    reportMode: "disabled", // dry-run phase: no real executions to report
  });
}
