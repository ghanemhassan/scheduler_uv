"""Automatic conflict detection over the live timetable grid.

Scans rooms+labs views (staff view mirrors sessions, so it is excluded to
avoid false positives) and reports:
- staff_overlap: same staff in 2+ sessions at the same day+slot
- student_group: same group in 2+ sessions at the same day+slot
- capacity: enrolled > room capacity
"""

from __future__ import annotations

from app.models.schema import Conflict, ConflictCell


def _iter_sessions(timetable: dict):
    """Yield (view, row, day, slot, session)."""
    for view in ('rooms', 'labs'):
        for row, days in (timetable.get(view) or {}).items():
            if not isinstance(days, dict):
                continue
            for day, slots in days.items():
                if not isinstance(slots, dict):
                    continue
                for slot, session in slots.items():
                    if session is None:
                        continue
                    yield view, row, int(day), int(slot), session


def _get(session, attr: str, default=None):
    if isinstance(session, dict):
        return session.get(attr, default)
    return getattr(session, attr, default)


def _safe_id(*parts: str) -> str:
    return 'auto-' + '-'.join(
        ''.join(ch if ch.isalnum() else '_' for ch in str(p)) for p in parts
    )


def detect_all_conflicts(timetable: dict, rooms: list) -> list[Conflict]:
    capacity_by_room = {}
    for r in rooms or []:
        name = r.get('name') if isinstance(r, dict) else getattr(r, 'name', None)
        cap = r.get('capacity') if isinstance(r, dict) else getattr(r, 'capacity', 0)
        if name:
            capacity_by_room[name] = cap or 0

    staff_slots: dict[tuple, list] = {}
    group_slots: dict[tuple, list] = {}
    conflicts: list[Conflict] = []

    for view, row, day, slot, session in _iter_sessions(timetable):
        staff = _get(session, 'staff')
        group = _get(session, 'group')
        enrolled = _get(session, 'enrolled', 0) or 0
        code = _get(session, 'code', '')
        if staff:
            staff_slots.setdefault((staff, day, slot), []).append((view, row, session))
        if group:
            group_slots.setdefault((group, day, slot), []).append((view, row, session))
        cap = capacity_by_room.get(row)
        if cap is not None and enrolled > cap:
            conflicts.append(Conflict(
                id=_safe_id('capacity', row, day, slot),
                type='capacity', severity='hard',
                description=f'{code}: {enrolled} enrolled exceeds {row} capacity {cap}.',
                cell=ConflictCell(row=row, day=day, slot=slot),
                alternatives=suggest_alternatives(
                    timetable, rooms, staff, group, enrolled, day, slot, exclude_row=row,
                ),
            ))

    for (staff, day, slot), places in staff_slots.items():
        if len(places) > 1:
            rows = ', '.join(f'{r}' for _, r, _ in places)
            view, row, _ = places[0]
            _s0 = places[0][2]
            conflicts.append(Conflict(
                id=_safe_id('staff_overlap', staff, day, slot),
                type='staff_overlap', severity='hard',
                description=f'{staff} double-booked at day {day} slot {slot}: {rows}.',
                cell=ConflictCell(row=row, day=day, slot=slot),
                alternatives=suggest_alternatives(
                    timetable, rooms, staff, _get(_s0, 'group'),
                    _get(_s0, 'enrolled', 0) or 0, day, slot,
                    search_all_slots=True,
                ),
            ))

    for (group, day, slot), places in group_slots.items():
        if len(places) > 1:
            rows = ', '.join(f'{r}' for _, r, _ in places)
            view, row, _ = places[0]
            _s0 = places[0][2]
            conflicts.append(Conflict(
                id=_safe_id('student_group', group, day, slot),
                type='student_group', severity='hard',
                description=f'Group {group} has {len(places)} sessions at day {day} slot {slot}: {rows}.',
                cell=ConflictCell(row=row, day=day, slot=slot),
                alternatives=suggest_alternatives(
                    timetable, rooms, _get(_s0, 'staff'), group,
                    _get(_s0, 'enrolled', 0) or 0, day, slot,
                    search_all_slots=True,
                ),
            ))

    return conflicts


def _find_room(rooms: list, name: str | None):
    if not name:
        return None
    for r in rooms or []:
        rname = r.get('name') if isinstance(r, dict) else getattr(r, 'name', None)
        if rname == name:
            return r
    # partial match fallback
    for r in rooms or []:
        rname = r.get('name') if isinstance(r, dict) else getattr(r, 'name', None)
        if rname and name.lower() in rname.lower():
            return r
    return None


def _room_prop(room, prop: str, default=None):
    if room is None:
        return default
    if isinstance(room, dict):
        return room.get(prop, default)
    return getattr(room, prop, default)


def _mk_conflict(code: str, en: str, ar: str) -> dict:
    # description kept for backward-compat with old UI; new UI prefers message_ar
    return {"conflict_type": code, "description": en, "message_en": en, "message_ar": ar}


def _day_label(day: int | None) -> str:
    try:
        from app.data_store import DAYS
        if day is not None and 0 <= int(day) < len(DAYS):
            return DAYS[int(day)]
    except Exception:
        pass
    return f"day {day}"


def _slot_free(timetable: dict, view: str, row: str, day: int, slot: int, exclude_id: str | None = None) -> bool:
    try:
        cell = ((timetable.get(view) or {}).get(row) or {}).get(day)
        if isinstance(cell, dict):
            s = cell.get(slot)
            if s is None:
                return True
            # ignore the session being edited so it never clashes with itself
            if exclude_id is not None and _get(s, 'id') == exclude_id:
                return True
            return False
        return cell is None
    except Exception:
        return False


def _staff_busy(timetable: dict, staff: str | None, day: int, slot: int, exclude_id: str | None = None) -> bool:
    if not staff:
        return False
    for view, row, d, s, session in _iter_sessions(timetable):
        if exclude_id is not None and _get(session, 'id') == exclude_id:
            continue
        if d == day and s == slot and _get(session, 'staff') == staff:
            return True
    return False


def _group_busy(timetable: dict, group: str | None, day: int, slot: int, exclude_id: str | None = None) -> bool:
    if not group:
        return False
    for view, row, d, s, session in _iter_sessions(timetable):
        if exclude_id is not None and _get(session, 'id') == exclude_id:
            continue
        if d == day and s == slot and _get(session, 'group') == group:
            return True
    return False


def _find_session_day(timetable: dict, sess_id: str | None) -> int | None:
    """Current weekday of a session id (used to grandfather same-day edits)."""
    if not sess_id:
        return None
    for _view, _row, d, _s, session in _iter_sessions(timetable):
        if _get(session, 'id') == sess_id:
            return d
    return None


def suggest_alternatives(
    timetable: dict, rooms: list, staff: str | None, group: str | None,
    enrolled: int, day: int, slot: int, exclude_row: str | None = None,
    limit: int = 3, search_all_slots: bool = False,
    required_equipment: list[str] | str | None = None,
    teaching_days: dict | None = None,
) -> list:
    """Rank feasible rooms/slots (SCH-FR-06) with a deterministic multi-factor score.

    score = 100 − capacity waste − time penalty − utilization penalty + equipment bonus
      - capacity fit: −(room capacity − enrolled)
      - equipment match: rooms missing required equipment are excluded;
        +up to 5 for working-unit headroom on required (or the room's own
        per-student) equipment
      - staff preference: days outside the staff teaching days are excluded
      - compactness: same cell −0, same day −10, other day −20
      - room utilization: −(room used % // 20), slightly preferring emptier rooms
    With search_all_slots, scan every day/slot (ranked best-first) instead of
    only the conflicting cell — so at least three appear when available.
    Reasons list every satisfied preference; different-time entries are marked
    as trade-offs. Never writes.
    """
    from app.models.schema import Alternative
    try:
        from app.data_store import DAYS as _DAYS, TIME_SLOTS as _SLOTS
    except Exception:
        _DAYS, _SLOTS = [], []
    try:
        from app.data_store import ROOM_EQUIPMENT as _INV
    except Exception:
        _INV = {}
    if teaching_days is None:
        try:
            from app.data_store import STAFF_TEACHING_DAYS as teaching_days
        except Exception:
            teaching_days = {}
    need = ([required_equipment] if isinstance(required_equipment, str)
            else list(required_equipment or []))
    allowed_days = (teaching_days or {}).get(staff) if staff else None
    # current utilization per room (rooms view) for the utilization factor
    rooms_view = (timetable.get('rooms', {}) or {})
    util_pct: dict[str, int] = {}
    for _r in rooms or []:
        _nm = _r.get('name') if isinstance(_r, dict) else getattr(_r, 'name', None)
        if not _nm:
            continue
        _t, _u = 0, 0
        for _ds in ((rooms_view.get(_nm, {}) or {}).values()):
            _cells = _ds.values() if isinstance(_ds, dict) else [_ds]
            for _c in _cells:
                _t += 1
                if _c is not None:
                    _u += 1
        util_pct[_nm] = round(_u / _t * 100) if _t else 0
    cells = [(day, slot)] if not search_all_slots else [
        (d, s) for d in range(len(_DAYS) or 5) for s in range(len(_SLOTS) or 10)]
    out = []
    for d, s in cells:
        if allowed_days is not None and d not in [int(x) for x in allowed_days]:
            continue
        for r in rooms or []:
            name = r.get('name') if isinstance(r, dict) else getattr(r, 'name', None)
            cap = r.get('capacity') if isinstance(r, dict) else getattr(r, 'capacity', 0)
            status = r.get('status') if isinstance(r, dict) else getattr(r, 'status', 'Available')
            robj_equip = r.get('equipment') if isinstance(r, dict) else getattr(r, 'equipment', []) or []
            if not name or name == exclude_row or status != 'Available':
                continue
            if (cap or 0) < (enrolled or 0):
                continue
            if need and any(e not in (robj_equip or []) for e in need):
                continue
            rinv = ((_INV or {}).get(name, {})) or {}
            qty_items = need if need else [
                e for e, q in rinv.items() if isinstance(q, dict) and q.get('per_student')]
            headroom = None
            fits_qty = True
            for e in qty_items:
                q = rinv.get(e)
                if not isinstance(q, dict) or not q.get('per_student'):
                    continue
                working = int(q.get('working', 0) or 0)
                if (enrolled or 0) > working:
                    fits_qty = False
                    break
                h = working - (enrolled or 0)
                headroom = h if headroom is None else min(headroom, h)
            if not fits_qty:
                continue
            if not _slot_free(timetable, 'rooms', name, d, s):
                continue
            if _staff_busy(timetable, staff, d, s):
                continue
            if _group_busy(timetable, group, d, s):
                continue
            waste = max(0, (cap or 0) - (enrolled or 0))
            time_pen = 0 if (d == day and s == slot) else (10 if d == day else 20)
            util_pen = (util_pct.get(name, 0) or 0) // 20
            equip_bonus = min(5, (headroom or 0) // 10) if headroom is not None else 0
            score = max(0, min(100, 100 - waste - time_pen - util_pen + equip_bonus))
            day_label = _DAYS[d] if 0 <= d < len(_DAYS) else f'day {d}'
            slot_label = _SLOTS[s] if 0 <= s < len(_SLOTS) else f'slot {s}'
            reasons = [f'Capacity {cap} fits {enrolled} (waste {waste})']
            if need:
                reasons.append(f'Equipment match: {", ".join(need)}')
            elif qty_items:
                reasons.append(f'Equipment ready: {", ".join(qty_items)}')
            if allowed_days is not None:
                reasons.append(f'Staff teaches {day_label}')
            if d == day and s == slot:
                reasons.append('Same time retained')
            else:
                reasons.append(('Same day, other time' if d == day else 'Different day') + ' — trade-off')
            reasons.append(f'Room {util_pct.get(name, 0)}% used')
            out.append(Alternative(
                id=f'alt-{name}-{d}-{s}'.replace(' ', '_'),
                score=score,
                day=d, slot=s, room=name,
                reasons=reasons,
            ))
    out.sort(key=lambda a: -a.score)
    return out[:limit]


def check_candidate(
    timetable: dict, rooms: list, staff: str | None = None, room: str | None = None,
    day: int | None = None, slot: int = 0, group: str | None = None,
    enrolled: int = 0, required_equipment: list[str] | str | None = None,
    room_type_required: str | None = None, duration_slots: int = 1,
    exclude_session_id: str | None = None,
    teaching_days: dict | None = None, equipment_inventory: dict | None = None,
    n_slots: int | None = None, holidays: list | None = None,
    unavailability: list | None = None,
) -> tuple[bool, list[dict], list]:
    """Evaluate a hypothetical placement; returns (ok, conflicts, recommendations).
    Deterministic SCH-FR-05 baseline. Bilingual messages (message_ar/message_en),
    description kept for backward-compat. Never writes.
    teaching_days / equipment_inventory / n_slots default to the project data
    layer; tests inject their own maps.
    """
    conflicts: list[dict] = []
    if day is None:
        return False, [_mk_conflict('INVALID_DAY', 'Day is required.', 'اليوم مطلوب — اختاري اليوم.')], []
    duration = max(1, int(duration_slots or 1))
    if n_slots is None:
        try:
            from app.data_store import TIME_SLOTS
            n_slots = len(TIME_SLOTS)
        except Exception:
            n_slots = 10
    dl = _day_label(day)

    # DURATION_OVERFLOW — consecutive slots must exist
    if slot + duration > n_slots:
        conflicts.append(_mk_conflict(
            'DURATION_OVERFLOW',
            f'Duration {duration} slot(s) from slot {slot} overflows timetable ({n_slots} slots).',
            f'المدة {duration} حصص من الحصة {slot} بتخرج بره الجدول.',
        ))

    wanted_slots = list(range(slot, min(slot + duration, n_slots)))

    # HOLIDAY — whole weekday closure (SCH-FR-01 planning data)
    if holidays is None:
        try:
            from app.data_store import HOLIDAYS as holidays
        except Exception:
            holidays = []
    _hol = next((h for h in (holidays or [])
                 if int(h.get('day', -1)) == day), None) if isinstance(holidays, list) else None
    if _hol is not None:
        _label = _hol.get('label', 'Holiday')
        conflicts.append(_mk_conflict(
            'HOLIDAY',
            f'{dl} is a holiday ({_label}) — no teaching allowed.',
            f'يوم {dl} أجازة ({_label}) — مينفعش تحط فيه أي محاضرة.',
        ))

    if room:
        robj = _find_room(rooms, room)
        if robj is None:
            conflicts.append(_mk_conflict('INVALID_ROOM', f'Room not found: {room}.', f'القاعة مش موجودة: {room}.'))
        else:
            cap = _room_prop(robj, 'capacity', 0) or 0
            status = _room_prop(robj, 'status', 'Available')
            rtype = _room_prop(robj, 'type', '') or ''
            equip = _room_prop(robj, 'equipment', []) or []
            # CAPACITY — عدد كبير على الأوضة
            if (enrolled or 0) > (cap or 0):
                conflicts.append(_mk_conflict(
                    'CAPACITY',
                    f'Room {room} capacity {cap} < enrolled {enrolled}.',
                    f'عدد الطلاب ({enrolled}) أكبر من سعة القاعة {room} ({cap}).',
                ))
            # CLOSURE — قاعة مقفولة / صيانة
            if status != 'Available':
                conflicts.append(_mk_conflict(
                    'CLOSURE',
                    f'Room {room} is {status} — not bookable.',
                    f'القاعة {room} حالتها {status} — مينفعش تحجزي فيها.',
                ))
            # ROOM_TYPE_MISMATCH — عملي محتاج معمل
            if room_type_required:
                need = room_type_required.lower()
                rt = rtype.lower()
                is_lab_need = any(k in need for k in ['lab', 'معمل', 'practical', 'عملي', 'science', 'computer', 'workshop'])
                is_lab_room = any(k in rt for k in ['lab', 'workshop', 'معمل'])
                if is_lab_need and not is_lab_room:
                    conflicts.append(_mk_conflict(
                        'ROOM_TYPE_MISMATCH',
                        f"Room {room} type '{rtype}' != required '{room_type_required}'.",
                        f'نوع القاعة {room} ({rtype}) مش مناسب — المطلوب: {room_type_required}.',
                    ))
            # EQUIPMENT — معدات ناقصة
            if required_equipment:
                need_list = [required_equipment] if isinstance(required_equipment, str) else list(required_equipment)
                missing = [e for e in need_list if e not in (equip or [])]
                if missing:
                    conflicts.append(_mk_conflict(
                        'EQUIPMENT',
                        f"Room {room} lacks required equipment: {', '.join(missing)}.",
                        f"القاعة {room} مفيهاش المعدات المطلوبة: {', '.join(missing)}.",
                    ))
            # EQUIPMENT QUANTITY — working units vs students
            # (e.g. lab holds 30 devices but only 20 work: 30 students are blocked)
            if equipment_inventory is None:
                try:
                    from app.data_store import ROOM_EQUIPMENT as _room_inv
                except Exception:
                    _room_inv = {}
            else:
                _room_inv = equipment_inventory
            inv = ((_room_inv or {}).get(room, {})) or {}
            qty_targets = need_list if required_equipment else [
                e for e, q in inv.items() if isinstance(q, dict) and q.get('per_student')
            ]
            for e in qty_targets:
                q = inv.get(e)
                if not isinstance(q, dict) or not q.get('per_student'):
                    continue
                working = int(q.get('working', 0) or 0)
                total = int(q.get('total', working) or working)
                if (enrolled or 0) > working:
                    conflicts.append(_mk_conflict(
                        'EQUIPMENT',
                        f'Room {room} has only {working} working {e} (of {total}) — not enough for {enrolled} students.',
                        f'القاعة {room} فيها {working} {e} شغالين بس (من أصل {total}) — مش كفاية لـ {enrolled} طالب.',
                    ))
            # AVAILABILITY — teaching days (e.g. doctor comes Wed only, admin wants Monday)
            if staff:
                if teaching_days is None:
                    try:
                        from app.data_store import STAFF_TEACHING_DAYS as _teaching_days
                    except Exception:
                        _teaching_days = {}
                else:
                    _teaching_days = teaching_days
                allowed = (_teaching_days or {}).get(staff)
                if allowed is not None and day not in [int(d) for d in allowed]:
                    # grandfather: editing a session without moving it off its current day
                    current_day = _find_session_day(timetable, exclude_session_id) if exclude_session_id else None
                    if current_day != day:
                        try:
                            from app.data_store import DAYS as _days
                        except Exception:
                            _days = []
                        ar_names = {'Mon': 'الاثنين', 'Tue': 'الثلاثاء', 'Wed': 'الأربعاء',
                                    'Thu': 'الخميس', 'Fri': 'الجمعة',
                                    'Monday': 'الاثنين', 'Tuesday': 'الثلاثاء', 'Wednesday': 'الأربعاء',
                                    'Thursday': 'الخميس', 'Friday': 'الجمعة'}
                        allowed_en = ', '.join([_days[d] if 0 <= d < len(_days) else str(d) for d in allowed])
                        allowed_ar = ', '.join([ar_names.get(_days[d] if 0 <= d < len(_days) else str(d), str(d)) for d in allowed])
                        conflicts.append(_mk_conflict(
                            'AVAILABILITY',
                            f'{staff} teaches only on {allowed_en} — not available at {dl}.',
                            f'الدكتور {staff} بييجي {allowed_ar} بس — مش متاح في الوقت ده ({dl}).',
                        ))
            # ROOM_BUSY — مكان متاخد (check every slot in duration, rooms+labs views)
            for s in wanted_slots:
                busy = (not _slot_free(timetable, 'rooms', room, day, s, exclude_session_id)
                        or not _slot_free(timetable, 'labs', room, day, s, exclude_session_id))
                if busy:
                    conflicts.append(_mk_conflict(
                        'ROOM_BUSY',
                        f'Room {room} is occupied at {dl} slot {s}.',
                        f'القاعة/المعمل {room} محجوزة في نفس الوقت ({dl} حصة {s}).',
                    ))
                    break
    # STAFF_BUSY — الدكتور مش فاضي / عنده محاضرة تانية
    if staff:
        for s in wanted_slots:
            if _staff_busy(timetable, staff, day, s, exclude_session_id):
                conflicts.append(_mk_conflict(
                    'STAFF_BUSY',
                    f'{staff} already teaches at {dl} slot {s}.',
                    f'الدكتور {staff} عنده محاضرة تانية في نفس الوقت ({dl} حصة {s}).',
                ))
                break
    # AVAILABILITY (requests) — lecturer-submitted unavailable windows (SCH-FR-03)
    if staff:
        if unavailability is None:
            try:
                from app.data_store import STAFF_UNAVAILABILITY as unavailability
            except Exception:
                unavailability = []
        for _u in (unavailability or []):
            if (_u.get('staff') or '') != staff:
                continue
            try:
                _ud = int(_u.get('day', -1))
            except Exception:
                continue
            if _ud != day:
                continue
            _us = _u.get('slot', None)
            hit = (_us is None) or any(int(_us) == s for s in wanted_slots)
            if not hit:
                continue
            _reason = (_u.get('reason') or '').strip()
            conflicts.append(_mk_conflict(
                'AVAILABILITY',
                f'{staff} marked unavailable at {dl}' + (f' slot {_us}.' if _us is not None else '.')
                + (f' Reason: {_reason}' if _reason else ''),
                f'الدكتور {staff} مسجل غير متاح في الوقت ده ({dl})'
                + (f' حصة {_us}.' if _us is not None else '.')
                + (f' السبب: {_reason}' if _reason else ''),
            ))
            break
    # GROUP_CLASH — المجموعة عندها محاضرة تانية
    if group:
        for s in wanted_slots:
            if _group_busy(timetable, group, day, s, exclude_session_id):
                conflicts.append(_mk_conflict(
                    'GROUP_CLASH',
                    f'Group {group} already has a session at {dl} slot {s}.',
                    f'المجموعة {group} عندها محاضرة تانية في نفس الوقت ({dl} حصة {s}).',
                ))
                break
    recs = []
    if conflicts:
        recs = suggest_alternatives(timetable, rooms, staff, group, enrolled, day, slot, exclude_row=room,
                                  required_equipment=required_equipment)
    return (len(conflicts) == 0), conflicts, recs
