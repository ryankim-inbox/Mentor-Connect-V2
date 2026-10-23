# Single contest-demo administrator

Scope: local preparation only for the user-selected `admin@test.edu` account.
Read-only Neon verification on 2026-10-23 found exactly one row, ID **991**,
`is_admin=false`, `is_verified=false`, `email_verified_at IS NULL`, in
Mentor_Connect / production / neondb. No password or hash was retrieved.

The chosen design extends the existing central server authority policy, using a
disabled-by-default, exact-account exception. All of these must hold:

- ID is the fixed reviewed integer 991 and email is exactly `admin@test.edu`.
- DB `is_admin` is true; the account is not synthetic-locked or a reserved A/B ID.
- Server `DEMO_ADMIN_USER_ID` is exactly `991` (no whitespace, lists or aliases).
- Both `APP_ORIGIN` and `GATEWAY_PUBLIC_ORIGIN` are exactly
  `https://mentor-connect-test.onrender.com`.

Normal verified administrators retain their existing policy. Ordinary users gain
no administrator authority. Effective `isAdmin` remains computed from current DB
state; consumers use that authoritative value instead of independently requiring
ownership. `isVerified` continues to represent real mailbox proof only, including
in UI. No new schema, timestamp writes, email delivery or client privilege fields.
Student participation stays denied to admins, including existing sockets after
promotion. Removing the config or revoking the DB flag disables the exception.

Broad email-only or all-admin bypasses are rejected. A real-mail route cannot
prove ownership of this explicitly fictitious demo mailbox. Hard pinning the ID
also prevents a future recreation of the same address inheriting this exception.

Remote role grant, environment activation, push and deployment require a later
approval naming this account and the reviewed candidate. This work changes none
of them, and preserves all existing data, passwords, session and rate-limit rules.
