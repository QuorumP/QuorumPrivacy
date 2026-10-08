// Stake vault + ledger: negative tests and a stateful invariant suite (audit Phase 5).
// The real confirmStake / unstakeQrm handlers run against Postgres (PGlite, real migrations) and a
// fake devnet whose vault balance is tracked independently of the DB ledger.
import { describe, it, expect, beforeEach } from "vitest";
import { confirmStake, unstakeQrm, qrmFaucet } from "./actions";
import { chain, signIn, signOut, newWallet, ledgerTotal, outcome, sql } from "../test/harness";

const stake = (w: string, amount: number) => {
  const sig = chain.userStake(w, amount);
  signIn(w);
  return confirmStake({ data: { signature: sig } });
};
const unstake = (w: string, amount: number) => { signIn(w); return unstakeQrm({ data: { amount } }); };

beforeEach(async () => {
  chain.reset();
  await sql(`delete from stakes`);
  await sql(`delete from stake_txs`);
  await sql(`delete from rate_limits`);
});

describe("confirmStake", () => {
  it("credits the on-chain amount exactly once per signature", async () => {
    const w = newWallet();
    const sig = chain.userStake(w, 250);
    signIn(w);
    await expect(confirmStake({ data: { signature: sig } })).resolves.toMatchObject({ staked: 250, credited: 250 });
    expect(await outcome(confirmStake({ data: { signature: sig } }))).toBe("ALREADY_CREDITED");
    expect(await ledgerTotal(w)).toBe(250);
  });

  it("credits a signature once under concurrent submission", async () => {
    const w = newWallet();
    const sig = chain.userStake(w, 100);
    signIn(w);
    const results = await Promise.all(Array.from({ length: 6 }, () => outcome(confirmStake({ data: { signature: sig } }))));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(await ledgerTotal(w)).toBe(100);
  });

  it("refuses someone else's stake transaction", async () => {
    const victim = newWallet(), thief = newWallet();
    const sig = chain.userStake(victim, 500);
    signIn(thief);
    expect(await outcome(confirmStake({ data: { signature: sig } }))).toBe("STAKE_NOT_CONFIRMED");
    expect(await ledgerTotal(thief)).toBe(0);
  });

  it("rejects unknown signatures, bad input and anonymous callers", async () => {
    signIn(newWallet());
    expect(await outcome(confirmStake({ data: { signature: "x".repeat(64) } }))).toBe("STAKE_NOT_CONFIRMED");
    expect(await outcome(confirmStake({ data: { signature: "short" } }))).toBe("INVALID_INPUT");
    signOut();
    expect(await outcome(confirmStake({ data: { signature: "x".repeat(64) } }))).toBe("UNAUTHENTICATED");
  });
});

describe("unstakeQrm", () => {
  it("pays out and debits the ledger", async () => {
    const w = newWallet();
    await stake(w, 300);
    await expect(unstake(w, 120)).resolves.toMatchObject({ staked: 180 });
    expect(chain.vault).toBe(180);
    expect(chain.bal(w)).toBe(-300 + 120);
    expect(await ledgerTotal(w)).toBe(180);
  });

  it("rejects overdraws, dust, other wallets' stake and anonymous callers", async () => {
    const w = newWallet(), other = newWallet();
    await stake(w, 100);
    expect(await outcome(unstake(w, 101))).toBe("INSUFFICIENT_STAKE");
    expect(await outcome(unstake(w, 0.5))).toBe("INVALID_INPUT");
    expect(await outcome(unstake(w, -5))).toBe("INVALID_INPUT");
    expect(await outcome(unstake(other, 1))).toBe("INSUFFICIENT_STAKE");
    signOut();
    expect(await outcome(unstakeQrm({ data: { amount: 1 } }))).toBe("UNAUTHENTICATED");
    expect(await ledgerTotal(w)).toBe(100);
    expect(chain.vault).toBe(100);
  });

  it("concurrent unstakes can never pay out more than the stake (the old TOCTOU drain)", async () => {
    const w = newWallet();
    await stake(w, 100);
    signIn(w);
    const results = await Promise.all(Array.from({ length: 10 }, () => outcome(unstakeQrm({ data: { amount: 30 } }))));
    expect(results.filter((r) => r === "ok")).toHaveLength(3);
    expect(results.filter((r) => r !== "ok").every((r) => r === "INSUFFICIENT_STAKE")).toBe(true);
    expect(await ledgerTotal(w)).toBe(10);
    expect(chain.vault).toBe(10);
  });

  it("refunds the ledger when the payout is never broadcast", async () => {
    const w = newWallet();
    await stake(w, 100);
    chain.sendThrows = true;
    expect(await outcome(unstake(w, 40))).toBe("RPC_DOWN");
    expect(await ledgerTotal(w)).toBe(100);
    expect(chain.vault).toBe(100);
  });

  it("refunds the ledger when the payout lands but fails", async () => {
    const w = newWallet();
    await stake(w, 100);
    chain.confirm = "failed";
    expect(await outcome(unstake(w, 40))).toBe("UNSTAKE_FAILED");
    expect(await ledgerTotal(w)).toBe(100);
    expect(chain.vault).toBe(100);
  });

  it("keeps the debit when confirmation times out (no double payout if it lands)", async () => {
    const w = newWallet();
    await stake(w, 100);
    chain.confirm = "timeout";
    expect(await outcome(unstake(w, 40))).toBe("UNSTAKE_PENDING");
    expect(await ledgerTotal(w)).toBe(60);
    expect(chain.vault).toBe(60);
    const [tx] = await sql<{ kind: string; amount: string }>(`select kind, amount::text from stake_txs where kind='unstake'`);
    expect(tx).toMatchObject({ kind: "unstake", amount: "40" }); // audit trail for reconciliation
  });
});

describe("qrmFaucet", () => {
  it("pays from the supply, never the stake vault, and is rate limited", async () => {
    const w = newWallet(), staker = newWallet();
    await stake(staker, 100);
    signIn(w);
    for (let i = 0; i < 3; i++) await qrmFaucet();
    expect(await outcome(qrmFaucet())).toBe("RATE_LIMITED");
    expect(chain.bal(w)).toBe(1500);
    expect(chain.vault).toBe(100);
    expect(await ledgerTotal(w)).toBe(0); // faucet tokens are not stake
  });

  it("is disabled off devnet", async () => {
    const rpc = process.env.SOLANA_RPC;
    process.env.SOLANA_RPC = "https://api.mainnet-beta.solana.com";
    try {
      signIn(newWallet());
      expect(await outcome(qrmFaucet())).toBe("FAUCET_DISABLED");
    } finally { process.env.SOLANA_RPC = rpc; }
  });
});

// ── Stateful invariants ──────────────────────────────────────────────
// Random sequences of stakes, unstakes (including concurrent bursts and every payout failure
// mode) across several wallets. After every step:
//   I1 vault solvency:   on-chain vault balance == sum of the active ledger
//   I2 per-wallet model: ledger(w) == Σ credited stakes − Σ debits that left the vault
//   I3 conservation:     wallet tokens + ledger(w) == wallet's starting tokens
//   I4 no negative stake rows
function prng(seed: number) { // mulberry32: reproducible runs, the seed is in the test name
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// STAKE_OPS=35000 is the nightly long run (3 seeds × 35k ≈ 105k operations); the default keeps PR CI fast.
const OPS = Number(process.env.STAKE_OPS ?? 150);

describe.each([1, 2, 3])("stake ledger invariants (seed %i)", (seed) => {
  it(`hold across ${OPS} random operations`, async () => {
    const rand = prng(seed);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const START = 10_000;
    const wallets = Array.from({ length: 4 }, newWallet);
    wallets.forEach((w) => chain.balances.set(w, START));
    const model = new Map(wallets.map((w) => [w, 0]));

    const check = async (step: number) => {
      const where = `seed ${seed} step ${step}`;
      expect(chain.vault, `I1 ${where}`).toBe(await ledgerTotal());
      for (const w of wallets) {
        const ledger = await ledgerTotal(w);
        expect(ledger, `I2 ${where}`).toBe(model.get(w));
        expect(chain.bal(w) + ledger, `I3 ${where}`).toBe(START);
      }
      const [neg] = await sql<{ n: number }>(`select count(*)::int n from stakes where amount < 0`);
      expect(neg.n, `I4 ${where}`).toBe(0);
    };

    for (let step = 0; step < OPS; step++) {
      await sql(`delete from rate_limits`); // limits are tested above; here they'd just mask ops
      const w = pick(wallets);
      const op = rand();
      if (op < 0.4) {
        const amt = 1 + Math.floor(rand() * 500);
        if (chain.bal(w) < amt) continue;
        const r = await outcome(stake(w, amt));
        expect(r).toBe("ok");
        model.set(w, model.get(w)! + amt);
      } else {
        chain.confirm = pick(["ok", "ok", "ok", "failed", "timeout"] as const);
        chain.sendThrows = rand() < 0.1;
        const burst = op < 0.75 ? 1 : 2 + Math.floor(rand() * 4); // concurrent same-wallet unstakes
        const amt = 1 + Math.floor(rand() * Math.max(1, model.get(w)! * 0.7));
        signIn(w);
        const results = await Promise.all(Array.from({ length: burst }, () => outcome(unstakeQrm({ data: { amount: amt } }))));
        for (const r of results) {
          // a payout left the vault iff it succeeded or is pending (it landed in this fake)
          if (r === "ok" || r === "UNSTAKE_PENDING") model.set(w, model.get(w)! - amt);
          else expect(["INSUFFICIENT_STAKE", "UNSTAKE_FAILED", "RPC_DOWN"]).toContain(r);
        }
        chain.confirm = "ok"; chain.sendThrows = false;
      }
      await check(step);
    }
  }, Math.max(30_000, OPS * 100));
});
