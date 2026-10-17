
-- Additive student-demo context and submission identities. Existing rows stay intact.
ALTER TABLE requests ADD COLUMN client_request_id uuid;
ALTER TABLE requests ADD COLUMN payload_hash text;
ALTER TABLE requests ADD CONSTRAINT requests_author_client_request_key UNIQUE (author_id, client_request_id);
ALTER TABLE requests ADD CONSTRAINT requests_payload_hash_check CHECK (payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$');
CREATE INDEX idx_requests_author_payload_created ON requests (author_id, payload_hash, created_at DESC);

-- Keep every acknowledged UUID bound when identical-content submissions coalesce.
CREATE TABLE request_submission_keys (
    author_id integer NOT NULL REFERENCES users(id),
    client_request_id uuid NOT NULL,
    request_id integer NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    payload_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT request_submission_keys_pkey PRIMARY KEY (author_id, client_request_id),
    CONSTRAINT request_submission_keys_payload_hash_check CHECK (payload_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX idx_request_submission_keys_request ON request_submission_keys(request_id);

ALTER TABLE reports ADD COLUMN target_type text NOT NULL DEFAULT 'profile';
ALTER TABLE reports ADD COLUMN request_id integer REFERENCES requests(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN request_title text;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('profile', 'request'));
ALTER TABLE reports ADD CONSTRAINT reports_target_context_check CHECK (target_type = 'request' OR (request_id IS NULL AND request_title IS NULL));
ALTER TABLE reports ADD CONSTRAINT reports_request_title_check CHECK (request_title IS NULL OR octet_length(request_title) <= 200);
CREATE INDEX idx_reports_target ON reports (reporter_id, target_type, reported_user_id, request_id, status);
