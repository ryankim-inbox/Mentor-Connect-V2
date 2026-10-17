# Synthetic classroom dataset

This operator command adds one fixed, clearly labeled batch to the existing test database. It preserves current accounts, requests, tags, districts, and moderation history. It never registers accounts through the API or calls an email provider.

The user-facing `/requests` feed reads `requests`; the Practice Lab matching engine separately reads `questions`. This batch therefore contains **983 fictional student profiles, 782 questions, and 782 corresponding request posts**. Peer-mentoring roles are 600 mentees, 250 mentors, and 133 students who can do both.

| Table                | Added rows | Meaning                                                                                      |
| -------------------- | ---------: | -------------------------------------------------------------------------------------------- |
| users                |        983 | Fictional profiles; no usable credentials                                                    |
| questions            |        782 | Practice Lab matching input                                                                  |
| requests             |        782 | Same questions in the request feed: 470 open, 234 matched, 78 closed                         |
| request_tags         |        782 | One existing subject tag per post                                                            |
| schedules            |      1,966 | Two availability slots per profile                                                           |
| request_applications |        782 | Synthetic peer applications; pending for open requests, accepted for matched/closed requests |
| request_comments     |        391 | Labeled fictional discussions                                                                |
| request_events       |        312 | Synthetic observed match events for matched/closed requests                                  |

All seeded relationships refer only to members of this batch. No existing account becomes a request author, applicant, commenter, or matched peer. Existing tags and the first two districts by ID are reused; at least one of each must exist. No tags, districts, administrator accounts, verification tokens, moderation reports, blocks, chats, or direct messages are created.

## Identity and authority

The batch ID is `mc-synthetic-v1-983-782`. Emails range from `student-0001@mc-synthetic-v1-983-782.invalid` through `student-0983@mc-synthetic-v1-983-782.invalid`. Names and biographies explicitly say Synthetic. Every password field contains the non-bcrypt lock marker `!mentor-connect-synthetic:v1:mc-synthetic-v1-983-782`; there is no generated or shared password.

Every profile has `is_verified=false`, `email_verified_at=NULL`, and `is_admin=false`. The account-policy change must already be deployed: it rejects this password marker before bcrypt, session authorization, and verification delivery. These accounts are distinct from the two explicitly configured login-test members and the administrator. Do not put a synthetic ID into that member allowlist, grant it ownership, or turn it into an admin. No user credentials belong in the seed receipt.

Synthetic profiles appear as authors of labeled request posts and in administrator analytics. The member mentor directory requires current member access, so these unverified synthetic profiles **do not appear in that directory**. The administrator-only Practice Lab can evaluate their matching data. This behavior preserves the distinction between sample data and email ownership.

## Preconditions and execution

1. Review the selected test database identity and create a verified backup using the existing classroom backup runbook. Save the backup outside the repository with restricted permissions. Do not bootstrap or replace the populated database.
2. Deploy and verify the account lock and admin/member boundaries. Upgrade the database through the reviewed account-trust procedure if needed. The seed requires the full checked migration ledger, currently **0008_student_demo**. A live database still below 0008 must stop here; the local-only notifications helper does not authorize a remote upgrade.
3. In a protected operator environment, supply the existing `CLASSROOM_DATABASE_URL`, `CLASSROOM_ALLOWED_HOST`, and `CLASSROOM_DATABASE_NAME`. The command validates the exact host and database and requires explicit certificate-verified TLS (`sslmode=verify-full`) outside loopback. It uses the shared isolated PostgreSQL connection settings rather than ambient PG target/TLS variables. Do not paste secrets into chat, command history, or source files. Unsupported URL options, including `channel_binding`, are rejected rather than silently discarded; use the documented operator connection format with the user's existing privately supplied credentials.
4. Set `SYNTHETIC_AS_OF` to one UTC ISO timestamp with milliseconds, for example `2026-10-17T12:00:00.000Z`. It must be no later than the database clock and no earlier than the existing `tracking_started` event. Keep the exact timestamp for every rerun of this batch. The example is illustrative; use the reviewed execution timestamp.
5. Preview, inspect the count summary and plan digest, then apply the same plan:

```sh
node ops/seed-synthetic-classroom.mjs --preview
```

```sh
export SYNTHETIC_CONFIRM_BATCH=mc-synthetic-v1-983-782
umask 077
node ops/seed-synthetic-classroom.mjs --apply > "$SYNTHETIC_RECEIPT_FILE"
```

`SYNTHETIC_RECEIPT_FILE` is an operator-selected private path outside the repository. Save the preview as well. A successful apply receipt has `operation: "inserted"`, the exact anchor, a SHA-256 plan digest, row counts, and IDs grouped by table. It contains synthetic identifiers only. The exported function owns its database transaction and expects an idle client.

Preview performs no inserts and does not allocate sequence values. Apply uses one transaction and the migration advisory lock. A complete identical batch returns `already-present` without writing. A partial namespace collision, modified batch record, changed anchor, or incompatible current tags/districts rejects the run; it never overwrites or repairs existing data. If another operator runs the same batch concurrently, only one insertion commits.

The seed also refuses any database containing a matched event with **both** `request_id` and `mentor_id` set to `NULL`. Those foreign keys use `ON DELETE SET NULL`, so deleting an earlier batch's profiles and posts can leave its history behind. With both references gone, provenance cannot distinguish that history from unrelated matches. This conservative check requires a separate review of such history instead of silently inserting another batch or deleting anything. It can also block a database with legitimate orphaned history; that is intentional.

A write failure rolls back all batch records; PostgreSQL sequence numbers consumed by a failed insert can remain unused. Do not reset sequences to remove these normal gaps. If the connection fails while committing, the outcome may be unknown: inspect the database or rerun the exact same plan. The CLI deliberately does not print raw database errors, which could contain sensitive row contents.

## Reports and analytics verification

The Reports signup summary is calculated from `users.created_at` using UTC day/month/year boundaries. The moderation queue at `/admin/reports` is a separate feature: this seed does not invent accusations or moderation activity.

Subject demand reads request tags. Availability reads `users.available_times` and counts each user once per slot. Weekly matches and average time to match read `request_events`; signup totals, roles, request states, and district counts read their relational tables. No API or UI total is hardcoded for the seed.

Historical profile dates and request dates derive from the fixed anchor. Match events are never earlier than the existing tracking-start marker or their request creation. The seed does not move the marker or claim coverage before tracking began. A recently initialized database may therefore show all generated match events in its current covered week; earlier weeks remain untracked.

Compare independent SQL with the administrator APIs, including preexisting data in both sides. Useful read-only checks:

```sql
SELECT count(*) AS synthetic_students
FROM users
WHERE email LIKE '%@mc-synthetic-v1-983-782.invalid'
  AND password_hash='!mentor-connect-synthetic:v1:mc-synthetic-v1-983-782';

SELECT count(*) AS questions
FROM questions q JOIN users u ON u.id=q.student_id
WHERE u.email LIKE '%@mc-synthetic-v1-983-782.invalid';

SELECT status,count(*) FROM requests
WHERE request LIKE 'mc-synthetic-v1-983-782:question:%'
GROUP BY status ORDER BY status;

SELECT t.name,count(*) FROM request_tags rt JOIN tags t ON t.id=rt.tag_id
GROUP BY t.id ORDER BY count(*) DESC,t.id;

SELECT date_trunc('week',occurred_at AT TIME ZONE 'UTC')::date AS week,count(*)
FROM request_events WHERE kind='matched' GROUP BY week ORDER BY week;
```

Check `/api/python-reports/summary`, the four `/api/analytics/*` endpoints, and `/api/stats/overview`. Confirm the request feed fetches bounded pages (maximum 50), filters by status/district/tag, and advances its cursor without duplicates. As an ordinary member, direct analytics, status, matching, and admin report APIs must still deny access; the corresponding frontend routes remain admin-only. Synthetic login and signed-session requests must return 401 and must create no verification requests or tokens. Do not attempt delivery to the synthetic addresses.

Local verification, using the existing Node 24, PostgreSQL tools, and Python environment:

```sh
sh lib/db/test/synthetic-seed-disposable.sh
```

The harness creates and removes its own localhost PostgreSQL cluster. It checks exact added counts, existing-record preservation, repeat runs, concurrent runs, conflicts, rollback, the schema gate, real FastAPI responses against independent SQL, pagination, and access denial. Its API utility is restricted to the `synthetic_exact` localhost fixture and must not be used on a live database. Browser rendering is a separate release check.

## Identification for a future undo review

No deletion or undo is performed by this command. Preserve the apply receipt, plan digest, anchor, and pre-seed backup. A future batch-scoped undo must start from the receipt's exact IDs and revalidate the markers, sentinel, and relationships. Identify request posts by their exact `request` marker, question messages and comments by their batch prefix, and profiles by the full email namespace plus password lock. Include dependent schedules, tags, applications, comments, and match events.

Before any future removal, inspect references from accounts outside the batch, especially new comments, applications, reports, blocks, chat/DM content, and moderation reviewers. Stop if later real activity depends on seeded records. Neither a broad `.invalid` match nor an ID range is sufficient authorization to delete. Plan and review the exact rows separately; do not rerun the initial classroom seed or restore over newer unrelated content to remove this batch.
