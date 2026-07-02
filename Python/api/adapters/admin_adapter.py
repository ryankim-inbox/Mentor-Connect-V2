"""
Wraps the student moderation file (Python/get_blocks.py) without modifying it.

get_blocks.py is meant to count reports/blocks per user and apply the
thresholds documented in its code: 1+ reports -> warning, 3+ -> serious
warning, 5+ -> ban. While it cannot be imported (it currently has incomplete
function bodies), the endpoint answers with the same aggregation computed from
the product reports/blocks tables, labeled source="adapter-fallback".
"""

from db import db

from api.adapters.probe import make_envelope, probe_student_call


def _status_for(report_count: int) -> str:
    if report_count >= 5:
        return "banned"
    if report_count >= 3:
        return "serious_warning"
    if report_count >= 1:
        return "warned"
    return "active"


def get_flagged_users():
    # Chain the student functions the way get_blocks.py intends:
    # receive_block_data() feeds count_blocks(). Each step is safely probed.
    probe = probe_student_call("get_blocks", "receive_block_data")
    if probe["called"]:
        probe = probe_student_call("get_blocks", "count_blocks", args=(probe["result"],))

    with db() as conn:
        cur = conn.cursor()
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
    return make_envelope("admin.flagged_users", probe, data, normalize=lambda _: None)
