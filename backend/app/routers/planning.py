"""
Planning master data (SCH-FR-01): academic terms, holidays, departments.

GET    /api/planning/terms          → list terms
POST   /api/planning/terms          → create term (rejects overlapping ranges)
PUT    /api/planning/terms/{id}     → update term (same overlap rule)
DELETE /api/planning/terms/{id}     → delete term
POST   /api/planning/terms/{id}/activate → mark active term
GET/POST /api/planning/holidays (+DELETE /{id}) → full-day weekday closures
GET/POST /api/planning/departments (+DELETE /{id})
Reads are open; writes require admin.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional

from app import data_store
from app.database import save_setting
from app.routers.auth import require_admin

router = APIRouter()


class TermIn(BaseModel):
    name: str
    start: str  # ISO date
    end: str  # ISO date
    is_active: bool = False


class HolidayIn(BaseModel):
    label: str
    day: int  # weekday index into DAYS
    reason: str = ''


class DepartmentIn(BaseModel):
    name: str
    code: str


def _parse_day(d: str) -> date:
    try:
        return date.fromisoformat(d)
    except Exception:
        raise HTTPException(status_code=422, detail=f'Invalid date (use YYYY-MM-DD): {d}')


def _overlaps(a_start: date, a_end: date, skip_id: str | None = None) -> dict | None:
    for t in data_store.ACADEMIC_TERMS:
        if skip_id is not None and t.get('id') == skip_id:
            continue
        try:
            s, e = _parse_day(t['start']), _parse_day(t['end'])
        except HTTPException:
            continue
        if a_start <= e and s <= a_end:
            return t
    return None


def _persist() -> None:
    try:
        save_setting('terms', data_store.ACADEMIC_TERMS)
    except Exception:
        pass


# ── Terms ──

@router.get('/terms')
def list_terms():
    return data_store.ACADEMIC_TERMS


@router.post('/terms', status_code=201)
def create_term(body: TermIn, authorization: str = Header(default='')):
    require_admin(authorization)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail='name is required')
    s, e = _parse_day(body.start), _parse_day(body.end)
    if s > e:
        raise HTTPException(status_code=422, detail='Term start must be on/before end.')
    clash = _overlaps(s, e)
    if clash:
        raise HTTPException(
            status_code=422,
            detail=f"Term overlaps '{clash.get('name')}' ({clash.get('start')}…{clash.get('end')}).")
    term = {'id': f'term-{uuid4().hex[:8]}', 'name': name,
            'start': body.start, 'end': body.end, 'is_active': bool(body.is_active)}
    if term['is_active']:
        for t in data_store.ACADEMIC_TERMS:
            t['is_active'] = False
    data_store.ACADEMIC_TERMS.append(term)
    _persist()
    return term


@router.put('/terms/{term_id}')
def update_term(term_id: str, body: TermIn, authorization: str = Header(default='')):
    require_admin(authorization)
    t = next((x for x in data_store.ACADEMIC_TERMS if x.get('id') == term_id), None)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Term '{term_id}' not found")
    s, e = _parse_day(body.start), _parse_day(body.end)
    if s > e:
        raise HTTPException(status_code=422, detail='Term start must be on/before end.')
    clash = _overlaps(s, e, skip_id=term_id)
    if clash:
        raise HTTPException(
            status_code=422,
            detail=f"Term overlaps '{clash.get('name')}' ({clash.get('start')}…{clash.get('end')}).")
    t.update({'name': body.name.strip() or t['name'], 'start': body.start,
              'end': body.end, 'is_active': bool(body.is_active)})
    if t['is_active']:
        for x in data_store.ACADEMIC_TERMS:
            if x.get('id') != term_id:
                x['is_active'] = False
    _persist()
    return t


@router.delete('/terms/{term_id}')
def delete_term(term_id: str, authorization: str = Header(default='')):
    require_admin(authorization)
    before = len(data_store.ACADEMIC_TERMS)
    data_store.ACADEMIC_TERMS[:] = [x for x in data_store.ACADEMIC_TERMS if x.get('id') != term_id]
    if len(data_store.ACADEMIC_TERMS) == before:
        raise HTTPException(status_code=404, detail=f"Term '{term_id}' not found")
    _persist()
    return {'ok': True, 'deleted': term_id}


@router.post('/terms/{term_id}/activate')
def activate_term(term_id: str, authorization: str = Header(default='')):
    require_admin(authorization)
    t = next((x for x in data_store.ACADEMIC_TERMS if x.get('id') == term_id), None)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Term '{term_id}' not found")
    for x in data_store.ACADEMIC_TERMS:
        x['is_active'] = (x.get('id') == term_id)
    _persist()
    return t


# ── Holidays (full weekday closures; engine blocks placements with HOLIDAY) ──

@router.get('/holidays')
def list_holidays():
    return data_store.HOLIDAYS


@router.post('/holidays', status_code=201)
def add_holiday(body: HolidayIn, authorization: str = Header(default='')):
    require_admin(authorization)
    try:
        from app.data_store import DAYS
        n_days = len(DAYS)
    except Exception:
        n_days = 5
    if body.day is None or not (0 <= int(body.day) < n_days):
        raise HTTPException(status_code=422, detail=f'day must be 0-{n_days - 1}')
    if not body.label.strip():
        raise HTTPException(status_code=422, detail='label is required')
    if any(int(h.get('day', -1)) == int(body.day) for h in data_store.HOLIDAYS):
        raise HTTPException(status_code=422, detail='That weekday is already a holiday.')
    h = {'id': f'hol-{uuid4().hex[:8]}', 'label': body.label.strip(),
         'day': int(body.day), 'reason': (body.reason or '').strip()}
    data_store.HOLIDAYS.append(h)
    try:
        save_setting('holidays', data_store.HOLIDAYS)
    except Exception:
        pass
    return h


@router.delete('/holidays/{holiday_id}')
def delete_holiday(holiday_id: str, authorization: str = Header(default='')):
    require_admin(authorization)
    before = len(data_store.HOLIDAYS)
    data_store.HOLIDAYS[:] = [x for x in data_store.HOLIDAYS if x.get('id') != holiday_id]
    if len(data_store.HOLIDAYS) == before:
        raise HTTPException(status_code=404, detail=f"Holiday '{holiday_id}' not found")
    try:
        save_setting('holidays', data_store.HOLIDAYS)
    except Exception:
        pass
    return {'ok': True, 'deleted': holiday_id}


# ── Departments ──

@router.get('/departments')
def list_departments():
    return data_store.DEPARTMENTS


@router.post('/departments', status_code=201)
def add_department(body: DepartmentIn, authorization: str = Header(default='')):
    require_admin(authorization)
    if not body.name.strip() or not body.code.strip():
        raise HTTPException(status_code=422, detail='name and code are required')
    if any(d.get('code', '').lower() == body.code.strip().lower() for d in data_store.DEPARTMENTS):
        raise HTTPException(status_code=422, detail='Department code already exists.')
    d = {'id': f'dep-{uuid4().hex[:8]}', 'name': body.name.strip(), 'code': body.code.strip().upper()}
    data_store.DEPARTMENTS.append(d)
    try:
        save_setting('departments', data_store.DEPARTMENTS)
    except Exception:
        pass
    return d


@router.delete('/departments/{dep_id}')
def delete_department(dep_id: str, authorization: str = Header(default='')):
    require_admin(authorization)
    before = len(data_store.DEPARTMENTS)
    data_store.DEPARTMENTS[:] = [x for x in data_store.DEPARTMENTS if x.get('id') != dep_id]
    if len(data_store.DEPARTMENTS) == before:
        raise HTTPException(status_code=404, detail=f"Department '{dep_id}' not found")
    try:
        save_setting('departments', data_store.DEPARTMENTS)
    except Exception:
        pass
    return {'ok': True, 'deleted': dep_id}
