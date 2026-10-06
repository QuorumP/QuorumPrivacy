// ZK eligibility server functions: register an identity commitment and fetch the Merkle
// witness needed to prove membership for a given vote.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, queryOne } from "../lib/db/pool.server";
import { requireWallet } from "../lib/auth/session.server";
import { memberPath, hasEligibleStake } from "../lib/zk/tree.server";
import { voteIdToField } from "../lib/zk/verify.server";
import { isCanonicalField } from "../lib/zk/poseidon";
import { rateLimit } from "../lib/security/rateLimit.server";

const commitment = z.string().refine(isCanonicalField, "commitment must be a canonical field element");

// Register the caller's identity commitment. Write-once: the identity is derived
// deterministically from the wallet signature, so an honest client always re-sends the same
// value. Allowing a different one would hand the wallet a second secret -> a second nullifier
// -> a second ballot in every vote.
export const registerIdentity = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ commitment }).parse(d))
  .handler(async ({ data }) => {
    const wallet = requireWallet();
    await rateLimit(`identity:${wallet}`, 10, 60);
    if (!(await hasEligibleStake(wallet))) throw new Error("STAKE_REQUIRED");
    const rows = await query(
      `update members
         set id_commitment = $2,
             eligible = true,
             leaf_index = coalesce(leaf_index, nextval('members_leaf_seq'))
       where wallet = $1 and (id_commitment is null or id_commitment = $2)
       returning 1`,
      [wallet, data.commitment],
    );
    if (rows.length === 0) throw new Error("IDENTITY_LOCKED");
    return { ok: true };
  });

// Return the Merkle witness + bound voteId field for in-browser proving.
export const getEligibility = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ voteId: z.string().min(1), commitment }).parse(d),
  )
  .handler(async ({ data }) => {
    requireWallet();
    // Prove against the vote's frozen eligibility set (legacy votes without one: live tree).
    const vote = await queryOne<{ eligibility_leaves: string[] | null }>(
      `select eligibility_leaves from votes where vote_id=$1`, [data.voteId],
    );
    if (!vote) throw new Error("VOTE_NOT_FOUND");
    const path = await memberPath(data.commitment, vote.eligibility_leaves ?? undefined);
    if (!path) return { registered: false as const };
    return {
      registered: true as const,
      root: path.root,
      pathElements: path.pathElements,
      pathIndices: path.pathIndices,
      voteIdField: voteIdToField(data.voteId).toString(),
    };
  });
