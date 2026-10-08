// Mutation sample: plant each known-dangerous bug (most are the audit's own findings, re-opened)
// and check the test suite catches it. A surviving mutant means a security property has no test.
// Run: node scripts/test/mutants.mjs [name filter]   (≈3 min; restores every file even on Ctrl-C)
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const A = "src/fn/actions.ts";
const RS = "onchain/programs/quorum_anchor/src";
const js = (tests) => ["bunx", ["vitest", "run", ...tests]];
const rust = ["cargo", ["test", "--locked"], "onchain"]; // cwd onchain/ so its rust-toolchain.toml applies

// [name, file, original, mutated, test command]
const MUTANTS = [
  ["unstake: check-then-debit outside a transaction (TOCTOU drain)", A,
    "const remaining = await withTransaction(async (q) => {",
    "const remaining = await (async (q: (t: string, p?: unknown[]) => Promise<unknown[]>) => {", js(["src/fn/stake.test.ts"]),
    ["      return staked - data.amount;\n    });", "      return staked - data.amount;\n    })((t, p) => query(t, p));"]],
  ["unstake: no balance check", A, `if (data.amount > staked) throw new Error("INSUFFICIENT_STAKE");`, "", js(["src/fn/stake.test.ts"])],
  ["unstake: no refund when the payout never broadcasts", A, "await refund(); // never broadcast", "// never broadcast", js(["src/fn/stake.test.ts"])],
  ["unstake: refund a pending payout (double pay)", A, `throw new Error("UNSTAKE_PENDING");`, `await refund(); throw new Error("UNSTAKE_PENDING");`, js(["src/fn/stake.test.ts"])],
  ["confirmStake: no idempotency check", A, `if (dup) throw new Error("ALREADY_CREDITED");`, "", js(["src/fn/stake.test.ts"])],
  ["confirmStakeTransfer: no signer check", "src/lib/solana/qrm.server.ts", "if (!signed) return 0;", "", js(["src/lib/solana/qrm.test.ts"])],
  ["faucet: enabled off devnet", A, `.includes("devnet")) throw new Error("FAUCET_DISABLED");`, `.includes("devnet")) void 0;`, js(["src/fn/stake.test.ts"])],
  ["castBallot: proof root not bound to the vote snapshot", A, `if (proofRoot !== expectedRoot) throw new Error("STALE_ROOT");`, "", js(["src/fn/voting.test.ts"])],
  ["castBallot: proof not bound to the vote id", A, `throw new Error("VOTE_MISMATCH");`, "void 0;", js(["src/fn/voting.test.ts"])],
  ["castBallot: no ballot validity check", A, `if (!valid) throw new Error("BAD_BALLOT");`, "", js(["src/fn/voting.test.ts"])],
  ["castBallot: no re-randomization", A, "JSON.stringify(rerandomizeAll(tallyPub, cts))", "JSON.stringify(cts)", js(["src/fn/voting.test.ts"])],
  ["nullifier aliasing: any digit string accepted", "src/lib/zk/poseidon.ts", "/^(0|[1-9]\\d*)$/", "/^\\d+$/", js(["src/fn/voting.test.ts", "src/lib/crypto"])],
  ["ballot proof: sum-to-1 not checked", "src/lib/crypto/elgamal.ts", `return challenge(context + "|sum", P, As, Bs, t1, t2) === c;`, "return true;", js(["src/lib/crypto"])],
  ["registerIdentity: identity not write-once", "src/fn/zk.ts", "where wallet = $1 and (id_commitment is null or id_commitment = $2)", "where wallet = $1", js(["src/fn/voting.test.ts"])],
  ["registerIdentity: no stake gate", "src/fn/zk.ts", `if (!(await hasEligibleStake(wallet))) throw new Error("STAKE_REQUIRED");`, "", js(["src/fn/voting.test.ts"])],
  ["requireAdmin: no admin check", "src/lib/auth/session.server.ts", `if (!isAdmin(wallet)) throw new Error("FORBIDDEN");`, "", js(["src/fn/admin.test.ts"])],
  ["verifyTally: transcript key not pinned", A, "transcript.pubkey === process.env.TALLY_PUBKEY\n      && ", "", js(["src/fn/voting.test.ts"])],
  ["verifyTally: ballots not bound to the transcript", A, "&& transcript.options.every((o, i) => o.ct.c1 === sums[i].c1 && o.ct.c2 === sums[i].c2)", "", js(["src/fn/voting.test.ts"])],
  ["revealProposal: anyone can reveal", A, `if (p.author_wallet !== wallet) throw new Error("NOT_AUTHOR");`, "", js(["src/fn/admin.test.ts"])],
  ["revealProposal: commitment not checked", A, `if (commit !== p.rules_commit) throw new Error("COMMIT_MISMATCH");`, "", js(["src/fn/admin.test.ts"])],
  ["SIWS: nonce consume not atomic (replay race)", "src/fn/auth.ts", "where id=$1 and consumed_at is null returning id", "where id=$1 returning id", js(["src/fn/auth.test.ts"])],
  ["SIWS: message not domain-bound", "src/fn/auth.ts", "buildSignMessage(data.wallet, data.nonce, getRequestHost(), new Date(row.expires_at))", "buildSignMessage(data.wallet, data.nonce, \"quorum-airdrop.example\", new Date(row.expires_at))", js(["src/fn/auth.test.ts"])],
  ["groth16 (on-chain): public inputs not range-checked", `${RS}/groth16.rs`, "if pubs.iter().any(|p| *p >= R) {", "if pubs.iter().any(|p| *p >= R && false) {", rust],
  ["commit_ballots: any state", `${RS}/lib.rs`, "require!(v.status == STATUS_OPEN, QuorumError::BadState);", "", rust],
  ["solvency: no check against the real treasury balance", A, `if (t.amount < threshold) throw new Error("INSOLVENT");`, "", js(["src/fn/admin.test.ts"])],
  ["solvency: opening sealed to revoked auditors too", A, "select pubkey from auditor_keys where not revoked", "select pubkey from auditor_keys", js(["src/fn/admin.test.ts"])],
  ["verify_solvency (on-chain): any signer", `${RS}/lib.rs`, "    #[account(address = QUORUM_AUTHORITY @ QuorumError::Unauthorized)]\n", "", rust],
  ["submit_tally: any signer", `${RS}/lib.rs`, "        require_keys_eq!(v.authority, ctx.accounts.authority.key(), QuorumError::Unauthorized);\n        require!(v.status == STATUS_TALLYING", "        require!(v.status == STATUS_TALLYING", rust],
];

const originals = new Map();
const restore = () => { for (const [f, s] of originals) writeFileSync(f, s); originals.clear(); };
process.on("SIGINT", () => { restore(); process.exit(130); });

const only = process.argv[2];
const selected = MUTANTS.filter(([name]) => !only || name.includes(only));
const exec = ([cmd, args, cwd]) => spawnSync(cmd, args, { cwd, stdio: "ignore", shell: process.platform === "win32" }).status;

// Baseline: every test command must pass unmutated, or a failure would count as a "kill".
for (const c of new Map(selected.map(([, , , , c]) => [JSON.stringify(c), c])).values()) {
  if (exec(c) !== 0) { console.error(`baseline failed (fix the suite first): ${c[0]} ${c[1].join(" ")}`); process.exit(1); }
}

let survived = 0;
for (const [name, file, from, to, command, extra] of selected) {
  const src = readFileSync(file, "utf8");
  const edits = [[from, to], ...(extra ? [extra] : [])];
  let mutated = src;
  for (const [f, t] of edits) {
    if (mutated.split(f).length !== 2) { restore(); throw new Error(`mutant "${name}": pattern not found exactly once in ${file}`); }
    mutated = mutated.replace(f, t);
  }
  originals.set(file, src);
  writeFileSync(file, mutated);
  try {
    const killed = exec(command) !== 0;
    if (!killed) survived++;
    console.log(`${killed ? "killed  " : "SURVIVED"}  ${name}`);
  } finally { restore(); }
}
console.log(`\n${selected.length - survived}/${selected.length} mutants killed`);
process.exit(survived ? 1 : 0);
