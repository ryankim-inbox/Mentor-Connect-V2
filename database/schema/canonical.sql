-- Mentor Connect migration-chain materialization, schema version 0001.
-- Version 0001 was frozen from read-only introspection of the local 13-table catalog.
-- These bytes are migration 0001; future canonical materializations append only.

CREATE TABLE districts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    county TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'unified',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'mentee' CHECK (role IN ('mentee', 'mentor', 'both')),
    district_id INTEGER NOT NULL REFERENCES districts(id),
    bio TEXT,
    subjects TEXT[] NOT NULL DEFAULT '{}',
    is_verified BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    location TEXT,
    available_times TEXT[],
    languages TEXT[],
    grade_level TEXT,
    teaching_style TEXT
);

CREATE TABLE requests (
    id SERIAL PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES users(id),
    district_id INTEGER NOT NULL REFERENCES districts(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('mentee', 'mentor')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'closed')),
    matched_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    request TEXT,
    preferred_times TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE request_tags (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id),
    UNIQUE (request_id, tag_id)
);

CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    reported_user_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE blocks (
    id SERIAL PRIMARY KEY,
    blocker_id INTEGER NOT NULL REFERENCES users(id),
    blocked_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (blocker_id, blocked_user_id)
);

CREATE TABLE questions (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    topic TEXT,
    preferred_time TEXT,
    preferred_times TEXT[] NOT NULL DEFAULT '{}',
    preferred_language TEXT,
    preferred_teaching_style TEXT,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE schedules (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, slot)
);

CREATE INDEX idx_users_district ON users(district_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_district ON requests(district_id);
CREATE INDEX idx_requests_author ON requests(author_id);
CREATE INDEX idx_request_tags_request ON request_tags(request_id);
CREATE INDEX idx_request_tags_tag ON request_tags(tag_id);
CREATE INDEX idx_reports_reported ON reports(reported_user_id);
CREATE INDEX idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX idx_questions_student ON questions(student_id);
CREATE INDEX idx_schedules_slot ON schedules(slot);
CREATE INDEX idx_requests_preferred_times ON requests USING GIN (preferred_times);
CREATE INDEX idx_questions_preferred_times ON questions USING GIN (preferred_times);

CREATE TABLE chat_rooms (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('global', 'district')),
    district_id INTEGER NULL REFERENCES districts(id),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (type, district_id)
);

CREATE UNIQUE INDEX uq_chat_rooms_single_global
    ON chat_rooms (type) WHERE district_id IS NULL;

CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE dm_conversations (
    id SERIAL PRIMARY KEY,
    user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (user_a_id <> user_b_id),
    UNIQUE (user_a_id, user_b_id)
);

CREATE TABLE dm_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ NULL,
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_chat_messages_room_created ON chat_messages (room_id, created_at);
CREATE INDEX idx_dm_messages_conversation_created ON dm_messages (conversation_id, created_at);
CREATE INDEX idx_dm_conversations_user_a ON dm_conversations (user_a_id);
CREATE INDEX idx_dm_conversations_user_b ON dm_conversations (user_b_id);
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
