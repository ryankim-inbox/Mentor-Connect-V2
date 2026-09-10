# Secret rotation ledger template

Use one row for every exposed credential or account-reset investigation. Do not
record secret values, hashes, URLs containing credentials, screenshots, or CI
output here. Store only the ticket reference and approved evidence location.

| Item type | Scope/reference | Owner | Rotated/reset at (UTC) | Ticket ID | Previous credential rejected | Replacement verification | Secret-store evidence reference | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `[credential type]` | `[non-sensitive identifier]` | `[accountable owner]` | `[YYYY-MM-DDThh:mm:ssZ or UNKNOWN]` | `[ticket or UNKNOWN]` | `[pass/fail/UNKNOWN]` | `[pass/fail/UNKNOWN]` | `[approved private reference or UNKNOWN]` | `[OPEN/BLOCKED/CLOSED]` |

Closure requires a non-`[UNKNOWN]` value for every evidence column, a `pass`
result for both credential checks, and a confirmed least-privilege secret-store
location. A ledger is not evidence that an external operation occurred.
