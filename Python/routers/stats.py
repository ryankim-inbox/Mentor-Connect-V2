from fastapi import APIRouter, HTTPException
from db import db

router = APIRouter()

def get_top_tags(cur, limit: int = 5, district_id: int | None = None) -> list[dict]:
    cur.execute(
        """SELECT t.id, t.name, t.color, COUNT(*) AS request_count
           FROM tags t
           JOIN request_tags rt ON rt.tag_id = t.id
           JOIN requests r ON r.id = rt.request_id
           WHERE (%s IS NULL OR r.district_id = %s)
           GROUP BY t.id
           ORDER BY request_count DESC, t.id ASC
           LIMIT %s""",
        (district_id, district_id, limit),
    )
    return [
        {"id": tag["id"], "name": tag["name"], "color": tag["color"], "requestCount": tag["request_count"]}
        for tag in cur.fetchall()
    ]

@router.get("/stats/overview")
def stats_overview():
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM users")
        total_users = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM users WHERE role = 'mentor'")
        total_mentors = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM users WHERE role = 'mentee'")
        total_mentees = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM districts")
        total_districts = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM requests WHERE status = 'open'")
        open_requests = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM requests WHERE status = 'matched'")
        successful_matches = cur.fetchone()["cnt"]
        top_tags = get_top_tags(cur)

    return {
        "totalUsers": total_users,
        "totalMentors": total_mentors,
        "totalMentees": total_mentees,
        "totalDistricts": total_districts,
        "openRequests": open_requests,
        "successfulMatches": successful_matches,
        "topTags": top_tags,
    }

@router.get("/stats/district/{district_id}")
def district_stats(district_id: int):
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM districts WHERE id = %s", (district_id,))
        district = cur.fetchone()
        if not district:
            raise HTTPException(status_code=404, detail="District not found")

        cur.execute("SELECT COUNT(*) as cnt FROM users WHERE district_id = %s", (district_id,))
        member_count = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM users WHERE district_id = %s AND role = 'mentor'", (district_id,))
        mentor_count = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM users WHERE district_id = %s AND role = 'mentee'", (district_id,))
        mentee_count = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM requests WHERE district_id = %s AND status = 'open'", (district_id,))
        open_requests = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) as cnt FROM requests WHERE district_id = %s AND status = 'matched'", (district_id,))
        matched_requests = cur.fetchone()["cnt"]
        top_tags = get_top_tags(cur, district_id=district_id)

    return {
        "districtId": district["id"],
        "districtName": district["name"],
        "memberCount": member_count,
        "mentorCount": mentor_count,
        "menteeCount": mentee_count,
        "openRequests": open_requests,
        "matchedRequests": matched_requests,
        "topTags": top_tags,
    }
