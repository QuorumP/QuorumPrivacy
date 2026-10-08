// Authorization matrix for every mutating server fn, plus the negative paths of proposals,
// delegation and the confidential treasury (disclosure, solvency, auditor keys).
import { describe, it, expect } from "vitest";
import * as A from "./actions";
import { eciesDecrypt } from "../lib/crypto/ecies";
import { signIn, signOut, newWallet, outcome, sql, chain, ADMIN } from "../test/harness";
import { poseidon2 } from "poseidon-lite";
import { createHash, randomBytes } from "node:crypto";

// Each fn has its own input type; the matrix calls them uniformly.
type Fn = (o?: never) => Promise<unknown>;
const hex64 = () => randomBytes(32).toString("hex");

// Valid input for each admin-only fn, so the only thing that can fail is the gate.
const adminOnly: [string, Fn, unknown][] = [
  ["createVote", A.createVote, { title: "t", days: 1 }],
  ["saveSettings", A.saveSettings, { quorumPct: 5, approvalPct: 60, votingWindowDays: 3 }],
  ["setRealms", A.setRealms, { enabled: false }],
  ["issueDisclosure", A.issueDisclosure, { recordId: "R-1", auditorPubkey: hex64(), content: "x" }],
  ["recordSolvencyProof", A.recordSolvencyProof, { threshold: "1" }],
  ["addAuditor", A.addAuditor, { label: "a" }],
  ["revokeAuditor", A.revokeAuditor, { pubkey: "p" }],
];
// Fns any signed-in wallet may call, but never anonymously.
const signedIn: [string, Fn, unknown][] = [
  ["castBallot", A.castBallot, undefined],
  ["submitProposal", A.submitProposal, { encPayload: "x", commitHash: "0x" + hex64(), reveal: "on_pass" }],
  ["revealProposal", A.revealProposal, { proposalId: "P-x", plaintext: "x" }],
  ["runTally", A.runTally, { voteId: "v" }],
  ["qrmFaucet", A.qrmFaucet, undefined],
  ["confirmStake", A.confirmStake, { signature: "s".repeat(64) }],
  ["unstakeQrm", A.unstakeQrm, { amount: 1 }],
  ["setDelegation", A.setDelegation, { delegate: newWallet() }],
  ["clearDelegation", A.clearDelegation, undefined],
  ["applyTallyNode", A.applyTallyNode, undefined],
];

describe("authorization matrix", () => {
  it.each(adminOnly)("%s: anonymous → UNAUTHENTICATED, member → FORBIDDEN", async (_n, fn, data) => {
    signOut();
    expect(await outcome(fn({ data } as never))).toBe("UNAUTHENTICATED");
    signIn(newWallet());
    expect(await outcome(fn({ data } as never))).toBe("FORBIDDEN");
  });

  it.each(signedIn.filter(([n]) => n !== "castBallot"))("%s: anonymous → UNAUTHENTICATED", async (_n, fn, data) => {
    signOut();
    expect(await outcome(fn({ data } as never))).toBe("UNAUTHENTICATED");
  });

  it("a forged or expired session cookie is anonymous", async () => {
    signIn(newWallet());
    const { session } = await import("../test/harness");
    session.cookie = session.cookie!.slice(0, -2) + "xx";
    expect(await outcome(A.applyTallyNode())).toBe("UNAUTHENTICATED");
    const { signSession } = await import("../lib/auth/jwt.server");
    session.cookie = signSession(ADMIN, -10);
    expect(await outcome(A.saveSettings({ data: { quorumPct: 1, approvalPct: 1, votingWindowDays: 1 } }))).toBe("UNAUTHENTICATED");
  });

  it("admins pass the gate and the write lands", async () => {
    await sql(`insert into settings (dao) values ('quorum') on conflict do nothing`);
    signIn(ADMIN);
    await A.saveSettings({ data: { quorumPct: 7, approvalPct: 66, votingWindowDays: 5 } });
    const [s] = await sql<{ q: string; a: string; d: number }>(`select quorum_pct::text q, approval_pct::text a, voting_window_days d from settings where dao='quorum'`);
    expect(s).toEqual({ q: "7", a: "66", d: 5 });
    expect(await outcome(A.saveSettings({ data: { quorumPct: 101, approvalPct: 1, votingWindowDays: 1 } }))).toBe("INVALID_INPUT");
    expect(await outcome(A.createVote({ data: { title: "", days: 1 } }))).toBe("INVALID_INPUT");
    expect(await outcome(A.createVote({ data: { title: "t", days: 61 } }))).toBe("INVALID_INPUT");
  });
});

describe("sealed proposals", () => {
  const seal = (text: string, salt = hex64()) =>
    ({ salt, commitHash: "0x" + createHash("sha256").update(salt + text).digest("hex") });

  it("only the author can reveal, only the committed text, only once", async () => {
    const author = newWallet();
    const { salt, commitHash } = seal("Raise quorum to 7%");
    signIn(author);
    const { proposalId } = await A.submitProposal({ data: { encPayload: "ct", commitHash, reveal: "on_pass" } });

    signIn(newWallet());
    expect(await outcome(A.revealProposal({ data: { proposalId, plaintext: "Raise quorum to 7%", salt } }))).toBe("NOT_AUTHOR");
    signIn(author);
    expect(await outcome(A.revealProposal({ data: { proposalId, plaintext: "Raise quorum to 9%", salt } }))).toBe("COMMIT_MISMATCH");
    expect(await outcome(A.revealProposal({ data: { proposalId, plaintext: "Raise quorum to 7%" } }))).toBe("COMMIT_MISMATCH"); // salt is required
    await expect(A.revealProposal({ data: { proposalId, plaintext: "Raise quorum to 7%", salt } })).resolves.toEqual({ ok: true });
    expect(await outcome(A.revealProposal({ data: { proposalId, plaintext: "Raise quorum to 7%", salt } }))).toBe("ALREADY_REVEALED");
    expect(await outcome(A.revealProposal({ data: { proposalId: "P-none", plaintext: "x" } }))).toBe("NOT_FOUND");
  });

  it("timelocked proposals can't be revealed early", async () => {
    const { salt, commitHash } = seal("t");
    signIn(newWallet());
    const { proposalId } = await A.submitProposal({ data: { encPayload: "ct", commitHash, reveal: "timelock" } });
    expect(await outcome(A.revealProposal({ data: { proposalId, plaintext: "t", salt } }))).toBe("TIMELOCK_NOT_ELAPSED");
  });

  it("rejects malformed commitments and oversize payloads", async () => {
    signIn(newWallet());
    expect(await outcome(A.submitProposal({ data: { encPayload: "ct", commitHash: "abc", reveal: "on_pass" } }))).toBe("INVALID_INPUT");
    expect(await outcome(A.submitProposal({ data: { encPayload: "x".repeat(8001), commitHash: "0x" + hex64(), reveal: "on_pass" } }))).toBe("INVALID_INPUT");
    expect(await outcome(A.submitProposal({ data: { encPayload: "ct", commitHash: "0x" + hex64(), reveal: "never" } }))).toBe("INVALID_INPUT");
  });
});

describe("delegation", () => {
  it("only to an eligible member, never to yourself", async () => {
    const me = newWallet(), friend = newWallet(), stranger = newWallet();
    await sql(`insert into members (wallet, eligible) values ($1,true),($2,true),($3,false)`, [me, friend, stranger]);
    signIn(me);
    expect(await outcome(A.setDelegation({ data: { delegate: me } }))).toBe("SELF_DELEGATION");
    expect(await outcome(A.setDelegation({ data: { delegate: stranger } }))).toBe("DELEGATE_NOT_ELIGIBLE");
    expect(await outcome(A.setDelegation({ data: { delegate: newWallet() } }))).toBe("DELEGATE_NOT_ELIGIBLE");
    await A.setDelegation({ data: { delegate: friend } });
    const read = async () => (await sql<{ d: string | null }>(`select delegation_to d from members where wallet=$1`, [me]))[0].d;
    expect(await read()).toBe(friend);
    await A.clearDelegation();
    expect(await read()).toBeNull();
  });
});

describe("confidential treasury", () => {
  it("a disclosure is readable by its auditor only", async () => {
    signIn(ADMIN);
    const auditor = await A.addAuditor({ data: { label: "Big4" } });
    const other = await A.addAuditor({ data: { label: "Other" } });
    await A.issueDisclosure({ data: { recordId: "R-7", auditorPubkey: auditor.pubkey, content: "Q3 payroll 41,200 USDC" } });
    const [r] = await sql<{ enc_balance: string }>(`select enc_balance from treasury_records where record_id='R-7'`);
    expect(r.enc_balance).not.toContain("41,200");
    expect(await eciesDecrypt(auditor.secret, r.enc_balance)).toBe("Q3 payroll 41,200 USDC");
    await expect(eciesDecrypt(other.secret, r.enc_balance)).rejects.toThrow();
    await A.revokeAuditor({ data: { pubkey: auditor.pubkey } });
    const [k] = await sql<{ revoked: boolean }>(`select revoked from auditor_keys where pubkey=$1`, [auditor.pubkey]);
    expect(k.revoked).toBe(true);
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int n from auditor_keys where pubkey=$1 and pubkey like '%' || $2 || '%'`, [auditor.pubkey, auditor.secret]);
    expect(n).toBe(0); // the secret is never stored
  });

  it("solvency proofs are bound to the real treasury balance and open only to active auditors", async () => {
    signIn(ADMIN);
    const auditor = await A.addAuditor({ data: { label: "Reserves" } });
    chain.treasury = 1_000_000n * 10n ** 9n; // 1M QRM on chain
    const r = await A.recordSolvencyProof({ data: { threshold: "750000" } });
    expect(r).toMatchObject({ threshold: "750000", account: "QRMtreasury", slot: 4242 });

    const [row] = await sql<{ commitment: string; account: string; slot: string; enc_balance: string }>(
      `select commitment, account, slot::text, enc_balance from treasury_records where record_id=$1`, [r.recordId]);
    expect(row).toMatchObject({ commitment: r.commitment, account: "QRMtreasury", slot: "4242" });
    expect(row.enc_balance).not.toContain(chain.treasury.toString()); // sealed, never in the clear
    // the auditor opens the commitment and it is the chain balance
    const sealed = JSON.parse(row.enc_balance) as { pubkey: string; ct: string }[];
    const o = JSON.parse(await eciesDecrypt(auditor.secret, sealed.find((x) => x.pubkey === auditor.pubkey)!.ct));
    expect(o).toMatchObject({ account: "QRMtreasury", slot: 4242, amount: chain.treasury.toString() });
    expect(poseidon2([BigInt(o.amount), BigInt(o.blinding)]).toString()).toBe(r.commitment);
    const revoked = (await sql<{ pubkey: string }>(`select pubkey from auditor_keys where revoked`)).map((k) => k.pubkey);
    expect(revoked.length).toBeGreaterThan(0);
    expect(sealed.filter((x) => revoked.includes(x.pubkey))).toEqual([]);

    // a threshold above the real balance can't be proven, whatever the admin claims
    expect(await outcome(A.recordSolvencyProof({ data: { threshold: "1000001" } }))).toBe("INSOLVENT");
    expect(await outcome(A.recordSolvencyProof({ data: { threshold: "99999999999" } }))).toBe("THRESHOLD_TOO_LARGE");
    expect(await outcome(A.recordSolvencyProof({ data: { threshold: "-1" } }))).toBe("INVALID_INPUT");
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int n from treasury_records where kind='solvency'`);
    expect(n).toBe(1);
  });
});

describe("tally node applications", () => {
  it("start pending with zero stake", async () => {
    const w = newWallet();
    signIn(w);
    const { nodeId } = await A.applyTallyNode();
    const [n] = await sql<{ status: string; operator_wallet: string }>(`select status::text, operator_wallet from tally_nodes where node_id=$1`, [nodeId]);
    expect(n).toEqual({ status: "pending", operator_wallet: w });
  });
});
