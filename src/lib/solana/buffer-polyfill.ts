// @solana/web3.js and @solana/spl-token assume Node's global `Buffer`, which Vite does NOT
// polyfill for the browser. Without it, the first browser code that touches the Solana SDK
// (buildStakeTx / walletQrmBalance) throws `ReferenceError: Buffer is not defined`.
//
// This MUST be an exported function that callers invoke — NOT a side-effect-only import.
// package.json has `"sideEffects": false`, so a bare `import "./buffer-polyfill"` gets
// tree-shaken out of the production build (that's why the first attempt still failed).
import { Buffer } from "buffer";

/** Set globalThis.Buffer in the browser before the Solana SDK uses it. No-op on the server. */
export function ensureBuffer(): void {
  if (typeof globalThis.Buffer === "undefined") {
    (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
  }
}
