from fastapi import Depends
from security import require_member_user
from fastapi import APIRouter
from db import db
from request_access import request_access_sql

router = APIRouter(dependencies=[Depends(require_member_user)])

@router.get("/tags")
def list_tags(viewer=Depends(require_member_user)):
    audience_clause, audience_params = request_access_sql(viewer)
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM tags ORDER BY name")
        tags = cur.fetchall()
        result = []
        for tag in tags:
            cur.execute(
                f"""SELECT COUNT(*) as cnt FROM request_tags rt JOIN requests r ON r.id=rt.request_id
                    WHERE rt.tag_id = %s AND {audience_clause}""", (tag["id"], *audience_params)
            )
            count = cur.fetchone()["cnt"]
            result.append({
                "id": tag["id"],
                "name": tag["name"],
                "color": tag["color"],
                "requestCount": count,
            })
        return result
