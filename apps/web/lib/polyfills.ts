/**
 * Client-side Buffer bootstrap (2026-11-03).
 *
 * bip39 and ed25519-hd-key use the Node `Buffer` API internally. Next.js 14
 * does not polyfill Node core modules for client components, so without this
 * import every wallet key operation throws `ReferenceError: Buffer is not
 * defined` in a real browser. Import this module from any client module that
 * touches key derivation (keys.ts, multichain-derive.ts). Idempotent.
 */
import { Buffer } from "buffer";

if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: unknown }).Buffer = Buffer;
}

export { Buffer };
