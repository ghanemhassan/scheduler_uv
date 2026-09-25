/**
 * src/api/client.ts
 *
 * Thin fetch wrapper for the ScheduleAI backend.
 * Drop this file into your frontend at src/api/client.ts and set
 * VITE_API_URL in a local .env file:
 *
 *   VITE_API_URL=http://localhost:8000
 *
 * Then enable the Vite proxy in vite.config.ts (already commented-out there):
 *
 *   server: {
 *     proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
 *   }
 *
 * With the proxy you can leave VITE_API_URL empty and all /api/* requests
 * will be forwarded automatically during development.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

// ─── Auth token (stored in memory; swap for httpOnly cookie in production) ────

let _token: string | null = null;

export function setToken(t: string | null) { _token = t; }
export function getToken() { return _token; }


// ─── Low-level fetch helper ────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    // Backend may use {error:{message}} (app handlers) or {detail} (FastAPI default)
    const msg = detail?.detail ?? detail?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const get  = <T>(path: string)               => request<T>('GET',    path);
const post = <T>(path: string, body?: unknown) => request<T>('POST',   path, body);
const put  = <T>(path: string, body?: unknown) => request<T>('PUT',    path, body);
const del  = <T>(path: string)               => request<T>('DELETE', path);


// ─── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  role: 'admin' | 'lecturer' | 'student';
  token: string;
  display_name: string;
}

export const auth = {
  login:  (email: string, password: string) =>
    post<LoginResponse>('/api/auth/login', { email, password }),
  forgotPassword: (email: string) =>
    post<{ ok: boolean; reset_token: string; expires_in_minutes: number }>('/api/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    post<{ ok: boolean }>('/api/auth/reset-password', { token, new_password: newPassword }),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  me:     () => get<LoginResponse>('/api/auth/me'),
};


// ─── Timetable ─────────────────────────────────────────────────────────────────

export type ViewMode = 'rooms' | 'labs' | 'staff';

export interface Session {
  id: string;
  code: string;
  name: string;
  staff: string;
  group: string;
  capacity: number;
  enrolled: number;
  color: string;
  conflictId?: string;
  slot?: number;      // start time-slot index (0 = 08:00), when synced from backend
  duration?: number;  // number of consecutive slots
  academic_year?: number; // 1-4
  major?: 'CS' | 'IT' | 'AI' | 'DS';
}

export type TimetableRow   = Record<string, Session | null>;   // day-index → Session
export type TimetableView  = Record<string, TimetableRow>;      // row-label → TimetableRow

export interface TimetableConstants {
  days: string[];
  fullDays: string[];
  timeSlots: string[];
  rooms: string[];
  labs: string[];
  staff: string[];
}

export const timetable = {
  constants: ()                                   => get<TimetableConstants>('/api/timetable/constants'),
  full:      ()                                   => get<Record<ViewMode, TimetableView>>('/api/timetable'),
  view:      (v: ViewMode)                        => get<TimetableView>(`/api/timetable/${v}`),
  row:       (v: ViewMode, row: string)           => get<TimetableRow>(`/api/timetable/${v}/${encodeURIComponent(row)}`),
  addRow:    (v: ViewMode, row: string)            => post<{ ok: boolean }>(`/api/timetable/${v}/rows`, { name: row }),
  deleteRow: (v: ViewMode, row: string)            => del(`/api/timetable/${v}/rows/${encodeURIComponent(row)}`),
  addColumn: (name: string)                        => post<{ ok: boolean }>('/api/timetable/columns', { name }),
  renameColumn: (day: number, name: string, fullName?: string) => put(`/api/timetable/columns/${day}`, { name, fullName }),
  deleteColumn: (day: number)                      => del(`/api/timetable/columns/${day}`),
  addSlot:   (time: string)                        => post<{ ok: boolean }>('/api/timetable/slots', { time }),
  renameSlot: (slot: number, time: string)         => put(`/api/timetable/slots/${slot}`, { time }),
  deleteSlot: (slot: number)                       => del(`/api/timetable/slots/${slot}`),
  setSlot:   (v: ViewMode, row: string, day: number, session: Session | null) =>
    put(`/api/timetable/${v}/${encodeURIComponent(row)}/${day}`, session),
};


// ─── Rooms ─────────────────────────────────────────────────────────────────────

export interface Room {
  id: string;
  name: string;
  building: string;
  floor: number;
  type: string;
  capacity: number;
  examCapacity: number;
  accessibility: string[];
  equipment: string[];
  closures: { label: string; from: string; to: string; reason: string }[];
  status: 'Available' | 'Maintenance' | 'Closed';
  bookingRate: number;
  notes: string;
}

export const rooms = {
  list:      (params?: { type?: string; status?: string; building?: string; q?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string,string>).toString() : '';
    return get<Room[]>(`/api/rooms${qs}`);
  },
  get:       (id: string)           => get<Room>(`/api/rooms/${id}`),
  create:    (data: Partial<Room>)  => post<Room>('/api/rooms', data),
  update:    (id: string, data: Partial<Room>) => put<Room>(`/api/rooms/${id}`, data),
  remove:    (id: string)           => del(`/api/rooms/${id}`),
  buildings: ()                     => get<string[]>('/api/rooms/buildings'),
};


// ─── Conflicts ─────────────────────────────────────────────────────────────────

export interface Alternative {
  id: string;
  score: number;
  day: number;
  slot: number;
  room: string;
  reasons: string[];
}

export interface Conflict {
  id: string;
  type: 'double_booking' | 'capacity' | 'staff_overlap' | 'equipment' | 'student_group' | 'room_type' | 'closure';
  severity: 'hard' | 'soft';
  description: string;
  cell: { row: string; day: number; slot: number };
  alternatives: Alternative[];
}

export const conflicts = {
  list:    ()                                              => get<Conflict[]>('/api/conflicts'),
  get:     (id: string)                                   => get<Conflict>(`/api/conflicts/${id}`),
  apply:   (conflictId: string, alternativeId: string)    =>
    post(`/api/conflicts/${conflictId}/apply`, { conflict_id: conflictId, alternative_id: alternativeId }),
  dismiss: (id: string)                                   => del(`/api/conflicts/${id}`),
};


// ─── Allocations (what-if conflict check — SCH-FR-05) ───────────────────────
// Conflict part only: dry-run, never writes. Returns bilingual messages.
export interface CheckConflict {
  conflict_type: string;
  description: string;
  message_en?: string;
  message_ar?: string;
}

export interface CheckMoveResult {
  ok: boolean;
  conflicts: CheckConflict[];
  recommendations: Alternative[];
}

export const allocations = {
  check: (body: {
    staff?: string; room?: string; day?: string; slot?: number;
    group?: string; enrolled?: number; required_equipment?: string[];
    room_type_required?: string; duration_slots?: number; exclude_session_id?: string;
  }) => post<CheckMoveResult>('/api/allocations/check', body),
};


// ─── Analytics ─────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  total_sessions: number;
  total_conflicts: number;
  avg_utilization: number;
  rooms_at_capacity: number;
  utilization_by_room: { name: string; utilization: number }[];
  utilization_by_day:  { name: string; utilization: number }[];
  utilization_by_hour: { name: string; utilization: number }[];
  conflict_breakdown:  { name: string; value: number; color: string }[];
}

export const analytics = {
  summary: () => get<AnalyticsSummary>('/api/analytics/summary'),
  equipment: () => get<{ room: string; equipment: string; total: number; working: number; broken: number; shortfall_pct: number }[]>('/api/analytics/equipment'),
  validation: () => get<{ total: number; errors: number; warnings: number; issues: { severity: string; code: string; message: string; where: string }[] }>('/api/analytics/validation'),
  edits: () => get<{ total_edits: number; active_days: number; avg_edits_per_day: number; by_action: Record<string, number> }>('/api/analytics/edits'),
};


// ─── Versions ──────────────────────────────────────────────────────────────────

export interface ScheduleVersion {
  id: string;
  label: string;
  status: 'draft' | 'published' | 'archived';
  timestamp: string;
  author: string;
  changes: number;
  conflicts: number;
}

export const versions = {
  list:    ()                           => get<ScheduleVersion[]>('/api/versions'),
  get:     (id: string)                 => get<ScheduleVersion>(`/api/versions/${id}`),
  create:  (label: string, author?: string) =>
    post<ScheduleVersion>('/api/versions', { label, author: author ?? 'Scheduler' }),
  publish: (id: string)                 => post<ScheduleVersion>(`/api/versions/${id}/publish`),
  archive: (id: string)                 => post<ScheduleVersion>(`/api/versions/${id}/archive`),
  delete:  (id: string)                 => del(`/api/versions/${id}`),
  snapshot: (id: string)                => get<{ version: ScheduleVersion; sessions: number; live: boolean; mode: string; gaps: boolean; grid: Record<string, Record<string, Record<string, Record<string, Session | null>>>> }>(`/api/versions/${encodeURIComponent(id)}/snapshot`),
  compare: (a: string, b: string) => get<{ a: { id: string; mode: string }; b: { id: string; mode: string }; added: { id: string; code: string; name: string; room: string; day: number; slot: number }[]; removed: { id: string; code: string; name: string; room: string; day: number; slot: number }[]; moved: { id: string; code: string; from: { room: string; day: number; slot: number }; to: { room: string; day: number; slot: number } }[]; counts: { added: number; removed: number; moved: number } }>(`/api/versions/${encodeURIComponent(a)}/compare/${encodeURIComponent(b)}`),
};


// ─── Student portal ────────────────────────────────────────────────────────────

export interface StudentSession {
  id: string; code: string; name: string; staff: string;
  room: string; day: number; slot: number; color: string;
  academic_year?: number;
  major?: 'CS' | 'IT' | 'AI' | 'DS';
}

export interface Credit {
  code: string; name: string; credits: number;
  grade: string | null; status: 'completed' | 'in_progress' | 'planned';
}

export interface StudentProfile {
  id: string; name: string; group: string;
  programme: string; year: number;
  academic_year?: number;
  major?: 'CS' | 'IT' | 'AI' | 'DS';
  sessions: StudentSession[];
  credits: Credit[];
  total_credits_required: number;
  total_credits_earned: number;
}

export const students = {
  me:       () => get<StudentProfile>('/api/students/me'),
  sessions: () => get<StudentSession[]>('/api/students/me/sessions'),
  credits:  () => get<Credit[]>('/api/students/me/credits'),
  list:     (q?: string) => get<ManagedStudent[]>(`/api/students${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  add:      (data: { name: string; email: string; group: string; year?: string; academic_year?: number; major?: string }) => post<ManagedStudent>('/api/students', data),
  updateGroup: (id: string, group: string) => request<ManagedStudent>('PATCH', `/api/students/${id}`, { group }),
  update:  (id: string, data: Partial<ManagedStudent>) => request<ManagedStudent>('PATCH', `/api/students/${id}`, data),
  remove:   (id: string) => del(`/api/students/${id}`),
  register: (studentId: string, sectionIds: string[], year: string, term: string) =>
    post<CourseRegistration[]>('/api/students/register-courses', { student_id: studentId, section_ids: sectionIds, year, term }),
  registrationsOf: (studentId: string) => get<CourseRegistration[]>(`/api/students/${studentId}/registrations`),
  myRegistrations: () => get<CourseRegistration[]>('/api/students/me/registrations'),
  registerMine: (sectionIds: string[], year: string, term: string) =>
    post<CourseRegistration[]>('/api/students/me/register', { section_ids: sectionIds, year, term }),
};

export interface ManagedStudent {
  id: string; name: string; email: string; group: string; year: string;
  academic_year?: number; major?: 'CS' | 'IT' | 'AI' | 'DS';
}

export const staff = {
  list:   () => get<string[]>('/api/staff'),
  add:    (name: string) => post('/api/staff', { name }),
  remove: (name: string) => del(`/api/staff/${encodeURIComponent(name)}`),
  availability: () => get<{ id: string; staff: string; day: number; slot: number | null; reason: string }[]>('/api/staff/availability'),
  addUnavailability: (body: { staff?: string; day: number; slot?: number | null; reason?: string }) => post('/api/staff/availability', body),
  removeUnavailability: (id: string) => del(`/api/staff/availability/${encodeURIComponent(id)}`),
};


// ─── Planning master data (SCH-FR-01) ──────────────────────────────────────

export interface AcademicTerm { id: string; name: string; start: string; end: string; is_active: boolean }
export interface Holiday { id: string; label: string; day: number; reason: string }
export interface Department { id: string; name: string; code: string }

export const planning = {
  terms: () => get<AcademicTerm[]>('/api/planning/terms'),
  createTerm: (body: { name: string; start: string; end: string; is_active?: boolean }) => post<AcademicTerm>('/api/planning/terms', body),
  deleteTerm: (id: string) => del(`/api/planning/terms/${encodeURIComponent(id)}`),
  activateTerm: (id: string) => post<AcademicTerm>(`/api/planning/terms/${encodeURIComponent(id)}/activate`),
  holidays: () => get<Holiday[]>('/api/planning/holidays'),
  addHoliday: (body: { label: string; day: number; reason?: string }) => post<Holiday>('/api/planning/holidays', body),
  removeHoliday: (id: string) => del(`/api/planning/holidays/${encodeURIComponent(id)}`),
  departments: () => get<Department[]>('/api/planning/departments'),
  addDepartment: (body: { name: string; code: string }) => post<Department>('/api/planning/departments', body),
  removeDepartment: (id: string) => del(`/api/planning/departments/${encodeURIComponent(id)}`),
};


// ─── Sections ────────────────────────────────────────────────────────────────

export interface Section {
  id: string; course_id: string; code: string; name: string;
  staff: string; group: string; capacity: number; enrolled: number;
  year: string; term: string;
  academic_year?: number;
  major?: 'CS' | 'IT' | 'AI' | 'DS';
}

export interface CourseRegistration {
  id: string; student_id: string; section_id: string;
  year: string; term: string; status: 'registered' | 'dropped';
}

export const sections = {
  list:   (params?: { q?: string; year?: string; term?: string }) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>,
    ).toString() : '';
    return get<Section[]>(`/api/sections${qs}`);
  },
  get:    (id: string) => get<Section>(`/api/sections/${id}`),
  create: (data: Partial<Section>) => post<Section>('/api/sections', data),
  update: (id: string, data: Partial<Section>) => put<Section>(`/api/sections/${id}`, data),
  remove: (id: string) => del(`/api/sections/${id}`),
};


// ─── Notifications ───────────────────────────────────────────────────────────

export interface Notification {
  id: string; audience: string; email: string | null; type: string;
  message: string; related_id: string | null; read: boolean; created_at: string;
}

export const notifications = {
  list:     (params?: { email?: string; role?: string; unread?: boolean }) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
      ),
    ).toString() : '';
    return get<Notification[]>(`/api/notifications${qs}`);
  },
  markRead: (id: string) => request<Notification>('PATCH', `/api/notifications/${id}/read`),
};


// ─── Schedules (canonical export) ────────────────────────────────────────────

export const schedules = {
  exportIcsUrl: (staff?: string) =>
    `${BASE}/api/schedules/export/ics${staff ? `?staff=${encodeURIComponent(staff)}` : ''}`,
};
