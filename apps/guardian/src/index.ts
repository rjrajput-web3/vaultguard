/** VAULTGUARD guardian service entrypoint — demo orchestration starts here. */
import { checkPeg, trackDepeg, fetchPythPrice, type DepegState } from "./oracle-monitor";

async function main(): Promise<void> {
  console.log("VAULTGUARD guardian service v0.1.0 — scaffold phase");
  console.log("Modules: risk-engine ✓ policy ✓ oracle-monitor ✓ depeg-flow ✓ rhea-client ✓");
  console.log("Next phases: live oracle loop, RHEA dry-run quote, contract wiring, demo UI.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
