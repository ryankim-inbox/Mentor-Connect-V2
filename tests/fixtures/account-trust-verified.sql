-- Synthetic local member accounts explicitly prove ownership. No privilege implied.
UPDATE users SET email_verified_at=now(),is_verified=true;
