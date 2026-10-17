"""Auto-match new "Seeking a mentor" requests and notify the matched mentors.

Quick version: scores mentor/both users against a request's tags, district and
preferred times, stores in-app notifications, and never blocks the request
from being created if matching fails.
"""
import logging

from db import db
from member_access import has_member_access

log = logging.getLogger(__name__)

TOP_MATCHES = 5

def _lower_set(values) -> set[str]:
    return {str(v).strip().lower() for v in (values or []) if str(v).strip()}


def score_mentor(request_row: dict, tag_names: set[str], mentor: dict) -> tuple[int, str]:
    """Return (score, reason) for one mentor candidate; score 0 means no match."""
    score, reasons = 0, []
    if tag_names & _lower_set(mentor.get("subjects")):
        score += 50
        reasons.append("Same subject")
    if mentor.get("district_id") == request_row["district_id"]:
        score += 25
        reasons.append("Same district")
    if _lower_set(request_row.get("preferred_times")) & _lower_set(mentor.get("slots")):
        score += 10
        reasons.append("Available at a preferred time")
    return score, ", ".join(reasons)


def find_matches_for_request(cur, request_row: dict, limit: int = TOP_MATCHES) -> list[dict]:
    cur.execute(
        """SELECT t.name FROM request_tags rt JOIN tags t ON t.id = rt.tag_id
           WHERE rt.request_id = %s""",
        (request_row["id"],),
    )
    tag_names = _lower_set(row["name"] for row in cur.fetchall())
    author_id = request_row["author_id"]
    cur.execute(
        """SELECT u.id, u.name, u.subjects, u.district_id, u.role,
                  u.email_verified_at, u.is_admin, u.password_hash,
                  COALESCE(array_agg(s.slot) FILTER (WHERE s.slot IS NOT NULL), '{}') AS slots
           FROM users u LEFT JOIN schedules s ON s.user_id = u.id
           WHERE u.role IN ('mentor', 'both') AND u.id <> %s
             AND NOT EXISTS (
                 SELECT 1 FROM blocks b
                 WHERE (b.blocker_id = %s AND b.blocked_user_id = u.id)
                    OR (b.blocker_id = u.id AND b.blocked_user_id = %s))
           GROUP BY u.id""",
        (author_id, author_id, author_id),
    )
    scored = []
    for mentor in cur.fetchall():
        if not has_member_access(mentor):
            continue
        score, reason = score_mentor(request_row, tag_names, mentor)
        if score > 0:
            scored.append({"mentor_id": mentor["id"], "score": score, "reason": reason})
    scored.sort(key=lambda m: (-m["score"], m["mentor_id"]))
    return scored[:limit]


def auto_match_request(request_row: dict) -> int:
    """Notify matching mentors about a new mentee request. Returns the match count.

    Runs in its own transaction after the request is saved; any failure is
    logged and swallowed so the request itself still succeeds.
    """
    if request_row.get("role") != "mentee":
        return 0
    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM users WHERE id=%s', (request_row['author_id'],))
            author = cur.fetchone()
            if not author or not has_member_access(author):
                return 0
            matches = find_matches_for_request(cur, request_row)
            title = request_row["title"]
            for match in matches:
                cur.execute(
                    """INSERT INTO notifications (user_id, kind, request_id, message)
                       VALUES (%s, 'request_match', %s, %s)
                       ON CONFLICT DO NOTHING""",
                    (match["mentor_id"], request_row["id"],
                     f"New request matches you: {title} ({match['reason']})"),
                )
            summary = (f"We let {len(matches)} mentor{'s' if len(matches) != 1 else ''} know about {title}"
                       if matches else f"No matching mentors yet for {title}")
            cur.execute(
                """INSERT INTO notifications (user_id, kind, request_id, message)
                   VALUES (%s, 'request_match_summary', %s, %s)
                   ON CONFLICT DO NOTHING""",
                (request_row["author_id"], request_row["id"], summary),
            )
            return len(matches)
    except Exception:
        # Raw database exceptions can contain row/connection details. The saved
        # request remains available; no automatic retry creates duplicate alerts.
        log.warning("auto-match unavailable for request %s", request_row.get("id"))
        return 0
