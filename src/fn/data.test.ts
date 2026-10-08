// Read endpoints are public: they must never leak who voted, how, sealed proposal bodies,
// disclosure ciphertexts, auditor secrets, or anyone's delegation.
import { describe, it, expect, beforeAll } from "vitest";
import * as D from "./data";
import * as A from "./actions";
import { signIn, signOut, newWallet, sql, ADMIN } from "../test/harness";

const voter = newWallet(), delegate = newWallet(), author = newWallet();
const SECRETS = {
  nullifier: "987654321987654321",
  encChoice: '[{"c1":"aa","c2":"bb"}]',
  sealedBody: "SEALED-PROPOSAL-CIPHERTEXT",
  disclosure: "ECIES-PACKAGE-FOR-AUDITOR",
  commitment: "424242424242",
};

beforeAll(async () => {
  await sql(`insert into settings (dao) values ('quorum') on conflict do nothing`);
  await sql(`insert into members (wallet, eligible, id_commitment, delegation_to) values ($1,true,$2,$3),($3,true,null,null)`,
    [voter, SECRETS.commitment, delegate]);
  await sql(`insert into stakes (wallet, amount, status) values ($1,150,'active')`, [voter]);
  await sql(`insert into votes (vote_id, title, status, ballot_count) values ('qrm-d1','Budget','open',1)`);
  await sql(`insert into ballots (vote_id, nullifier, enc_choice, commit_hash) values ('qrm-d1',$1,$2,'0xc')`, [SECRETS.nullifier, SECRETS.encChoice]);
  await sql(`insert into nullifiers (vote_id, nullifier) values ('qrm-d1',$1)`, [SECRETS.nullifier]);
  await sql(`insert into proposals (proposal_id, author_wallet, status, rules_commit, enc_payload_ref) values ('P-1',$1,'hidden','0xabc',$2)`, [author, SECRETS.sealedBody]);
  await sql(`insert into treasury_records (record_id, kind, disclosed, disclosed_to, enc_balance) values ('R-1','disclosure',true,'pk',$1)`, [SECRETS.disclosure]);
});

describe("public read endpoints", () => {
  it("leak no ballot, identity, sealed body, disclosure or delegation data", async () => {
    signOut();
    const all = await Promise.all([
      D.listVotes(), D.listProposals(), D.listTallyNodes(), D.listProofs(), D.getTreasury(),
      D.listAuditors(), D.getSettings(), D.getStakeContext(), D.getProtocolStatus(), D.getMembersSummary(),
    ]);
    const dump = JSON.stringify(all);
    for (const [what, s] of Object.entries(SECRETS)) expect(dump, what).not.toContain(s);
    expect(dump).not.toContain(voter);
    expect(dump).not.toContain(delegate);
  });

  it("aggregate only", async () => {
    await expect(D.getMembersSummary()).resolves.toEqual({
      eligibleWallets: 1, delegationsOut: 1, activeDelegates: 1, sealedBallots: 1, openVotes: 1,
    });
    const [v] = await D.listVotes();
    expect(Object.keys(v).sort()).toEqual(["anchorTx", "ballots", "closesAt", "id", "quorumPct", "resultHash", "status", "tallyTx", "title"]);
  });
});

describe("getParticipation", () => {
  it("is null when signed out and only ever describes the caller", async () => {
    signOut();
    await expect(D.getParticipation()).resolves.toBeNull();
    signIn(voter);
    await expect(D.getParticipation()).resolves.toMatchObject({ wallet: voter, eligible: true, registered: true, delegationTo: delegate, qrmStaked: 150 });
    signIn(delegate);
    await expect(D.getParticipation()).resolves.toMatchObject({ wallet: delegate, eligible: false, registered: false, qrmStaked: 0 });
  });
});

describe("opsStatus (/api/ops-status, polled by the monitor)", () => {
  it("shows pause flags and recent admin actions, never actors or values", async () => {
    signIn(ADMIN);
    const aud = await A.addAuditor({ data: { label: "Ops" } });
    await A.setPause({ data: { faucet: true } });
    try {
      const s = await D.opsStatus();
      expect(s).toMatchObject({ faucet_paused: true, tally_paused: false });
      expect(s.admin_events.map((e) => e.action)).toEqual(expect.arrayContaining(["addAuditor", "setPause"]));
      const text = JSON.stringify(s);
      expect(text).not.toContain(ADMIN);
      expect(text).not.toContain(aud.pubkey);
    } finally { await A.setPause({ data: { faucet: false } }); }
    expect((await D.opsStatus()).faucet_paused).toBe(false);
  });
});
