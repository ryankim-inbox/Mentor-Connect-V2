# Student privacy and notifications implementation plan

**Goal:** Implement the six approved Mentor Connect changes locally on the existing FastAPI/PostgreSQL + React/TypeScript stack.
**Base:** 78b65d974432f73d5abc296b19811c10c9802c3c, isolated branch codex/student-privacy-notifications.
**Authorization:** Local code, synthetic tests and review only. No remote push, deployment, production migration, authentication activation, account deletion, credential reset or permission expansion.

## Design decisions (conservative defaults)
- Count request titles using Unicode code points, including all spaces before any transformation, maximum 60; preserve the title as submitted. Reject blank and unpaired surrogate input. Emoji counts as one code point; combining sequences count separately. Existing longer titles remain stored.
- New registrations require 12+ code points, one ASCII A–Z and one ASCII punctuation character. Retain bcrypt and reject passwords exceeding 72 UTF-8 bytes. Existing login policy and hashes remain unchanged.
- New registrations require female/male and a real ISO date of birth no later than today (UTC). Store nullable users.gender/date_of_birth; leave legacy accounts null. Do not return these fields in profile/auth APIs or logs. This is self-reported information, not age or enrollment verification.
- Requests gain immutable audience female/male/both, default both. Existing rows retain both. Access is allowed to the author, existing admin moderators, both audiences, or a matching registered gender. Unknown gender fails closed. An author can choose another gender and still access their own post.
- Apply visibility at server list/detail/discussion/applications/related activity/matching/notifications/counts. Preserve existing admin student-function denial.
- New-question notifications retain the existing top-five eligible mentor recipients plus author summary. Acceptance sends one notice to each participant per application via a durable event key. No broad new-question broadcast.
- DM unread uses existing dm_messages.read_at, counts incoming nondeleted messages, acknowledges only explicit observed incoming message IDs (batches of at most 50), and reconciles server counts on focus/reconnect/poll/multiple tabs. Hidden tabs do not mark read.
- Library reference was resolved with exact ID libfile_c9166695043881918ba7e8e24af15256 but official transfer helper failed on this Mac. Use current bottom-right widget; pixel match remains unverified.

## Work and ownership
- [ ] Signup: auth.py, Register.tsx and validation/tests; update existing synthetic signup fixtures.
- [ ] Audience/alerts: request_access.py, request routes/interactions, auto_match.py, notifications and related data exposures; adversarial synthetic tests.
- [ ] DM: chat.py and widget/client hooks, real unread state and dedicated integration/browser tests.
- [ ] Integration: additive migration 0009, Drizzle/catalog/ledger; OpenAPI/generated clients/gateway routes; title/audience UI and tests.
- [ ] Full checks: typecheck/release build, Python synthetic PostgreSQL regressions, gateway, schema/migration, generated contracts, browser suite, independent whole-diff review and fix confirmed findings.

## Review focus
- Unauthorized audience data through secondary APIs/counts/notifications.
- Old account login and admin 991 exceptions remain unchanged.
- Concurrent read/new-message arrival, replayed sends, reconnect and multiple tabs.
- No sensitive registration data reflected in APIs/error/logs.
- Migration preserves all old rows/taxonomies, keeps nullable demographics and old posts both.

## Deployment handoff
Prepare migration and exact release scope only. Require a separately authorized rehearsal/production migration and deployment decision after local results. Rollback should preserve new columns/data and requires coordinated compatible app behavior; never silently remove restrictions with an old binary.


## Review corrections
- Independent review found sequence-ID watermarks could consume unseen late commits. Both DM and notification reads now acknowledge explicit observed IDs; notifications retain an explicit mark-all action for older entries.
- History reconciliation keeps at least the newest 50 messages on refresh so a late commit before the cached anchor becomes visible without reloading.
- DM badges show the exact server count, including counts greater than 99.
