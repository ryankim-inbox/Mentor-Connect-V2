# Student demo release

This change is prepared for code review and local rehearsal. It does not authorize a live database migration, Render configuration change, deployment, administrator grant, or seed. The previous rollout operator is pinned to its reviewed commit and schema0006/0007 scope; it must not be reused to apply0008 silently.

## Data and authority

Students with mentor, mentee, or both roles use requests, applications, comments, chat, profile/post reports and their own notification inbox. Administrators use operational views and moderation. Every chat handshake and message checks current database authority, including sockets opened before an administrator promotion. Administrators may delete inappropriate posts/comments and process reports, but cannot publish or replace student content. Existing signed sessions do not freeze authority.

The seeded983 profiles and782 questions are synthetic demonstration records. Locked synthetic accounts cannot sign in, receive recommendations or earn activity badges. The two explicitly configured test-member accounts remain a narrowly scoped exception to email ownership verification; their access does not prove ownership or confer administrator privileges. A new administrator account still needs verified ownership and a separately authorized exact-ID grant.

Profile and post reports share the moderation queue. Unresolved reports from the same reporter against the same target coalesce without overwriting original evidence. A deleted post leaves its report and title snapshot available to moderators.

## Submission and notification behavior

The browser sends a stable UUID for an explicitly retried unchanged submission; uncertain requests are never retried automatically. An author/UUID pair identifies its original payload. Reusing it for different content returns409. Identical validated content from one author within five minutes coalesces even when different UUIDs arrive. Every acknowledged UUID alias is persisted. Deleting the post also deletes its aliases and notifications, ending that identity lifetime; an explicit later submission can create a new post.

Only committed, open mentee questions trigger matching. The shared lesson scoring helper ranks eligible mentor/both accounts, filters authority and both block directions before the top-five limit, and resolves score ties by ascending user ID. Alerts are in-app only. A completed delivery batch, including a zero-recipient batch, is frozen by its author summary. An explicit request replay can repair a wholly failed batch; it cannot grow a completed batch. Matching does not create an application, acceptance, connection or DM.

Activity badges use distinct accepted study partners, not message/post volume. See [the badge metric and nine thresholds](student-activity-badges.md). A badge describes activity, not teaching quality or verified skill.

## Schema0008 and future deployment handoff

Migration `0008_student_demo.sql` is additive. It adds request submission identity/hash columns, a UUID alias table, and report target context. Existing migrations0001–0007 retain their original checksums. Canonical assets contain20 tables,141 columns,90 constraints and65 indexes. Frozen0007 assets support explicit historical backup/restore without changing current readiness expectations.

Before any live transition, obtain approval for the exact target, maintenance behavior, release SHA, reviewed migration/operator, and recovery plan. A populated database must never run the empty-DB bootstrap. Capture and restore-verify a private backup using its actual schema version; preserve the existing scoped operator and credentials. Review migrations and runtime privileges together in an atomic, ledger-locked transaction. The runtime requires SELECT/INSERT on `request_submission_keys`; it does not need UPDATE/DELETE/DDL on that table. Existing request/report table privileges cover new columns; restricted deployments must check this explicitly. Matching row locks require an existing UPDATE privilege on requests/users, satisfied by narrow UPDATE(title) and UPDATE(name) respectively; never grant administrator or verification writes.

The live source may still be schema0005. Do not label it0007 or apply only0008. Do not change the saved `/readyz` health gate, environment values, or service release based on this code change. Those previously blocked rollout actions need their own exact approval and new evidence.

After an authorized deployment, verify the exact public HTTPS origin and release SHA with two independent browser contexts and user-controlled credentials: shared data, room and DM messages in both directions, history after reload/relogin/restart, reconnect resynchronization and deduplication, denied unauthorized/Origin/spoofing attempts, admin/student boundaries, contextual reports, badges, inbox links/read state, deep links,404 and readiness. Local TLS evidence is a rehearsal and does not establish public deployment completion.
