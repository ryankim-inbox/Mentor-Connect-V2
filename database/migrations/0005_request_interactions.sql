
-- Add consent and discussion without rewriting any existing match or message.
CREATE TABLE request_applications (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    applicant_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT request_applications_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    CONSTRAINT request_applications_request_applicant_key UNIQUE (request_id, applicant_id)
);
CREATE INDEX idx_request_applications_request ON request_applications(request_id, id);
CREATE INDEX idx_request_applications_applicant ON request_applications(applicant_id, id);
CREATE TABLE request_comments (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id),
    parent_id INTEGER,
    body TEXT NOT NULL,
    client_comment_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT request_comments_id_request_key UNIQUE (id, request_id),
    CONSTRAINT request_comments_parent_fkey FOREIGN KEY (parent_id, request_id)
        REFERENCES request_comments(id, request_id) ON DELETE CASCADE,
    CONSTRAINT request_comments_operation_key UNIQUE (author_id, request_id, client_comment_id)
);
CREATE INDEX idx_request_comments_request ON request_comments(request_id, id);
