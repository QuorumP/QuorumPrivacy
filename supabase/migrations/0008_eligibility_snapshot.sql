-- Freeze each vote's eligibility set at creation (audit 2026-10-06, Phase 2).
-- The leaves (identity commitments of members with >= 100 QRM staked) are stored so the Merkle
-- witness for that exact root can be rebuilt later. Ballots must prove against it, so stake
-- moved to another wallet after a vote opens can't buy a second ballot. Votes created before
-- this migration keep NULL and fall back to the live tree.
alter table votes add column if not exists eligibility_leaves jsonb;
