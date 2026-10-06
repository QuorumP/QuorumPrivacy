// Integration scripts wired into the runner. Each exits non-zero on any failed check.
// Circuit scripts run everywhere (real wasm/zkey artifacts, no network). The devnet scripts hit
// the deployed program and need a funded key in .devnet/ — run them with `bun run test:devnet`.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

const run = (script: string) => {
  const r = spawnSync(process.execPath.includes("bun") ? "node" : process.execPath, [script], { encoding: "utf8", timeout: 180_000 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

describe("circuit integration (real artifacts)", () => {
  it.each([
    "scripts/zk/test.mjs",            // eligibility: member proves, tampered root rejected
    "scripts/zk/test-lib.mjs",        // app's poseidon tree == circuit, non-member can't prove
    "scripts/zk/solvency-test.mjs",   // solvent proves, insolvent can't
    "scripts/zk/e2e-devnet-test.mjs", // production artifacts end to end
    "scripts/zk/poseidon-check.mjs",  // poseidon-lite == circomlibjs
    "scripts/zk/auth-crypto-test.mjs",
  ])("%s", (script) => {
    const r = run(script);
    expect(r.code, r.out).toBe(0);
  }, 180_000);
});

describe.skipIf(!process.env.DEVNET)("devnet integration (deployed program)", () => {
  it.each([
    "scripts/onchain/anchor-vote.mjs",       // lifecycle + authority/state negatives + close
    "scripts/zk/onchain-groth16-test.mjs",   // on-chain verifier: valid proof lands, tampered fails
  ])("%s", (script) => {
    const r = run(script);
    expect(r.code, r.out).toBe(0);
  }, 180_000);
});
