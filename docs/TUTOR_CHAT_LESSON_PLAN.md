# Tutor Lesson Plan — Chat Backend (5 sessions)

Companion to `docs/STUDENT_CHAT_BACKEND_GUIDE.md`. The student implements
`Python/routers/chat.py`; the schema, seed data, frontend widget, and API
contract already exist on this branch. Nothing in the scaffold gives away
mission solutions — the stubs contain step comments, the guide contains query
skeletons with blanks.

**Scaffold invariants to preserve while teaching:**
- Don't commit solutions into `Python/routers/chat.py` yourself; the student's
  branch/PR should carry them.
- The seed plants one soft-deleted room message (id 9) and one soft-deleted DM
  (id 7) as traps for the `deleted_at IS NULL` filter — don't spoil them; let
  the widget reveal the mistake.
- The student practice files (`Python/analysis.py`, `scheduling.py`,
  `find_matches.py`, `get_users.py`, `get_questions.py`, `get_blocks.py`,
  `reports.py`) stay untouched by this project.
- If the student gets stuck on plumbing (venv, reseeding, ports), fix plumbing
  together fast — the learning budget belongs to SQL/HTTP/WS concepts.

---

## Lesson 1 — Modeling conversations + first endpoint (Missions 1)

**Objectives:** read an unfamiliar schema; explain FK relationships; write the
first authenticated endpoint.

**Prep:** reseed the mock DB; both servers run; open the widget to show the
practice-task notice (that notice is the lesson's villain).

**Agenda:**
1. *Warm-up (10 min):* "What has to be true for a chat message to survive a
   server restart?" — draw out persistence vs memory.
2. *Schema tour (20 min):* student reads `003_chat_learning_schema.sql` aloud
   table by table and predicts what each column is for; whiteboard the ERD.
   Probe: why `district_id NULL` for global? why `deleted_at` instead of
   `DELETE`? what does `UNIQUE (type, district_id)` *not* prevent? (NULLs —
   show the partial index comment.)
3. *psql exploration (15 min):* student writes SELECTs live — count rooms,
   find their own district's room, find who wrote chat message 3 (their first
   JOIN of the day).
4. *Router anatomy (15 min):* walk `routers/auth.py` `me()` end to end:
   session → query → camelCase dict. Then read the Mission 1 stub comments.
5. *Mission 1 (rest of session):* student drives; you only ask questions.
   Checkpoint: Global + My School tabs light up in the widget; anonymous curl
   returns 401.

**Homework:** finish Mission 1 if incomplete; write three SELECTs joining
`chat_messages` to `users` (bring them to Lesson 2).

**Assessment questions:** What's the difference between 401 and 403? Why does
the JSON say `districtId` but the column `district_id`?

---

## Lesson 2 — Reading and writing history (Missions 2 + 3)

**Objectives:** JOIN + ORDER BY + LIMIT for history; input validation; INSERT
… RETURNING; status codes.

**Agenda:**
1. *Warm-up (5 min):* review homework JOINs.
2. *Mission 2 (40 min):* student implements history. When the trap message
   ("…your query forgot WHERE deleted_at IS NULL") appears in the widget,
   resist explaining for a minute — let them read the message itself.
   Checkpoints: room 1 shows exactly 4 messages; room 3 as user 1 → 403.
3. *Validation discussion (10 min):* "What's the worst thing a user could put
   in the message box?" → empty strings, 10 MB of text, `'); DROP TABLE` —
   lands on parameterized queries and length limits.
4. *Mission 3 (30 min):* implement send. Checkpoint: message survives a server
   restart; empty body → 400; response is 201 with the created row.

**Homework:** Missions 2–3 polished; stretch: add a `limit` query parameter to
Mission 2.

**Assessment:** Why must the INSERT use `%s` placeholders? Why return the
created message instead of just `{"ok": true}`?

---

## Lesson 3 — Going real-time (Mission 4)

**Objectives:** articulate REST vs WebSocket; manage connection state; write
an async receive/broadcast loop.

**Agenda:**
1. *Warm-up (10 min):* open two windows on the room tab; send a message; count
   the seconds until the other window polls it. "How does Discord make that
   instant?"
2. *Concept (15 min):* letters (request/response) vs phone call (open line).
   Key insight to land: **the server can't speak first over REST.** Sketch the
   registry: `{room_id: [sockets]}` on the whiteboard; walk connect → loop →
   broadcast → disconnect.
3. *Mission 4 (50 min):* build it in stages, testing after each: (a) accept +
   echo to yourself; (b) registry + broadcast to everyone; (c) persist via
   Mission 3 logic before broadcasting; (d) disconnect cleanup — kill a window
   mid-chat and watch the crash, *then* fix it with try/finally (the crash is
   the lesson).
4. *Checkpoint:* two windows chat live; refresh still shows history (REST and
   WS agree because both hit the same table).

**Homework:** none new — write up "what happens, step by step, when user A
sends 'hi' and user B sees it" in their own words (great retention check).

**Assessment:** Why do we still save to Postgres when we have WebSockets? What
happens if a socket isn't removed from the registry?

---

## Lesson 4 — Private messages (Missions 5, 6, 7)

**Objectives:** OR-side lookups; the unordered-pair problem; authorization as
distinct from authentication.

**Agenda:**
1. *Warm-up (5 min):* "How is a DM different from a room with two people?"
   (mostly: *who is allowed in* is data, not a district rule).
2. *Mission 5 (25 min):* conversation list. Checkpoint: user 1 sees Sophia +
   Jordan; user 501 sees only Alex.
3. *The pair puzzle (15 min):* whiteboard `(1,501)` vs `(501,1)`. Let the
   student propose fixes before naming LEAST/GREATEST canonical ordering.
4. *Mission 6 (25 min):* get-or-create. Checkpoint: double-POST creates one
   row.
5. *Mission 7 (30 min):* thread GET/POST. Spend real time on the participant
   check — have the student *prove* privacy by attacking their own endpoint as
   user 951 (expect 403). Optional stretch: read receipts via `read_at`.

**Homework:** finish Mission 7 incl. the soft-delete trap DM; stretch: block
check in Mission 6 using the `blocks` table.

**Assessment:** Authentication vs authorization — which check is which in
Mission 7? Why is `WHERE user_a_id = %s OR user_b_id = %s` not enough on its
own in Mission 6?

---

## Lesson 5 — DM sockets, polish, and debugging (Mission 8 + hardening)

**Objectives:** transfer Lesson 3's pattern to a new context with authz;
systematic debugging; honest self-review.

**Agenda:**
1. *Mission 8 (35 min):* student should need little help — it's Mission 4 +
   Mission 7's participant check. Insist the check happens *before* data
   flows; user 951's connection to conversation 1 must be closed immediately.
2. *Break-it hour (30 min):* you attack, student defends. Script: anonymous
   curls on every endpoint (all 401?); non-participant DM reads (403?);
   empty/whitespace/oversized bodies (400?); double dms/start; does the trap
   message stay hidden everywhere? File anything that slips through as a
   bug the student fixes on the spot.
3. *Definition-of-done walkthrough (15 min):* go through the checklist at the
   end of the student guide together, checking items honestly.
4. *Retro (10 min):* what would production chat still need? (pagination,
   rate limiting, multiple server processes → the registry breaks → pub/sub
   like Redis; unread badges; typing indicators.) Good bridge to a follow-on
   project if momentum is high.

**Assessment (course-level):** Explain the whole journey of a DM from textarea
to the other person's screen, naming every table and protocol involved.

---

## If the pace is off

- **Faster student:** pull stretch goals forward (read receipts, unread counts
  in Mission 5, block checks, a `limit` param) — the frontend already renders
  the required contract, so extra fields are backend-only wins; or have them
  upgrade the widget to consume their WebSocket.
- **Slower student:** Missions 4 and 8 are the compressible ones — a chat that
  works over polling REST is a complete, honest milestone; sockets can be a
  bonus week. Never compress Mission 7's participant check.
