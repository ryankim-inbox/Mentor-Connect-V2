# Account name repair

Registration and profile writes now reject empty/whitespace-only names and raw names
over 120 UTF-8 bytes, then trim accepted names. Existing invalid rows can still make
gateway profile, session, room-history, or DM-list responses fail validation. This
procedure is a separate operator action; do not run it against an existing database
during development. Do not change schema version `0002`, truncate valid names, or
delete messages.

Use the deployed release's compatible Python environment and existing `Python/db.py`
connection helper. Set `DATABASE_URL` through the protected operator environment,
never in command history or committed files. Run the snippets with `Python/` on
`PYTHONPATH`. Record the database identity, release SHA, operator, reviewer, timestamp,
backup reference, and evidence location in the incident/change record. Restrict that
location to the operator and reviewer: it contains original names and history IDs.

## Read-only preflight

Set `ACCOUNT_NAME_EVIDENCE` to a new file inside that protected location. The snippet
opens a read-only transaction, classifies names with the deployed validator, and
saves original values and affected history IDs without changing any rows. A name
that passes validation is left intact even if trimming would change its presentation.

```python
import json
import os
from db import db
from routers.auth import normalize_display_name

affected = []
with db() as conn:
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute("SELECT id, name FROM users ORDER BY id")
    for user in cur.fetchall():
        try:
            normalize_display_name(user["name"])
        except ValueError:
            affected.append(dict(user))
    for user in affected:
        cur.execute(
            "SELECT DISTINCT room_id FROM chat_messages WHERE sender_id = %s ORDER BY room_id",
            (user["id"],),
        )
        user["room_ids"] = [row["room_id"] for row in cur.fetchall()]
        cur.execute(
            "SELECT id FROM dm_conversations WHERE user_a_id = %s OR user_b_id = %s ORDER BY id",
            (user["id"], user["id"]),
        )
        user["conversation_ids"] = [row["id"] for row in cur.fetchall()]

fd = os.open(os.environ["ACCOUNT_NAME_EVIDENCE"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as evidence:
    json.dump(affected, evidence, ensure_ascii=False, indent=2)
print(f"Affected rows: {len(affected)}")
```

If the count is zero, retain the evidence and record that existing-data remediation
needs no writes. Otherwise, review each ID and original name against the incident.
Approve a specific list of invalid IDs and `Member <id>` replacements. Do not use
an unreviewed bulk update. Arrange a maintenance window for the transaction and
endpoint verification, and confirm the backup is recoverable.

## Reviewed-ID transaction

Use the same protected evidence file. Fill `reviewed_ids` with only the approved
IDs. This transaction locks every reviewed row, rejects stale evidence or a now-valid
name, and updates names only. Any mismatch rolls back the entire transaction through
`db()`. Preserve the reviewed list and successful row count in the change record.

```python
import json
import os
from db import db
from routers.auth import normalize_display_name

reviewed_ids = []  # Fill with the exact IDs approved by the reviewer.
assert reviewed_ids and len(reviewed_ids) == len(set(reviewed_ids))
with open(os.environ["ACCOUNT_NAME_EVIDENCE"], encoding="utf-8") as evidence:
    originals = {row["id"]: row for row in json.load(evidence)}
assert set(reviewed_ids) <= originals.keys()

with db() as conn:
    cur = conn.cursor()
    for user_id in sorted(reviewed_ids):
        cur.execute("SELECT name FROM users WHERE id = %s FOR UPDATE", (user_id,))
        current = cur.fetchone()
        if current is None or current["name"] != originals[user_id]["name"]:
            raise RuntimeError(f"Evidence changed for user {user_id}; redo preflight")
        try:
            normalize_display_name(current["name"])
        except ValueError:
            pass
        else:
            raise RuntimeError(f"User {user_id} has a valid name; do not replace it")
        replacement = f"Member {user_id}"
        normalize_display_name(replacement)
        cur.execute("UPDATE users SET name = %s WHERE id = %s", (replacement, user_id))
        if cur.rowcount != 1:
            raise RuntimeError(f"Unexpected row count for user {user_id}")
print(f"Repaired rows: {len(reviewed_ids)}")
```

## Verification and completion evidence

Repeat the read-only preflight into a new protected file and record the count. If
invalid rows remain, review those rows separately; remediation is not complete.
Through the public gateway, use approved existing sessions with access to the
affected resources and record HTTP status evidence for:

- `GET /api/auth/me` for each repaired member: 200 with the replacement name.
- `GET /api/users/<id>` for every repaired ID: 200 with the replacement name.
- `GET /api/chat/rooms/<room_id>/messages` for every room ID in the evidence: 200,
  including history pages containing that member's messages and replacement sender name.
- `GET /api/dms` for each participant in affected conversations: 200 with the
  replacement participant name, and `GET /api/dms/<conversation_id>/messages`: 200
  for every affected conversation using an authorized participant session.

Respect room and DM access checks; never bypass authentication to perform verification.
Compare message counts/IDs against the protected evidence or approved backup to
confirm histories were preserved. Retain preflight, reviewed IDs, transaction result,
postflight, and endpoint status evidence. Code tests alone do not establish the state
of a deployed database. Existing-data remediation is complete only with a recorded
zero-affected-row preflight or recorded operator repair evidence and verification.

## Rollback

If the operator/reviewer approves rollback, restore exact original names from the
protected evidence, using the same reviewed IDs. Coordinate this with release rollback:
restoring invalid names can reintroduce gateway failures. The conditional update below
refuses to overwrite a member's subsequent name edit and rolls back all rows on a
mismatch. Never reconstruct original values from a public log or guessed/truncated text.

```python
import json
import os
from db import db

reviewed_ids = []  # Exact IDs from the approved repair record.
assert reviewed_ids and len(reviewed_ids) == len(set(reviewed_ids))
with open(os.environ["ACCOUNT_NAME_EVIDENCE"], encoding="utf-8") as evidence:
    originals = {row["id"]: row["name"] for row in json.load(evidence)}
assert set(reviewed_ids) <= originals.keys()

with db() as conn:
    cur = conn.cursor()
    for user_id in sorted(reviewed_ids):
        cur.execute(
            "UPDATE users SET name = %s WHERE id = %s AND name = %s",
            (originals[user_id], user_id, f"Member {user_id}"),
        )
        if cur.rowcount != 1:
            raise RuntimeError(f"User {user_id} changed since repair; stop and review")
print(f"Restored rows: {len(reviewed_ids)}")
```

Record rollback results and verify the chosen release's affected endpoints again.
