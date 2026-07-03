-- 003_chat_learning_schema.sql
--
-- Additive-only migration: database schema for the CHAT LEARNING SCAFFOLD.
--
-- The tables below back a messenger-style chat feature (separate from
-- posting/commenting) that the student implements in Python/routers/chat.py:
--
--   * chat_rooms       — one 'global' room for everyone + one 'district'
--                        room per school district
--   * chat_messages    — messages posted into a chat room
--   * dm_conversations — one row per pair of users who talk privately
--   * dm_messages      — messages inside a DM conversation
--
-- The Python endpoints that read/write these tables are intentionally left
-- as TODO stubs — see docs/STUDENT_CHAT_BACKEND_GUIDE.md for the missions.
--
-- It NEVER drops or rewrites existing data. Fresh mock databases already
-- contain these tables via database/mentor_connect_mock_1000.sql.
--
-- Usage:
--   psql "$DATABASE_URL" -f Python/migrations/003_chat_learning_schema.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rooms. type is 'global' (district_id stays NULL) or 'district'
--    (district_id points at the district the room belongs to).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_rooms (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('global', 'district')),
    district_id INTEGER NULL REFERENCES districts(id),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (type, district_id)
);

-- Gotcha worth knowing: in Postgres a UNIQUE constraint treats NULLs as
-- distinct, so UNIQUE(type, district_id) alone would still allow many
-- ('global', NULL) rows. This partial index closes that gap.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_single_global
    ON chat_rooms (type) WHERE district_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Room messages. deleted_at is for soft deletes: the row stays, but
--    implemented endpoints should hide messages WHERE deleted_at IS NOT NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL
);

-- ---------------------------------------------------------------------------
-- 3. Direct-message conversations: exactly one row per pair of users.
--    Note for the student: UNIQUE(user_a_id, user_b_id) does not stop the
--    pair from appearing twice in swapped order — (1, 501) and (501, 1) are
--    different rows to Postgres. Your POST /api/dms/start code must handle
--    that (hint: look up both orders, or always store the smaller id first).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_conversations (
    id SERIAL PRIMARY KEY,
    user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (user_a_id <> user_b_id),
    UNIQUE (user_a_id, user_b_id)
);

-- ---------------------------------------------------------------------------
-- 4. DM messages. read_at is NULL until the other user has seen the message.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ NULL,
    deleted_at TIMESTAMPTZ NULL
);

-- ---------------------------------------------------------------------------
-- 5. Indexes for the queries the student will write: message history is
--    always fetched per room/conversation ordered by time, and the DM list
--    is looked up from either side of the pair.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created
    ON chat_messages (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation_created
    ON dm_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user_a
    ON dm_conversations (user_a_id);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user_b
    ON dm_conversations (user_b_id);

-- ---------------------------------------------------------------------------
-- 6. Baseline rooms, so GET /api/chat/rooms has something to return the
--    moment the student implements it: one global room plus one room per
--    district. Safe to re-run (skips rows that already exist).
-- ---------------------------------------------------------------------------
INSERT INTO chat_rooms (type, district_id, name)
SELECT 'global', NULL, 'Global Chat'
WHERE NOT EXISTS (
    SELECT 1 FROM chat_rooms WHERE type = 'global' AND district_id IS NULL
);

INSERT INTO chat_rooms (type, district_id, name)
SELECT 'district', d.id, d.name || ' Chat'
FROM districts d
WHERE NOT EXISTS (
    SELECT 1 FROM chat_rooms r WHERE r.type = 'district' AND r.district_id = d.id
)
ORDER BY d.id;

COMMIT;
