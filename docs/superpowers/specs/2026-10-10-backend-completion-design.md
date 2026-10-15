# Backend reliability and completion design

## Intent and evidence

The user requested a plan addressing all nine findings and the unfinished features in the October 10 backend audit. The user selected latest GitHub `main`, then explicitly chose **event tracking for accurate future analytics, without invented historical data**. This document proposes the remaining implementation decisions for review; it does not authorize deployment or claim implementation is complete.

Audited revision: `1dfef50bfbfa39c262f5f3a31b3d0f266bae2242`. PR #20 (`b9300773370ddb390daee72d1341fb33e665d691`) remained open when this design was written. The local checkout is older; execution must start from current remote main in an isolated checkout, not assume the local files contain PR #19.

Evidence: 55 backend Python files inspected; 144 default tests passed with disposable PostgreSQL; student-selected rank tests had 41 passes and three Mission 6 failures. Real gateway tests reproduced the oversized request feed, blocked recommendations, invalid-input 500s, nullable-bio failure, incorrect district filtering and statistics. Concurrent DM creation produced 200/500. A DM history of 2,191,182 bytes exceeded the gateway's 2,097,152-byte ceiling. Concurrent module imports produced two failures in 4,000 calls using 20 workers.

## Delivery structure and boundaries

Three independently verifiable delivery stages are recommended: (A) product API/chat reliability; (B) event tracking and completed learning modules; (C) whole-server acceptance and release documentation. They may be separate PRs. One coordinated implementation plan records their shared schema, API and test-fixture decisions.

Keep FastAPI, psycopg2/psycopg, PostgreSQL, the TypeScript gateway, React and existing generators. No queue, ORM replacement, new service, geocoder, generic plugin system or production fallback algorithm is needed. Student modules are now explicitly in scope to complete; older comments saying they must never be edited do not override this request. Preserve their useful interfaces and update their guides.

Do not reactivate legacy `artifacts/api-server/python`, the root greeting script, or the unused spam experiment. Do not import answer keys into the runtime. Mentor ranking remains available through the lesson server: public rank routes/profile badges are a separate product integration and are not required by this remediation.

## Global constraints

- Target Python 3.12+, PostgreSQL 16, Node 24.21.0 and pnpm 10.33.0; retain the repository's pinned uv tooling.
- Keep one Python worker and one gateway process for the documented approximately 20-user classroom deployment.
- Keep Python private on loopback; preserve gateway authentication, Origin checks, redaction, rate limits and the 2,097,152-byte response ceiling.
- Use configured database connections, parameterized SQL and existing transaction helpers; no hardcoded database hosts.
- Tests use disposable databases and synthetic accounts only; never reseed, migrate or repair a populated user database during development.
- Never edit checksum-pinned migrations 0001/0002; add the next migration and regenerate the canonical schema/catalog through the existing process.
- No new production dependency is required; align the uv test environment with the already-required psycopg driver.
- Preserve successful completed lessons and existing authentication/blocking fixes; never restore them to TODO states.
- UI copy stays English; retain keyboard access, loading/error states and accurate empty-state messages.
- A green health check or HTTP 200 failure envelope is not feature completion. Required success paths must use real module results.

## A. Product API and chat contracts

### A1. Bounded requests without silently losing older results

New and updated request titles must contain non-whitespace text and be at most **200 UTF-8 bytes** before trimming; descriptions follow the same rule with **4,000 UTF-8 bytes**. Reject oversized/blank values with 422 in Python. Browser validation must use byte length, not JavaScript string length. Keep the public response an array.

`GET /api/requests` adds `limit` (default/max 50, minimum 1) and `before` (optional cursor, maximum 96 characters). A cursor is `<timezone-aware ISO-8601 createdAt>|<positive decimal id>`, encoded normally by URLSearchParams. Python rejects malformed cursors with 422; the gateway rejects invalid query syntax with 400. Match endpoints retain their separate 1–20 limit.

Apply district/role/status/tag filters in SQL, including tag filtering with EXISTS, before cursor/limit. Order by `(created_at DESC, id DESC)` and select strictly older tuples for the next page. A concurrently inserted newer row must not duplicate or displace rows on the next older page. The UI exposes older/newer page controls, resets cursors on filter changes, and says how many requests are **shown**, not a fabricated total. Dashboard explicitly asks for its small preview (five); district pages support paging too.

Already stored oversized rows must not keep poisoning list responses. Bound title/description **list previews** to the same byte ceilings without splitting a Unicode code point; add `descriptionTruncated: boolean` to distinguish a preview. Do not rewrite stored rows. Keep detail reads intact; document an operator inspection/repair path for legacy single rows too large for the transport ceiling rather than raising the ceiling or silently editing data. Public contract, OpenAPI, generated clients, RequestCard and all list callers change together.

### A2. Blocking in recommendations

`get_blocks.receive_block_data() -> list[tuple[int, int]]` reads the configured product `blocks` table. Matching applies both directions before scoring/limiting. A lookup failure returns `success: false`, `matches: []`, and `status: "database error"`; it must never become an empty block set. A failed lookup must not be described as successful matching. Preserve parameterized reads and existing role selection in the matcher.

### A3. DMs

Conversation creation keeps its current response shape/status 200. A new canonical pair is inserted with `ON CONFLICT (user_a_id, user_b_id) DO NOTHING RETURNING id`; a losing transaction reselects the committed row. Preserve membership and pair-block checks. Two successful simultaneous starts must return the same ID, with one database row.

DM history returns the **latest 50 visible messages**, sorted for display by `(created_at, id)` ascending, matching room-history behavior. Select newest 50 first, reverse the bounded result, and mark only returned incoming messages read. Preserve prior read timestamps. Do not load or mark an entire conversation before selecting the window. No pagination or new endpoint is needed in this stage; show “Latest 50 messages” when the window is full. Historical storage remains intact.

### A4. Input and small product fixes

- Request role: `mentor|mentee`; status: `open|matched|closed`; positive district/tag/resource IDs; at most 20 unique tag IDs. Reject malformed bodies with 422 and missing referenced district/tag/target with 404. Reject self-reports with 400. Translate expected concurrent foreign-key failures narrowly; never blanket-catch SQL failures as user mistakes.
- Only the Connect endpoint can transition a request into `matched`. PATCH may retain an already-matched state but cannot manufacture a new match; reject that transition with 409. Explicit reopen clears `matched_user_id`; update timestamps on real state changes. Preserve ownership checks and the current row lock when matching.
- Explicit `bio: null` clears the biography; omitted bio leaves it unchanged; `bio: ""` remains a valid empty biography.
- District type filtering works for both currently supported public types: `high_school` and `unified`.
- District popular tags count associations only for requests in that district; omit zero-count tags and order count descending, tag ID ascending. Global tags use the same ordering without the district restriction.

### A5. Module-loading boundary

Serialize cache invalidation, `sys.modules` removal and import with one module-level reentrant lock. Release the lock before running student code or database queries. Preserve development reload behavior and module allowlisting. As part of this boundary fix, catch expected normalization conversion failures and return the existing invalid-output envelope; zero values and empty valid arrays remain successes. Unexpected infrastructure failures must remain diagnosable, not become fake data.

## B. Real future analytics

### B1. Persist observed match events

Add migration `0003_request_events.sql` if 0003 is still free; otherwise use the next ledger sequence consistently. Introduce **one** `request_events` table:

| Column | Contract |
| --- | --- |
| `id` | BIGSERIAL primary key |
| `kind` | TEXT NOT NULL, `tracking_started` or `matched` |
| `occurred_at` | TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() |
| `request_id` | nullable INTEGER FK requests(id), ON DELETE SET NULL |
| `mentor_id` | nullable INTEGER FK users(id), ON DELETE SET NULL |
| `request_created_at` | nullable TIMESTAMPTZ; required for matched events |

Use a partial unique index for the singleton `tracking_started` marker, and an index on `(kind, occurred_at, id)`. Insert the marker when the migration is applied. Matched events contain the request's existing creation time and the mentor identity determined from request role: mentor-authored → author; mentee-authored → matched user. No request text, email or names are copied into the event table. Deleting a request must not erase observed aggregate history.

Inside the existing locked Connect transaction, write exactly one event **after a successful open→matched transition and before commit**. A failed/lost match produces no event. Rollback removes both state change and event. Reopening and matching later produces another real event; it does not rewrite the earlier one. Reads/PATCH retaining the same state create no match event. Historic already-matched rows produce no fabricated events.

The measured interval is explicitly **time from request creation to each observed match**, including any time closed before reopening. It is not a mentor's reply time. Use the DB timestamp for the event; reject negative measured intervals from aggregates as unknown rather than presenting negative durations.

Keep readiness tied to the new schema version. Rollout order is backup/dry-run → additive migration → backend → client, with Connect writes paused from migration until the event-writing backend is healthy so the tracking marker cannot imply coverage from older code. Rolling back code leaves the additive table and history intact; never downgrade by deleting events. If reverting to code that cannot record events, keep Connect writes paused until tracking is restored rather than silently introducing an observation gap. Existing operator approvals remain required when later deploying, not during plan drafting or disposable tests.

### B2. Analytics values and presentation

- `analysis.receive_weekly_matches() -> list[dict]`: eight UTC calendar weeks ending with the current week, Monday starts, ascending. Each row is `{week: "YYYY-MM-DD", matches: int|null, coverage: "untracked"|"partial"|"complete"}`. Count observed matched events. A week entirely before tracking has null, not zero; the boundary week is partial when tracking began after its Monday midnight. Complete means tracked for the whole elapsed portion of the week; the current week is explicitly week-to-date, not a prediction. Zero-fill only tracked periods.
- `analysis.receive_most_popular_subject() -> list[dict]`: top ten tags by number of associated current requests, descending count then tag ID; return `{subject, requests, color}`. Empty input returns `[]`. This is request demand, independent of event tracking.
- Keep the public `/api/analytics/mentor-response-rates` URL for compatibility, but change its documented data to `{trackingStartedAt: str, mentors: [{mentorId, mentorName, totalMatches, avgTimeToMatchHours: float|null}]}`. `analysis.receive_mentor_ranks() -> dict` supplies that data from events for current mentor/both users; include zero-match mentors, order totalMatches descending then ID. No personal response rate is calculated because there is no targeted invitation/response model.
- Change the view label to **Mentor matching activity** and the duration label to **Average time from request creation to match**. Explain that only activity observed after tracking started is counted. Render null as “No observed matches”; never turn missing historical information into zero. Keep `response_time_analysis()` as a compatibility accessor for the same observed duration data, with documented return shape equal to the activity payload.
- Adapters only validate/format these module results; no invented fallback analytics. Update UI types and the documented public data schemas together.

## C. Complete the remaining learning functions

### Scheduling

`receive_time_data() -> list[dict]` returns unique-user availability counts from `users.available_times`, as `{slot, count}`, ordered Monday–Sunday then hour. `time_dict(student: dict, teacher: dict) -> list[str]` returns the sorted unique intersection of their `available_times`; null/missing lists mean empty. Valid slots are exactly `Ddd HH:00`, e.g. `Mon 17:00`; invalid stored slots are excluded and tests cover that decision. Do not infer a date, timezone conversion or booking from weekly wall-clock labels. Missing requested users remain 404.

### Reports and block status

`reports.signup_summary() -> dict[str,int]` returns `today`, `thisMonth`, `thisYear`, `total` from one aggregate using UTC calendar boundaries. `daily_count()`, `monthly_count()`, `yearly_count()` remain callable compatibility wrappers. The adapter calls the full summary once and reports `source: "student-module"` on success; database failure is explicit, not fallback success.

`get_blocks.count_blocks(blocks_data) -> dict[int,int]` counts distinct blockers per blocked user. `get_blocks.get_flagged_users() -> list[dict]` owns the existing reports/blocks aggregation previously in the adapter; preserve field names and the gateway's privacy projection. Existing 1/3/5 report thresholds are teaching labels, not account suspension. Clarify the UI's `banned` label as a recommended review state; do not add automatic bans or claim an account was suspended. The adapter uses real module output instead of always returning fallback data.

### Locations

Create the missing `locations.location_data(student: dict, mentor: dict, question: dict) -> dict`. Return `{compatible: bool, overlap: list[str]}` from trimmed/case-folded location-label intersection; accept `locations: list[str]` or a single `location: str`, prefer the list when present. Missing values mean no overlap. Reject malformed supplied values via ValueError; existing integration code turns this into its failure envelope. Preserve the third parameter for the current practice caller, without inventing geographic meaning for `question.subject`. No coordinates, distance estimation or external service.

### Mentor rank Mission 6

Recheck PR #20 at execution time. If merged, retain it and verify. If still open, implement its already-reviewed global-rank lookup once on the execution branch or coordinate integration without merging/pushing unasked. The student-selected suite must pass all missions against PostgreSQL; keep the answer key independent and preserve lesson-only routing.

## Acceptance and exclusions

Normal synthetic flows must succeed through the actual gateway: register/login/logout, profile read/edit/clear, request browse/page/filter/create/edit/delete/match, report/block/unblock, room/DM REST and WebSockets, matching, analytics, scheduling, reporting, moderation summary and location test. Zero data is valid successful data, not a reason to select fallback. Student rank endpoints are tested through the lesson server separately.

All nine audit regressions need permanent tests. The release gate must run the real student module checks as well as reference checks, require canonical-schema DB tests without skips, and exercise real gateway/Python composition (not only browser interception). Source compilation must find no syntax errors in active backend modules. Keep old lesson failure simulations as injected tests; do not require the actual files to remain broken.

Production hosting, credentials, account suspension policy, historic event reconstruction, multiworker broadcasting, full-text history pagination and legacy backend activation are outside this implementation. Document these bounds; do not call a local run proof of production deployment.
