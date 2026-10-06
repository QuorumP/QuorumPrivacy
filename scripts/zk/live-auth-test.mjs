// Drives the LIVE deployed app (quorumprivacy.com) through the real Sign-In-With-Solana flow:
// requestNonce → sign with the test wallet → verifySignature → getMe (proves session cookie).
// Uses seroval to encode payloads exactly like the TanStack Start client RPC does.
import { toJSONAsync, fromJSON } from "seroval";
import { getDefaultSerovalPlugins } from "@tanstack/start-client-core/getDefaultSerovalPlugins";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";

const BASE = "https://quorumprivacy.com/_serverFn/";
const FN = {
  requestNonce: "5ba0f5cdc4f56443971de1bfedfbe18afed35a055f43e067dce096821ec83fee",
  verifySignature: "c8e71fc30ee69af89bccba842d98bdd9cbb8083fd1a8ee8660502a4466f92bce",
  getMe: "0b0fc181662c95c0da55e221799213ba69663aacdc2b098e6a8dfa3086b34358",
};
const plugins = getDefaultSerovalPlugins();
const kp = Keypair.generate(); // any keypair: SIWS proves ownership, it needs no funds
const wallet = kp.publicKey.toBase58();

let cookie = "";
async function call(fnId, data, method = "POST") {
  const headers = { "x-tsr-serverFn": "true", accept: "application/json" };
  if (cookie) headers.cookie = cookie;
  let url = BASE + fnId, body;
  if (data !== undefined) {
    const encoded = JSON.stringify(await toJSONAsync({ data }, { plugins }));
    if (method === "GET") { url += "?payload=" + encodeURIComponent(encoded); }
    else { body = encoded; headers["content-type"] = "application/json"; }
  }
  const res = await fetch(url, { method, headers, body });
  const setC = res.headers.get("set-cookie");
  if (setC) cookie = setC.split(";")[0];
  const text = await res.text();
  let val;
  try { val = fromJSON(JSON.parse(text), { plugins }); } catch { val = text; }
  return { status: res.status, val };
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

console.log("wallet:", wallet);

console.log("\n[1] requestNonce");
const n = await call(FN.requestNonce, { wallet });
console.log("   status", n.status, "→", JSON.stringify(n.val).slice(0, 120));
ok(n.status === 200 && n.val?.nonce, "server issued a nonce + canonical message");

console.log("\n[2] sign the canonical message + verifySignature");
const msg = new TextEncoder().encode(n.val.message);
const sig = Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString("base64");
const v = await call(FN.verifySignature, { wallet, nonce: n.val.nonce, signature: sig });
console.log("   status", v.status, "→", JSON.stringify(v.val).slice(0, 120));
ok(v.status === 200 && v.val?.wallet === wallet, "signature verified server-side; session issued");
ok(!!cookie, "session cookie set (" + cookie.split("=")[0] + ")");

console.log("\n[3] getMe with the session cookie");
const me = await call(FN.getMe, undefined, "GET");
console.log("   status", me.status, "→", JSON.stringify(me.val).slice(0, 120));
ok(me.val?.wallet === wallet, "authenticated session returns the wallet");

console.log("\n[4] negative: replay the same nonce → must be rejected");
const replay = await call(FN.verifySignature, { wallet, nonce: n.val.nonce, signature: sig });
console.log("   status", replay.status, "→", JSON.stringify(replay.val).slice(0, 160));
ok(replay.status !== 200 || replay.val?.error, "consumed nonce cannot be replayed (fails closed)");

console.log(`\n[live-auth] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
