# Mentor rank badges and student missions

Approved in conversation: matched-request popularity, Python ranking, reference-first verification, six student missions, and profile/recommendation badges. The user's `yes` authorizes implementation of this design.

## Outcome and sequence

1. Complete `Python/mentor_ranks.py` and run its real HTTP server against local PostgreSQL.
2. Connect badges beside names on Profile and Recommendations.
3. Only after the completed module has passed live verification, move it to `Python/mentor_ranks_answer.py` and recreate `Python/mentor_ranks.py` as the student exercise.
4. Verify the reference still works and the student server safely returns explicit mission responses. No automatic reference fallback.

## Ranking contract

- Include current users whose role is `mentor` or `both`, including zero-match users.
- Count requests with `status = 'matched'` and a non-null `matched_user_id`.
- If request `role = 'mentor'`, credit `author_id`; if `role = 'mentee'`, credit `matched_user_id`.
- Do not create a `mentored_count` column or persist calculated badges. Recompute from existing data.
- Sort by descending match count, then ascending user ID for stable ordering.
- Positive equal counts share competition ranks: counts 5, 3, 3, 1 give ranks 1, 2, 2, 4. Zero counts have `rank = null` and `badge = null`.
- Badge upper bounds: 1 Master; 10 Platinum; 100 Diamond; 500 Gold; 1000 Silver; 2000 Steel; 5000 Bronze; 10000 Mud. A rank above 10000 has no badge. Preserve the original project's tier order.
- A tied rank gets the same badge, even if the tied group straddles a tier boundary.

## Python interfaces and endpoints

The reference and scaffold have identical function names and signatures:

```python
rank_data() -> list[dict]                         # id, name, matched_count
sort_mentors(mentors: list[dict]) -> list[dict]    # do not mutate caller input
assign_ranks(mentors: list[dict]) -> list[dict]    # sorted input; adds rank
badge_for_rank(rank: int | None) -> str | None
list_mentor_ranks(request: Request) -> list[dict]
get_mentor_rank(mentor_id: int, request: Request) -> dict
```

The scaffold mission functions return the documented TODO envelope until implemented.

- `GET /api/mentor-ranks` returns all mentor rows, including unranked rows.
- `GET /api/mentor-ranks/{mentor_id}` returns one row; a missing/non-mentor ID returns 404, nonpositive IDs return 422.
- Both endpoints require a session (401 without login).
- Each response row is exactly `{mentorId, mentorName, matchedCount, rank, badge}`. No emails or other private user data.
- Student response: `{status: 'todo', mission: number, message: string, guide: 'docs/STUDENT_MENTOR_RANKS_GUIDE.md'}`.
- Use existing PostgreSQL connection handling and parameterized queries, with no new runtime dependencies.

## Runtime

`Python/mentor_ranks_server.py` is the lesson entrypoint. It loads existing `.env` configuration, provides real session-based login using the existing auth router, and mounts the selected rank router. It also mounts the existing users/matches/practice routes needed by the local learning UI if needed; no chat import. The existing chat module has an unrelated import error and must remain untouched.

- `python Python/mentor_ranks_server.py --port 8001` runs the student module by default.
- `python Python/mentor_ranks_server.py --answer --port 8001` explicitly selects the reference after it exists.
- Bind the lesson CLI to `127.0.0.1`. Require configured DATABASE_URL and SESSION_SECRET; never print their values.
- Register the student rank router in normal `Python/main.py` too; this does not claim to repair the pre-existing chat startup error.
- Add exactly the authenticated, read-only rank routes to the existing API gateway. Preserve quarantine and self-only rules for all unrelated routes.

## UI

A shared `MentorRankBadge` component uses a cached ranking-list query, keyed to the logged-in user, and displays the server-provided tier beside Profile and Recommendations names. It does not calculate rankings or load the answer module. Hide the badge while loading, on error, for a TODO response, for non-mentors, or when the badge is null. Include a readable title describing rank and matched requests. Preserve existing release controls.

## Student exercise

Six missions: database aggregation; sorting; competition ranking; badge mapping; list API; single-mentor API.

Provide working helpers at the top for authentication, SQL execution, response formatting and TODO responses. Each helper explains purpose, arguments, return value, a usage example, and the exact mission/step that consumes it. Core ranking solutions remain in the answer file, never imported by the scaffold.

Each mission includes Definition/Goal, ordered TODO steps, helper references, literal examples, edge cases and runnable checks. Use English code comments consistent with existing chat materials. The user-facing delivery can be Korean. Write a student guide with commands, API examples, tier table, milestones and troubleshooting. Include the critical instruction that the server must be restarted after editing when not run with reload.

## Verification

- Tests precede implementation; record the expected initial failure.
- Hand-derived fixtures exercise ties, zero counts, all tier boundaries, both request directions, `both` users, excluded statuses, empty results and authentication/404 behavior.
- PostgreSQL tests use connection-local temporary tables and rollback; never reseed or mutate the user's product database.
- Start a real Uvicorn server and log in over HTTP. Verify live ranking responses against independently queried aggregate data before moving the reference file.
- After scaffolding, verify default student TODO responses and explicit answer mode again.
- Typecheck/build the frontend and verify badges with the running UI. Test the gateway's two new route policies and retain existing boundary tests.
- Report existing unrelated chat/test failures separately from this task's checks.
