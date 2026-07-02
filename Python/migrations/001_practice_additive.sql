-- 001_practice_additive.sql
--
-- Additive-only migration that lets the student practice modules
-- (find_matches.py, get_users.py, get_questions.py, scheduling.py) run
-- against the existing product database.
--
-- It NEVER drops or rewrites existing data:
--   * new nullable columns on users (shape from Python/create_tables.sql)
--   * new questions table (same shape as Python/create_tables.sql, but
--     referencing the existing product users table)
--   * demo availability/languages for a few mentors + mentees (COALESCE keeps
--     any value that already exists)
--   * three demo questions, inserted only when the table is empty
--
-- Do NOT run Python/create_tables.sql or Python/seed_demo_data.sql against
-- the product database - they DROP tables.
--
-- Usage:
--   psql "$DATABASE_URL" -f Python/migrations/001_practice_additive.sql

BEGIN;

-- 1. Additive columns used by get_users.py / find_matches.py / scheduling.py
ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS available_times TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS languages TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS grade_level TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS teaching_style TEXT;

-- 2. Questions table used by get_questions.py / find_matches.py
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    topic TEXT,
    preferred_time TEXT,
    preferred_language TEXT,
    preferred_teaching_style TEXT,
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Demo availability for ~12 mentors, in two variation batches so
--    find_matches produces a score spread. Subjects are left untouched
--    (real product data already has them).
UPDATE users SET
    location        = COALESCE(location, 'San Jose'),
    available_times = COALESCE(available_times, ARRAY['Wed 7pm', 'Sat 2pm']),
    languages       = COALESCE(languages, ARRAY['English', 'Korean']),
    grade_level     = COALESCE(grade_level, 'college'),
    teaching_style  = COALESCE(teaching_style, 'step_by_step')
WHERE id IN (
    SELECT id FROM users WHERE role IN ('mentor', 'both') ORDER BY id LIMIT 6
);

UPDATE users SET
    location        = COALESCE(location, 'Mountain View'),
    available_times = COALESCE(available_times, ARRAY['Mon 6pm', 'Fri 5pm']),
    languages       = COALESCE(languages, ARRAY['English']),
    grade_level     = COALESCE(grade_level, 'high_school'),
    teaching_style  = COALESCE(teaching_style, 'visual')
WHERE id IN (
    SELECT id FROM users WHERE role IN ('mentor', 'both') ORDER BY id OFFSET 6 LIMIT 6
);

-- The asking mentees get matching fields too (student side of the scoring).
UPDATE users SET
    location        = COALESCE(location, 'San Jose'),
    available_times = COALESCE(available_times, ARRAY['Wed 7pm', 'Sat 2pm']),
    languages       = COALESCE(languages, ARRAY['English', 'Korean']),
    grade_level     = COALESCE(grade_level, 'middle_school')
WHERE id IN (
    SELECT id FROM users WHERE role = 'mentee' ORDER BY id LIMIT 3
);

-- 4. Three demo questions (subjects exist in real mentor subjects arrays).
--    Guarded so re-running the migration never duplicates them.
INSERT INTO questions (student_id, subject, topic, preferred_time,
                       preferred_language, preferred_teaching_style, message)
SELECT u.id, s.subject, s.topic, s.pt, s.pl, s.ts, s.msg
FROM (
    SELECT id, row_number() OVER (ORDER BY id) AS rn
    FROM users WHERE role = 'mentee' ORDER BY id LIMIT 3
) u
JOIN (VALUES
    (1, 'Math',    'Algebra',  'Wed 7pm', 'Korean',  'step_by_step', 'Need step-by-step algebra help.'),
    (2, 'Math',    'Geometry', 'Sat 2pm', 'English', 'visual',       'Prefer visual explanations.'),
    (3, 'English', 'Essays',   'Mon 6pm', 'English', 'discussion',   'Help structuring essays.')
) AS s(rn, subject, topic, pt, pl, ts, msg) ON s.rn = u.rn
WHERE NOT EXISTS (SELECT 1 FROM questions);

COMMIT;
