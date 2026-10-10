
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
