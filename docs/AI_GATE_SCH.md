# AI Release Gate — SCH conflict-free slot recommendation (Project 4)

## Feature
Deterministic constraint engine (`backend/app/services/conflicts.py`):
eliminates hard conflicts, then ranks feasible rooms/slots. No training data.

## Dataset (documented split)
- Synthetic seed only — no real student/staff records.
- `backend/app/data_store.py`: 22 rooms/labs, 15 staff, 42 sections,
  `STAFF_TEACHING_DAYS` (2 restricted staff), `ROOM_EQUIPMENT` (4 inventoried labs).
- Split: seed grid = eval set; every `POST /api/allocations/check` is a
  what-if trial logged only in the demo chat/tests, never persisted.

## Baseline vs current
- Baseline v0 (capacity-only): score = 100 − capacity waste.
- Current v1 (multi-factor): score = 100 − waste − time penalty
  (same cell 0 / same day 10 / other day 20) − utilization penalty
  (room used % // 20) + equipment headroom bonus (max +5).
- Hard filters (both versions): capacity, room status, required equipment,
  staff teaching days, staff/group/room busy, per-student working units.

## Metric (measured on seed, 2026-09-24)
- Hard conflicts in grid: detected 2/2 seeded staff double-books (recall 100%).
- Alternatives coverage: 3 ranked alternatives for every auto conflict.
- Score sanity: best-fit alternative outranks far-slot ones
  (e.g. same-day LT-102/38 beats cross-day options).
- Dashboard (§5 AI metrics): feasible candidates, rejected, satisfaction %.

## Known limitations
- Staff preferences beyond teaching days are not modeled (no preference data captured — SCH-FR-03 gap).
- Equipment inventory covers 4 labs only; other rooms are presence-checked.
- No whole-schedule optimizer (stretch); ranking is per-conflict, greedy.
- Availability/equipment data is seed-curated, not collected from staff/facilities UIs.

## Model/version log
- v0: capacity-only ranking — `suggest_alternatives(limit=3)`.
- v1: multi-factor score + `search_all_slots` + teaching-day/equipment filters.
- Engine is code-versioned with the backend (no weights, no training runs).

## Tests (in-repo)
- `backend/tests/test_conflicts.py` — 12 rule-matrix cases (every hard-conflict
  category + bilingual messages + self-edit exclusion) + 3 seeded property
  tests: determinism/soundness over 200 fuzzed placements, alternatives always
  feasible/ranked/explained, same-cell outranks far slots. Run from `backend/`:
  `python tests/test_conflicts.py`. Stdlib only, no DB needed.

## Non-AI fallback (working)
- Rule-based chatbot NLU + deterministic answers when Gemini is unreachable.
- Manual flows: conflict panel lists every issue; admin picks any alternative
  or resolves by hand; publish works with open conflicts listed.
