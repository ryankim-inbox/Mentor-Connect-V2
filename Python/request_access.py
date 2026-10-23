"""One audience policy for request reads, interactions, counts and delivery."""
from fastapi import HTTPException

from member_access import has_admin_access


def can_access_request(request_row, viewer):
    audience = request_row.get('audience')
    if audience == 'both':
        return True
    if viewer is None:
        return False
    return (request_row['author_id'] == viewer['id']
            or has_admin_access(viewer)
            or (viewer.get('gender') in ('female', 'male')
                and audience == viewer['gender']))


def require_request_access(request_row, viewer):
    if not can_access_request(request_row, viewer):
        # Do not confirm the existence of an inaccessible request.
        raise HTTPException(404, 'Request not found')


def request_access_sql(viewer, alias='r'):
    """Return a parameterized predicate; alias is a trusted caller constant."""
    if viewer is None:
        return f"{alias}.audience = 'both'", []
    return (f"({alias}.audience = 'both' OR {alias}.author_id = %s OR %s"
            f" OR ({alias}.audience = %s AND %s IN ('female', 'male')))",
            [viewer['id'], has_admin_access(viewer), viewer.get('gender'), viewer.get('gender')])
