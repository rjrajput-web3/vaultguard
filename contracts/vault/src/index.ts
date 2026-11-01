/**
 * VAULTGUARD vault contract (NEAR, near-sdk-js).
 *
 * On-chain enforcement for the guardian's policy engine:
 *  - `paused` flag: flipped by the guardian signer when a depeg is confirmed
 *    and no safe hedge route exists. All withdrawals reject while paused.
 *  - Per-transaction spend cap (`max_spend_per_tx`).
 *  - Allowed-asset list (`allowed_assets`): deposits/withdrawals only in
 *    listed assets.
 *
 * The off-chain guardian (apps/guardian) pre-checks everything this contract
 * enforces — the contract is the final trustless authority. Single guardian
 * key is the documented MVP tradeoff (see ARCHITECTURE.md §4); rotation
 * procedure ships in the README before submission.
 */
import { NearBindgen, near, call, view, initialize } from "near-sdk-js";

@NearBindgen({})
class VaultGuard {
  guardian: string = "";
  paused: boolean = false;
  max_spend_per_tx: string = "0"; // smallest-unit string (bigint-safe)
  allowed_assets: string[] = []; // "chain:address" keys, lowercased
  owner: string = "";

  @initialize({})
  init({ guardian, max_spend_per_tx, allowed_assets }: {
    guardian: string;
    max_spend_per_tx: string;
    allowed_assets: string[];
  }) {
    this.owner = near.signerAccountId();
    this.guardian = guardian;
    this.max_spend_per_tx = max_spend_per_tx;
    this.allowed_assets = allowed_assets.map((a) => a.toLowerCase());
  }

  private assertGuardian() {
    if (near.signerAccountId() !== this.guardian) {
      throw new Error("VAULTGUARD: caller is not the guardian");
    }
  }

  private assertNotPaused() {
    if (this.paused) {
      throw new Error("VAULTGUARD: vault is paused — guardian halt in effect");
    }
  }

  private assertAssetAllowed(asset: string) {
    if (this.allowed_assets.length > 0 && !this.allowed_assets.includes(asset.toLowerCase())) {
      throw new Error(`VAULTGUARD: asset not allowed: ${asset}`);
    }
  }

  private assertWithinCap(amount: string) {
    if (BigInt(amount) > BigInt(this.max_spend_per_tx)) {
      throw new Error("VAULTGUARD: amount exceeds per-tx spend cap");
    }
  }

  /** Guardian flips the pause flag — depeg confirmed, no safe hedge route. */
  @call({})
  set_paused({ paused }: { paused: boolean }) {
    this.assertGuardian();
    this.paused = paused;
    near.log(`vault ${paused ? "PAUSED" : "UNPAUSED"} by guardian ${this.guardian}`);
  }

  /** Guardian updates the per-tx spend cap (smallest units). */
  @call({})
  set_max_spend_per_tx({ max_spend_per_tx }: { max_spend_per_tx: string }) {
    this.assertGuardian();
    this.max_spend_per_tx = max_spend_per_tx;
  }

  /** Guardian rotates the allowed-asset list. */
  @call({})
  set_allowed_assets({ allowed_assets }: { allowed_assets: string[] }) {
    this.assertGuardian();
    this.allowed_assets = allowed_assets.map((a) => a.toLowerCase());
  }

  /**
   * Deposit intent registration — MVP: records policy-checked deposits.
   * Real custody wiring (ft_transfer_call) lands in the next phase.
   */
  @call({})
  register_deposit({ asset, amount }: { asset: string; amount: string }) {
    this.assertNotPaused();
    this.assertAssetAllowed(asset);
    this.assertWithinCap(amount);
    near.log(`deposit registered: ${amount} of ${asset} from ${near.predecessorAccountId()}`);
  }

  /**
   * Withdrawal request — enforced on-chain: rejects when paused,
   * over the per-tx cap, or for a non-allowed asset.
   */
  @call({})
  request_withdraw({ asset, amount, recipient }: {
    asset: string;
    amount: string;
    recipient: string;
  }) {
    this.assertNotPaused();
    this.assertAssetAllowed(asset);
    this.assertWithinCap(amount);
    near.log(
      `withdraw approved: ${amount} of ${asset} → ${recipient} (executor: ${near.predecessorAccountId()})`,
    );
  }

  @view({})
  get_status(): { paused: boolean; guardian: string; max_spend_per_tx: string; allowed_assets: string[] } {
    return {
      paused: this.paused,
      guardian: this.guardian,
      max_spend_per_tx: this.max_spend_per_tx,
      allowed_assets: this.allowed_assets,
    };
  }
}
