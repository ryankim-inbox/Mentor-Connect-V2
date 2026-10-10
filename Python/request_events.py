"""Persist observed matches using the caller's locked request transaction."""


def record_match_event(cur, request_row: dict) -> None:
    mentor_id = (request_row["author_id"] if request_row["role"] == "mentor"
                 else request_row["matched_user_id"])
    cur.execute(
        """INSERT INTO request_events (kind, request_id, mentor_id, request_created_at)
           VALUES ('matched', %s, %s, %s)""",
        (request_row["id"], mentor_id, request_row["created_at"]),
    )
