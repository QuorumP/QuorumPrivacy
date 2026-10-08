-- Solvency proofs are bound to a real treasury account (audit finding M8). The server reads the
-- account's balance at a finalized slot and proves it; both are recorded so anyone can see which
-- account and snapshot a proof covers. enc_balance holds the opening sealed to each auditor key.
alter table treasury_records add column if not exists account text;
alter table treasury_records add column if not exists slot bigint;
