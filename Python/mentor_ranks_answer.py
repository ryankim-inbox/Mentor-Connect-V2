"""Authenticated mentor rankings derived from matched requests."""

from fastapi import APIRouter, HTTPException, Request

from db import db


router = APIRouter()


def rank_data() -> list[dict]:
    """Return mentors and both-role users with their matched-request counts."""
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT u.id, u.name, COUNT(r.id)::integer AS matched_count
            FROM users AS u
            LEFT JOIN requests AS r
              ON r.status = %s
             AND r.matched_user_id IS NOT NULL
             AND CASE r.role
                   WHEN %s THEN r.author_id
                   WHEN %s THEN r.matched_user_id
                 END = u.id
            WHERE u.role IN (%s, %s)
            GROUP BY u.id, u.name
            ORDER BY u.id
            """,
            ("matched", "mentor", "mentee", "mentor", "both"),
        )
        return [dict(row) for row in cur.fetchall()]


def sort_mentors(mentors: list[dict]) -> list[dict]:
    """Return copied rows ordered by count descending and ID ascending."""
    return sorted(
        (dict(mentor) for mentor in mentors),
        key=lambda mentor: (-mentor["matched_count"], mentor["id"]),
    )


def assign_ranks(mentors: list[dict]) -> list[dict]:
    """Add competition ranks to already sorted rows; leave zero counts unranked."""
    ranked = []
    previous_count = None
    current_rank = None
    for position, mentor in enumerate(mentors, start=1):
        row = dict(mentor)
        count = row["matched_count"]
        if count <= 0:
            row["rank"] = None
        else:
            if count != previous_count:
                current_rank = position
            row["rank"] = current_rank
            previous_count = count
        ranked.append(row)
    return ranked


def badge_for_rank(rank: int | None) -> str | None:
    """Map a positive competition rank to its mentor badge."""
    if rank is None or rank < 1:
        return None
    for upper_bound, badge in (
        (1, "Master"),
        (10, "Platinum"),
        (100, "Diamond"),
        (500, "Gold"),
        (1000, "Silver"),
        (2000, "Steel"),
        (5000, "Bronze"),
        (10000, "Mud"),
    ):
        if rank <= upper_bound:
            return badge
    return None


def _require_user(request: Request) -> int:
    """Return the session user ID or reject anonymous access."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


def _ranked_rows() -> list[dict]:
    """Fetch, sort and rank the private database rows."""
    return assign_ranks(sort_mentors(rank_data()))


def _public_row(row: dict) -> dict:
    """Expose only the five fields in the public ranking contract."""
    return {
        "mentorId": row["id"],
        "mentorName": row["name"],
        "matchedCount": row["matched_count"],
        "rank": row["rank"],
        "badge": badge_for_rank(row["rank"]),
    }


@router.get("/mentor-ranks")
def list_mentor_ranks(request: Request) -> list[dict]:
    """Return all mentor rankings to an authenticated user."""
    _require_user(request)
    return [_public_row(row) for row in _ranked_rows()]


@router.get("/mentor-ranks/{mentor_id}")
def get_mentor_rank(mentor_id: int, request: Request) -> dict:
    """Return one mentor ranking or 404 when the ID is not rank-eligible."""
    _require_user(request)
    if mentor_id <= 0:
        raise HTTPException(status_code=422, detail="Mentor ID must be positive")
    for row in _ranked_rows():
        if row["id"] == mentor_id:
            return _public_row(row)
    raise HTTPException(status_code=404, detail="Mentor not found")
