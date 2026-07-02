from fastapi import APIRouter, HTTPException
from db import db

router = APIRouter()

def get_top_tags(cur, limit=5):
    cur.execute("SELECT * FROM tags ORDER BY name")
    tags = cur.fetchall()
    result = []
    for tag in tags:
        cur.execute("SELECT COUNT(*) as cnt FROM request_tags WHERE tag_id = %s", (tag["id"],))
        count = cur.fetchone()["cnt"]
        result.append({"id": tag["id"], "name": tag["name"], "color": tag["color"], "requestCount": count})
    result.sort(key=lambda t: t["requestCount"], reverse=True)
    return result[:limit]

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
        top_tags = get_top_tags(cur)

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
