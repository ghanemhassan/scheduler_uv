"""
Chatbot endpoints for SCH scheduling assistant.

POST /api/chatbot/message        → NLU + facts + Arabic answer in one call
GET  /api/chatbot/timetable      → Get timetable data (supports ?staff=&day=)
POST /api/allocations/check      → Validate move (dry-run)
GET  /api/search/rooms           → Search available rooms (?minCapacity=&day=)
GET  /api/analytics/occupancy    → Room occupancy stats
POST /api/chatbot/analyze-image  → Analyze timetable photo (multipart)
GET  /api/chatbot/export-ics     → Export ICS calendar file
"""

from fastapi import APIRouter, Header, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import base64
import io

from app.data_store import (
    TIMETABLE, CONFLICTS, ALL_ROOMS, DAYS, TIME_SLOTS, ROOMS, LABS, STAFF,
    MANAGED_STUDENTS, STUDENT_PROFILE, VERSIONS
)
from app.database import SessionLocal, TimetableCellRow
from sqlalchemy import select
from app.routers.auth import require_admin

router = APIRouter()

# ── Request/Response Models ────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    message: str
    # Optional: live timetable snapshot (formatted JSON text) attached by the
    # frontend "Export & Send" button. Passed to Gemini as core context.
    timetable_json: Optional[str] = None

class ChatResponse(BaseModel):
    intent: str
    entities: dict
    answer_ar: str
    facts: dict
    gemini_used: bool = False

class TimetableRow(BaseModel):
    id: str
    name: str
    code: str
    room: str
    day_name: str
    time: str
    staff: str
    group: str
    capacity: int
    enrolled: int
    color: str

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
    exclude_session_id: Optional[str] = None

class CheckMoveResponse(BaseModel):
    ok: bool
    conflicts: List[dict]
    recommendations: List[dict] = []

class SearchRoomsRequest(BaseModel):
    minCapacity: Optional[int] = None
    day: Optional[str] = None

class RoomInfo(BaseModel):
    id: str
    name: str
    building: str
    floor: int
    type: str
    capacity: int
    examCapacity: int
    status: str
    pct: Optional[int] = None

# ── Helpers ────────────────────────────────────────────────────────────────────

import json as _json
import os as _os
import urllib.request as _urlrequest


def _gemini_answer_sync(user_message: str, timetable_context: str) -> str | None:
    """Call Google Gemini REST API. Returns answer text or None on any failure."""
    api_key = (_os.getenv('GEMINI_API_KEY') or '').strip()
    if not api_key:
        return None
    model = (_os.getenv('GEMINI_MODEL') or 'gemini-3.6-flash').strip()
    system = (
        'You are SCH, the Bua University timetable assistant. '
        'Answer in Arabic (Egyptian dialect is fine). '
        'Base your answer ONLY on the timetable JSON context below; '
        'never invent sessions, rooms, staff, or times. '
        'If the context lacks the needed rows, say so honestly and suggest what to attach. '
        'Format rules (mandatory): reply as short organized bullet points only, '
        'no long paragraphs; keep the whole answer concise so it fits in one message; '
        'always finish with a complete sentence — never stop mid-sentence or mid-list. '
        'Each timetable row carries an explicit time range (HH:MM-HH:MM): always use it '
        'when checking same-day same-time overlaps for staff, rooms, and student groups. '
        'Structure: 1) direct answer first, 2) supporting bullets with day/time/room/code, '
        '3) one closing line (recommendation or next step).'
    )
    body = _json.dumps({
        'system_instruction': {'parts': [{'text': system}]},
        'contents': [{'parts': [{
            'text': f'Timetable context (JSON):\n{timetable_context}\n\nUser question:\n{user_message}'
        }]}],
        'generationConfig': {'temperature': 0.3, 'maxOutputTokens': 2048},
    }).encode('utf-8')
    req = _urlrequest.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=' + api_key,
        data=body, headers={'Content-Type': 'application/json'}, method='POST',
    )
    try:
        with _urlrequest.urlopen(req, timeout=25) as resp:
            payload = _json.loads(resp.read().decode('utf-8'))
        parts = (((payload.get('candidates') or [{}])[0].get('content') or {}).get('parts') or [])
        text = ''.join(p.get('text', '') for p in parts if isinstance(p, dict)).strip()
        return text or None
    except Exception:
        return None


def resolve_day(day_input: Optional[str]) -> Optional[int]:
    """Resolve day name or index to 0-4 index (teaching week Sat-Wed)."""
    if day_input is None:
        return None
    if isinstance(day_input, int):
        return day_input
    try:
        return int(day_input)
    except ValueError:
        pass
    day_map = {
        'saturday': 0, 'sat': 0, 'السبت': 0,
        'sunday': 1, 'sun': 1, 'الأحد': 1, 'الاحد': 1,
        'monday': 2, 'mon': 2, 'الأثنين': 2, 'الاثنين': 2,
        'tuesday': 3, 'tue': 3, 'الثلاثاء': 3,
        'wednesday': 4, 'wed': 4, 'الاربعاء': 4, 'الأربعاء': 4,
    }
    return day_map.get(day_input.lower(), None)

def get_timetable_rows(staff: Optional[str] = None, day: Optional[int] = None) -> List[dict]:
    """Get timetable rows enriched with names (rooms + labs views)."""
    rows = []
    for _view in ('rooms', 'labs'):
        rooms_view = TIMETABLE.get(_view, {})
        for room_name, days in rooms_view.items():
            for day_idx, slots in days.items():
                if day is not None and day_idx != day:
                    continue
                if not isinstance(slots, dict):
                    continue
                for slot_idx, session in slots.items():
                    if session is None:
                        continue
                    # Handle both Session objects and dicts
                    session_staff = session.get('staff') if isinstance(session, dict) else getattr(session, 'staff', None)
                    if staff and session_staff != staff:
                        continue
                    session_name = session.get('name') if isinstance(session, dict) else getattr(session, 'name', '')
                    session_code = session.get('code') if isinstance(session, dict) else getattr(session, 'code', '')
                    session_group = session.get('group') if isinstance(session, dict) else getattr(session, 'group', '')
                    session_capacity = session.get('capacity') if isinstance(session, dict) else getattr(session, 'capacity', 0)
                    session_enrolled = session.get('enrolled') if isinstance(session, dict) else getattr(session, 'enrolled', 0)
                    session_color = session.get('color') if isinstance(session, dict) else getattr(session, 'color', '#2563eb')
                    session_duration = session.get('duration') if isinstance(session, dict) else getattr(session, 'duration', 1)

                    start_time = TIME_SLOTS[slot_idx] if slot_idx < len(TIME_SLOTS) else ''
                    end_slot = min(slot_idx + session_duration, len(TIME_SLOTS) - 1)
                    end_time = TIME_SLOTS[end_slot] if end_slot < len(TIME_SLOTS) else ''

                    rows.append({
                        'id': session.get('id') if isinstance(session, dict) else getattr(session, 'id', ''),
                        'name': session_name,
                        'code': session_code,
                        'room': room_name,
                        'day_name': DAYS[day_idx] if day_idx < len(DAYS) else f'Day {day_idx}',
                        'time': f"{start_time}-{end_time}" if start_time and end_time else start_time,
                        'staff': session_staff,
                        'group': session_group,
                        'capacity': session_capacity,
                        'enrolled': session_enrolled,
                        'color': session_color,
                    })
    return rows

def generate_arabic_answer(intent: str, entities: dict, facts: dict) -> str:
    """Generate Arabic answer from intent + facts."""
    if intent == 'greeting':
        return 'أهلاً بيكي! 👋 أنا مساعد الجداول. اسأليني عن جدول دكتور، قاعة فاضية، إشغال القاعات، أو افحصي نقل محاضرة قبل ما تحفظيها.'
    if intent == 'unknown':
        return 'مش عارفة 🤷 جربي تسأليني عن: جدول دكتور في يوم، أكتر دكتور مشغول، أزحم/أفضى يوم، معلومات قاعة (سعتها ومعداتها)، أو افحصي نقل محاضرة.'
    if intent == 'busiest_room':
        ranked = facts.get('ranking', [])
        if not ranked:
            return 'مفيش حصص متسجلة.'
        lines = ['🏫 أكتر أوضة فيها محاضرات شغالة:']
        for i, r in enumerate(ranked[:3], 1):
            lines.append(f"{i}. {r['room']} — {r['sessions']} محاضرات")
        return '\n'.join(lines)
    if intent == 'day_load':
        if facts.get('busiest_day') is None:
            return 'مفيش حصص متسجلة.'
        _dn = DAYS
        b, bn = facts['busiest_day'], facts['busiest_n']
        f, fn = facts['freest_day'], facts['freest_n']
        bl = _dn[b] if 0 <= b < len(_dn) else str(b)
        fl = _dn[f] if 0 <= f < len(_dn) else str(f)
        return f'📅 أزحم يوم: {bl} ({bn} حصص) — وأفضى يوم: {fl} ({fn} حصص).'
    if intent == 'room_info':
        r = facts.get('room')
        if not r:
            return 'مش لاقية القاعة دي. اتأكدي من الكود (مثال: LT-101 أو CS-Lab1).'
        lines = [f"🏫 {r['name']} — {r['type']}", f"بتشيل لحد {r['capacity']} طالب.", f"الحالة: {r['status']}."]
        if r['equipment']:
            lines.append('المعدات: ' + '، '.join(r['equipment']) + '.')
        for e, q in (r['working'] or {}).items():
            lines.append(f"{e}: {q.get('working', 0)} شغالين من {q.get('total', 0)}.")
        return '\n'.join(lines)
    if intent == 'equipment_status':
        if not facts.get('room'):
            return 'قوليلي اسم القاعة/المعمل. مثال: "أجهزة CS-Lab2 شغالة؟"'
        items = facts.get('items', [])
        if not items:
            return f"مفيش بيانات أعطال متسجلة لـ {facts['room']} — المعدات المسجلة كلها سليمة."
        lines = [f"🔧 أجهزة {facts['room']}:"]
        for it in items:
            state = 'سليمة ✅' if it['working'] >= it['total'] else 'فيها عطل ⚠️'
            lines.append(f"- {it['name']}: {it['working']} شغالين من {it['total']} — {state}")
        return '\n'.join(lines)
    if intent == 'busiest':
        ranked = facts.get('ranking', [])
        if not ranked:
            return 'مفيش حصص متسجلة.'
        lines = ['👨‍🏫 أكتر الدكاترة انشغالاً:']
        for i, r in enumerate(ranked[:5], 1):
            lines.append(f"{i}. {r['staff']} — {r['sessions']} حصص")
        return '\n'.join(lines)
    if intent == 'show_schedule':
        staff = entities.get('staff', 'الكل')
        day = entities.get('day', 'الكل')
        rows = facts.get('rows', [])
        if not rows:
            return f'ما فيش جلسات لـ {staff} يوم {day}.'
        lines = [f'📅 جدول {staff} — {day}:']
        for r in rows:
            lines.append(f"{r['day_name']} {r['time']} — {r['name']} ({r['code']}) — {r['room']}")
        if facts.get('truncated'):
            lines.append(f"\n…و {facts.get('total', 0) - len(rows)} كمان — حددي الدكتور أو اليوم عشان أعرض أقل.")
        return '\n'.join(lines)

    if intent == 'check_move':
        if facts.get('need_info'):
            return 'قوليلي الدكتور أو القاعة مع اليوم والوقت عشان أفحص. مثال: "انقل د. أحمد LT-101 الأثنين 09:00".'
        if facts.get('ok'):
            return '✅ التغيير ممكن. مفيش تعارضات صعبة.'
        lines = ['❌ مش ممكن تعمل التغيير ده:']
        for c in facts.get('conflicts', []):
            msg = c.get('message_ar') or c.get('description', '')
            lines.append(f"- [{c.get('conflict_type', 'CONFLICT')}] {msg}")
        if facts.get('recommendations'):
            lines.append('\nالبدائل المقترحة:')
            for i, a in enumerate(facts['recommendations'], 1):
                room = a.get('room_number') or a.get('room') or '?'
                time = f"{a.get('start_time','')}-{a.get('end_time','')}"
                expl = a.get('explanation') or '، '.join(a.get('reasons', []))
                lines.append(f"{i}. {a.get('day_name','')} {time} في {room} ({expl})")
            lines.append('\nاكتبي رقم البديل (1-3) أو "نفذ رقم 1" للمعاينة.')
        return '\n'.join(lines)

    if intent == 'find_room':
        rooms = facts.get('rooms', [])
        if not rooms:
            return 'مفيش قاعة متاحة بالمواصفات دي.'
        lines = ['القاعات المتاحة:']
        for r in rooms[:5]:
            pct = f" ({r.get('pct','')}%)" if r.get('pct') is not None else ''
            lines.append(f"{r.get('room_number') or r.get('name')}: سعة {r.get('capacity')}{pct}")
        return '\n'.join(lines)

    if intent == 'occupancy':
        occ = facts.get('occupancy', [])
        if not occ:
            return 'مفيش بيانات إشغال.'
        return '\n'.join([f"{o['room_number']}: {o['used']}/{o['total']} ({o['pct']}%)" for o in occ])

    if intent == 'insights':
        lines = [f"📊 عندك {facts.get('open_conflicts', 0)} تعارضات مفتوحة."]
        for t, v in (facts.get('breakdown') or {}).items():
            lines.append(f'- {t}: {v}')
        if facts.get('top_day'):
            lines.append(f"أزحم يوم: {facts['top_day']} ({facts.get('top_day_count', 0)} حصة).")
        return '\n'.join(lines)

    return 'أنا فاهم طلبك. جرب: "اعرض جدول د. أحمد الأثنين" / "انقل د. أحمد LT-101 الثلاثاء 11:00" / "قاعة 60 طالب الأحد" / "إشغال القاعات".'

# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post('/message', response_model=ChatResponse)
async def chatbot_message(body: ChatMessage):
    """
    Main chatbot endpoint: NLU + facts + Arabic answer in one call.
    Falls back to rule-based parsing if Gemini unavailable.
    """
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=422, detail='Message is required')

    # Simple rule-based NLU (deterministic fallback)
    t = text.lower()
    intent = 'show_schedule'
    entities = {}

    # Greetings / small talk — short messages only, answered directly
    import re as _re_nlu
    _greet_en = bool(_re_nlu.search(r'\b(hi|hey|hello|thanks|thank you|bye|good morning|good evening)\b', t))
    _greet_ar = any(w in t for w in ['مرحبا', 'اهلا', 'أهلا', 'صباح الخير', 'مساء الخير', 'شكرا', 'شكراً', 'مع السلامة', 'تمام', 'ازيك', 'عامل ايه'])
    if (_greet_en or _greet_ar) and len(text) < 40:
        intent = 'greeting'
    elif (any(w in t for w in ['أزحم', 'ازحم', 'أفضى', 'افضى', 'أخف', 'اخف', 'أشغل', 'اشغل', 'busiest day', 'freest', 'emptiest'])
            or (any(w in t for w in ['أكتر', 'اكتر', 'أكثر', 'اكثر', 'most']) and any(w in t for w in ['busy', 'free', 'فاضي', 'فاضية']))
        ) and any(w in t for w in ['يوم', 'day', 'أيام', 'ايام', 'days']) and not any(w in t for w in ['قاعة', 'معمل', 'room', 'lab', 'سعة', 'capacity', 'طالب']):
        intent = 'day_load'
    elif ((('busiest' in t and 'day' not in t and 'يوم' not in t) or (('most' in t and 'busy' in t) and 'day' not in t and 'يوم' not in t)
            or 'أزحم' in t or 'who teaches most' in t
            or (('أكتر' in t or 'اكتر' in t or 'أكثر' in t or 'اكثر' in t)
                and ('دكتور' in t or 'محاضر' in t or 'doctor' in t or 'staff' in t or 'محاضرات' in t))
            or (('most' in t) and ('sessions' in t or 'classes' in t)))
            and not any(w in t for w in ['اوضه', 'اوضة', 'أوضه', 'أوضة', 'غرفة', 'قاعة', 'معمل', 'room', 'rooms', 'lab'])):
        intent = 'busiest'
    elif any(w in t for w in ['occupancy', 'استخدام', 'إشغال', 'اشغال', 'احصائيات', 'أكثر القاعات', 'اكثر القاعات']):
        intent = 'occupancy'
    elif any(w in t for w in ['insight', 'تحليل', 'ضغط', 'متتالية', 'مضغوط', 'توزيع']):
        intent = 'insights'
    elif (any(w in t for w in ['بايظ', 'بايظه', 'خربان', 'عطلان', 'broken', 'damaged', 'عطل'])
            or (any(w in t for w in ['شغال', 'شغاله', 'سليم', 'working']) and any(w in t for w in ['أجهزة', 'اجهزة', 'جهاز', 'equipment']))):
        intent = 'equipment_status'
        for rn in list(ROOMS) + list(LABS):
            if rn.lower() in t:
                entities['room'] = rn
                break
    elif (any(w in t for w in ['ايه', 'إيه', 'ايش', 'what', 'كم', 'كام', 'معلومات', 'info', 'تشيل', 'بتشيل', 'بتاخد', 'سعة', 'capacity', 'نوع', 'type', 'فين', 'where', '?', '؟'])
            and any(rn.lower() in t for rn in list(ROOMS) + list(LABS))
            and not any(w in t for w in ['ahmed', 'احمد', 'أحمد', 'sara', 'سارة', 'chen', 'patel', 'باتل', 'bell', 'hassan', 'حسن', 'ali', 'علي', 'mona', 'omar', 'nwosu', 'kovac', 'johansson', 'fatma', 'lena', 'amara', 'marcus', 'heba', 'karim', 'nabil', 'smith', 'john'])):
        intent = 'room_info'
        for rn in list(ROOMS) + list(LABS):
            if rn.lower() in t:
                entities['room'] = rn
                break
    elif (any(w in t for w in ['اوضه', 'اوضة', 'أوضه', 'أوضة', 'غرفة', 'room', 'rooms', 'قاعة', 'معمل', 'lab'])
            and any(w in t for w in ['أكتر', 'اكتر', 'أكثر', 'اكثر', 'most', 'أزحم', 'ازحم', 'busiest'])):
        intent = 'busiest_room'
    elif any(w in t for w in ['room', 'lab', 'قاعة', 'معمل', 'فاضية', 'فاضي', 'سعة', 'طالب']):
        intent = 'find_room'
        import re
        cap_match = re.search(r'(\d{2,3})\s*(طالب|student|capacity|سعة)?', t)
        entities['capacity'] = int(cap_match.group(1)) if cap_match else 60
        day_map = {
            # Arabic + English days (teaching week Sat-Wed: 0=Sat .. 4=Wed)
            'السبت': 0,
            'الأحد': 1, 'الاحد': 1,
            'الأثنين': 2, 'الاثنين': 2,
            'الثلاثاء': 3,
            'الاربعاء': 4, 'الأربعاء': 4,
            # English days
            'saturday': 0, 'sat': 0, 'sunday': 1, 'sun': 1, 'monday': 2, 'mon': 2, 'tuesday': 3, 'tue': 3, 'wednesday': 4, 'wed': 4
        }
        for ar, idx in day_map.items():
            if ar in t:
                entities['day'] = idx
                break
    elif any(w in t for w in ['move', 'انقل', 'ينفع', 'ماذا لو', 'احطه', 'احط', 'what if', 'check']):
        intent = 'check_move'
        # Extract course
        for course in ['database', 'ai', 'networks', 'algorithms', 'داتابيز', 'ذكاء']:
            if course in t:
                entities['course'] = course
                break
        # Extract day
        day_map = {
            # Arabic + English days (teaching week Sat-Wed: 0=Sat .. 4=Wed)
            'السبت': 0,
            'الأحد': 1, 'الاحد': 1,
            'الأثنين': 2, 'الاثنين': 2,
            'الثلاثاء': 3,
            'الاربعاء': 4, 'الأربعاء': 4,
            # English days
            'saturday': 0, 'sat': 0, 'sunday': 1, 'sun': 1, 'monday': 2, 'mon': 2, 'tuesday': 3, 'tue': 3, 'wednesday': 4, 'wed': 4
        }
        for ar, idx in day_map.items():
            if ar in t:
                entities['day'] = idx
                break
        # Extract time
        import re
        time_match = re.search(r'(\d{1,2}):(\d{2})', t)
        if time_match:
            entities['time'] = time_match.group(0)
        # Extract staff (both hamza + plain Egyptian spellings)
        if 'ahmed' in t or 'أحمد' in t or 'احمد' in t:
            entities['staff'] = 'Ahmed'
        elif 'sara' in t or 'سارة' in t:
            entities['staff'] = 'Sara'
        # Extract room/lab by code (e.g. LT-101, CS-Lab1)
        for rn in list(ROOMS) + list(LABS):
            if rn.lower() in t:
                entities['room'] = rn
                break
    else:
        # show_schedule
        if 'ahmed' in t or 'أحمد' in t or 'احمد' in t:
            entities['staff'] = 'Ahmed'
        elif 'sara' in t or 'سارة' in t:
            entities['staff'] = 'Sara'
        day_map = {
            # Arabic + English days (teaching week Sat-Wed: 0=Sat .. 4=Wed)
            'السبت': 0,
            'الأحد': 1, 'الاحد': 1,
            'الأثنين': 2, 'الاثنين': 2,
            'الثلاثاء': 3,
            'الاربعاء': 4, 'الأربعاء': 4,
            # English days
            'saturday': 0, 'sat': 0, 'sunday': 1, 'sun': 1, 'monday': 2, 'mon': 2, 'tuesday': 3, 'tue': 3, 'wednesday': 4, 'wed': 4
        }
        for ar, idx in day_map.items():
            if ar in t:
                entities['day'] = idx
                break

    # Nothing recognized at all → say so honestly instead of dumping the schedule
    if intent == 'show_schedule' and not entities:
        intent = 'unknown'

    # Gather facts based on intent
    facts = {}
    if intent == 'busiest_room':
        # Real count: sessions per room/lab row
        counts: dict = {}
        for _view in ('rooms', 'labs'):
            for _row, _days in (TIMETABLE.get(_view, {}) or {}).items():
                if not isinstance(_days, dict):
                    continue
                n = 0
                for _slots in _days.values():
                    cells = _slots.values() if isinstance(_slots, dict) else [_slots]
                    n += sum(1 for _s in cells if _s is not None)
                if n:
                    counts[_row] = n
        facts['ranking'] = sorted(
            ({'room': k, 'sessions': v} for k, v in counts.items()),
            key=lambda r: -r['sessions'])
    elif intent == 'day_load':
        # Real count per weekday across rooms + labs
        counts: dict = {}
        # Real count per weekday across rooms + labs
        counts: dict = {}
        for _view in ('rooms', 'labs'):
            for _days in (TIMETABLE.get(_view, {}) or {}).values():
                if not isinstance(_days, dict):
                    continue
                for _d, _slots in _days.items():
                    cells = _slots.values() if isinstance(_slots, dict) else [_slots]
                    counts[_d] = counts.get(_d, 0) + sum(1 for _s in cells if _s is not None)
        if counts:
            facts['busiest_day'] = max(counts, key=counts.get)
            facts['freest_day'] = min(counts, key=counts.get)
            facts['busiest_n'] = counts[facts['busiest_day']]
            facts['freest_n'] = counts[facts['freest_day']]
    elif intent == 'room_info':
        rn = entities.get('room')
        robj = next((r for r in ALL_ROOMS if r.name == rn), None)
        if robj is not None:
            from app.data_store import ROOM_EQUIPMENT as _inv_all
            inv = ((_inv_all or {}).get(robj.name, {})) or {}
            facts['room'] = {
                'name': robj.name, 'type': robj.type, 'capacity': robj.capacity,
                'status': robj.status, 'equipment': list(robj.equipment or []),
                'working': {e: q for e, q in inv.items() if isinstance(q, dict)},
            }
    elif intent == 'equipment_status':
        rn = entities.get('room')
        from app.data_store import ROOM_EQUIPMENT as _inv_all2
        inv = ((_inv_all2 or {}).get(rn, {})) or {} if rn else {}
        facts['room'] = rn
        facts['items'] = [{'name': e, 'total': q.get('total', 0), 'working': q.get('working', 0)}
                          for e, q in inv.items() if isinstance(q, dict)]
    elif intent == 'busiest':
        # Real count: sessions per staff across rooms + labs
        counts: dict = {}
        for _view in ('rooms', 'labs'):
            for _days in (TIMETABLE.get(_view, {}) or {}).values():
                if not isinstance(_days, dict):
                    continue
                for _slots in _days.values():
                    cells = _slots.values() if isinstance(_slots, dict) else [_slots]
                    for _s in cells:
                        if _s is None:
                            continue
                        _st = _s.get('staff') if isinstance(_s, dict) else getattr(_s, 'staff', None)
                        if _st:
                            counts[_st] = counts.get(_st, 0) + 1
        facts['ranking'] = sorted(
            ({'staff': k, 'sessions': v} for k, v in counts.items()),
            key=lambda r: -r['sessions'])
    elif intent == 'show_schedule':
        staff = entities.get('staff')
        day = entities.get('day')
        # Map common short names to full names
        staff_map = {
            'ahmed': 'Dr. Ahmed Hassan',
            'أحمد': 'Dr. Ahmed Hassan',
            'sara': 'Prof. Sara Johansson',
            'سارة': 'Prof. Sara Johansson',
            'chen': 'Dr. Chen Wei',
            'نوسو': 'Prof. Amara Nwosu',
            'نوسة': 'Prof. Amara Nwosu',
            'kovac': 'Dr. Lena Kovač',
            'كوفاك': 'Dr. Lena Kovač',
            'patel': 'Dr. Raj Patel',
            'باتل': 'Dr. Raj Patel',
            'bell': 'Dr. Marcus Bell',
            'بل': 'Dr. Marcus Bell',
            'hassan': 'Dr. Ahmed Hassan',
            'حسن': 'Dr. Ahmed Hassan',
            'ali': 'Dr. Fatma Ali',
            'علي': 'Dr. Fatma Ali',
            'johansson': 'Prof. Sara Johansson',
            'جوهانسون': 'Prof. Sara Johansson',
            'nwosu': 'Prof. Amara Nwosu',
            'محمد': 'Dr. Mohamed',
        }
        if staff:
            staff_lower = staff.lower()
            staff = staff_map.get(staff_lower, staff)
        rows = get_timetable_rows(staff=staff, day=day)
        # Cap huge unfiltered answers; the count stays exact
        facts['total'] = len(rows)
        facts['truncated'] = len(rows) > 8
        facts['rows'] = rows[:8]
    elif intent == 'check_move':
        # Real what-if check through the deterministic conflict engine
        from app.services.conflicts import check_candidate
        _name_map = {
            'ahmed': 'Dr. Ahmed Hassan', 'أحمد': 'Dr. Ahmed Hassan', 'احمد': 'Dr. Ahmed Hassan',
            'hassan': 'Dr. Ahmed Hassan', 'حسن': 'Dr. Ahmed Hassan',
            'sara': 'Prof. Sara Johansson', 'سارة': 'Prof. Sara Johansson',
            'johansson': 'Prof. Sara Johansson', 'chen': 'Dr. Chen Wei',
            'patel': 'Dr. Raj Patel', 'باتل': 'Dr. Raj Patel',
            'bell': 'Dr. Marcus Bell', 'nwosu': 'Prof. Amara Nwosu',
            'kovac': 'Dr. Lena Kovač', 'ali': 'Dr. Fatma Ali', 'علي': 'Dr. Fatma Ali',
            'mona': 'Dr. Mona Khalil', 'omar': 'Eng. Omar Farouk',
        }
        staff_full = _name_map.get((entities.get('staff') or '').lower())
        day = entities.get('day')
        slot = None
        if entities.get('time'):
            hh = entities['time'].split(':')[0]
            slot = next((i for i, s in enumerate(TIME_SLOTS) if s.startswith(hh + ':')), None)
        room = entities.get('room')
        if day is None or (staff_full is None and room is None):
            facts['ok'] = None
            facts['need_info'] = True
        else:
            ok, conflicts, recs = check_candidate(
                TIMETABLE, ALL_ROOMS, staff=staff_full, room=room,
                day=day, slot=slot if slot is not None else 0,
                group=None, enrolled=0)
            facts['ok'] = ok
            facts['conflicts'] = conflicts
            facts['recommendations'] = [r.model_dump() if hasattr(r, 'model_dump') else dict(r) for r in recs]
    elif intent == 'find_room':
        min_cap = entities.get('capacity', 60)
        day = entities.get('day')
        # Find available rooms (with at least one free slot that day when day given)
        available = []
        for r in ALL_ROOMS:
            if r.capacity >= min_cap and r.status == 'Available':
                if day is not None:
                    room_days = (TIMETABLE.get('rooms', {}).get(r.name, {}) or {})
                    day_cells = room_days.get(day, {})
                    cells = day_cells.values() if isinstance(day_cells, dict) else [day_cells]
                    if not any(s is None for s in cells):
                        continue
                available.append({
                    'id': r.id,
                    'room_number': r.name,
                    'name': r.name,
                    'capacity': r.capacity,
                    'pct': r.booking_rate,
                })
        facts['rooms'] = available
    elif intent == 'insights':
        # Real numbers: open conflicts by type + busiest day + top room
        from app.data_store import CONFLICTS as _LIVE_CONFLICTS
        by_type: dict = {}
        for c in _LIVE_CONFLICTS:
            by_type[c.type] = by_type.get(c.type, 0) + 1
        day_counts: dict = {}
        for _room, days in (TIMETABLE.get('rooms', {}) or {}).items():
            for d, slots in (days or {}).items():
                cells = slots.values() if isinstance(slots, dict) else [slots]
                day_counts[d] = day_counts.get(d, 0) + sum(1 for s in cells if s is not None)
        top_day = max(day_counts, key=day_counts.get) if day_counts else None
        facts['open_conflicts'] = len(_LIVE_CONFLICTS)
        facts['breakdown'] = by_type
        facts['top_day'] = DAYS[top_day] if top_day is not None and top_day < len(DAYS) else None
        facts['top_day_count'] = day_counts.get(top_day, 0) if top_day is not None else 0
    elif intent == 'occupancy':
        # Calculate occupancy (day → slot → session cells)
        occ = []
        for r in ALL_ROOMS:
            used, total = 0, 0
            for slots in (TIMETABLE.get('rooms', {}).get(r.name, {}) or {}).values():
                cells = slots.values() if isinstance(slots, dict) else [slots]
                for s in cells:
                    total += 1
                    if s is not None:
                        used += 1
            occ.append({'room_number': r.name, 'used': used, 'total': total, 'pct': round(used/total*100) if total else 0})
        facts['occupancy'] = sorted(occ, key=lambda x: -x['pct'])

    answer_ar = generate_arabic_answer(intent, entities, facts)

    # Real Gemini pass (if GEMINI_API_KEY is set). Greetings are answered
    # deterministically and skip Gemini.
    attached = (body.timetable_json or '').strip()
    if intent not in ('greeting', 'unknown') and (attached or intent in ('show_schedule', 'check_move', 'find_room', 'occupancy', 'insights', 'busiest', 'busiest_room', 'day_load', 'room_info', 'equipment_status')):
        try:
            context = attached if attached else _json.dumps(facts, ensure_ascii=False, default=str)[:12000]
        except Exception:
            context = attached
        if context:
            from starlette.concurrency import run_in_threadpool
            try:
                gemini_text = await run_in_threadpool(_gemini_answer_sync, text, context)
            except Exception:
                gemini_text = None
            if gemini_text:
                return ChatResponse(
                    intent=intent,
                    entities=entities,
                    answer_ar=gemini_text,
                    facts=facts,
                    gemini_used=True
                )

    return ChatResponse(
        intent=intent,
        entities=entities,
        answer_ar=answer_ar,
        facts=facts,
        gemini_used=False
    )

@router.get('/timetable', response_model=List[TimetableRow])
async def get_timetable(staff: Optional[str] = None, day: Optional[str] = None):
    """Get timetable rows for staff/day."""
    # Map common short names to full names
    staff_map = {
        'ahmed': 'Dr. Ahmed Hassan',
        'أحمد': 'Dr. Ahmed Hassan',
        'sara': 'Prof. Sara Johansson',
        'سارة': 'Prof. Sara Johansson',
        'chen': 'Dr. Chen Wei',
        'نوسو': 'Prof. Amara Nwosu',
        'نوسة': 'Prof. Amara Nwosu',
        'kovac': 'Dr. Lena Kovač',
        'كوفاك': 'Dr. Lena Kovač',
        'patel': 'Dr. Raj Patel',
        'باتل': 'Dr. Raj Patel',
        'bell': 'Dr. Marcus Bell',
        'بل': 'Dr. Marcus Bell',
        'hassan': 'Dr. Ahmed Hassan',
        'حسن': 'Dr. Ahmed Hassan',
        'ali': 'Dr. Fatma Ali',
        'علي': 'Dr. Fatma Ali',
        'johansson': 'Prof. Sara Johansson',
        'جوهانسون': 'Prof. Sara Johansson',
        'nwosu': 'Prof. Amara Nwosu',
    }
    if staff:
        staff_lower = staff.lower()
        staff = staff_map.get(staff_lower, staff)
    day_idx = resolve_day(day)
    rows = get_timetable_rows(staff=staff, day=day_idx)
    return rows

@router.post('/allocations/check', response_model=CheckMoveResponse)
async def check_move(body: CheckMoveRequest):
    """Validate a move (dry-run). Returns bilingual conflicts and alternatives."""
    from app.services.conflicts import check_candidate
    day_idx = resolve_day(body.day)
    if body.day is not None and day_idx is None:
        return CheckMoveResponse(ok=False, conflicts=[{'conflict_type': 'INVALID_DAY', 'description': 'Invalid day', 'message_en': 'Invalid day.', 'message_ar': 'اليوم غير صحيح.'}], recommendations=[])
    ok, conflicts, recs = check_candidate(
        TIMETABLE, ALL_ROOMS, staff=body.staff, room=body.room,
        day=day_idx, slot=int(body.slot or 0), group=body.group, enrolled=body.enrolled or 0,
        required_equipment=body.required_equipment, room_type_required=body.room_type_required,
        duration_slots=int(body.duration_slots or 1), exclude_session_id=body.exclude_session_id,
    )
    recs_out = [r.model_dump() if hasattr(r, 'model_dump') else dict(r) for r in recs]
    return CheckMoveResponse(ok=ok, conflicts=conflicts, recommendations=recs_out)

@router.get('/search/rooms', response_model=List[RoomInfo])
async def search_rooms(minCapacity: Optional[int] = None, day: Optional[str] = None):
    """Search available rooms."""
    day_idx = resolve_day(day)
    results = []
    for r in ALL_ROOMS:
        if minCapacity and r.capacity < minCapacity:
            continue
        if r.status != 'Available':
            continue
        # Check if room is free on that day
        if day_idx is not None:
            room_days = TIMETABLE.get('rooms', {}).get(r.name, {})
            occupied = sum(1 for s in room_days.values() if s is not None)
            if occupied >= len(DAYS):
                continue
        results.append(RoomInfo(
            id=r.id,
            name=r.name,
            building=r.building,
            floor=r.floor,
            type=r.type,
            capacity=r.capacity,
            examCapacity=r.exam_capacity,
            status=r.status,
            pct=r.booking_rate
        ))
    return results

@router.get('/analytics/occupancy')
async def get_occupancy():
    """Room occupancy statistics."""
    occ = []
    for r in ALL_ROOMS:
        used, total = 0, 0
        for slots in (TIMETABLE.get('rooms', {}).get(r.name, {}) or {}).values():
            cells = slots.values() if isinstance(slots, dict) else [slots]
            for s in cells:
                total += 1
                if s is not None:
                    used += 1
        occ.append({
            'room_id': r.id,
            'room_number': r.name,
            'used': used,
            'total': total,
            'pct': round(used/total*100) if total else 0
        })
    return sorted(occ, key=lambda x: -x['pct'])

@router.post('/analyze-image')
async def analyze_image(file: UploadFile = File(...)):
    """Analyze timetable photo (placeholder - needs OCR integration)."""
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='File must be an image')
    # Placeholder - in production integrate with OCR/Vision API
    return {
        'answer_ar': 'تحليل الصورة مش مطوّر بعد. ابعت النص بدل ما تبعت صورة دلوقتي.',
        'extracted': []
    }