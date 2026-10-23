-- Leave legacy demographics unknown; registration validates new self-reported values.
ALTER TABLE users ADD COLUMN gender text;
ALTER TABLE users ADD COLUMN date_of_birth date;
ALTER TABLE users ADD CONSTRAINT users_gender_check CHECK (gender IN ('female', 'male'));

-- Existing requests retain their original visibility and stored content.
ALTER TABLE requests ADD COLUMN audience text NOT NULL DEFAULT 'both';
ALTER TABLE requests ADD CONSTRAINT requests_audience_check CHECK (audience IN ('female', 'male', 'both'));

ALTER TABLE notifications ADD COLUMN event_key text;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('request_match', 'request_match_summary', 'request_accepted'));
-- Preserve match deduplication while allowing one acceptance per later application.
ALTER TABLE notifications DROP CONSTRAINT notifications_user_id_request_id_kind_key;
CREATE UNIQUE INDEX notifications_user_id_request_id_kind_key
    ON notifications(user_id, request_id, kind)
    WHERE kind IN ('request_match', 'request_match_summary');
CREATE UNIQUE INDEX notifications_user_event_key
    ON notifications(user_id, event_key) WHERE event_key IS NOT NULL;
