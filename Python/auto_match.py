"""Deliver at most five in-app mentor alerts after a request has committed."""
import logging

from db import db
from find_matches import rank_candidates
from member_access import has_student_access
from request_access import can_access_request

log = logging.getLogger(__name__)

TOP_MATCHES = 5
MAX_NOTIFICATION_LENGTH = 1000


def find_matches_for_request(cur, request_row: dict, limit: int = TOP_MATCHES) -> list[dict]:
    """Adapt production tags, district IDs and schedules to the lesson scorer."""
    cur.execute(
        """SELECT t.name FROM request_tags rt JOIN tags t ON t.id = rt.tag_id
           WHERE rt.request_id = %s ORDER BY t.id""",
        (request_row["id"],),
    )
    question = {
        "subjects": [row["name"] for row in cur.fetchall()],
        "district": request_row["district_id"],
        "preferred_times": request_row.get("preferred_times") or [],
    }
    author_id = request_row["author_id"]
    student = {"id": author_id, "district": request_row["district_id"]}
    cur.execute(
        """SELECT u.id, u.name, u.subjects, u.district_id, u.role,
                  u.email_verified_at, u.is_admin, u.password_hash, u.gender,
                  COALESCE(array_agg(s.slot ORDER BY s.slot)
                      FILTER (WHERE s.slot IS NOT NULL), '{}') AS slots
           FROM users u LEFT JOIN schedules s ON s.user_id = u.id
           WHERE u.role IN ('mentor', 'both') AND u.id <> %s
             AND NOT EXISTS (
                 SELECT 1 FROM blocks b
                 WHERE (b.blocker_id = %s AND b.blocked_user_id = u.id)
                    OR (b.blocker_id = u.id AND b.blocked_user_id = %s))
           GROUP BY u.id""",
        (author_id, author_id, author_id),
    )
    mentors = [
        {**mentor, "district": mentor["district_id"], "available_times": mentor["slots"]}
        for mentor in cur.fetchall() if has_student_access(mentor) and can_access_request(request_row, mentor)
    ]
    return rank_candidates(student, mentors, question, min(limit, TOP_MATCHES))


def auto_match_request(request_row: dict) -> int:
    """Deliver once in a separate transaction; failures leave the request saved.

    The committed request row is the authority. Its lock serializes retries and
    the author summary marks a completed delivery, including a zero-match result.
    A failed insert rolls back alerts and the marker together, allowing repair.
    """
    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM requests WHERE id=%s FOR UPDATE', (request_row['id'],))
            request = cur.fetchone()
            if not request or request['role'] != 'mentee' or request['status'] != 'open':
                return 0
            cur.execute('SELECT * FROM users WHERE id=%s FOR SHARE', (request['author_id'],))
            author = cur.fetchone()
            if not author or not has_student_access(author):
                return 0
            cur.execute(
                """SELECT 1 FROM notifications WHERE user_id=%s AND request_id=%s
                   AND kind='request_match_summary'""",
                (request['author_id'], request['id']),
            )
            if cur.fetchone():
                cur.execute(
                    "SELECT count(*) AS n FROM notifications WHERE request_id=%s AND kind='request_match'",
                    (request['id'],),
                )
                return cur.fetchone()['n']

            matches = find_matches_for_request(cur, request)
            # Lock recipients in a fixed order, then recheck current eligibility
            # and both block directions before any alert is inserted.
            cur.execute('SELECT * FROM users WHERE id=ANY(%s) ORDER BY id FOR SHARE',
                        ([match['mentor_id'] for match in matches],))
            recipients = {user['id']: user for user in cur.fetchall()
                          if user['role'] in ('mentor', 'both') and has_student_access(user)
                          and can_access_request(request, user)}
            delivered = 0
            title = request['title']
            for match in matches:
                recipient_id = match['mentor_id']
                if recipient_id not in recipients or recipient_id == request['author_id']:
                    continue
                cur.execute(
                    """SELECT 1 FROM blocks WHERE (blocker_id=%s AND blocked_user_id=%s)
                       OR (blocker_id=%s AND blocked_user_id=%s) LIMIT 1""",
                    (request['author_id'], recipient_id, recipient_id, request['author_id']),
                )
                if cur.fetchone():
                    continue
                message = f"New request matches you: {title} ({match['reason']})"
                cur.execute(
                    """INSERT INTO notifications (user_id, kind, request_id, message)
                       VALUES (%s, 'request_match', %s, %s)
                       ON CONFLICT DO NOTHING""",
                    (recipient_id, request['id'], message[:MAX_NOTIFICATION_LENGTH]),
                )
                delivered += 1
            summary = (f"We let {delivered} mentor{'s' if delivered != 1 else ''} know about {title}"
                       if delivered else f"No matching mentors yet for {title}")
            cur.execute(
                """INSERT INTO notifications (user_id, kind, request_id, message)
                   VALUES (%s, 'request_match_summary', %s, %s)
                   ON CONFLICT DO NOTHING""",
                (request['author_id'], request['id'], summary[:MAX_NOTIFICATION_LENGTH]),
            )
            return delivered
    except Exception:
        # Raw exceptions can include private row or connection details.
        log.warning("auto-match unavailable for request %s", request_row.get("id"))
        return 0
