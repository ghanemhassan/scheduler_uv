"""
Allocations endpoints for what-if checks.

POST /api/allocations/check → Validate move (dry-run)
"""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from app.data_store import TIMETABLE, DAYS, TIME_SLOTS, ALL_ROOMS, STAFF
from app.routers.auth import require_admin

router = APIRouter()


class CheckMoveRequest(BaseModel):
    staff: Optional[str] = None
    room: Optional[str] = None
    day: Optional[str] = None  # name or 0-4
    slot: Optional[int] = 0
    group: Optional[str] = None
    enrolled: Optional[int] = None
    section_id: Optional[str] = None  # for mock fallback
    required_equipment: Optional[List[str]] = None
    room_type_required: Optional[str] = None
    duration_slots: Optional[int] = 1
    exclude_session_id: Optional[str] = None  # set when editing so a session never clashes with itself


class CheckMoveResponse(BaseModel):
    ok: bool
    conflicts: List[dict] = []
    recommendations: List[dict] = []


def resolve_day(day_input: Optional[str]) -> Optional[int]:
    """Resolve day name or index to 0-4 index."""
    if day_input is None:
        return None
    if isinstance(day_input, int):
        return day_input
    try:
        return int(day_input)
    except ValueError:
        pass
    day_map = {
        # Teaching week is Sat-Wed (indexes 0-4)
        'saturday': 0, 'sat': 0, 'السبت': 0,
        'sunday': 1, 'sun': 1, 'الأحد': 1, 'الاحد': 1,
        'monday': 2, 'mon': 2, 'الأثنين': 2, 'الاثنين': 2,
        'tuesday': 3, 'tue': 3, 'الثلاثاء': 3,
        'wednesday': 4, 'wed': 4, 'الاربعاء': 4, 'الأربعاء': 4,
    }
    return day_map.get(day_input.lower(), None)


def find_staff_by_name(name: str) -> Optional[int]:
    """Find staff index by name."""
    for i, s in enumerate(STAFF):
        if name.lower() in s.lower():
            return i
    return None


def find_room_by_name(name: str) -> Optional[str]:
    """Find room name by partial match."""
    for r in ALL_ROOMS:
        if name.lower() in r.name.lower():
            return r.name
    return None


@router.post('/check', response_model=CheckMoveResponse)
async def check_move(body: CheckMoveRequest):
    """Validate a move (dry-run, read-only). Returns bilingual conflicts + alternatives."""
    from app.services.conflicts import check_candidate
    day_idx = resolve_day(body.day)
    if body.day is not None and day_idx is None:
        return CheckMoveResponse(
            ok=False,
            conflicts=[{'conflict_type': 'INVALID_DAY', 'description': f'Invalid day: {body.day}',
                        'message_en': f'Invalid day: {body.day}.', 'message_ar': f'اليوم غير صحيح: {body.day}.'}],
            recommendations=[],
        )
    ok, conflicts, recs = check_candidate(
        TIMETABLE, ALL_ROOMS, staff=body.staff, room=body.room,
        day=day_idx, slot=int(body.slot or 0), group=body.group, enrolled=body.enrolled or 0,
        required_equipment=body.required_equipment, room_type_required=body.room_type_required,
        duration_slots=int(body.duration_slots or 1), exclude_session_id=body.exclude_session_id,
    )
    recs_out = [r.model_dump() if hasattr(r, 'model_dump') else dict(r) for r in recs]
    return CheckMoveResponse(ok=ok, conflicts=conflicts, recommendations=recs_out)