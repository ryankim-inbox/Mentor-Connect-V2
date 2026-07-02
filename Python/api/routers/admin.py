from fastapi import APIRouter

from api.adapters import admin_adapter

router = APIRouter()


@router.get("/admin/flagged-users")
def flagged_users():
    return admin_adapter.get_flagged_users()
