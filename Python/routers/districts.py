from fastapi import APIRouter, HTTPException
from typing import Optional
from db import db

router = APIRouter()

def build_district_response(cur, district):
    cur.execute("SELECT COUNT(*) as cnt FROM users WHERE district_id = %s", (district["id"],))
    member_count = cur.fetchone()["cnt"]
    cur.execute(
        "SELECT COUNT(*) as cnt FROM requests WHERE district_id = %s AND status = 'open'",
        (district["id"],),
    )
    open_count = cur.fetchone()["cnt"]
    return {
        "id": district["id"],
        "name": district["name"],
        "county": district["county"],
        "type": district["type"],
        "memberCount": member_count,
        "openRequestCount": open_count,
    }

@router.get("/districts")
def list_districts(type: Optional[str] = None, search: Optional[str] = None):
    conditions = []
    params = []
    if type == "high_school":
        conditions.append("type = 'high_school'")
    if search:
        conditions.append("name ILIKE %s")
        params.append(f"%{search}%")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT * FROM districts {where} ORDER BY name"

    with db() as conn:
        cur = conn.cursor()
        cur.execute(query, params)
        districts = cur.fetchall()
        return [build_district_response(cur, d) for d in districts]

@router.get("/districts/{district_id}")
def get_district(district_id: int):
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM districts WHERE id = %s", (district_id,))
        district = cur.fetchone()
        if not district:
            raise HTTPException(status_code=404, detail="District not found")
        return build_district_response(cur, district)
