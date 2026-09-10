-- Forward strategy: reject unsafe existing rows, then enforce relationship
-- invariants and add the two composite indexes used by matching lookups.
-- Preflight: run `pnpm --filter db migration:preflight -- --env <target>`;
-- every named check must report zero before this migration is approved.
-- No row is updated or deleted by this migration.

ALTER TABLE blocks
    ADD CONSTRAINT blocks_no_self_check
    CHECK (blocker_id <> blocked_user_id) NOT VALID;

ALTER TABLE reports
    ADD CONSTRAINT reports_no_self_check
    CHECK (reporter_id <> reported_user_id) NOT VALID;

ALTER TABLE dm_conversations
    ADD CONSTRAINT dm_conversations_canonical_pair_check
    CHECK (user_a_id < user_b_id) NOT VALID;

ALTER TABLE blocks VALIDATE CONSTRAINT blocks_no_self_check;
ALTER TABLE reports VALIDATE CONSTRAINT reports_no_self_check;
ALTER TABLE dm_conversations VALIDATE CONSTRAINT dm_conversations_canonical_pair_check;

CREATE INDEX idx_users_matching_lookup
    ON users (district_id, role, is_verified, id);

CREATE INDEX idx_requests_open_matching_lookup
    ON requests (district_id, role, created_at DESC, id)
    WHERE status = 'open';

-- Verification strategy: constraints:verify compares the complete constraint
-- catalog with the frozen version-0002 catalog; explain:verify proves the
-- representative email, district, status, tag-join, and matching plans.
-- Recovery strategy: the runner rolls back this entire migration on failure.
-- Once committed, retain ledger history and use a reviewed higher-numbered
-- roll-forward migration. Production application remains forbidden until the
-- Slice 11 recovery rehearsal. Index lock time and production p95 are [UNKNOWN].
