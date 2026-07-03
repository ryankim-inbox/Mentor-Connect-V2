-- 002_requests_preferred_times.sql
--
-- Additive-only migration: multi-slot "preferred times" for the
-- Post a Request flow (and the matching practice data on questions).
--
-- Weekly slots use one canonical string format, shared with the frontend
-- selector and the mock seed (database/mentor_connect_mock_1000.sql):
--   '<Day> <HH>:00'  — 24-hour clock, e.g. 'Mon 17:00' .. 'Sun 23:00'
--
--   * requests.preferred_times  — canonical multi-slot field written by
--     POST /api/requests (empty array when the author skips the selector)
--   * questions.preferred_times — full multi-slot list; the existing
--     questions.preferred_time single column is kept for backward
--     compatibility (student practice files read it) and is backfilled as
--     the first/primary slot
--
-- It NEVER drops or rewrites existing data. Fresh mock databases already
-- contain these columns via database/mentor_connect_mock_1000.sql.
--
-- Usage:
--   psql "$DATABASE_URL" -f Python/migrations/002_requests_preferred_times.sql

BEGIN;

ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS preferred_times TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE questions
    ADD COLUMN IF NOT EXISTS preferred_times TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: a question that has a legacy single preferred_time but no
-- multi-slot list yet gets a one-element list (preferred_time stays primary).
UPDATE questions
SET preferred_times = ARRAY[preferred_time]
WHERE preferred_time IS NOT NULL
  AND preferred_times = '{}';

CREATE INDEX IF NOT EXISTS idx_requests_preferred_times
    ON requests USING GIN (preferred_times);
CREATE INDEX IF NOT EXISTS idx_questions_preferred_times
    ON questions USING GIN (preferred_times);

COMMIT;
