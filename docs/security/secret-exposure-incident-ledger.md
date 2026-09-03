# Secret-exposure incident closure ledger

Last reviewed: 2026-09-02 UTC
Incident owner: `[UNKNOWN]`
Release status: **NO-GO** — external closure evidence is incomplete.

No secret values, hashes, or credential-bearing URLs belong in this ledger.
The required schema is in [the rotation-ledger template](secret-rotation-ledger.template.md).

| Item type | Scope/reference | Owner | Rotated/reset at (UTC) | Ticket ID | Previous credential rejected | Replacement verification | Secret-store evidence reference | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub token | Historical Git exposure | GitHub credential owner `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Database credential | Historical Git exposure | Database owner `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| `SESSION_SECRET` | Historical Git exposure | Application operations owner `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Password-hash account linkage and reset | Historical database dump exposure | Account security owner `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Git history rewrite and force-push coordination | Historical Git exposure | Repository administrator `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |
| Required CI check on `main` | `secret-history-scan` workflow | Repository administrator `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | `[UNKNOWN]` | BLOCKED |

There are six `[UNKNOWN]` rows. This ledger must not be marked closed until
each is independently evidenced; repository changes cannot close them.
