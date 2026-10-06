-- Phase 3: ZK eligibility. Members register an identity commitment (Poseidon leaf);
-- the eligibility Merkle root is built from these. leaf_index gives a stable position.
create sequence if not exists members_leaf_seq;

alter table members add column if not exists id_commitment text unique;
alter table members add column if not exists leaf_index integer;

create index if not exists members_leaf_index_idx on members (leaf_index) where id_commitment is not null;
