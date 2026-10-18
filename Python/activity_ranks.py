"""Production profile badges from distinct, accepted study relationships.

The teaching module owns sorting and competition ranks. This adapter supplies
eligible production counts and absolute activity tiers, preserving its exercises.
"""
import mentor_ranks

from account_policy import SYNTHETIC_LOCK_PREFIX
from db import db
from member_access import has_student_access


ACTIVITY_TIERS = (
    (1, "Bronze"),
    (3, "Silver"),
    (5, "Gold"),
    (10, "Platinum"),
    (20, "Emerald"),
    (35, "Diamond"),
    (50, "Master"),
    (75, "Grand Master"),
    (100, "Challenger"),
)


def rank_activity_counts(rows: list[dict]) -> list[dict]:
    """Rank trusted ``id``/``matched_count`` rows without mutating their input."""
    ranked = mentor_ranks.assign_ranks(mentor_ranks.sort_mentors(rows))
    return [
        {
            "userId": int(row["id"]),
            "distinctPartners": int(row["matched_count"]),
            "rank": row["rank"],
            "tier": next(
                (tier for minimum, tier in reversed(ACTIVITY_TIERS)
                 if row["matched_count"] >= minimum),
                None,
            ),
        }
        for row in ranked
    ]


def get_activity_rank(user_id: int) -> dict | None:
    """Return one eligible student's global rank, or None for an invalid target.

    Authentication/authorization belongs to the calling profile route. Reads use
    one consistent, read-only snapshot; there are at most two data queries, never
    a query per participant. SQL reduces all history to one count per eligible
    student before Python applies the lesson's ordering and competition ranks.
    Database errors propagate so callers can distinguish unavailable from zero.
    """
    if (not isinstance(user_id, int) or isinstance(user_id, bool)
            or not 1 <= user_id <= 2147483647):
        return None

    with db() as conn, conn.cursor() as cur:
        cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        cur.execute(
            """SELECT id, role, email_verified_at, is_admin, password_hash
               FROM users
               WHERE role IN ('mentor', 'mentee', 'both') AND is_admin IS FALSE
                 AND password_hash NOT LIKE %s""",
            (SYNTHETIC_LOCK_PREFIX + "%",),
        )
        eligible_ids = [row["id"] for row in cur.fetchall() if has_student_access(row)]
        if user_id not in eligible_ids:
            return None

        cur.execute(
            """WITH eligible_pairs AS (
                   SELECT DISTINCT LEAST(r.author_id, r.matched_user_id) AS first_id,
                                   GREATEST(r.author_id, r.matched_user_id) AS second_id
                   FROM requests r
                   WHERE r.status IN ('matched', 'closed')
                     AND r.author_id <> r.matched_user_id
                     AND r.author_id = ANY(%s)
                     AND r.matched_user_id = ANY(%s)
                     AND EXISTS (
                         SELECT 1 FROM request_applications a
                         WHERE a.request_id = r.id
                           AND a.applicant_id = r.matched_user_id
                           AND a.status = 'accepted')
                     AND NOT EXISTS (
                         SELECT 1 FROM blocks b
                         WHERE (b.blocker_id = r.author_id AND b.blocked_user_id = r.matched_user_id)
                            OR (b.blocker_id = r.matched_user_id AND b.blocked_user_id = r.author_id))
               ), participants AS (
                   SELECT first_id AS id FROM eligible_pairs
                   UNION ALL
                   SELECT second_id AS id FROM eligible_pairs
               )
               SELECT id, COUNT(*)::int AS matched_count FROM participants GROUP BY id""",
            (eligible_ids, eligible_ids),
        )
        counts = {row["id"]: row["matched_count"] for row in cur.fetchall()}

    ranked = rank_activity_counts([
        {"id": member_id, "matched_count": counts.get(member_id, 0)}
        for member_id in eligible_ids
    ])
    return next(row for row in ranked if row["userId"] == user_id)
