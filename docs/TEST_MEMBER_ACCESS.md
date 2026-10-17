# Two-account test member access

The test deployment can grant ordinary member access to exactly one designated
mentor and one designated mentee without claiming that either owns their email.
This is a server policy, disabled by default. It does not create accounts, change
signup eligibility, send mail, set `is_verified` / `email_verified_at`, or grant
administrator access. Actual account IDs and credentials are not stored here.

## Private server configuration

After the two accounts have been identified, configure all of these together on
the test deployment:

| Setting | Required value |
| --- | --- |
| `TEST_MEMBER_ACCESS_ENABLED` | Literal `true` |
| `TEST_MEMBER_MENTOR_ID` | The existing mentor's exact positive integer account ID |
| `TEST_MEMBER_MENTEE_ID` | The existing mentee's different positive integer account ID |
| `APP_ORIGIN` | `https://mentor-connect-test.onrender.com` |
| `GATEWAY_PUBLIC_ORIGIN` | `https://mentor-connect-test.onrender.com` |

Both IDs must be canonical decimal integers between 1 and 2147483647. Missing,
duplicate, whitespace-padded, leading-zero, comma-separated, or malformed IDs
disable the exception. Origins must match literally, without a trailing slash.
There is no localhost override. Local regression tests supply the exact origin
configuration only to synthetic disposable servers; they make no remote calls.

The fresh database row must have the exact bound role (`mentor` or `mentee`) and
`is_admin=false`. `both`, changed roles, an admin flag, or any third account cannot
receive this exception. Registration fields, browser storage, email patterns,
signed-session privilege attributes, and profile updates cannot add account IDs.
The policy is independent of `EMAIL_TEST_ALLOWLIST_ENABLED` and
`EMAIL_TEST_RECIPIENT`; those existing settings only govern signup eligibility.

The account emails/IDs remain pending until supplied or established through an
authorized account-creation workflow. The user enters their own passwords
directly in the service; the operator must not generate, read, transmit, commit,
or log those credentials.

## Authority and revocation

`User.hasMemberAccess` is the computed member decision. `User.isVerified` still
means actual persisted email ownership. `User.isAdmin` is effective admin
authority, requiring actual ownership and the database admin flag, and excluding
the two reserved IDs. A valid configured pair remains excluded from admin even
when the member feature is disabled. This also protects gateway-owned operational
endpoints, which consume the fresh Python session response.

Synthetic seed identities are separately locked by the database password sentinel
`!mentor-connect-synthetic:`. They cannot log in, retain sessions, request email,
or receive member/admin authority, even if accidentally listed in the two-account
configuration. The marker is never inferred from an email address or client field.

HTTP member checks load the current database row. Chat and DM WebSockets check at
handshake, send, and recipient broadcast. Room membership, DM membership, blocks,
self-only profile changes, and consent-based matching restrictions still apply.
Mentor discovery admits the designated mentor only while the same policy is valid.
The browser uses `hasMemberAccess` for member routes, navigation, safety controls,
and chat, and displays “Test member access · Email ownership unverified”. It keeps
actual ownership and admin checks for operational pages.

Set `TEST_MEMBER_ACCESS_ENABLED=false` and restart/redeploy every application
instance to revoke the exception; environment changes must reach running workers.
The next HTTP/socket authorization then denies an unverified test account. Role
or admin-flag changes take effect from the fresh database check without restart.
Existing socket recipients are checked again before message delivery. Removing
the private ID configuration also removes the reserved-ID admin exclusion, so do
not remove it as a substitute for revoking an accidental database admin grant.

Normal users verify email ownership at signup. The persisted timestamp survives
logout and future logins. The 30-minute expiry applies only to an unused email
link; expiration or replay of an old token does not revoke already established
ownership. This feature adds no new database columns or migrations.

## Verification

`tests/test_test_member_access.py` covers fail-closed configuration, role binding,
third accounts, client/session forgery, actual ownership persistence, member chat,
mentor discovery, consent matching, gateway HTTP/WebSockets, admin exclusion, and
revocation with synthetic accounts. Gateway authority tests and
`e2e/test-member-access.spec.ts` cover the wire boundary, direct browser URLs,
login return destinations, honest ownership presentation, and admin denial.
