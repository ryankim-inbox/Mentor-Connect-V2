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
- `User.isAdmin` requires the database administrator flag plus actual ownership
  or the explicitly configured, pinned demo exception below. It is never inferred
  from email alone, mentor/mentee/both role or client input.
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

The requested demo address `admin@test.edu` does not prove ownership. The supported
registration form accepts a password entered directly by its user; it requires a
display name, student-role value and district, so those values must be deliberately
chosen rather than inferred as real student identity. Registration creates only
an ordinary account and sends no email automatically.

The user registered this account privately. Read-only verification found exactly
one row, ID **991**, with `is_admin=false`, `is_verified=false` and no ownership
timestamp. The code supports an exception only for this fixed ID and exact email,
with a current DB admin flag, no synthetic lock, and no reserved A/B ID collision.
All three server-only settings must match exactly:

| Setting | Required value |
| --- | --- |
| `DEMO_ADMIN_USER_ID` | `991` |
| `APP_ORIGIN` | `https://mentor-connect-test.onrender.com` |
| `GATEWAY_PUBLIC_ORIGIN` | `https://mentor-connect-test.onrender.com` |

The exception defaults off; any absent/mismatched value denies it. It does not
apply to a recreated address with a new ID or to other unverified administrators.
The API and UI still report `isVerified=false`. Only effective administrator and
member authority change. Normal verified administrators are unaffected.

Activation still requires separate execution approval: recheck this exact row,
grant only its `is_admin` flag through the approved operator role, then deploy the
reviewed exact SHA and activate the server configuration. Do not widen the runtime
DB role. Preserve verification columns, passwords and all existing user data.
The local patch does not perform a grant, set remote configuration or deploy.

Revoke the DB flag to remove administration on the next authoritative check; this
returns the account to ordinary membership. Removing `DEMO_ADMIN_USER_ID` while
keeping the unverified admin flag denies both admin and member features. A code
rollback likewise restores the previous ownership requirement without data edits.

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
