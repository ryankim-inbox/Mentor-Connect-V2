from fastapi import Depends
from security import require_admin
from fastapi import APIRouter

from api.adapters import admin_adapter

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/admin/flagged-users")
def flagged_users():
    return admin_adapter.get_flagged_users()
