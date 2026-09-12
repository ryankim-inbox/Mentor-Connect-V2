# Secret-exposure incident closure ledger

Last reviewed: 2026-09-09 UTC
Incident owner: `[UNKNOWN]`
Release status: **NO-GO** — external closure evidence is incomplete.

No secret values, hashes, or credential-bearing URLs belong in this ledger.
The required schema is in [the rotation-ledger template](secret-rotation-ledger.template.md).

| Item type | Scope/reference | Owner | Rotated/reset at (UTC) | Ticket ID | Previous credential rejected | Replacement verification | Secret-store evidence reference | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub token | Historical Git exposure | GitHub credential owner `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Database credential | Historical Git exposure | Database owner `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| `SESSION_SECRET` | Historical Git exposure | Application operations owner `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Classroom database credential | Isolated classroom deployment | Deployment operator `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Classroom `SESSION_SECRET` | Isolated classroom deployment | Deployment operator `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Password-hash account linkage and reset | Historical database dump exposure | Account security owner `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Git history rewrite and force-push coordination | Historical Git exposure | Repository administrator `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Required CI check on `main` and organization-license configuration if applicable | `secret-history-scan` workflow | Repository administrator `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |

There are eight rows with `[UNKNOWN]` evidence. This ledger must not be marked
closed until each is independently evidenced; repository changes cannot close
them.

## Local scanner remediation

The 2026-09-09 tracked-file scan reported credential-shaped synthetic URLs in
two test files. Those fixtures were changed without weakening the scanner or
excluding test directories. This local correction is not evidence that any
credential was rotated, any account was reset, or Git history was remediated.

## Pending operator actions

1. The deployment operator must issue a least-privilege credential for a
   separate classroom database, store it in the approved private secret store,
   verify access to only that target, and add the ticket and evidence reference
   to the classroom database row without recording the value or URL.
2. The deployment operator must generate a new classroom `SESSION_SECRET`,
   store it in the approved private secret store, verify the deployed classroom
   uses it, and add the ticket and evidence reference to the classroom session
   row without recording the value.
3. The responsible provider owners must revoke or rotate the historically
   exposed GitHub token, database credential, and `SESSION_SECRET`; demonstrate
   rejection of each previous value and successful use of its replacement; and
   record the provider-approved private evidence references in the historical
   rows.
4. If a historical environment will not be reused, its owner must decommission
   it instead of recycling its credentials and record the private provider
   evidence reference in the corresponding historical credential rows.
5. The account security owner must determine whether exposed password hashes
   map to real accounts and record required reset evidence. The repository
   administrator must separately coordinate any approved history rewrite and
   required CI gate evidence.

No external secret provider, secret-store reference, revocation evidence, or
account-reset evidence was supplied during this review, so those fields remain
`[UNKNOWN]` and every affected row remains `BLOCKED`.
