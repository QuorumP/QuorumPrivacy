// Server-side solvency proving. The caller passes the treasury balance it read from chain (never
// a typed-in number), so the commitment is bound to the real account. The circuit artifacts are
// inlined into the server bundle (Vite `?inline` → data: URL): no runtime file read or self-fetch.
import * as snarkjs from "snarkjs";
import { poseidon2 } from "poseidon-lite";
import { randomBytes } from "node:crypto";
import { FIELD } from "./poseidon";
import { ensureBn128 } from "./verify.server";
import wasmUrl from "../../../public/zk/solvency.wasm?inline";
import zkeyUrl from "../../../public/zk/solvency.zkey?inline";

const mem = (dataUrl: string) =>
  ({ type: "mem", data: new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")) });

/** Prove balance >= threshold (both u64 base units). Throws if the treasury is below it. */
export async function proveSolvency(balance: bigint, threshold: bigint) {
  const blinding = (BigInt("0x" + randomBytes(31).toString("hex")) % FIELD).toString();
  const commitment = poseidon2([balance, BigInt(blinding)]).toString();
  await ensureBn128(); // single-thread curve: no Worker in the Vercel bundle
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { balance: balance.toString(), blinding, threshold: threshold.toString(), commitment },
    mem(wasmUrl) as never, mem(zkeyUrl) as never,
  );
  return { proof: proof as unknown as Record<string, unknown>, publicSignals, commitment, blinding };
}
