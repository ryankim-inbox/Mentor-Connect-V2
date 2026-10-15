-- create_tables.sql
--
-- Run this in PostgreSQL first.
-- This schema is intentionally beginner-friendly.
--
-- In a bigger real app, subjects and availability might each have their own table.
-- For a learning project, TEXT[] arrays are easier to understand.

DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS blocked_users;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('student', 'mentor', 'admin')),
    location TEXT,
    subjects TEXT[] DEFAULT '{}',
    available_times TEXT[] DEFAULT '{}',
    languages TEXT[] DEFAULT '{}',
    grade_level TEXT,
    teaching_style TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE questions (
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

CREATE TABLE blocked_users (
    id SERIAL PRIMARY KEY,
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (blocker_id, blocked_id)
);

CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Record only observed matches; the marker defines the start of coverage.
CREATE TABLE request_events (
                                id BIGSERIAL PRIMARY KEY,
                                kind TEXT NOT NULL,
                                occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                                request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
                                mentor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                                request_created_at TIMESTAMPTZ,
                                CONSTRAINT request_events_kind_check CHECK (kind IN ('tracking_started', 'matched')),
                                CONSTRAINT request_events_matched_created_at_check CHECK (kind <> 'matched' OR request_created_at IS NOT NULL)
);
CREATE UNIQUE INDEX idx_request_events_tracking_started ON request_events (kind)
    WHERE kind = 'tracking_started';
CREATE INDEX idx_request_events_kind_occurred_at_id ON request_events (kind, occurred_at, id);
INSERT INTO request_events (kind) VALUES ('tracking_started');