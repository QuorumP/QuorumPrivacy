// Run the (t,n) DKG once and persist the group key + shares. The group pubkey becomes the
// tally key (clients encrypt to it); shares are held by tally nodes (here: server env, since
// running them on physically separate nodes is deployment infra). Idempotent.
// Run with: bun scripts/crypto/dkg.ts
import { pedersenDkg } from "../../src/lib/crypto/threshold";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const N = 5, T = 3;
const dir = join(process.cwd(), ".devnet");
mkdirSync(dir, { recursive: true });
const path = join(dir, "tally-shares.json");

let dkg;
if (existsSync(path)) {
  dkg = JSON.parse(readFileSync(path, "utf8"));
  console.error(`(reusing existing ${dkg.t}-of-${dkg.n} DKG)`);
} else {
  dkg = pedersenDkg(N, T);
  writeFileSync(path, JSON.stringify(dkg));
  console.error(`(generated new ${T}-of-${N} threshold key -> .devnet/tally-shares.json)`);
}
// stdout line 1 = group pubkey; the shares JSON goes to TALLY_SHARES (server-side).
console.log(dkg.pubkey);
console.error("TALLY_SHARES=" + JSON.stringify({ t: dkg.t, n: dkg.n, shares: dkg.shares }));
