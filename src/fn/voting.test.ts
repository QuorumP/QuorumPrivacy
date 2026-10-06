// Ballot lifecycle against the real server fns, real Groth16 proofs and the real threshold tally:
// stake → register identity → create vote (frozen snapshot) → cast → tally → verify.
// Every rejection path of castBallot / runTally / verifyTally / registerIdentity is exercised.
import { describe, it, expect, beforeAll } from "vitest";
import { castBallot, confirmStake, createVote, runTally, verifyTally, verifyProof } from "./actions";
import { registerIdentity, getEligibility } from "./zk";
import { encrypt, encryptOneHotProved } from "../lib/crypto/elgamal";
import { pedersenDkg } from "../lib/crypto/threshold";
import { tallyCorrectnessTranscript, verifyTranscript } from "../lib/crypto/tally.server";
import { chain, signIn, signOut, newWallet, outcome, sql, ADMIN } from "../test/harness";
import { newIdentity, proveEligibility } from "../test/zk";

const P = () => process.env.TALLY_PUBKEY!;
type Voter = { wallet: string; secret: string; commitment: string };

async function enroll(stakeAmount = 150): Promise<Voter> {
  const wallet = newWallet();
  const id = newIdentity();
  await sql(`insert into members (wallet) values ($1)`, [wallet]); // what verifySignature does at sign-in
  signIn(wallet);
  await confirmStake({ data: { signature: chain.userStake(wallet, stakeAmount) } });
  await registerIdentity({ data: { commitment: id.commitment } });
  return { wallet, ...id };
}

async function newVote(title = "Fund the grants round") {
  signIn(ADMIN);
  return (await createVote({ data: { title, days: 3 } })).voteId;
}

// Builds a fully valid castBallot payload for `voter` choosing option `choice`.
async function ballot(voter: Voter, voteId: string, choice: number) {
  signIn(voter.wallet);
  const w = await getEligibility({ data: { voteId, commitment: voter.commitment } });
  if (!w.registered) throw new Error("not in snapshot");
  const { proof, publicSignals } = await proveEligibility(voter.secret, w);
  const { cts, proof: ballotProof } = encryptOneHotProved(P(), choice, 3, `${voteId}|${publicSignals[0]}`);
  return { voteId, encChoice: JSON.stringify(cts), ballotProof, commitHash: "0x00", proof, publicSignals };
}

let voters: Voter[];
let voteId: string;
beforeAll(async () => {
  voters = [await enroll(), await enroll(), await enroll()];
  voteId = await newVote();
}, 120_000);

describe("registerIdentity", () => {
  it("requires the minimum stake", async () => {
    signIn(newWallet());
    expect(await outcome(registerIdentity({ data: { commitment: newIdentity().commitment } }))).toBe("STAKE_REQUIRED");
  });

  it("is write-once: a second identity (= a second nullifier) is refused", async () => {
    const v = voters[0];
    signIn(v.wallet);
    await expect(registerIdentity({ data: { commitment: v.commitment } })).resolves.toEqual({ ok: true }); // idempotent
    expect(await outcome(registerIdentity({ data: { commitment: newIdentity().commitment } }))).toBe("IDENTITY_LOCKED");
  });

  it("accepts only canonical field elements", async () => {
    signIn(voters[0].wallet);
    for (const bad of ["0" + voters[0].commitment, "0x1f", "-1", "21888242871839275222246405745257275088548364400416034343698204186575808495617"]) {
      expect(await outcome(registerIdentity({ data: { commitment: bad } }))).toBe("INVALID_INPUT");
    }
  });
});

describe("castBallot", () => {
  it("rejects anonymous callers and unknown votes", async () => {
    const b = await ballot(voters[0], voteId, 0);
    signOut();
    expect(await outcome(castBallot({ data: b }))).toBe("UNAUTHENTICATED");
    signIn(voters[0].wallet);
    expect(await outcome(castBallot({ data: { ...b, voteId: "qrm-nope" } }))).toBe("VOTE_NOT_FOUND");
  });

  it("rejects non-canonical nullifier spellings (the aliasing replay)", async () => {
    const b = await ballot(voters[0], voteId, 0);
    const [n, root, v] = b.publicSignals;
    for (const alias of ["0" + n, "0x" + BigInt(n).toString(16)]) {
      expect(await outcome(castBallot({ data: { ...b, publicSignals: [alias, root, v] } }))).toBe("INVALID_INPUT");
    }
  });

  it("rejects a proof against another root, another vote, or tampered", async () => {
    const b = await ballot(voters[0], voteId, 0);
    const [n, root, v] = b.publicSignals;
    expect(await outcome(castBallot({ data: { ...b, publicSignals: [n, (BigInt(root) + 1n).toString(), v] } }))).toBe("STALE_ROOT");
    const other = await newVote("Another vote");
    signIn(voters[0].wallet);
    expect(await outcome(castBallot({ data: { ...b, voteId: other } }))).toBe("VOTE_MISMATCH");
    const pi_a = [...(b.proof.pi_a as string[])];
    pi_a[0] = (BigInt(pi_a[0]) + 1n).toString();
    expect(await outcome(castBallot({ data: { ...b, proof: { ...b.proof, pi_a } } }))).toBe("BAD_PROOF");
  });

  it("rejects inflated, malformed and re-bound ballots without burning the nullifier", async () => {
    const b = await ballot(voters[2], voteId, 1);
    const cts = JSON.parse(b.encChoice);
    cts[0] = encrypt(P(), 2); // a 2-vote entry
    expect(await outcome(castBallot({ data: { ...b, encChoice: JSON.stringify(cts) } }))).toBe("BAD_BALLOT");
    cts[0] = { c1: "ff".repeat(32), c2: cts[1].c2 }; // not a curve point
    expect(await outcome(castBallot({ data: { ...b, encChoice: JSON.stringify(cts) } }))).toBe("BAD_BALLOT");
    expect(await outcome(castBallot({ data: { ...b, encChoice: "not json" } }))).not.toBe("ok");
    const otherCtx = encryptOneHotProved(P(), 1, 3, `${voteId}|123`); // proof bound to another nullifier
    expect(await outcome(castBallot({ data: { ...b, encChoice: JSON.stringify(otherCtx.cts), ballotProof: otherCtx.proof } }))).toBe("BAD_BALLOT");
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int n from nullifiers where vote_id=$1`, [voteId]);
    expect(n).toBe(0);
  });

  it("counts one ballot per member, and the stored ballot is re-randomized", async () => {
    const choices = [0, 0, 1]; // yes, yes, no
    for (const [i, v] of voters.entries()) {
      const b = await ballot(v, voteId, choices[i]);
      await expect(castBallot({ data: b })).resolves.toHaveProperty("nullifier");
      const [row] = await sql<{ enc_choice: string }>(`select enc_choice from ballots where nullifier=$1`, [b.publicSignals[0]]);
      expect(row.enc_choice).not.toBe(b.encChoice); // receipt-freeness
    }
    const again = await ballot(voters[0], voteId, 1);
    expect(await outcome(castBallot({ data: again }))).toBe("ALREADY_VOTED");
    const [{ ballot_count }] = await sql<{ ballot_count: number }>(`select ballot_count from votes where vote_id=$1`, [voteId]);
    expect(ballot_count).toBe(3);
  });

  it("is bound to the vote's frozen snapshot: members who join later can't vote in it", async () => {
    const late = await enroll();
    signIn(late.wallet);
    await expect(getEligibility({ data: { voteId, commitment: late.commitment } })).resolves.toEqual({ registered: false });
  });
});

describe("runTally / verifyTally", () => {
  it("refuses non-owners, unknown votes and anonymous callers", async () => {
    signIn(voters[0].wallet);
    expect(await outcome(runTally({ data: { voteId } }))).toBe("NOT_VOTE_OWNER");
    expect(await outcome(runTally({ data: { voteId: "qrm-nope" } }))).toBe("VOTE_NOT_FOUND");
    signOut();
    expect(await outcome(runTally({ data: { voteId } }))).toBe("UNAUTHENTICATED");
  });

  it("decrypts only the totals, once, and the transcript verifies", async () => {
    signIn(ADMIN);
    const r = await runTally({ data: { voteId } });
    expect(r.totals).toEqual({ yes: 2, no: 1, abstain: 0 });
    expect(r.tallied).toBe(3);
    expect(await outcome(runTally({ data: { voteId } }))).toBe("ALREADY_TALLIED");
    await expect(verifyTally({ data: { voteId } })).resolves.toMatchObject({ found: true, verified: true });
    await expect(verifyProof({ data: { refId: voteId } })).resolves.toMatchObject({ found: true, verified: true });
    const late = await ballot(voters[1], voteId, 2);
    expect(await outcome(castBallot({ data: late }))).toBe("VOTE_CLOSED");
  });

  it("a forged total or a dropped ballot fails verification", async () => {
    const [row] = await sql<{ correctness_zk_ref: string }>(`select correctness_zk_ref from tally_results where vote_id=$1`, [voteId]);
    const t = JSON.parse(row.correctness_zk_ref);
    t.options[0].total = 3;
    await sql(`update tally_results set correctness_zk_ref=$2 where vote_id=$1`, [voteId, JSON.stringify(t)]);
    await expect(verifyTally({ data: { voteId } })).resolves.toMatchObject({ verified: false });
    t.options[0].total = 2;
    await sql(`update tally_results set correctness_zk_ref=$2 where vote_id=$1`, [voteId, JSON.stringify(t)]);
    await expect(verifyTally({ data: { voteId } })).resolves.toMatchObject({ verified: true });
    await sql(`delete from ballots where id = (select id from ballots where vote_id=$1 limit 1)`, [voteId]);
    await expect(verifyTally({ data: { voteId } })).resolves.toMatchObject({ verified: false });
  });

  it("ballots + transcript forged under a foreign key are rejected (key pinning)", async () => {
    // Someone with DB write access swaps in ballots encrypted to their own key and a matching,
    // internally valid DLEQ transcript. Only pinning the transcript to TALLY_PUBKEY catches it.
    const forgedVote = "qrm-forged";
    await sql(`insert into votes (vote_id, title, status) values ($1,'forged','verified')`, [forgedVote]);
    const evil = pedersenDkg(5, 3);
    const encs = [0, 0, 0].map(() => JSON.stringify(encryptOneHotProved(evil.pubkey, 0, 3, "x").cts));
    for (const [i, e] of encs.entries()) {
      await sql(`insert into ballots (vote_id, nullifier, enc_choice, commit_hash) values ($1,$2,$3,'0x')`, [forgedVote, String(i), e]);
    }
    const real = { pub: process.env.TALLY_PUBKEY, shares: process.env.TALLY_SHARES };
    Object.assign(process.env, { TALLY_PUBKEY: evil.pubkey, TALLY_SHARES: JSON.stringify(evil) });
    const transcript = tallyCorrectnessTranscript(encs);
    Object.assign(process.env, { TALLY_PUBKEY: real.pub, TALLY_SHARES: real.shares });
    expect(verifyTranscript(transcript!)).toBe(true); // self-consistent under the evil key
    await sql(`insert into tally_results (vote_id, totals, ballot_count, correctness_zk_ref) values ($1,'{}',3,$2)`,
      [forgedVote, JSON.stringify(transcript)]);
    await expect(verifyTally({ data: { voteId: forgedVote } })).resolves.toMatchObject({ found: true, verified: false });
  });
});
