// Ops monitor (read-only), run hourly by .github/workflows/monitor.yml. Exits 1 on any alert, which
// makes GitHub notify the repo owner; if ALERT_WEBHOOK_URL is set (Discord/Slack-style incoming
// webhook) the alerts are also posted there. Checks:
//  1. the post-deploy check: program hash, upgrade + QRM authorities, vault/treasury ownership
//  2. authority SOL balance (it pays unstake/faucet fees and rent) >= MIN_AUTHORITY_SOL
//  3. outflows in the last LOOKBACK_MIN minutes: any single vault or supply (faucet) outflow >
//     VAULT_ALERT_QRM, or total > 5x that; ANY outflow from the treasury (no app code moves it)
//  4. the app's /api/ops-status: faucet/tally paused, or a role/settings change (addAuditor,
//     revokeAuditor, setPause, saveSettings, setRealms) in the window. Unreachable → alert.
// See SECURITY.md "Incident response" for what to do when it fires.
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const AUTHORITY = new PublicKey("9sjBajqChwe1BDCa9gxAG46qgJzMwgKPe1mi64T24ZYC");
const MIN_SOL = Number(process.env.MIN_AUTHORITY_SOL ?? 1);
const LOOKBACK_MIN = Number(process.env.LOOKBACK_MIN ?? 65);
const VAULT_ALERT = BigInt(process.env.VAULT_ALERT_QRM ?? 10_000) * 10n ** 9n;
const MINT = new PublicKey("HjQdV3YTpdJmThMuxe9Tvx8zJV9fHxZo5T3cA8Fhgvsw");
const APP_URL = process.env.APP_URL ?? "https://quorumprivacy.com";
const ALERT_ACTIONS = ["addAuditor", "revokeAuditor", "setPause", "saveSettings", "setRealms"];
const conn = new Connection(RPC, "confirmed");
const alerts = [];

// 1. deploy + authority invariants (reuses the post-deploy check)
try {
  execFileSync(process.execPath, [fileURLToPath(new URL("./post-deploy-check.mjs", import.meta.url))], { stdio: "inherit" });
} catch { alerts.push("post-deploy check failed: program hash, an authority, or a vault/treasury account changed"); }

// 2. authority SOL
const sol = (await conn.getBalance(AUTHORITY)) / 1e9;
console.log(`authority SOL: ${sol}`);
if (sol < MIN_SOL) alerts.push(`authority SOL ${sol} < ${MIN_SOL}: unstakes and faucet will start failing; fund ${AUTHORITY.toBase58()}`);

// 3. outflows (base units) from an account in the lookback window
async function outflows(account) {
  const since = Date.now() / 1000 - LOOKBACK_MIN * 60;
  // page back until past the window, so a flood of dust transactions can't push an outflow out of view
  const sigs = [];
  for (let before; ;) {
    const page = await conn.getSignaturesForAddress(account, { limit: 1000, before });
    sigs.push(...page.filter((s) => (s.blockTime ?? 0) >= since && !s.err));
    if (page.length < 1000 || (page.at(-1).blockTime ?? 0) < since) break;
    before = page.at(-1).signature;
  }
  const out = [];
  for (const s of sigs) {
    const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    const keys = tx?.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()) ?? [];
    const i = keys.indexOf(account.toBase58());
    const amt = (list) => BigInt(list?.find((b) => b.accountIndex === i)?.uiTokenAmount.amount ?? "0");
    const delta = amt(tx?.meta?.postTokenBalances) - amt(tx?.meta?.preTokenBalances);
    if (delta < 0n) out.push({ sig: s.signature, amount: -delta });
  }
  return out;
}
const qrm = (base) => (Number(base) / 1e9).toLocaleString("en-US");
const watched = [
  ["stake vault", await PublicKey.createWithSeed(AUTHORITY, "qrm-stake-vault", TOKEN_2022_PROGRAM_ID)],
  ["supply (faucet)", getAssociatedTokenAddressSync(MINT, AUTHORITY, false, TOKEN_2022_PROGRAM_ID)],
  ["treasury", await PublicKey.createWithSeed(AUTHORITY, "qrm-treasury", TOKEN_2022_PROGRAM_ID)],
];
for (const [name, acc] of watched) {
  const out = await outflows(acc);
  const total = out.reduce((a, o) => a + o.amount, 0n);
  console.log(`${name}: ${out.length} outflow(s), ${qrm(total)} QRM in the last ${LOOKBACK_MIN} min`);
  if (name === "treasury" && out.length) alerts.push(`treasury moved ${qrm(total)} QRM (${out.map((o) => o.sig).join(", ")}); no app code moves treasury funds`);
  if (name !== "treasury") {
    for (const o of out) if (o.amount > VAULT_ALERT) alerts.push(`large vault outflow ${qrm(o.amount)} QRM: ${o.sig}`);
    if (total > VAULT_ALERT * 5n) alerts.push(`${name} outflows ${qrm(total)} QRM in ${LOOKBACK_MIN} min`);
  }
}

// 4. pauses and role/settings changes, from the app (the monitor has no database access)
try {
  const res = await fetch(`${APP_URL}/api/ops-status`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const s = await res.json();
  const since = Date.now() - LOOKBACK_MIN * 60_000;
  const recent = (s.admin_events ?? []).filter((e) => ALERT_ACTIONS.includes(e.action) && Date.parse(e.at) >= since);
  console.log(`app: faucet_paused=${s.faucet_paused} tally_paused=${s.tally_paused}, ${recent.length} role/settings change(s)`);
  if (s.faucet_paused) alerts.push("faucet is paused");
  if (s.tally_paused) alerts.push("tally is paused");
  for (const e of recent) alerts.push(`admin action ${e.action} at ${e.at} (details in admin_events)`);
} catch (e) { alerts.push(`ops status unreachable at ${APP_URL}/api/ops-status: ${e.message}`); }

if (alerts.length) {
  const text = `QUORUM monitor: ${alerts.length} alert(s)\n- ${alerts.join("\n- ")}`;
  console.error(text);
  if (process.env.ALERT_WEBHOOK_URL) {
    await fetch(process.env.ALERT_WEBHOOK_URL, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, text }),
    }).catch((e) => console.error("webhook failed:", e.message));
  }
  process.exit(1);
}
console.log("monitor: all clear");
process.exit(0);
