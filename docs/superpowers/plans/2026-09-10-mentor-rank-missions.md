# Mentor Rank Missions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete and verify mentor popularity badges, then deliver a tested reference and six-mission student scaffold.

**Architecture:** Existing SQL supplies match counts; Python sorts, ranks and assigns tiers. A separate local lesson server avoids the unrelated chat import failure, while the normal app also registers the new student router. The frontend consumes a shared cached ranking query through the authenticated gateway.

**Tech Stack:** Existing Python 3.12+, FastAPI, psycopg2, PostgreSQL, pytest, React, TanStack Query, TypeScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-10-mentor-rank-missions-design.md`

## Global Constraints

- Complete and live-test `Python/mentor_ranks.py` before moving it to `Python/mentor_ranks_answer.py` and recreating the student file.
- No automatic reference fallback. The student module is the default.
- No new runtime dependencies; use the existing PostgreSQL connection facilities and parameterized queries.
- Keep `Python/routers/chat.py` and all unrelated student files unchanged.
- Never reseed or mutate the user's product database. Use temporary PostgreSQL tables with rollback for fixtures.
- Preserve existing gateway quarantine, self-only rules and frontend release controls.
- Count only matched requests, crediting the author for mentor-authored requests and the matched user for mentee-authored requests.
- Include `mentor` and `both`; zero matches produce null rank/badge; positive ties use competition ranks.
- Public rows contain exactly mentorId, mentorName, matchedCount, rank, badge.
- Badge bounds: 1 Master; 10 Platinum; 100 Diamond; 500 Gold; 1000 Silver; 2000 Steel; 5000 Bronze; 10000 Mud; above 10000 none.

### Task 1: Completed ranking module and real lesson server

**Files:** Modify `Python/mentor_ranks.py`, `Python/main.py`; create `Python/mentor_ranks_server.py`, `tests/test_mentor_ranks.py` and a focused HTTP smoke check if useful.

**Interfaces:** Produces `rank_data()`, `sort_mentors(mentors)`, `assign_ranks(mentors)`, `badge_for_rank(rank)`, `list_mentor_ranks(request)`, `get_mentor_rank(mentor_id, request)`, and `router`. Raw rows have id/name/matched_count; ranked rows add rank. HTTP shapes and paths are in the spec. The lesson server exposes `create_app(answer=False)` and CLI `--answer`, `--port` (default 8001), binding loopback. Reference mode may explicitly error until Task 3 creates the reference; it must not silently use student code.

- [x] Write tests with literal expected ranks and badge thresholds. For example:
  ```python
  rows = [{"id": 3, "name": "C", "matched_count": 3},
          {"id": 2, "name": "B", "matched_count": 5},
          {"id": 1, "name": "A", "matched_count": 3},
          {"id": 4, "name": "D", "matched_count": 1},
          {"id": 5, "name": "E", "matched_count": 0}]
  result = ranks.assign_ranks(ranks.sort_mentors(rows))
  assert [(r["id"], r["rank"]) for r in result] == [(2,1),(1,2),(3,2),(4,4),(5,None)]
  assert ranks.badge_for_rank(10) == "Platinum"
  assert ranks.badge_for_rank(11) == "Diamond"
  assert ranks.badge_for_rank(None) is None
  ```
- [x] Run `.venv/bin/python -m pytest -q tests/test_mentor_ranks.py` and record failure due to the unfinished module.
- [x] Implement the minimal module, with documented provided helpers. SQL aggregates via CASE on request role and a LEFT JOIN so zero-count mentors remain. Python uses `sorted(rows, key=lambda r: (-r['matched_count'], r['id']))`, then enumerate from 1 with the prior positive count to implement competition ranks. Format only the five public keys. Authenticate before querying. Use HTTPException for missing mentor and nonpositive IDs; schema validation may handle typed path errors.
- [x] Implement the lesson app/CLI using existing auth/session patterns and dotenv loading. Register student router in main.py. Keep the unrelated broken chat unchanged.
- [x] Verify real SQL via opt-in `MENTOR_RANKS_TEST_DSN='dbname=postgres'` tests using temporary tables, including both role directions, both-role users and zero counts. Unit checks must not require a running DB. No httpx dependency is available; use real Uvicorn plus stdlib urllib for HTTP tests.
- [x] Start the completed student module's server. Log in with the existing local demo account, query list and single rank, check anonymous access and missing IDs. Record commands and counts without secrets. Do not rename yet.
- [x] Commit only Task 1 files and report exact test/live results.

### Task 2: Profile and recommendation badges through the gateway

**Files:** Create `artifacts/peerbridge/src/components/MentorRankBadge.tsx` and, if helpful, `artifacts/peerbridge/src/lib/mentor-ranks-api.ts`; modify `pages/Profile.tsx`, `pages/Recommendations.tsx`, `artifacts/api-gateway/src/gateway.ts`; add focused gateway tests.

**Interfaces:** Consumes `GET /api/mentor-ranks` returning `Array<{mentorId:number,mentorName:string,matchedCount:number,rank:number|null,badge:string|null}>` or the scaffold TODO envelope. Produces `<MentorRankBadge mentorId={id} />`. GET `/api/mentor-ranks/{positive integer}` also needs authenticated gateway forwarding; no write verbs, request bodies or arbitrary descendants.

- [x] Write and run failing gateway behavior tests: authenticated list/single queries forward; anonymous calls fail; invalid IDs and write methods do not gain access. Reuse the existing test-server conventions. Preserve query and body policy defaults unless explicitly needed; these APIs require no query parameters.
- [x] Add only the two read-only session-authenticated route policies. Keep all existing quarantine and profile restrictions.
- [x] Implement a query keyed by `['mentor-ranks', user.id]`, enabled only for a logged-in user, with shared caching. Select the mentor by ID and return null on pending/error/TODO/null badge/missing user. Render a small tier label and readable title, using server rank and count; never recalculate the badge in TypeScript.
- [x] Add the badge next to `{user.name}` in Profile and `{m.mentorName}` in Recommendations. Keep recommendation match rank separate. Do not change release flags.
- [x] Run gateway covering tests and frontend `pnpm --filter @workspace/peerbridge typecheck` and build. Visually verify the profile badge against the live completed backend. Recommendations may retain an unrelated quarantined data source; inspect component integration and record that constraint if live page data is unavailable.
- [x] Commit only Task 2 files and report exact validation results.

### Task 3: Reference rename, six-mission scaffold and lesson documentation

**Files:** Move completed `Python/mentor_ranks.py` to `Python/mentor_ranks_answer.py`; recreate `Python/mentor_ranks.py`; update `tests/test_mentor_ranks.py`; create `docs/STUDENT_MENTOR_RANKS_GUIDE.md`; update `Python/README.md` with a link and run commands. Add dedicated student checks if they improve usability.

**Interfaces:** Preserve all Task 1 signatures/router paths in both files. Default lesson server/main import the student. `--answer` must load the reference explicitly. The finished reference contains the verified Task 1 algorithm unchanged unless a newly reproduced defect requires a fix.

- [x] Verify Task 1 report contains a successful real server run BEFORE renaming. Add a failing check that a default scaffold request will return a safe mission envelope, then rename the verified module.
- [x] Keep working helpers above all six missions. Document purpose, inputs, returns, usage example and mission/step for each helper. Use `_todo` responses instead of SyntaxError, pass or NotImplementedError.
- [x] Mission 1: describe SQL aggregation and role attribution; Mission 2: descending counts and stable ID tie order; Mission 3: ranks 1,2,2,4 and zero handling; Mission 4: scan the given threshold table; Mission 5: authenticate, compose Missions 1–4, format the list; Mission 6: authenticate, locate one mentor, return 404 if absent. Every mission contains ordered TODO steps, literal input/output examples, edge cases and a runnable verification command. Do not import or call the answer from the exercise.
- [x] Test the reference by default in the checked-in suite. Support running the same meaningful checks against the student via `MENTOR_RANKS_MODULE=mentor_ranks` and provide mission-based selection commands. Scaffold baseline checks verify safe import and TODO/auth responses separately so an intentionally unfinished exercise does not make the project test command fail.
- [x] Write the student guide with the data model, six mission checklist, helper map, tier boundaries, local server commands, explicit answer selection, curl/login examples, and restart instructions. Explain that counts represent matches, not confirmed completed lessons; closed requests do not count under this exercise's chosen metric.
- [x] Run reference checks, PostgreSQL checks, live default student TODO checks and live `--answer` checks. Ensure the UI hides missing student badges without crashing. Record server URLs and meaningful test evidence.
- [x] Commit only Task 3 files and report results.

## Final controller verification

- [x] Review the whole feature, fix actionable findings, and run covering checks for any fixes.
- [x] Stop task-owned servers, transfer only the verified feature files into the original project checkout while preserving its branch and concurrent chat work, and restart the student lesson server there for the user.
- [x] Deliver student/reference/guide file links, test outcomes, run commands and the unchanged chat limitation. Do not claim the root main.py startup issue was fixed.

## Verification record

- The completed module was live-tested before rename: authenticated PostgreSQL-backed list returned501 mentors; independent SQL totals matched; mentor523 had3matches, rank1, Master. The answer file is byte-identical to that verified module.
- Final Python reference and scaffold checks with temporary PostgreSQL tables:39passed. Student mission checks intentionally fail until the exercise is solved; the guide separates mission grading from the original TODO-state checks.
- Gateway tests:16main +8shield passed. Frontend typecheck and build passed, with the existing nonfatal tooltip sourcemap warning.
- Actual browser verification after rename: default student mode shows the profile safely with no badge; explicit answer mode shows MASTER and the correct rank/count; neither mode logged browser errors or warnings.
- Existing chat import/dependency failure and recommendation API quarantine are unchanged. The dedicated lesson server supports the verified profile flow.

## Delivery verification

- Whole-feature review and scoped documentation re-review passed with no outstanding findings. The Mission6 zero-match regression was also verified against an intentionally wrong404 implementation.
- Original-checkout Python/PostgreSQL verification after transfer:39passed. A second focused gateway run after concurrent chat gateway edits:4passed. Those concurrent changes were preserved.
- All feature files matched the reviewed source at transfer. The only later shared-file difference was additional chat handling in gateway.ts from the concurrent task; ranking policy tests still passed.
- Student backend runs on127.0.0.1:8001; both /api/healthz and /docs returned200. Original-checkout profile rendered without a badge as expected for TODO mode and logged no browser errors/warnings. Gateway8080 and frontend5173 were launched with the guide's explicit upstream and pnpm dependency-check setting.
- Delivery preserves the originalmain branch and leaves this feature's changes uncommitted in that checkout, alongside the ongoing chat work. The separately committed codex/mentor-rank-missions branch retains the reviewed implementation.
