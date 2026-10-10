"""Configured block checks and moderation teaching labels; labels do not suspend accounts."""
from collections import Counter

from db import db


def receive_block_data() -> list[tuple[int, int]]:
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("SELECT blocker_id, blocked_user_id FROM blocks;")
        return [(row["blocker_id"], row["blocked_user_id"]) for row in cursor.fetchall()]

def prevent_matches(blocks_data, match_possibilities):
    block_s = set(blocks_data)
    good_matches = []

    for match in match_possibilities:
        user1, user2 = match[0], match[1]

        if (user1, user2) not in block_s and (user2, user1) not in block_s:
            good_matches.append(match)
    return good_matches


def count_blocks(blocks_data: list[tuple[int, int]]) -> dict[int, int]:
    """Count each blocker once per blocked user."""
    return dict(Counter(blocked for _, blocked in set(blocks_data)))


def _status_for(report_count: int) -> str:
    if report_count >= 5:
        return "banned"
    if report_count >= 3:
        return "serious_warning"
    if report_count >= 1:
        return "warned"
    return "active"


def get_flagged_users() -> list[dict]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                u.id AS user_id,
                u.name,
                u.email,
                COALESCE(d.name, '-') AS district,
                COALESCE(ra.report_count, 0) AS report_count,
                COALESCE(ba.block_count, 0) AS block_count,
                ra.last_reported_at,
                COALESCE(ra.top_reasons, '{}') AS top_reasons
            FROM users u
            LEFT JOIN (
                SELECT
                    r.reported_user_id,
                    COUNT(*)::int AS report_count,
                    MAX(r.created_at) AS last_reported_at,
                    ARRAY(
                        SELECT r2.reason
                        FROM reports r2
                        WHERE r2.reported_user_id = r.reported_user_id
                        GROUP BY r2.reason
                        ORDER BY COUNT(*) DESC
                        LIMIT 3
                    ) AS top_reasons
                FROM reports r
                GROUP BY r.reported_user_id
            ) ra ON ra.reported_user_id = u.id
            LEFT JOIN (
                SELECT blocked_user_id, COUNT(*)::int AS block_count
                FROM blocks
                GROUP BY blocked_user_id
            ) ba ON ba.blocked_user_id = u.id
            LEFT JOIN districts d ON d.id = u.district_id
            WHERE COALESCE(ra.report_count, 0) > 0 OR COALESCE(ba.block_count, 0) > 0
            ORDER BY report_count DESC, block_count DESC
            """
        )
        rows = cur.fetchall()

    data = [
        {
            "userId": row["user_id"],
            "name": row["name"],
            "email": row["email"],
            "district": row["district"],
            "reportCount": row["report_count"],
            "blockCount": row["block_count"],
            "lastReportedAt": row["last_reported_at"].isoformat()
            if row["last_reported_at"]
            else None,
            "topReasons": list(row["top_reasons"] or []),
            "status": _status_for(row["report_count"]),
        }
        for row in rows
    ]
    return data
