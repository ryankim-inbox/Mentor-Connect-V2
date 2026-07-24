# Build the PeerBridge Chat Backend — Student Guide

You are going to build a real chat feature: a global room everyone can talk
in, a room for your school district, and private one-on-one messages.

**The frontend is already done.** Log in to the app and click the round chat
button in the bottom-right corner. Every tab currently shows *"Chat backend is
a Python practice task"* — because the backend answers every request with:

```json
{ "status": "todo", "mission": 1, "message": "Student TODO: ..." }
```

Your job is to replace those placeholders, one endpoint at a time, in
**`Python/routers/chat.py`**. Each mission you finish makes part of the
chat popup come alive — no frontend changes needed. That's the reward loop.

---

## 1. How chat apps actually work

Three separate ideas combine into "real-time chat". Keep them apart in your
head and none of this is scary:

1. **Persistence (the database).** A message only "exists" once it is a row in
   a table. If the server restarts, the chat history survives because it lives
   in PostgreSQL, not in memory.

2. **REST API (request → response).** The browser asks (`GET /api/chat/rooms`)
   and the server answers once. This is exactly like every other endpoint in
   this project. A chat built only on REST already works — the frontend simply
   re-fetches every few seconds ("polling"). Ours does that for you.

3. **WebSocket (a phone call, not a letter).** With REST, the server can never
   speak first. A WebSocket is a connection that *stays open*, so the moment
   user A sends a message, the server can push it to user B without B asking.
   That push is what makes chat feel instant. Missions 1–3 and 5–7 are REST;
   Missions 4 and 8 upgrade rooms and DMs to WebSockets.

> Rule of thumb: **REST changes the database. WebSockets announce the change.**
> Even in Mission 4, every message still gets saved with the same logic you
> wrote for Mission 3.

## 2. The tables you'll be reading and writing

Created by `Python/migrations/003_chat_learning_schema.sql`, and already
seeded in your local `mentor_connect_mock` database:

```
chat_rooms                      chat_messages
─────────────                   ─────────────
id          SERIAL PK           id          SERIAL PK
type        'global'|'district' room_id     → chat_rooms.id
district_id → districts.id      sender_id   → users.id
            (NULL for global)   body        TEXT
name        TEXT                created_at  TIMESTAMPTZ
created_at  TIMESTAMPTZ         deleted_at  TIMESTAMPTZ (NULL = visible)

dm_conversations                dm_messages
─────────────                   ─────────────
id          SERIAL PK           id              SERIAL PK
user_a_id   → users.id          conversation_id → dm_conversations.id
user_b_id   → users.id          sender_id       → users.id
created_at  TIMESTAMPTZ         body            TEXT
                                created_at      TIMESTAMPTZ
                                read_at         TIMESTAMPTZ (NULL = unread)
                                deleted_at      TIMESTAMPTZ (NULL = visible)
```

Things worth knowing before you write queries:

* **Soft delete.** Nothing is ever `DELETE`d; a hidden message just has
  `deleted_at` set. Your history queries must filter with
  `WHERE deleted_at IS NULL`. The seed data contains one soft-deleted room
  message and one soft-deleted DM *on purpose* — if a message telling you that
  you forgot the filter shows up in the app, you forgot the filter.
* **One conversation per pair — but which order?** `(user_a=1, user_b=501)`
  and `(user_a=501, user_b=1)` are *different rows* to Postgres, so the
  `UNIQUE (user_a_id, user_b_id)` constraint alone can't stop a duplicate
  conversation in swapped order. Mission 6 makes you handle this.
* **Seeded demo data.** Room 1 is the global room; district rooms are
  `district_id + 1` (rooms 2–33). User 1 already has DM conversations with
  user 501 (conversation 1) and user 951 (conversation 2).

Explore it yourself:

```bash
psql mentor_connect_mock -c "SELECT * FROM chat_rooms LIMIT 5;"
psql mentor_connect_mock -c "SELECT * FROM chat_messages;"
psql mentor_connect_mock -c "SELECT * FROM dm_conversations;"
```

## 3. The endpoints you'll implement

| Mission | Method & path                            | What it does                             |
|--------:|------------------------------------------|------------------------------------------|
| 1       | `GET  /api/chat/rooms`                    | The rooms this user may chat in          |
| 2       | `GET  /api/chat/rooms/{room_id}/messages` | Message history for one room             |
| 3       | `POST /api/chat/rooms/{room_id}/messages` | Post a message into a room               |
| 4       | `WS   /ws/chat/rooms/{room_id}`           | Live push for a room                     |
| 5       | `GET  /api/dms`                           | This user's DM conversation list         |
| 6       | `POST /api/dms/start`                     | Start (or reuse) a conversation          |
| 7       | `GET/POST /api/dms/{conversation_id}/messages` | Read + send private messages        |
| 8       | `WS   /ws/dms/{conversation_id}`          | Live push for a conversation             |

All the REST responses use **camelCase** keys (`districtId`, `senderName`,
`createdAt`) because that's what the frontend — and this project's other
routers — use. The exact response shapes are documented per mission below and
in `lib/api-spec/openapi.yaml`.

## 4. Your toolbox

**Run everything:**

```bash
# 1. (Re)seed the local database — safe to repeat anytime you break data
dropdb --if-exists mentor_connect_mock
createdb mentor_connect_mock
psql -v ON_ERROR_STOP=1 mentor_connect_mock -f database/mentor_connect_mock_1000.sql

# 2. Backend (from the repo root)
cd Python
source ../.venv/bin/activate
python main.py                        # http://localhost:8000

# 3. Frontend (new terminal, repo root)
PORT=8080 BASE_PATH=/ pnpm --filter @workspace/peerbridge dev
```

**Code idioms to copy** (look at `Python/routers/auth.py` — it's short):

```python
# Who is logged in? (SessionMiddleware reads the browser cookie for you)
user_id = request.session.get("user_id")
if not user_id:
    raise HTTPException(status_code=401, detail="Not authenticated")

# Run a query (always %s placeholders — NEVER f-strings: SQL injection!)
with db() as conn:
    cur = conn.cursor()
    cur.execute("SELECT * FROM chat_rooms WHERE id = %s", (room_id,))
    row = cur.fetchone()          # rows behave like dicts: row["name"]

# Dates → JSON
"createdAt": row["created_at"].isoformat()
```

**Test like a pro — curl with a cookie jar.** Sessions live in a cookie, so
log in once with `-c` (save cookies), then call endpoints with `-b` (send
cookies):

```bash
curl -c /tmp/pb-cookies.txt -H 'Content-Type: application/json' \
     -d '{"email":"student001@test.edu","password":"Password123!"}' \
     http://localhost:8000/api/auth/login

curl -b /tmp/pb-cookies.txt http://localhost:8000/api/chat/rooms
```

Other useful tools:

* **FastAPI's built-in playground:** http://localhost:8000/docs
* **Browser DevTools → Network tab:** open the chat popup and watch the
  requests fire (this is the fastest way to see your real responses).
* **WebSocket quick test (browser console):**
  `new WebSocket("ws://localhost:8000/ws/chat/rooms/1").onmessage = e => console.log(e.data)`

---

## Mission 1 — `GET /api/chat/rooms`

**Goal:** return the rooms this user may join: the global room + their
district's room. When this works, the Global and My School tabs stop showing
the practice-task notice.

**Edit:** `list_chat_rooms()` in `Python/routers/chat.py`.

**Plan:**
1. Get `user_id` from the session (401 if missing).
2. Find the user's `district_id` (`users` table).
3. Select the global room and that district's room. One query can do it:

```sql
SELECT id, type, district_id, name
FROM chat_rooms
WHERE type = 'global' OR district_id = %s
ORDER BY id
```

4. Build the response list yourself (remember: camelCase keys).

**Expected shape:**

```json
[
  { "id": 1, "type": "global",   "districtId": null, "name": "Global Chat" },
  { "id": 2, "type": "district", "districtId": 1,    "name": "Fremont Union High School District Chat" }
]
```

**Test:**
```bash
curl -b /tmp/pb-cookies.txt http://localhost:8000/api/chat/rooms
curl http://localhost:8000/api/chat/rooms        # no cookie → must now be 401!
```
That second line is important: before this mission the placeholder answered
everyone; your version must answer *only logged-in users*. The 401 is
progress, not a bug.

**Common mistakes:**
* Returning every room in the table (the user should only see *their* district).
* Renaming nothing: the DB column is `district_id`, the JSON key is `districtId`.
* Forgetting the user's district can be found with one extra query — or a JOIN
  if you're feeling fancy. Both are fine.

---

## Mission 2 — `GET /api/chat/rooms/{room_id}/messages`

**Goal:** message history, oldest → newest, with each sender's name. The room
tabs will start showing the seeded conversation.

**Edit:** `list_room_messages()`.

**Plan:**
1. Session check (401).
2. Load the room. No room → `404`. If `type = 'district'` and it isn't the
   user's district → `403` (they shouldn't read other schools' chat).
3. Query messages + sender names. Skeleton to complete:

```sql
SELECT m.id, m.room_id, m.sender_id, u.name AS sender_name, m.body, m.created_at
FROM chat_messages m
JOIN users u ON u.id = m.sender_id
WHERE m.room_id = %s
  AND ...            -- hide soft-deleted rows!
ORDER BY m.created_atd
LIMIT 50
```

4. Return the list (camelCase, `isoformat()` for the timestamp).

**Expected shape:**

```json
[
  { "id": 1, "roomId": 1, "senderId": 1, "senderName": "Alex Kim",
    "body": "Hi everyone! First message in the global room.",
    "createdAt": "2026-07-01T16:00:00+00:00" }
]
```

**Test:** `curl -b /tmp/pb-cookies.txt http://localhost:8000/api/chat/rooms/1/messages`
— the seed has 4 visible messages in room 1 and 3 in room 2.

**Common mistakes:**
* Seeing 5 messages in room 1: you forgot `deleted_at IS NULL` (the seed
  plants a trap message that literally tells you this).
* Messages in the wrong order (the widget renders oldest at the top).
* Forgetting the JOIN and trying to send `sender_id` only — the frontend
  wants `senderName`.

---

## Mission 3 — `POST /api/chat/rooms/{room_id}/messages`

**Goal:** save a message. The input box in the room tabs starts working.

**Edit:** `send_room_message()` — the request body arrives already parsed as
`body.body` (a `SendMessageBody`).

**Plan:**
1. Session check (401).
2. Same room checks as Mission 2 (404 / 403). You've now written that logic
   twice — feel free to move it into a small helper function.
3. Validate the text: strip it; empty → `400`. Pick a max length (say 2000)
   and reject longer.
4. Insert and return the saved row in Mission 2's shape:

```sql
INSERT INTO chat_messages (room_id, sender_id, body)
VALUES (%s, %s, %s)
RETURNING id, room_id, sender_id, body, created_at
```

5. Return it with status code `201` (look at how `auth.py` sets
   `status_code=201` on the register route).

**Test:**
```bash
curl -b /tmp/pb-cookies.txt -H 'Content-Type: application/json' \
     -d '{"body":"My first stored message!"}' \
     http://localhost:8000/api/chat/rooms/1/messages
```
Then re-run the Mission 2 curl — your message must be there. Restart the
server and fetch again: *still* there. That's persistence.

**Common mistakes:**
* Trusting the client: always `body.body.strip()`, never assume it's clean.
* Building the INSERT with an f-string. Parameterized queries are
  non-negotiable.
* Returning nothing / `null` — the frontend uses the returned message.
* `senderName` missing on the response (you know the sender: it's the current
  user — one small lookup, or reuse your Mission 2 query for the new row).

---

## Mission 4 — WebSocket `/ws/chat/rooms/{room_id}`

**Goal:** two browser windows in the same room see each other's messages
instantly, without waiting for the 5-second poll.

**Edit:** `chat_room_socket()` — currently accepts, sends a TODO notice, and
closes. Note it's `async def` (WebSockets are asynchronous by nature).

**Plan (read the block comment in the file too):**
1. Keep a registry of open sockets per room at module level, e.g.
   `room_connections: dict[int, list[WebSocket]] = {}`.
2. On connect: check the session — `websocket.session.get("user_id")` works
   just like `request.session`. No user → `await websocket.close(code=4401)`.
3. `await websocket.accept()`, add the socket to the room's list.
4. Loop over incoming text (`async for text in websocket.iter_text():`):
   validate + save exactly like Mission 3, then send the saved message (as
   JSON) to **every** socket in that room's list — including the sender.
5. Wrap the loop so `WebSocketDisconnect` removes the socket from the
   registry (`try/except/finally`). If you skip this, the next broadcast
   crashes on a dead connection.

**Test:** log in as `student001@test.edu` in one window and
`mentor501@test.edu` (same district) in a private/incognito window. Browser
console in each:

```js
const ws = new WebSocket("ws://localhost:8000/ws/chat/rooms/1");
ws.onmessage = (e) => console.log("received:", e.data);
ws.onopen = () => ws.send("hello from the console");
```

**Common mistakes:**
* Forgetting `await websocket.accept()` first — nothing works without it.
* Broadcasting only to *other* sockets, so the sender never sees their own
  message confirmed.
* Not removing closed sockets → `RuntimeError` on the next broadcast.
* Skipping the save: if you only broadcast, the message vanishes on refresh.
  Persist first, then announce.

---

## Mission 5 — `GET /api/dms`

**Goal:** the DMs tab lists this user's conversations with real names.

**Edit:** `list_dm_conversations()`.

**Plan:**
1. Session check (401).
2. Find conversations where the user sits in *either* column:

```sql
SELECT c.id, c.user_a_id, c.user_b_id, c.created_at
FROM dm_conversations c
WHERE c.user_a_id = %s OR c.user_b_id = %s
ORDER BY c.created_at DESC
```

3. For each row work out the *other* participant (if `user_a_id` is me, the
   other is `user_b_id`, and vice versa) and fetch their name. In SQL a
   `CASE WHEN` + JOIN can do it in one go; doing it in Python is also fine.

**Expected shape:**

```json
[
  { "id": 1, "otherUserId": 501, "otherUserName": "Sophia Lee", "createdAt": "..." },
  { "id": 2, "otherUserId": 951, "otherUserName": "Jordan Park", "createdAt": "..." }
]
```

**Test:** as user 1 you must see exactly the two seeded conversations above.
Log in as `mentor501@test.edu` instead: they see one (with Alex Kim).

**Common mistakes:**
* `WHERE user_a_id = %s` only — you'll miss conversations where you're `user_b`.
* Returning your own name instead of the other person's.

---

## Mission 6 — `POST /api/dms/start`

**Goal:** the "Start a DM by user id…" box in the widget works — and never
creates duplicate conversations.

**Edit:** `start_dm_conversation()` — the target arrives as `body.toUserId`.

**Plan:**
1. Session check (401).
2. Validate: target exists in `users` (404); target is not yourself (400).
3. **The gotcha:** a conversation between 1 and 501 may be stored as
   `(1, 501)` *or* `(501, 1)`. Check both:

```sql
SELECT ... FROM dm_conversations
WHERE (user_a_id = %s AND user_b_id = %s)
   OR (user_a_id = %s AND user_b_id = %s)
```

   If found → return it (200). Cleaner alternative: *always store the smaller
   id in `user_a_id`* (Python's `min()`/`max()`, or SQL `LEAST()`/`GREATEST()`)
   — then one `WHERE` clause suffices forever.
4. Not found → INSERT and return the new conversation in Mission 5's shape.
5. Stretch goal: check the `blocks` table (see `routers/reports.py`) and
   refuse to open a DM either direction of a block (403).

**Test:**
```bash
curl -b /tmp/pb-cookies.txt -H 'Content-Type: application/json' \
     -d '{"toUserId": 2}' http://localhost:8000/api/dms/start
```
Run it **twice** — the second call must return the *same* conversation id,
and `SELECT COUNT(*) FROM dm_conversations;` must not grow.

**Common mistakes:**
* The duplicate-pair bug above (the whole point of this mission).
* Allowing `toUserId` equal to your own id.
* Returning the raw DB row (`user_a_id`/`user_b_id`) instead of the
  `otherUserId`/`otherUserName` shape the frontend expects.

---

## Mission 7 — DM messages (GET + POST)

**Goal:** clicking a conversation shows the private thread; sending works.

**Edit:** `list_dm_messages()` and `send_dm_message()`.

**Plan (GET):**
1. Session check (401).
2. Load the conversation (404 if missing) and verify the current user is
   `user_a_id` **or** `user_b_id`. Anyone else → `403`. This is the single
   most important check in the whole project: DMs are private.
3. Select non-deleted messages ordered by `created_at`.
4. Stretch goal (read receipts): after fetching, set `read_at = now()` on the
   *other* user's still-unread rows in this conversation — you just read them.

**Plan (POST):** same participant check, Mission 3's text validation, INSERT
into `dm_messages`, return the created row (201).

**Expected shape (GET):**

```json
[
  { "id": 1, "conversationId": 1, "senderId": 1,
    "body": "Hi Sophia! Could we go over quadratic equations before Monday?",
    "createdAt": "2026-07-01T19:00:30+00:00", "readAt": "2026-07-01T19:01:00+00:00" }
]
```

**Test:** conversation 1 as user 1 shows 3 visible messages (a 4th is
soft-deleted — same trap as Mission 2). Then log in with a *third* account,
e.g. `both951@test.edu`, and curl conversation 1: must be `403`.

**Common mistakes:**
* Skipping the participant check — the most serious bug possible here.
  Test it explicitly; don't assume.
* Checking only `user_a_id = me`.
* Forgetting `readAt` in the JSON (the frontend type expects it, even if null).

---

## Mission 8 — WebSocket `/ws/dms/{conversation_id}`

**Goal:** live private messaging.

**Edit:** `dm_socket()`.

**Plan:** everything from Mission 4, with two changes:
1. The registry key is `conversation_id`, and each list should only ever hold
   the two participants' sockets.
2. On connect, run Mission 7's participant check using
   `websocket.session.get("user_id")`; outsiders get
   `await websocket.close(code=4403)` *before* any data flows.

**Test:** two windows (user 1 + user 501), both connected to
`ws://localhost:8000/ws/dms/1`; messages appear instantly on both sides. A
third window (user 951) trying to connect must be closed immediately.

**Common mistakes:**
* Reusing one global connection list for every conversation — user 951 would
  receive user 1's private messages. Key the registry by conversation.
* Doing the auth check *after* `accept()` and forgetting to close.

---

## When things go wrong

* **500 + traceback in the backend terminal:** read the *last* line first
  (the actual error), then walk up to the line in `chat.py` it points at.
* **`psycopg2.errors.UndefinedColumn`:** your SQL names a column that doesn't
  exist — check spelling against section 2, or run `\d chat_messages` in psql.
* **Widget says "Can't reach the Python backend":** `python main.py` isn't
  running, or it crashed on startup — check that terminal.
* **Your endpoint works in curl but the tab still shows the practice notice:**
  you probably returned the todo envelope from a *different* endpoint the tab
  also calls — watch the Network tab to see which request still says `todo`.
* **Broke the data while experimenting?** Re-run the three reseed commands in
  section 4. Fresh world, 30 seconds.

## Definition of done

- [ ] All 7 REST endpoints return real data (no `"status": "todo"` anywhere).
- [ ] Anonymous curl gets `401` from every chat/DM REST endpoint.
- [ ] The soft-deleted seed messages never appear in the app.
- [ ] `POST /api/dms/start` called twice creates one conversation.
- [ ] A non-participant gets `403` from someone else's DM thread.
- [ ] Two browser windows chat live through the WebSockets.
- [ ] Every query uses `%s` parameters — zero f-string SQL.
