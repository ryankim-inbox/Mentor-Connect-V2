# Demo member access without email ownership verification

Ordinary registered accounts can use member features without verifying mailbox
ownership. This is the approved contest-demo policy. It does not establish
school enrollment, age, identity or mailbox ownership. The application still
requires a valid login, the existing signup email eligibility rule, and current
server-side authority for each protected operation.

## Separate facts and privileges

- `User.hasMemberAccess` is computed from the current database row. Ordinary,
  unlocked accounts have member access independently of email ownership.
- `User.isVerified` represents only actual `email_verified_at` proof. Registering,
  logging in, posting or chatting does not write a verification timestamp.
- `User.isAdmin` still requires actual ownership and the database administrator
  flag. It is never inferred from email, mentor/mentee/both role or client input.
  Administrators cannot participate in student posting, applications or chat.
- Synthetic seed identities remain locked by the server-written
  `!mentor-connect-synthetic:` password sentinel. They cannot authenticate,
  retain a session, receive messages or acquire member/administrator authority.

Signup retains the `.edu` format restriction and the existing private exact
non-.edu test-recipient exception. Neither is evidence of school enrollment.
Registration does not send mail automatically. Users may deliberately request
optional ownership verification; the existing expiry, resend limits, protected
local test outbox and disabled/failed delivery behavior remain unchanged.

## Existing configuration and live authorization

`TEST_MEMBER_ACCESS_ENABLED` no longer gates ordinary membership. No origin or
pair of account IDs is required for ordinary member access. Disabling that
retired switch does not revoke ordinary users.

A valid pair in `TEST_MEMBER_MENTOR_ID` and `TEST_MEMBER_MENTEE_ID` remains excluded
from administrator authority, even with a database admin flag and actual email
proof. Preserve those reserved IDs; deleting their configuration is not a way to
revoke a mistaken administrator grant. IDs must remain distinct canonical positive
32-bit integers. This patch does not edit any deployed environment variables.

HTTP and WebSocket checks reload current database authority. Synthetic locks,
admin promotion, room/DM membership, bilateral blocks, self-only settings and
consent-based matching remain enforced. Mentor discovery excludes administrator
and locked seed accounts. The browser follows `hasMemberAccess` while honestly
displaying unverified ownership. Operational routes retain separate admin checks.

## Administrator preparation

The requested demo address `admin@test.edu` does not prove ownership. This patch
neither creates that account nor grants a verification exception. The supported
registration form accepts a password entered directly by its user; it requires a
display name, student-role value and district, so those values must be deliberately
chosen rather than inferred as real student identity. Registration creates only
an ordinary account and sends no email automatically.

Any demo administrator exception requires a separately reviewed exact numeric
account ID, exact email, server configuration, and audited role-grant approval.
Do not fill `email_verified_at`, widen general administrator access, send mail to
the demo address, or generate a password in chat to make it usable. Keep student
access denied once the account becomes an administrator.

## Verification and rollout

Regression coverage includes new registration with no email delivery, truthful
ownership state, mentor discovery, notification/matching eligibility, HTTP and
WebSocket authorization, ownership token protections, blocked peers, synthetic
locks, admin separation and browser return destinations. Tests use disposable
local databases only. No schema migration is introduced by this policy change.

Deploy Python, generated API contracts and UI together after exact-commit CI and
explicit deployment approval. Local validation does not prove the live site has
this behavior. Reverting to the previous code restores the ownership gate without
changing persisted ownership facts or deleting data.
