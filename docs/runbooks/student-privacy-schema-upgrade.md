# Student privacy schema 0009 deployment handoff

This change is prepared and tested locally only. No production migration, permission change, deployment or account update is authorized by this work.

`0009_student_privacy_notifications` follows the unchanged 0001–0008 ledger. It adds nullable `users.gender` and `users.date_of_birth`, `requests.audience` defaulting to `both`, and nullable `notifications.event_key`. It preserves old hashes, titles, accounts, requests, taxonomies, message history and read state. Acceptance notices use `request_accepted:application:{id}` per recipient; match notices retain their existing uniqueness. The old match constraint becomes a partial unique index, so writers must use bare `ON CONFLICT DO NOTHING` or infer that index with its matching predicate.

The migration contains no grants. Under the existing account trust policy, new signup remains denied until an operator separately reviews and authorizes exactly this additional permission for the actual application role:

```sql
GRANT INSERT (gender, date_of_birth) ON TABLE public.users TO <reviewed_application_role>;
```

The placeholder is intentionally not an executable role name. Do not grant table-wide user INSERT/UPDATE or UPDATE on either demographic field. Existing SELECT on users and existing notification SELECT/INSERT permissions cover the added columns. No new role, sequence, authentication, admin or credential privileges are needed. `ops/account-trust-grants.mjs` remains unchanged; rerunning that older policy after a separately approved demographic grant will fail its exact-permission check and needs a coordinated policy review.

Before any separately authorized rollout, rehearse an explicit 0008 backup/restore and the 0008→0009 migration against a disposable copy, review database lock time and use the existing audited migration process. The new `database/recovery/0008-{catalog,version}.json` assets retain explicit 0008 backup/restore validation. Historical demo-refresh and restore-diagnostic workflows pinned to 0008 are not automatically authorized for 0009.

Release the compatible server and clients with the schema change. Keep the new columns and their data during an application rollback; an old server does not enforce restricted audiences and cannot be used to serve these posts safely. Any recovery plan requires a separate reviewed decision rather than silently removing audience restrictions.

Local evidence: `sh lib/db/test/student-privacy-upgrade-disposable.sh` verifies full old-column preservation, rollback and replay, unknown legacy demographics, existing audiences, unchanged original ACLs, a narrowly granted synthetic signup, and duplicate notification prevention across rematches. Catalog capture uses a fresh loopback PostgreSQL cluster and a read-only introspection transaction. Environment-specific manifest statuses remain `[UNKNOWN]`.
