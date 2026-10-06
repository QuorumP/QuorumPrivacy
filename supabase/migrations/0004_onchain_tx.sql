-- Phase 5 wiring: record the devnet tx that anchors the final tally (register tx lives in
-- votes.anchor_tx). tally_results already tracks totals + verified_on_chain.
alter table votes add column if not exists tally_tx text;
