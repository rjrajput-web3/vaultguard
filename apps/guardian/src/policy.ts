/**
 * VAULTGUARD policy engine — user-defined spending limits + asset permissions.
 *
 * Mirrors the on-chain vault contract (contracts/vault) so the off-chain
 * guardian pre-checks what the contract will enforce on-chain. The contract
 * is the final authority; this module is the pre-flight UX layer.
 */
import type { NormalizedQuote } from "./risk-engine";

export interface VaultPolicy {
  vaultId: string;
  guardian: string; // NEAR account allowed to pause
  paused: boolean;
  /** Per-transaction spend cap, human units of the vault's base asset (e.g. USDC). */
  maxSpendPerTx: number;
  /** Per-day spend cap, human units. */
  maxSpendPerDay: number;
  /** Allowed "chain:address" asset keys, lowercased. Empty = allow all (not recommended). */
  allowedAssets: string[];
  /** Allowed router identifiers (e.g. "nearintents", "1inch"). Empty = allow all. */
  allowedRouters: string[];
  /** Max hedge slippage % the user tolerates for auto-hedge. */
  maxHedgeSlippagePct: number;
  /** Fee ceiling % for auto-hedge. */
  maxHedgeFeePct: number;
}

export interface PolicyCheck {
  allowed: boolean;
  reasons: string[]; // blocking reasons when !allowed; informational otherwise
}

/**
 * Human units of the input side for policy math. For the MVP demo the vault
 * base asset is USDC (6 decimals on NEAR); decimalsIn is passed per-quote.
 */
export function toHuman(amountBaseUnits: string, decimals: number): number {
  try {
    return Number(BigInt(amountBaseUnits)) / 10 ** decimals;
  } catch {
    return Number.NaN;
  }
}

export function evaluatePolicy(
  nq: NormalizedQuote,
  policy: VaultPolicy,
  opts: { spentTodayHuman: number; decimalsIn: number },
): PolicyCheck {
  const reasons: string[] = [];

  if (policy.paused) {
    return { allowed: false, reasons: ["vault is paused — guardian halt in effect"] };
  }

  const amountHuman = toHuman(nq.amountIn, opts.decimalsIn);
  if (!isFinite(amountHuman)) {
    return { allowed: false, reasons: ["input amount unparseable — refuse to proceed"] };
  }

  if (amountHuman > policy.maxSpendPerTx) {
    reasons.push(
      `tx amount ${amountHuman} exceeds per-tx cap ${policy.maxSpendPerTx} — would be rejected on-chain`,
    );
  }
  if (opts.spentTodayHuman + amountHuman > policy.maxSpendPerDay) {
    reasons.push(
      `daily cap exceeded: spent ${opts.spentTodayHuman} + ${amountHuman} > ${policy.maxSpendPerDay}`,
    );
  }
  if (policy.allowedAssets.length > 0) {
    if (!policy.allowedAssets.includes(nq.tokenIn)) {
      reasons.push(`input asset ${nq.tokenIn} not in allowed-assets list`);
    }
    if (!policy.allowedAssets.includes(nq.tokenOut)) {
      reasons.push(`output asset ${nq.tokenOut} not in allowed-assets list`);
    }
  }
  if (policy.allowedRouters.length > 0 && !policy.allowedRouters.includes(nq.router)) {
    reasons.push(`router "${nq.router}" not in allowed-routers list`);
  }

  return { allowed: reasons.length === 0, reasons };
}
