from fastapi import APIRouter
from db import db

router = APIRouter()

@router.get("/tags")
def list_tags():
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM tags ORDER BY name")
        tags = cur.fetchall()
        result = []
        for tag in tags:
            cur.execute(
                "SELECT COUNT(*) as cnt FROM request_tags WHERE tag_id = %s", (tag["id"],)
            )
            count = cur.fetchone()["cnt"]
            result.append({
                "id": tag["id"],
                "name": tag["name"],
                "color": tag["color"],
                "requestCount": count,
            })
        return result
