"""
Schedule version endpoints.

GET    /api/versions              → list all versions
GET    /api/versions/{id}         → one version
POST   /api/versions              → create a new draft
POST   /api/versions/{id}/publish → publish a draft
POST   /api/versions/{id}/archive → archive a published version
DELETE /api/versions/{id}         → delete a draft
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from app.models.schema import ScheduleVersion
from app.data_store import VERSIONS
from app.database import delete_version, save_version
from app.routers.auth import require_admin, get_email_from_auth

router = APIRouter()


# ── Version snapshots (SCH-FR-07): frozen grid per published version ─────────
# In-memory cache + DB persistence (SettingRow key f'snapshot:{id}') so an
# admin can open any old version after edits. Never affects the live grid.

SNAPSHOTS: dict[str, dict] = {}


def _dump_session(sess) -> dict | None:
    if sess is None:
        return None
    if isinstance(sess, dict):
        return dict(sess)
    try:
        return sess.model_dump()
    except Exception:
        return {"id": getattr(sess, 'id', '?'), "code": getattr(sess, 'code', ''),
                "name": getattr(sess, 'name', ''), "staff": getattr(sess, 'staff', ''),
                "group": getattr(sess, 'group', ''), "slot": getattr(sess, 'slot', 0)}


def _serialize_grid(timetable: dict) -> dict:
    out: dict = {}
    for view, rows in (timetable or {}).items():
        out[view] = {}
        for row, days in (rows or {}).items():
            out[view][row] = {}
            for day, slots in (days or {}).items():
                if isinstance(slots, dict):
                    out[view][row][str(day)] = {
                        str(s): _dump_session(sess) for s, sess in slots.items()}
                else:
                    out[view][row][str(day)] = _dump_session(slots)
    return out


def _snapshot_key(version_id: str) -> str:
    return f'snapshot:{version_id}'


def save_snapshot(version_id: str) -> None:
    """Freeze the current grid under a version id (memory + DB). Never raises."""
    try:
        from app.data_store import TIMETABLE
        data = _serialize_grid(TIMETABLE)
        SNAPSHOTS[version_id] = data
    except Exception:
        return
    try:
        from app.database import save_setting
        save_setting(_snapshot_key(version_id), data)
    except Exception:
        pass


def load_snapshot(version_id: str) -> dict | None:
    """Memory first, then DB. None when this version was never snapshotted."""
    if version_id in SNAPSHOTS:
        return SNAPSHOTS[version_id]
    try:
        from app.database import SessionLocal
        from app.database import SettingRow
        with SessionLocal() as db:
            row = db.get(SettingRow, _snapshot_key(version_id))
            if row is None or not row.value:
                return None
            import json as _json
            data = _json.loads(row.value)
            SNAPSHOTS[version_id] = data
            return data
    except Exception:
        return None


# Seed snapshot: the bundled published version reflects the seed grid,
# so it is viewable even before the first new publish in this deployment.
try:
    from app.data_store import TIMETABLE as _SEED_TT, VERSIONS as _SEED_V
    if any(v.id == 'pub-1' and v.status == 'published' for v in _SEED_V):
        SNAPSHOTS.setdefault('pub-1', _serialize_grid(_SEED_TT))
except Exception:
    pass


@router.get('', response_model=list[ScheduleVersion])
def list_versions():
    return VERSIONS


@router.get('/{version_id}', response_model=ScheduleVersion)
def get_version(version_id: str):
    v = next((v for v in VERSIONS if v.id == version_id), None)
    if v is None:
        raise HTTPException(status_code=404, detail=f"Version '{version_id}' not found")
    return v


def _flatten(grid: dict) -> dict[str, dict]:
    """session id -> {code,name,staff,group,room,day,slot} across all views."""
    out: dict[str, dict] = {}
    for view, rows in (grid or {}).items():
        for row, days in (rows or {}).items():
            if not isinstance(days, dict):
                continue
            for day, slots in days.items():
                cells = list(slots.items()) if isinstance(slots, dict) else [(0, slots)]
                for slot, s in cells:
                    if s is None:
                        continue
                    g = s.get if isinstance(s, dict) else None
                    def _gv(attr: str, default=None):
                        return g(attr, default) if g else getattr(s, attr, default)
                    sid = str(_gv('id', f'{view}/{row}/{day}/{slot}'))
                    try:
                        di, si = int(day), int(slot)
                    except Exception:
                        di, si = day, slot
                    out[sid] = {'id': sid, 'code': _gv('code', ''), 'name': _gv('name', ''),
                                'staff': _gv('staff', ''), 'group': _gv('group', ''),
                                'room': row, 'day': di, 'slot': si if isinstance(si, int) else _gv('slot', 0)}
    return out


def _version_grid_or_live(version_id: str) -> tuple[dict, str]:
    """Grid content for compare: frozen snapshot, live draft, or reconstructed."""
    v = next((x for x in VERSIONS if x.id == version_id), None)
    if v is None:
        raise HTTPException(status_code=404, detail=f"Version '{version_id}' not found")
    data = load_snapshot(version_id)
    if data is not None:
        return data, 'frozen'
    if v.status == 'draft':
        from app.data_store import TIMETABLE
        return _serialize_grid(TIMETABLE), 'live'
    data, _gaps = reconstruct_grid_at(v.timestamp)
    return data, 'reconstructed'


@router.get('/{a_id}/compare/{b_id}')
def compare_versions(a_id: str, b_id: str):
    """Side-by-side diff: added / removed / moved sessions from A to B."""
    ga, ma = _version_grid_or_live(a_id)
    gb, mb = _version_grid_or_live(b_id)
    fa, fb = _flatten(ga), _flatten(gb)
    added = [fb[k] for k in fb.keys() - fa.keys()]
    removed = [fa[k] for k in fa.keys() - fb.keys()]
    moved = []
    for k in fa.keys() & fb.keys():
        x, y = fa[k], fb[k]
        if (x['room'], x['day'], x['slot']) != (y['room'], y['day'], y['slot']):
            moved.append({'id': k, 'code': y['code'] or x['code'],
                          'from': {'room': x['room'], 'day': x['day'], 'slot': x['slot']},
                          'to': {'room': y['room'], 'day': y['day'], 'slot': y['slot']}})
    key = lambda r: (str(r.get('room', '')), str(r.get('day', '')), str(r.get('slot', '')))
    return {'a': {'id': a_id, 'mode': ma}, 'b': {'id': b_id, 'mode': mb},
            'added': sorted(added, key=key), 'removed': sorted(removed, key=key),
            'moved': sorted(moved, key=lambda m: str(m['id'])),
            'counts': {'added': len(added), 'removed': len(removed), 'moved': len(moved)}}


def _parse_ts(ts: str | None):
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')) if ts else None
    except Exception:
        return None


def reconstruct_grid_at(published_at: str | None) -> tuple[dict, bool]:
    """Rebuild the grid as it was at `published_at` by rewinding cell-level
    audit history (newest first, restoring each cell's `before` image).
    Returns (grid, gaps) — gaps=True when some changes (e.g. conflict-apply
    moves, structural edits) carry no cell-level before-image.
    Best effort: labeled as such to the viewer."""
    from app.data_store import TIMETABLE, AUDIT_LOGS
    grid = _serialize_grid(TIMETABLE)
    gaps = False
    ts = _parse_ts(published_at)
    try:
        events = sorted(
            (e for e in (AUDIT_LOGS or [])
             if (e.get('action') if isinstance(e, dict) else getattr(e, 'action', ''))
             in ('timetable_update', 'conflict_apply')),
            key=lambda e: str(e.get('created_at') if isinstance(e, dict)
                              else getattr(e, 'created_at', '')),
            reverse=True)
    except Exception:
        return grid, True
    for e in events:
        act = e.get('action') if isinstance(e, dict) else getattr(e, 'action', '')
        created = e.get('created_at') if isinstance(e, dict) else getattr(e, 'created_at', '')
        if ts is not None and _parse_ts(created) is not None and _parse_ts(created) <= ts:
            break
        if act != 'timetable_update':
            gaps = True
            continue
        eid = e.get('entity_id') if isinstance(e, dict) else getattr(e, 'entity_id', '')
        parts = str(eid).split('/')
        if len(parts) != 4:
            gaps = True
            continue
        _view, _row, _day, _slot = parts
        before = e.get('before') if isinstance(e, dict) else getattr(e, 'before', None)
        try:
            grid.setdefault(_view, {}).setdefault(_row, {}).setdefault(_day, {})[_slot] = before
        except Exception:
            gaps = True
            continue
    return grid, gaps


@router.get('/{version_id}/snapshot')
def get_version_snapshot(version_id: str):
    """Read-only grid of a version. Published/archived come from the frozen
    snapshot; drafts share the live grid, so they return its current state
    explicitly marked as live."""
    v = next((v for v in VERSIONS if v.id == version_id), None)
    if v is None:
        raise HTTPException(status_code=404, detail=f"Version '{version_id}' not found")
    data = load_snapshot(version_id)
    live = False
    mode = 'frozen'
    gaps = False
    if data is None:
        if v.status == 'draft':
            from app.data_store import TIMETABLE
            data = _serialize_grid(TIMETABLE)
            live = True
            mode = 'live'
        else:
            # No frozen copy (published before history tracking):
            # rebuild from audit trail so the old table still shows.
            data, gaps = reconstruct_grid_at(v.timestamp)
            mode = 'reconstructed'
    sessions = sum(
        1 for _view_rows in (data or {}).values() for _days in _view_rows.values()
        for _slots in (list(_days.values()) if isinstance(_days, dict) else [_days])
        for _s in (list(_slots.values()) if isinstance(_slots, dict) else [_slots])
        if _s is not None)
    return {'version': v.model_dump(), 'sessions': sessions, 'live': live,
            'mode': mode, 'gaps': gaps, 'grid': data}


class VersionCreate(BaseModel):
    label: str
    author: str = 'Scheduler'


@router.post('', response_model=ScheduleVersion, status_code=201)
def create_version(
    body: VersionCreate | None = None,
    label: str | None = None,
    author: str = 'Scheduler',
    authorization: str = Header(default=''),
):
    """Create a new draft version. Accepts JSON body or query params for backward compatibility."""
    require_admin(authorization)
    if body is not None:
        label = body.label
        author = body.author
    if not label:
        raise HTTPException(status_code=422, detail='label is required')
    new_id = f"v{len(VERSIONS) + 1}"
    latest_conflicts = next((v.conflicts for v in VERSIONS if v.status == 'draft'), 0)
    new_version = ScheduleVersion(
        id=new_id,
        label=label,
        status='draft',
        timestamp=datetime.now(timezone.utc).isoformat(),
        author=author,
        changes=0,
        conflicts=latest_conflicts,
    )
    VERSIONS.insert(0, new_version)
    save_version(new_version)
    try:
        from app.services.audit import log_audit
        actor = get_email_from_auth(authorization) or "admin@bua.edu.eg"
        log_audit(actor, "version_create", "version", new_version.id, message=f"Created draft '{new_version.label}'", after=new_version)
    except Exception:
        pass
    return new_version


@router.post('/{version_id}/publish', response_model=ScheduleVersion)
def publish_version(version_id: str, authorization: str = Header(default='')):
    require_admin(authorization)
    from app import data_store
    idx = next((i for i, v in enumerate(VERSIONS) if v.id == version_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Version '{version_id}' not found")
    v = VERSIONS[idx]
    if v.status == 'published':
        refreshed = v.model_copy(update={'timestamp': datetime.now(timezone.utc).isoformat()})
        VERSIONS[idx] = refreshed
        save_version(refreshed)
        try:
            from app.services.audit import log_audit
            actor = get_email_from_auth(authorization) or "admin@bua.edu.eg"
            log_audit(actor, "publish_refresh", "version", version_id, message=f"Refreshed publish timestamp for '{v.label}'", before=v, after=refreshed)
        except Exception:
            pass
        return refreshed
    if v.status != 'draft':
        raise HTTPException(status_code=409, detail=f"Version '{version_id}' is not a draft")
    # Archive existing published version
    for i, existing in enumerate(VERSIONS):
        if existing.status == 'published':
            VERSIONS[i] = existing.model_copy(update={'status': 'archived'})
            save_version(VERSIONS[i])
    from app.services.refresh import refresh_conflicts
    total = refresh_conflicts()
    VERSIONS[idx] = v.model_copy(
        update={'status': 'published',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'conflicts': total}
    )
    save_version(VERSIONS[idx])
    save_snapshot(VERSIONS[idx].id)
    from app.services.notifications import notify_users
    notify_users(data_store.USERS, type='publish',
                 message=f"Schedule '{VERSIONS[idx].label}' was published with {total} open conflicts.",
                 related_id=VERSIONS[idx].id)
    try:
        from app.services.audit import log_audit
        actor = get_email_from_auth(authorization) or "admin@bua.edu.eg"
        log_audit(actor, "publish", "version", VERSIONS[idx].id, message=f"Published '{VERSIONS[idx].label}'", before=v, after=VERSIONS[idx])
    except Exception:
        pass
    return VERSIONS[idx]


@router.post('/{version_id}/archive', response_model=ScheduleVersion)
def archive_version(version_id: str, authorization: str = Header(default='')):
    require_admin(authorization)
    idx = next((i for i, v in enumerate(VERSIONS) if v.id == version_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Version '{version_id}' not found")
    before = VERSIONS[idx]
    VERSIONS[idx] = VERSIONS[idx].model_copy(update={'status': 'archived'})
    save_version(VERSIONS[idx])
    try:
        from app.services.audit import log_audit
        actor = get_email_from_auth(authorization) or "admin@bua.edu.eg"
        log_audit(actor, "archive", "version", version_id, message=f"Archived '{before.label}'", before=before, after=VERSIONS[idx])
    except Exception:
        pass
    return VERSIONS[idx]


@router.delete('/{version_id}')
def delete_version(version_id: str, authorization: str = Header(default='')):
    require_admin(authorization)
    original_len = len(VERSIONS)
    matching = next((v for v in VERSIONS if v.id == version_id), None)
    if matching is None:
        raise HTTPException(status_code=404, detail=f"Version '{version_id}' not found")
    if matching.status != 'draft':
        raise HTTPException(status_code=409, detail='Only draft versions can be deleted')
    VERSIONS[:] = [v for v in VERSIONS if v.id != version_id]
    delete_version(version_id)
    try:
        from app.services.audit import log_audit
        actor = get_email_from_auth(authorization) or "admin@bua.edu.eg"
        log_audit(actor, "delete", "version", version_id, message=f"Deleted draft '{matching.label}'", before=matching)
    except Exception:
        pass
    return {'ok': True, 'deleted': version_id}
