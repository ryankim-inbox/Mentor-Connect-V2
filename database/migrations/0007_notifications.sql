-- Notifications are installed by an operator, never by request-time runtime DDL.
-- Existing unversioned objects must be reviewed separately, not silently adopted.
CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('request_match', 'request_match_summary')),
    request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    UNIQUE (user_id, request_id, kind)
);
CREATE INDEX idx_notifications_user_created
    ON notifications (user_id, created_at DESC);
