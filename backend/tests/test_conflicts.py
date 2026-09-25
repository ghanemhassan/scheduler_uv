# SCH-FR-05 engine tests: rule matrix + deterministic property tests.
# Stdlib only. Run from backend/:  python tests/test_conflicts.py
# (also pytest-compatible: every test_* function runs under pytest)
"""Covers backend/app/services/conflicts.py::check_candidate/suggest_alternatives."""

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.conflicts import check_candidate, suggest_alternatives  # noqa: E402

ROOMS = [
    {"name": "A101", "capacity": 60, "status": "Available",
     "type": "Lecture Theatre", "equipment": []},
    {"name": "Lab2", "capacity": 30, "status": "Available",
     "type": "Computer Lab", "equipment": ["PCs"]},
    {"name": "B203", "capacity": 80, "status": "Available",
     "type": "Lecture Theatre", "equipment": []},
    {"name": "Shut", "capacity": 20, "status": "Closed",
     "type": "Seminar Room", "equipment": []},
]
TEACH = {"Restrict Ed": [2]}  # Wednesdays only
INV = {"Lab2": {"PCs": {"total": 30, "working": 20, "per_student": True}}}
GRID = {"rooms": {
    "B203": {3: {2: {"id": "x1", "staff": "Dr. A", "group": "G1", "enrolled": 10}}},
    "Lab2": {4: {3: {"id": "x2", "staff": "Dr. B", "group": "G2", "enrolled": 10}}},
}, "labs": {}}

BASE = dict(timetable=GRID, rooms=ROOMS, teaching_days={},
            equipment_inventory={}, n_slots=10)


def check(**kw):
    args = dict(BASE)
    args.update(kw)
    return check_candidate(**args)


def types_of(res):
    return [c["conflict_type"] for c in res[1]]


# ── Rule matrix (one test per hard-conflict category) ──

def test_room_busy():
    assert "ROOM_BUSY" in types_of(check(staff="Dr. C", room="B203", day=3, slot=2, group="G9", enrolled=10))


def test_staff_busy():
    assert "STAFF_BUSY" in types_of(check(staff="Dr. A", room="A101", day=3, slot=2, group="G9", enrolled=10))


def test_group_clash():
    assert "GROUP_CLASH" in types_of(check(staff="Dr. C", room="A101", day=3, slot=2, group="G1", enrolled=10))


def test_capacity():
    assert "CAPACITY" in types_of(check(staff="Dr. C", room="Lab2", day=0, slot=0, group="G9", enrolled=55))


def test_closure():
    assert "CLOSURE" in types_of(check(staff="Dr. C", room="Shut", day=0, slot=0, group="G9", enrolled=5))


def test_room_type():
    assert "ROOM_TYPE_MISMATCH" in types_of(
        check(staff="Dr. C", room="A101", day=0, slot=0, group="G9",
              enrolled=5, room_type_required="Lab"))


def test_equipment_missing():
    assert "EQUIPMENT" in types_of(
        check(staff="Dr. C", room="A101", day=0, slot=0, group="G9",
              enrolled=5, required_equipment=["PCs"]))


def test_equipment_quantity():
    ok, conflicts, _ = check_candidate(
        timetable=GRID, rooms=ROOMS, staff="Dr. C", room="Lab2", day=0, slot=0,
        group="G9", enrolled=30, teaching_days={}, equipment_inventory=INV, n_slots=10)
    assert not ok and "EQUIPMENT" in [c["conflict_type"] for c in conflicts]


def test_availability():
    assert "AVAILABILITY" in types_of(
        check(staff="Restrict Ed", room="A101", day=0, slot=0, group="G9",
              enrolled=5, teaching_days=TEACH))


def test_duration_overflow():
    assert "DURATION_OVERFLOW" in types_of(
        check(staff="Dr. C", room="A101", day=0, slot=9, group="G9",
              enrolled=5, duration_slots=2))


def test_free_slot_passes():
    ok, conflicts, _ = check(staff="Dr. C", room="A101", day=0, slot=0, group="G9", enrolled=10)
    assert ok and conflicts == []


def test_self_edit_never_clashes_with_itself():
    ok, conflicts, _ = check(staff="Dr. A", room="B203", day=3, slot=2,
                             group="G1", enrolled=10, exclude_session_id="x1")
    assert ok, conflicts


def test_holiday_blocks_whole_day():
    hol = [{"id": "h1", "label": "Break", "day": 0, "reason": ""}]
    ok, conflicts, _ = check_candidate(
        timetable=GRID, rooms=ROOMS, staff="Dr. C", room="A101", day=0, slot=0,
        group="G9", enrolled=5, teaching_days={}, equipment_inventory={},
        n_slots=10, holidays=hol)
    assert not ok and "HOLIDAY" in [c["conflict_type"] for c in conflicts]
    ok2, _, _ = check_candidate(
        timetable=GRID, rooms=ROOMS, staff="Dr. C", room="A101", day=1, slot=0,
        group="G9", enrolled=5, teaching_days={}, equipment_inventory={},
        n_slots=10, holidays=hol)
    assert ok2


def test_unavailability_request_blocks():
    unav = [{"id": "u1", "staff": "Dr. C", "day": 0, "slot": 1, "reason": "Trip"}]
    ok, conflicts, _ = check_candidate(
        timetable=GRID, rooms=ROOMS, staff="Dr. C", room="A101", day=0, slot=1,
        group="G9", enrolled=5, teaching_days={}, equipment_inventory={},
        n_slots=10, unavailability=unav)
    assert not ok and "AVAILABILITY" in [c["conflict_type"] for c in conflicts]
    ok2, _, _ = check_candidate(
        timetable=GRID, rooms=ROOMS, staff="Dr. C", room="A101", day=0, slot=0,
        group="G9", enrolled=5, teaching_days={}, equipment_inventory={},
        n_slots=10, unavailability=unav)
    assert ok2


# ── Property tests (seeded-random, fully deterministic) ──

def _random_grid(rng, n_rooms=4, n_days=3, n_slots=4, fill=0.25):
    rooms = [{"name": f"R{i}", "capacity": rng.choice([20, 40, 60]),
              "status": "Available", "type": "Lecture Theatre", "equipment": []}
             for i in range(n_rooms)]
    grid = {"rooms": {}, "labs": {}}
    sid = 0
    for r in rooms:
        grid["rooms"][r["name"]] = {}
        for d in range(n_days):
            grid["rooms"][r["name"]][d] = {}
            for s in range(n_slots):
                if rng.random() < fill:
                    grid["rooms"][r["name"]][d][s] = {
                        "id": f"s{sid}", "staff": f"Dr. {rng.randint(1, 3)}",
                        "group": f"G{rng.randint(1, 3)}", "enrolled": 10}
                    sid += 1
                else:
                    grid["rooms"][r["name"]][d][s] = None
    return grid, rooms


def _random_candidate(rng, rooms, n_days=3, n_slots=4):
    r = rng.choice(rooms)
    return dict(staff=f"Dr. {rng.randint(1, 4)}", room=r["name"],
                day=rng.randrange(n_days), slot=rng.randrange(n_slots),
                group=f"G{rng.randint(1, 4)}", enrolled=rng.choice([5, 15, 25, 99]))


def test_property_deterministic_and_sound():
    rng = random.Random(20260924)
    for _ in range(200):
        grid, rooms = _random_grid(rng)
        kw = _random_candidate(rng, rooms)
        a = check_candidate(timetable=grid, rooms=rooms, teaching_days={},
                            equipment_inventory={}, n_slots=4, **kw)
        b = check_candidate(timetable=grid, rooms=rooms, teaching_days={},
                            equipment_inventory={}, n_slots=4, **kw)
        assert a == b, "engine must be deterministic"
        ok, conflicts, _ = a
        assert ok == (conflicts == []), "ok must mirror conflicts"
        for c in conflicts:  # every rejection is explained, bilingually
            assert c["conflict_type"] and c["message_en"] and c["message_ar"]


def test_property_alternatives_feasible_and_ranked():
    rng = random.Random(7)
    checked = 0
    for _ in range(200):
        grid, rooms = _random_grid(rng)
        kw = _random_candidate(rng, rooms)
        ok, _, _ = check_candidate(timetable=grid, rooms=rooms, teaching_days={},
                                   equipment_inventory={}, n_slots=4, **kw)
        if ok:
            continue
        recs = suggest_alternatives(
            grid, rooms, kw["staff"], kw["group"], kw["enrolled"],
            kw["day"], kw["slot"], limit=3)
        assert len(recs) <= 3
        scores = [a.score for a in recs]
        assert scores == sorted(scores, reverse=True), "ranked best-first"
        assert all(0 <= s <= 100 for s in scores)
        for a in recs:  # each alternative must itself pass the check
            ok2, _, _ = check_candidate(
                timetable=grid, rooms=rooms, staff=kw["staff"], room=a.room,
                day=a.day, slot=a.slot, group=kw["group"], enrolled=kw["enrolled"],
                teaching_days={}, equipment_inventory={}, n_slots=4)
            assert ok2, f"alternative {a.room} day {a.day} slot {a.slot} is infeasible"
            assert a.reasons, "every alternative explains itself"
        checked += 1
    assert checked > 10, "fuzz must hit enough conflicts to be meaningful"


def test_property_compactness_ordering():
    # same room/req, same day slot must outrank a far slot when both feasible
    grid = {"rooms": {"Big": {d: {s: None for s in range(4)} for d in range(3)}}, "labs": {}}
    rooms = [{"name": "Big", "capacity": 200, "status": "Available",
              "type": "Lecture Theatre", "equipment": []}]
    recs = suggest_alternatives(grid, rooms, "Dr. X", "GX", 10, 0, 0,
                                limit=5, search_all_slots=True)
    assert recs and (recs[0].day, recs[0].slot) == (0, 0)


if __name__ == "__main__":
    fns = [(k, v) for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"PASS: {name}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL: {name}: {e}")
    print("ALL_ENGINE_TESTS_PASSED" if not failed else f"{failed} TESTS FAILED")
    raise SystemExit(1 if failed else 0)
