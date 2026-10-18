# Student demo: authority, reports, activity and notifications

The student team's public demo needs student/admin separation, contextual reporting,
honest activity badges, and useful request notifications. The human explicitly
requested implementation of these six items. Existing main f9fa0fc3 has the same
tree as reviewed36cadbec; reuse its authentication, chat, moderation and notification
flows. No provider settings, remote DB, private credentials, main merge, paid
features or real student information are part of this implementation.

## Authority

Authority comes from the current DB account on every API call and WS handshake/send,
never a signed role claim. Verified administrators retain aggregate dashboards,
report processing and content removal. They cannot post/edit student requests,
apply/accept connections, post/edit replies, report/block as a student, or read/send
student chat. Administrators may inspect requests/profiles for moderation and edit
their account name. Verified mentor/mentee/both students cannot use any admin API,
page, operational aggregates under `/api/stats/**`, or direct-URL equivalent. Existing public directory counts (district members/open requests and tag request counts) remain public metadata; profile activity counts are intentionally member-visible. The two configured test exceptions remain
student-only; verification ownership remains separate. Navigation and writing
controls follow the same boundary, including a session whose admin flag changes.

## Reports

Reuse `reports` with a nullable request reference, target type and server-captured
request title. Profile reports remain compatible. Post reports resolve the author
server-side and reject mismatched author claims. Reject own, missing or blocked
targets and unauthorized actors. Serialize submission for the same reporter/target
and return the existing unresolved report instead of duplicating it. Preserve old
report rows, status, reviewer and notes. Deleted posts leave a moderation record
with no live link. Admin moderation remains separate from writing replies.

## Activity badges

Reuse `mentor_ranks.sort_mentors` and `assign_ranks` for deterministic ordering and
competition ranks. Production input covers eligible mentor/mentee/both students.
The activity count is distinct eligible study partners in accepted requests which
remain matched or closed, counted for both participants. Require an accepted
application, not just a legacy matched flag. Count each partner once regardless of
message count, duplicate requests or repeated pairing. Exclude self/admin/locked
synthetic/unverified accounts and blocked relationships. Zero activity has no badge.

Tier minimum distinct partners: Bronze1, Silver3, Gold5, Platinum10, Emerald20,
Diamond35, Master50, Grand Master75, Challenger100. Tiers measure the documented
activity count, not pedagogical quality or relative percentile. A small demo cannot
give its sole active member Challenger. Collusion across many verified identities
is outside this metric's protection; document that limit. Use original simple UI
badges, no copied game assets. Expose a bounded profile badge endpoint and show it
beside the member's name on own/other profiles; preserve the lesson API exercises.

## Matching and notifications

The existing `find_matches` scoring module is the common calculation for lesson
questions and production requests via a pure candidate-ranking adapter. Support
request tag subjects and preferred times while preserving legacy single-value
inputs. Use score descending then numeric user ID ascending. Filter before taking5:
exclude author, administrators, locked synthetic accounts, unverified/ineligible
students and blocks in either direction; candidate role is mentor/both. Zero-score
candidates are excluded; fewer than5 is valid.

Persist a request first, then run matching in a separate transaction. Notification
inserts retain the existing per-user/request/kind uniqueness. Re-read and lock the
committed request and eligibility before inserts. No email, push, accept/reject
notification action, DM, application or automatic match is created. Maintain the
existing list/read API and chronological ID tie-break; removed requests cannot
leave active navigation links. Bell links to the existing inbox, positioned at the
lower left without covering the lower-right chat widget.

New request submissions use a client UUID plus canonical payload digest. Reusing a
UUID with different content is409. A short identical-content duplicate window also
coalesces double submissions using different UUIDs; compatible older clients without
UUID still receive this protection. Do not retry an uncertain publish automatically.
An explicit identical retry returns the same request and can repair missing alerts.

## Verification and rollout boundaries

TDD covers actual DB effects, gateway authority, WS handshake/send including an
already-connected newly promoted admin, report concurrency, bad targets, all9 tier
thresholds, zero and spam activity, top5 eligibility/ties, notification retries,
rollback and deleted destinations. Local browser tests use two independent contexts
and synthetic fixtures for real room/DM send, receive, reconnect and history.

The983 profiles and782 questions remain labelled synthetic demo content; they are
not real students, cannot log in, and never receive notifications or rank credit.
Live ID5/6 passwords remain user-owned. Public HTTPS acceptance is pending deployment
and user login; admin Gmail signup/ownership/exact-ID grant remain separate gates.
The earlier health gate rejection still blocks provider rollout. A new migration
must be additive and locally rehearsed; do not modify immutable0001–0007 or reuse
the private pinned36 operator for the new schema without a separately reviewed update.

Implementation refinement: `request_submission_keys` binds every acknowledged UUID to its canonical request and payload hash, including UUID aliases coalesced within five minutes. Deleting the request cascades these submission identities. This closes the same-UUID/different-content conflict gap when duplicate content arrived under multiple UUIDs.
