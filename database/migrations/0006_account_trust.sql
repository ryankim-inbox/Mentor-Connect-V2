-- A school-domain suffix was never proof of email ownership. Preserve all content.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ALTER COLUMN is_verified SET DEFAULT false;
UPDATE users SET is_verified=false;
ALTER TABLE users ADD CONSTRAINT users_email_ownership_check
    CHECK (is_verified = (email_verified_at IS NOT NULL));
CREATE TABLE email_verification_tokens (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE email_verification_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'request' CHECK (kind IN ('request','confirm')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_verification_requests_user ON email_verification_requests(user_id, kind, requested_at);
ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewing','resolved','dismissed'));
ALTER TABLE reports ADD COLUMN note TEXT CHECK (length(note) <= 2000);
ALTER TABLE reports ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE reports ADD COLUMN reviewed_at TIMESTAMPTZ;
CREATE INDEX idx_reports_status_id ON reports(status,id);
ALTER TABLE request_comments ADD COLUMN updated_at TIMESTAMPTZ;
ALTER TABLE request_comments ADD COLUMN deleted_at TIMESTAMPTZ;
