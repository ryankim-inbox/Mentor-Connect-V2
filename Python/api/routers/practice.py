"""
Re-exposes the practice-lab routes from Python/app.py under the unified
/api prefix so the frontend only needs one backend. All logic stays in
integration_api.py (unmodified).
"""

from typing import Any

from fastapi import APIRouter, Body

import integration_api

router = APIRouter()


@router.get("/practice/status")
def practice_status():
    return integration_api.get_practice_status()


@router.get("/practice/matching/{question_id}")
def practice_matching(question_id: int, limit: int = 5):
    return integration_api.get_matching_result(question_id=question_id, limit=limit)


@router.get("/practice/locations/status")
def practice_locations_status():
    return integration_api.get_location_status()


@router.post("/practice/locations/test")
def practice_locations_test(test_input: dict[str, Any] | None = Body(default=None)):
    return integration_api.run_location_test(test_input or {})


@router.get("/practice/blocks/status")
def practice_blocks_status():
    return integration_api.get_block_status()


@router.get("/practice/raw/{module_name}")
def practice_raw_module(module_name: str):
    return integration_api.get_raw_module_metadata(module_name)
