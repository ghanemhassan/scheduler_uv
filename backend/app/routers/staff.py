"""
Staff endpoints (mirrors Manage staff modal in the frontend).

GET /api/staff              → list staff names
POST /api/staff             → add staff {name}
DELETE /api/staff/{name}    → remove staff (sessions become Unassigned)
"""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional
from uuid import uuid4
from app.data_store import DAYS, TIME_SLOTS, STAFF, TIMETABLE, STAFF_UNAVAILABILITY
from app.database import save_setting, save_timetable_row
from app.routers.auth import require_admin, get_email_from_auth

router = APIRouter()


class StaffCreate(BaseModel):
    name: str


class UnavailabilityIn(BaseModel):
    staff: Optional[str] = None  # admin may file for anyone; lecturers file for self
    day: int
    slot: Optional[int] = None  # None = whole day
    reason: str = ''


def _own_name(authorization: str) -> tuple[str, str]:
    """(email, display name) from the token; '' when unknown."""
    try:
        email = get_email_from_auth(authorization) or ''
    except Exception:
        email = ''
    name = ''
    try:
        from app.data_store import USERS
        for u in USERS:
            if u.get('email', '').lower() == email.lower():
                name = u.get('name', '')
                break
    except Exception:
        pass
    return email, name


def _persist_unav() -> None:
    try:
        save_setting('staff_unavailability', STAFF_UNAVAILABILITY)
    except Exception:
        pass


@router.get('')
def list_staff():
    return STAFF


@router.post('', status_code=201)
def add_staff(body: StaffCreate, authorization: str = Header(default='')):
    require_admin(authorization)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail='name is required')
    if name not in STAFF:
        STAFF.append(name)
        TIMETABLE.setdefault('staff', {})[name] = {
            d: {s: None for s in range(len(TIME_SLOTS))} for d in range(len(DAYS))
        }
        save_setting('staff', STAFF)
        save_timetable_row('staff', name, TIMETABLE['staff'][name])
    return {'ok': True, 'name': name, 'staff': STAFF}


@router.delete('/{name}')
def remove_staff(name: str, authorization: str = Header(default='')):
    require_admin(authorization)
    if name not in STAFF:
        raise HTTPException(status_code=404, detail=f"Staff '{name}' not found")
    STAFF[:] = [s for s in STAFF if s != name]
    staff_view = TIMETABLE.get('staff', {})
    staff_view.pop(name, None)
    save_setting('staff', STAFF)
    for view_data in TIMETABLE.values():
        for row_days in view_data.values():
            if not isinstance(row_days, dict):
                continue
            for day, slots in list(row_days.items()):
                cells = slots.items() if isinstance(slots, dict) else [(0, slots)]
                for slot, sess in list(cells):
                    if sess is None:
                        continue
                    s_staff = sess.get('staff') if isinstance(sess, dict) else getattr(sess, 'staff', None)
                    if s_staff != name:
                        continue
                    updated = dict(sess, staff='Unassigned') if isinstance(sess, dict) \
                        else sess.model_copy(update={'staff': 'Unassigned'})
                    if isinstance(slots, dict):
                        slots[slot] = updated
                    else:
                        row_days[day] = updated
    return {'ok': True, 'deleted': name, 'staff': STAFF}


# ── Availability / exception requests (SCH-FR-03) ────────────────────────────
# Lecturers submit their own unavailable windows; admins may file for anyone.
# The conflict engine blocks new placements there with AVAILABILITY.

@router.get('/availability')
def list_unavailability(authorization: str = Header(default='')):
    email, name = _own_name(authorization)
    try:
        from app.data_store import USERS
        role = next((u.get('role') for u in USERS
                     if u.get('email', '').lower() == email.lower()), None)
    except Exception:
        role = None
    if role == 'admin' or not email:
        return STAFF_UNAVAILABILITY
    return [u for u in STAFF_UNAVAILABILITY if u.get('staff') == name]


@router.post('/availability', status_code=201)
def add_unavailability(body: UnavailabilityIn, authorization: str = Header(default='')):
    email, name = _own_name(authorization)
    try:
        from app.data_store import USERS
        role = next((u.get('role') for u in USERS
                     if u.get('email', '').lower() == email.lower()), None)
    except Exception:
        role = None
    staff = (body.staff or '').strip() or name
    if not staff:
        raise HTTPException(status_code=422, detail='staff is required')
    if role != 'admin' and staff != name:
        raise HTTPException(status_code=403, detail='Lecturers may only file their own availability.')
    if staff not in STAFF:
        raise HTTPException(status_code=404, detail=f"Staff '{staff}' not found")
    if body.day is None or not (0 <= int(body.day) < len(DAYS)):
        raise HTTPException(status_code=422, detail=f'day must be 0-{len(DAYS) - 1}')
    if body.slot is not None and not (0 <= int(body.slot) < len(TIME_SLOTS)):
        raise HTTPException(status_code=422, detail=f'slot must be 0-{len(TIME_SLOTS) - 1}')
    entry = {'id': f'unav-{uuid4().hex[:8]}', 'staff': staff,
             'day': int(body.day),
             'slot': None if body.slot is None else int(body.slot),
             'reason': (body.reason or '').strip()}
    STAFF_UNAVAILABILITY.append(entry)
    _persist_unav()
    return entry


@router.delete('/availability/{entry_id}')
def delete_unavailability(entry_id: str, authorization: str = Header(default='')):
    email, name = _own_name(authorization)
    try:
        from app.data_store import USERS
        role = next((u.get('role') for u in USERS
                     if u.get('email', '').lower() == email.lower()), None)
    except Exception:
        role = None
    target = next((u for u in STAFF_UNAVAILABILITY if u.get('id') == entry_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Entry '{entry_id}' not found")
    if role != 'admin' and target.get('staff') != name:
        raise HTTPException(status_code=403, detail='Lecturers may only remove their own entries.')
    STAFF_UNAVAILABILITY[:] = [u for u in STAFF_UNAVAILABILITY if u.get('id') != entry_id]
    _persist_unav()
    return {'ok': True, 'deleted': entry_id}
