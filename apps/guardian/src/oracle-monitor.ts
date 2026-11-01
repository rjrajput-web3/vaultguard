/**
 * VAULTGUARD oracle monitor — stablecoin depeg detection.
 *
 * Pyth (primary) with Chainlink (fallback). MVP: pure math over a fetched
 * price — the fetch layer uses Pyth's free Hermes HTTP API; the Pyth feed id
 * for each covered stablecoin is configured per deployment (see .env.example).
 *
 * Pause triggers only outside the ±2% band for >N consecutive observations —
 * never on a single tick (avoids false-positive auto-pauses).
 */

export interface PegCheck {
  asset: string;
  price: number;
  peg: number;
  deviationPct: number;
  outsideBand: boolean;
  stale: boolean;
}

export interface DepegState {
  consecutiveOutside: number;
  confirmed: boolean;
}

export const DEFAULT_PEG = 1.0;
export const DEFAULT_BAND_PCT = 2.0; // ±2%
export const DEFAULT_CONFIRM_TICKS = 3;

export function checkPeg(
  asset: string,
  price: number,
  opts: {
    peg?: number;
    bandPct?: number;
    maxAgeSeconds?: number;
    priceAgeSeconds?: number;
  } = {},
): PegCheck {
  const peg = opts.peg ?? DEFAULT_PEG;
  const bandPct = opts.bandPct ?? DEFAULT_BAND_PCT;
  const stale =
    opts.maxAgeSeconds != null && opts.priceAgeSeconds != null
      ? opts.priceAgeSeconds > opts.maxAgeSeconds
      : false;
  const deviationPct = peg === 0 ? 100 : (Math.abs(price - peg) / peg) * 100;
  return {
    asset,
    price,
    peg,
    deviationPct,
    outsideBand: deviationPct > bandPct,
    stale,
  };
}

/** Feed a new observation; returns whether a depeg is CONFIRMED. */
export function trackDepeg(
  state: DepegState,
  check: PegCheck,
  confirmTicks: number = DEFAULT_CONFIRM_TICKS,
): DepegState {
  if (check.stale) {
    // Stale oracle: freeze, never auto-pause. (ARCHITECTURE.md §4 security plan)
    return { consecutiveOutside: 0, confirmed: false };
  }
  const consecutiveOutside = check.outsideBand ? state.consecutiveOutside + 1 : 0;
  return {
    consecutiveOutside,
    confirmed: consecutiveOutside >= confirmTicks,
  };
}

/** Minimal Pyth Hermes fetch — free, no key. Returns { price, ageSeconds } or null. */
export async function fetchPythPrice(feedId: string): Promise<{ price: number; ageSeconds: number } | null> {
  try {
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      parsed?: Array<{
        price: { price: string; expo: number };
        publish_time: number;
      }>;
    };
    const first = data.parsed?.[0];
    if (!first) return null;
    const price = Number(first.price.price) * 10 ** first.price.expo;
    const ageSeconds = Math.max(0, Date.now() / 1000 - first.publish_time);
    if (!isFinite(price) || price <= 0) return null;
    return { price, ageSeconds };
  } catch {
    return null;
  }
}
