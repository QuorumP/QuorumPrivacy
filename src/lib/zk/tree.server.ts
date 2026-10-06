// Server-side eligibility Merkle tree, built from registered member commitments.
// Eligible = registered identity commitment AND at least MIN_STAKE_QRM actively staked. Signing
// in alone is free (sybils), so the stake ledger is what makes a leaf cost something.
import { query, queryOne } from "../db/pool.server";
import { buildTree, merklePath } from "./poseidon";

export const MIN_STAKE_QRM = 100;

const STAKE_OF = `(select coalesce(sum(s.amount),0) from stakes s where s.wallet=m.wallet and s.status='active')`;

async function loadLeaves(): Promise<bigint[]> {
  const rows = await query<{ id_commitment: string }>(
    `select m.id_commitment from members m
     where m.id_commitment is not null and m.eligible and ${STAKE_OF} >= $1
     order by m.leaf_index asc nulls last, m.created_at asc`,
    [MIN_STAKE_QRM],
  );
  return rows.map((r) => BigInt(r.id_commitment));
}

/** Current root plus the leaves it was built from (stored per vote as its snapshot). */
export async function eligibilityRoot(): Promise<{ root: string; count: number; leaves: string[] }> {
  const leaves = await loadLeaves();
  const { root } = buildTree(leaves);
  return { root: root.toString(), count: leaves.length, leaves: leaves.map(String) };
}

/** Whether a wallet currently has enough stake to register / be eligible. */
export async function hasEligibleStake(wallet: string): Promise<boolean> {
  const r = await queryOne<{ ok: boolean }>(
    `select coalesce(sum(amount),0) >= $2 as ok from stakes where wallet=$1 and status='active'`,
    [wallet, MIN_STAKE_QRM],
  );
  return !!r?.ok;
}

// Path for a member's commitment in `snapshot` (a vote's frozen leaves) or the live tree.
export async function memberPath(commitment: string, snapshot?: string[]) {
  const target = BigInt(commitment);
  const leaves = snapshot ? snapshot.map(BigInt) : await loadLeaves();
  const index = leaves.findIndex((l) => l === target);
  if (index < 0) return null;
  const { levels, root, zeros } = buildTree(leaves);
  return { root: root.toString(), index, ...merklePath(levels, zeros, index) };
}
