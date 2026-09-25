import React, { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useTheme } from './theme';
import LoginScreen from './LoginScreen';
import RoomsScreen from './RoomsScreen';
import AnalyticsScreen from './AnalyticsScreen';
import StudentPortal from './StudentPortal';
import ProfileModal, { loadProfile, type UserProfile } from './ProfileModal';
import { sendChat } from './components/Chatbot/api';
import NotificationsBell from './components/NotificationsBell';
import SectionsScreen from './SectionsScreen';
import PlanningScreen from './PlanningScreen';
import StaffAvailability from './components/StaffAvailability';
import { timetable as timetableApi, conflicts as conflictsApi, allocations as allocationsApi, rooms as roomsApi, staff as staffApi, students as studentsApi, sections as sectionsApi, versions as versionsApi, auth as authApi, setToken } from './api/client';
import type { StudentSession, ManagedStudent, ScheduleVersion, CourseRegistration } from './api/client';
import {
  DAYS, FULL_DAYS, TIME_SLOTS, ROOMS, LABS, STAFF,
  TIMETABLE_DATA, CONFLICTS,
  type Session, type Conflict, type Alternative,
} from './data';

type AppRole = 'admin' | 'lecturer' | 'student';
type AppPage = 'schedule' | 'rooms' | 'student';

const LoadingSpinner = () => {
  const { tokens: C } = useTheme();
  return (
    <div className="flex h-full items-center justify-center" style={{ background: C.bg }}>
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
    </div>
  );
};

// Auth context
interface AuthContextType {
  role: AppRole | null;
  displayName: string | null;
  email: string | null;
  isAuthenticated: boolean;
  login: (role: AppRole, displayName?: string, email?: string) => void;
  logout: () => void;
}

const AuthContext = React.createContext<AuthContextType | null>(null);

function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { tokens: C } = useTheme();
  const [role, setRole] = useState<AppRole | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const savedRole = localStorage.getItem('auth_role') as AppRole | null;
    const savedName = localStorage.getItem('auth_name');
    const savedEmail = localStorage.getItem('auth_email');
    if (token && savedRole) {
      setRole(savedRole);
      setDisplayName(savedName);
      setEmail(savedEmail);
      setIsAuthenticated(true);
      setToken(token);
    }
    setHydrated(true);
  }, []);

  const login = (newRole: AppRole, newDisplayName?: string, newEmail?: string) => {
    setRole(newRole);
    setDisplayName(newDisplayName || null);
    if (newEmail !== undefined) {
      setEmail(newEmail);
      try { localStorage.setItem('auth_email', newEmail); } catch { /* ignore */ }
    }
    setIsAuthenticated(true);
  };

  const logout = () => {
    authApi.logout().catch(() => {});
    setToken(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_role');
    localStorage.removeItem('auth_name');
    localStorage.removeItem('auth_email');
    setRole(null);
    setDisplayName(null);
    setEmail(null);
    setIsAuthenticated(false);
  };

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: C.bg }}>
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ role, displayName, email, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

// Preview-as context (admin looks at lecturer/student views without logging out).
// Preview is view-only: pages read the preview role instead of the login role,
// so every edit gate below automatically disables while previewing.
type PreviewRole = 'lecturer' | 'student' | null;
interface PreviewCtx {
  previewRole: PreviewRole;
  previewStudentId: string | null;
  setPreviewRole: (r: PreviewRole) => void;
  setPreviewStudentId: (id: string | null) => void;
}
const PreviewContext = React.createContext<PreviewCtx>({
  previewRole: null, previewStudentId: null,
  setPreviewRole: () => {}, setPreviewStudentId: () => {},
});
function usePreview() { return React.useContext(PreviewContext); }

// ─── Shared dashboard types ─────────────────────────────────────────────────

type GridView = 'rooms' | 'labs' | 'staff';
type GridFilter = 'session' | 'conflict' | 'available' | null;
type VersionId = 'draft-3' | 'draft-2' | 'pub-1';

interface PersonalEvent {
  id: string; code: string; name: string; room: string; building: string;
  day: number; slot: number; color: string; staff?: string; group?: string;
}

interface SessionFormValue {
  code: string; name: string; staff: string;
  group: string; capacity: string; enrolled: string;
  academic_year: string; major: string;
  day: string; slot: string; duration: string; room: string;
}

// ─── Labs & staff grids (day → session, mirrors data.ts shape) ───────────────

const LABS_GRID: Record<string, Record<number, Session | null>> = {
  'CS-Lab1': {
    0: { id: 'lb1', code: 'CS201L', name: 'Data Structures Lab', staff: 'Dr. Chen Wei', group: 'CS-2A', capacity: 60, enrolled: 28, color: '#2563eb' },
    1: null,
    2: { id: 'lb2', code: 'CS301L', name: 'Algorithms Lab', staff: 'Dr. Chen Wei', group: 'CS-3A', capacity: 60, enrolled: 24, color: '#2563eb' },
    3: null,
    4: { id: 'lb3', code: 'CS401L', name: 'ML Lab', staff: 'Dr. Lena Kovač', group: 'CS-4A', capacity: 60, enrolled: 22, color: '#7c3aed' },
  },
  'CS-Lab2': {
    0: null,
    1: { id: 'lb4', code: 'CS501L', name: 'Distributed Sys Lab', staff: 'Dr. Lena Kovač', group: 'CS-MSc', capacity: 40, enrolled: 18, color: '#7c3aed' },
    2: null,
    3: { id: 'lb5', code: 'CS601L', name: 'Research Lab', staff: 'Dr. Chen Wei', group: 'PhD-1', capacity: 40, enrolled: 12, color: '#2563eb' },
    4: null,
  },
  'CS-Lab3': {
    0: { id: 'lb12', code: 'CS302L', name: 'OS Lab', staff: 'Dr. Mona Khalil', group: 'CS-3B', capacity: 50, enrolled: 23, color: '#2563eb' },
    1: null, 2: null,
    3: { id: 'lb13', code: 'CS101L', name: 'Intro CS Lab', staff: 'Dr. Ahmed Hassan', group: 'CS-1A', capacity: 50, enrolled: 42, color: '#2563eb' },
    4: null,
  },
  'Phys-Lab': {
    0: { id: 'lb6', code: 'PHYS101L', name: 'Mechanics Lab', staff: 'Dr. Raj Patel', group: 'ENG-1A', capacity: 48, enrolled: 24, color: '#0891b2' },
    1: null, 2: null,
    3: { id: 'lb7', code: 'PHYS201L', name: 'Electrodynamics Lab', staff: 'Dr. Raj Patel', group: 'PHYS-2A', capacity: 48, enrolled: 20, color: '#0891b2' },
    4: null,
  },
  'Phys-Lab2': {
    0: null,
    1: { id: 'lb14', code: 'PHYS102L', name: 'Waves Lab', staff: 'Dr. Fatma Ali', group: 'ENG-1B', capacity: 40, enrolled: 22, color: '#0891b2' },
    2: null, 3: null, 4: null,
  },
  'Chem-Lab': {
    0: null,
    1: { id: 'lb8', code: 'CHEM201L', name: 'Organic Chem Lab', staff: 'Dr. Raj Patel', group: 'CHEM-2B', capacity: 30, enrolled: 16, color: '#d97706' },
    2: null, 3: null,
    4: { id: 'lb9', code: 'CHEM401L', name: 'Spectroscopy Lab', staff: 'Dr. Raj Patel', group: 'CHEM-4A', capacity: 30, enrolled: 14, color: '#d97706' },
  },
  'Chem-Lab B': {
    0: null, 1: null,
    2: { id: 'lb15', code: 'CHEM102L', name: 'General Chem Lab', staff: 'Prof. Karim Adel', group: 'CHEM-1A', capacity: 30, enrolled: 21, color: '#d97706' },
    3: null, 4: null,
  },
  'BioLab': {
    0: null, 1: null,
    2: { id: 'lb10', code: 'BIO101L', name: 'Cell Biology Lab', staff: 'Dr. Marcus Bell', group: 'BIO-1A', capacity: 28, enrolled: 19, color: '#be185d' },
    3: { id: 'lb11', code: 'BIO301L', name: 'Genetics Lab', staff: 'Dr. Marcus Bell', group: 'BIO-3A', capacity: 28, enrolled: 18, color: '#be185d' },
    4: null,
  },
  'BioLab2': {
    0: null,
    1: { id: 'lb16', code: 'BIO201L', name: 'Microbiology Lab', staff: 'Dr. Heba Mostafa', group: 'BIO-2A', capacity: 24, enrolled: 22, color: '#be185d' },
    2: null, 3: null, 4: null,
  },
  'Eng-Workshop': {
    0: { id: 'lb17', code: 'ENG202L', name: 'Electronics Workshop', staff: 'Eng. Omar Farouk', group: 'EE-2B', capacity: 30, enrolled: 22, color: '#059669' },
    1: null, 2: null, 3: null, 4: null,
  },
};

const STAFF_GRID: Record<string, Record<number, Session | null>> = {
  'Dr. Chen Wei':        { 0: { id: 'sf1', code: 'CS301', name: 'Algorithms', staff: 'Dr. Chen Wei', group: 'CS-3A', capacity: 240, enrolled: 108, color: '#2563eb' }, 1: null, 2: { id: 'sf2', code: 'CS201', name: 'Data Structures', staff: 'Dr. Chen Wei', group: 'CS-2A', capacity: 120, enrolled: 78, color: '#2563eb' }, 3: null, 4: null },
  'Prof. Amara Nwosu':   { 0: null, 1: { id: 'sf3', code: 'ENG201', name: 'Circuit Analysis', staff: 'Prof. Amara Nwosu', group: 'EE-2A', capacity: 120, enrolled: 72, color: '#059669' }, 2: { id: 'sf4', code: 'ENG401', name: 'Control Systems', staff: 'Prof. Amara Nwosu', group: 'EE-4A', capacity: 30, enrolled: 28, color: '#059669' }, 3: null, 4: null },
  'Dr. Lena Kovač':      { 0: null, 1: { id: 'sf6', code: 'CS501', name: 'Distributed Sys', staff: 'Dr. Lena Kovač', group: 'CS-MSc', capacity: 30, enrolled: 24, color: '#7c3aed' }, 2: null, 3: { id: 'sf7', code: 'CS401', name: 'ML Foundations', staff: 'Dr. Lena Kovač', group: 'CS-4A', capacity: 240, enrolled: 94, color: '#7c3aed' }, 4: null },
  'Dr. Raj Patel':       { 0: null, 1: { id: 'sf8', code: 'CHEM201', name: 'Organic Chem', staff: 'Dr. Raj Patel', group: 'CHEM-2B', capacity: 300, enrolled: 143, color: '#d97706' }, 2: null, 3: { id: 'sf9', code: 'PHYS201', name: 'Electrodynamics', staff: 'Dr. Raj Patel', group: 'PHYS-2A', capacity: 300, enrolled: 98, color: '#0891b2' }, 4: { id: 'sf10', code: 'PHYS101', name: 'Mechanics', staff: 'Dr. Raj Patel', group: 'ENG-1A', capacity: 240, enrolled: 120, color: '#0891b2' } },
  'Prof. Sara Johansson':{ 0: null, 1: { id: 'sf11', code: 'MATH201', name: 'Linear Algebra', staff: 'Prof. Sara Johansson', group: 'ENG-2B', capacity: 240, enrolled: 235, color: '#7c3aed' }, 2: null, 3: { id: 'sf12', code: 'MATH301', name: 'Calculus III', staff: 'Prof. Sara Johansson', group: 'MATH-3A', capacity: 120, enrolled: 68, color: '#7c3aed' }, 4: null },
  'Dr. Marcus Bell':     { 0: { id: 'sf13', code: 'BIO101', name: 'Cell Biology', staff: 'Dr. Marcus Bell', group: 'BIO-1A', capacity: 300, enrolled: 187, color: '#be185d' }, 1: null, 2: null, 3: { id: 'sf14', code: 'BIO301', name: 'Genetics', staff: 'Dr. Marcus Bell', group: 'BIO-3A', capacity: 28, enrolled: 19, color: '#be185d' }, 4: null },
  'Dr. Ahmed Hassan':    { 0: { id: 'sf15', code: 'CS101', name: 'Intro to CS', staff: 'Dr. Ahmed Hassan', group: 'CS-1A', capacity: 180, enrolled: 172, color: '#2563eb' }, 1: null, 2: null, 3: null, 4: null },
  'Dr. Fatma Ali':       { 0: null, 1: { id: 'sf16', code: 'MATH101', name: 'Calculus I', staff: 'Dr. Fatma Ali', group: 'ENG-1B', capacity: 180, enrolled: 165, color: '#7c3aed' }, 2: null, 3: null, 4: null },
  'Prof. John Smith':    { 0: null, 1: null, 2: null, 3: { id: 'sf17', code: 'ENG101', name: 'Statics', staff: 'Prof. John Smith', group: 'MECH-1A', capacity: 180, enrolled: 150, color: '#059669' }, 4: null },
  'Dr. Mona Khalil':     { 0: { id: 'sf18', code: 'CS302', name: 'Operating Systems', staff: 'Dr. Mona Khalil', group: 'CS-3B', capacity: 25, enrolled: 23, color: '#2563eb' }, 1: null, 2: null, 3: null, 4: null },
  'Eng. Omar Farouk':    { 0: null, 1: null, 2: { id: 'sf19', code: 'ENG202', name: 'Electronics I', staff: 'Eng. Omar Farouk', group: 'EE-2B', capacity: 25, enrolled: 22, color: '#059669' }, 3: null, 4: null },
  'Dr. Heba Mostafa':    { 0: null, 1: null, 2: { id: 'sf20', code: 'BIO201', name: 'Microbiology', staff: 'Dr. Heba Mostafa', group: 'BIO-2A', capacity: 25, enrolled: 24, color: '#be185d' }, 3: null, 4: null },
  'Prof. Karim Adel':    { 0: null, 1: null, 2: null, 3: { id: 'sf21', code: 'CHEM102', name: 'General Chem II', staff: 'Prof. Karim Adel', group: 'CHEM-1A', capacity: 25, enrolled: 21, color: '#d97706' }, 4: null },
  'Dr. Nadia Samir':     { 0: null, 1: { id: 'sf22', code: 'CS402', name: 'HCI Studio', staff: 'Dr. Nadia Samir', group: 'CS-4B', capacity: 22, enrolled: 20, color: '#7c3aed' }, 2: null, 3: null, 4: null },
  'TA. Youssef Nabil':   { 0: null, 1: null, 2: null, 3: null, 4: null },
};

// ─── Personal events & notifications (mock) ─────────────────────────────────

const STUDENT_EVENTS: PersonalEvent[] = [
  { id: 'e1', code: 'CS301', name: 'Algorithms', room: 'LT-101', building: 'Block A', day: 0, slot: 0, color: '#2563eb', staff: 'Dr. Chen Wei' },
  { id: 'e2', code: 'MATH201', name: 'Linear Algebra', room: 'LT-101', building: 'Block A', day: 1, slot: 1, color: '#7c3aed', staff: 'Prof. Sara Johansson' },
  { id: 'e3', code: 'CS401', name: 'ML Foundations', room: 'LT-101', building: 'Block A', day: 3, slot: 3, color: '#2563eb', staff: 'Dr. Lena Kovač' },
  { id: 'e4', code: 'CS201', name: 'Data Structures', room: 'LT-102', building: 'Block A', day: 2, slot: 2, color: '#2563eb', staff: 'Dr. Chen Wei' },
  { id: 'e5', code: 'PHYS101', name: 'Mechanics', room: 'LT-101', building: 'Block A', day: 4, slot: 4, color: '#0891b2', staff: 'Dr. Raj Patel' },
];

const LECTURER_EVENTS: PersonalEvent[] = [
  { id: 'l1', code: 'CS301', name: 'Algorithms', room: 'LT-101', building: 'Block A', day: 0, slot: 0, color: '#2563eb', group: 'CS-3A' },
  { id: 'l2', code: 'CS201', name: 'Data Structures', room: 'LT-102', building: 'Block A', day: 2, slot: 2, color: '#2563eb', group: 'CS-2A' },
  { id: 'l3', code: 'CS401', name: 'ML Foundations', room: 'LT-101', building: 'Block A', day: 3, slot: 3, color: '#7c3aed', group: 'CS-4A' },
];

interface Notif { id: string; type: 'info' | 'warning' | 'change'; text: string; }

const NOTIFS: Notif[] = [
  { id: 'n1', type: 'change', text: 'MATH201 moved from LT-101 → LT-201 effective next Monday.' },
  { id: 'n2', type: 'warning', text: 'PHYS101 Fri 12:00 — Dr. Patel double-booked with PHYS201.' },
  { id: 'n3', type: 'info', text: 'Week 4 schedule published. Print / PDF to sync your calendar.' },
];

const NOTIF_COLOR: Record<string, string> = { change: '#f59e0b', warning: '#ef4444', info: '#38bdf8' };

// ─── Managed students (local fallback, mirrors backend seed) ────────────────

const DEFAULT_STUDENTS: ManagedStudent[] = [
  { id: 'st1', name: 'Amara Osei', email: 'amara@bua.edu.eg', group: 'CS-3A', year: 'Year 3', academic_year: 3, major: 'CS' },
  { id: 'st2', name: 'Youssef Adel', email: 'youssef@bua.edu.eg', group: 'CS-2A', year: 'Year 2', academic_year: 2 },
  { id: 'st3', name: 'Mariam Hany', email: 'mariam@bua.edu.eg', group: 'ENG-2B', year: 'Year 2', academic_year: 2 },
  { id: 'st4', name: 'Omar Khaled', email: 'omar@bua.edu.eg', group: 'CS-3B', year: 'Year 3', academic_year: 3, major: 'CS' },
  { id: 'st5', name: 'Nour Elhouda', email: 'nour@bua.edu.eg', group: 'BIO-2A', year: 'Year 2', academic_year: 2 },
  { id: 'st6', name: 'Karim Samy', email: 'karim@bua.edu.eg', group: 'EE-2A', year: 'Year 2', academic_year: 2, major: 'IT' },
  { id: 'st7', name: 'Salma Tarek', email: 'salma@bua.edu.eg', group: 'CS-1A', year: 'Year 1', academic_year: 1 },
  { id: 'st8', name: 'Mostafa Fathy', email: 'mostafa@bua.edu.eg', group: 'MECH-3A', year: 'Year 3', academic_year: 3, major: 'IT' },
  // Year1 additional
  { id: 'st_y1_1', name: 'Y1 Student One', email: 'student.y1.gen1@bua.edu.eg', group: 'CS-1A', year: 'Year 1', academic_year: 1 },
  { id: 'st_y1_2', name: 'Y1 Student Two', email: 'student.y1.gen2@bua.edu.eg', group: 'CS-1B', year: 'Year 1', academic_year: 1 },
];

function loadStudents(): ManagedStudent[] {
  try {
    const raw = localStorage.getItem('bua-students-v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as ManagedStudent[];
    }
  } catch { /* ignore */ }
  return [...DEFAULT_STUDENTS];
}

// ─── Small shared primitives ────────────────────────────────────────────────

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'success' | 'outline' | 'accent';

function Btn({ children, onClick, variant = 'ghost', disabled, small, className = '' }: {
  children: React.ReactNode; onClick?: () => void; variant?: BtnVariant;
  disabled?: boolean; small?: boolean; className?: string;
}) {
  const { tokens: C } = useTheme();
  const s: Record<BtnVariant, React.CSSProperties> = {
    primary: { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: 'transparent', color: C.textSub, border: 'none' },
    danger:  { background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}30` },
    success: { background: C.successBg, color: C.success, border: `1px solid ${C.success}30` },
    outline: { background: 'transparent', color: C.textSub, border: `1px solid ${C.border}` },
    accent:  { background: C.accentBg, color: C.accent, border: `1px solid ${C.accent}30` },
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all hover:opacity-80 active:scale-[0.97] disabled:opacity-40 ${small ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} ${className}`}
      style={{ fontFamily: 'Inter, sans-serif', ...s[variant] }}>
      {children}
    </button>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  const { tokens: C } = useTheme();
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: C.surfaceAlt }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value}%`, background: color }} />
    </div>
  );
}

// ─── Timetable grid ─────────────────────────────────────────────────────────

function TimetableGrid({ view, days, rows, data, conflicts, filter, isAdmin, onSessionClick, onEmptyCellClick, onMoveSession, onConflictHighlight, weekStart, times, fullDays, onRenameDay, onDeleteDay, onRenameTime, onDeleteTime }: {
  view: GridView;
  days: string[];
  rows: string[];
  data: Record<string, Record<number, Session | null>>;
  conflicts: Conflict[];
  filter: GridFilter;
  isAdmin: boolean;
  onSessionClick: (s: Session, row: string, day: number) => void;
  onEmptyCellClick: (row: string, day: number, slot?: number) => void;
  onMoveSession: (fromRow: string, fromDay: number, toRow: string, toDay: number) => void;
  onConflictHighlight: (id: string | null) => void;
  weekStart?: Date;
  times?: string[];
  fullDays?: string[];
  onRenameDay?: (idx: number) => void;
  onDeleteDay?: (idx: number) => void;
  onRenameTime?: (idx: number) => void;
  onDeleteTime?: (idx: number) => void;
}) {
  const { tokens: C } = useTheme();
  const [hovered, setHovered] = useState<string | null>(null);

  // Academic standard: Time slots vertical (left), Days horizontal (top)
  // Build day→slot → sessions lookup for visual correctness
  const daySlotLookup = useMemo(() => {
    const map: Record<number, Record<number, { session: Session; row: string }[]>> = {};
    for (const [row, dayMap] of Object.entries(data)) {
      for (const [dStr, sess] of Object.entries(dayMap)) {
        if (!sess) continue;
        const d = Number(dStr);
        const slot = sess.slot ?? 0;
        if (!map[d]) map[d] = {};
        if (!map[d][slot]) map[d][slot] = [];
        map[d][slot].push({ session: sess, row });
      }
    }
    return map;
  }, [data]);

  // Conflict lookup by row-day (legacy) and by day-slot for academic grid
  const conflictByDaySlot = useMemo(() => {
    const m = new Set<string>();
    conflicts.forEach(c => m.add(`${c.cell.day}-${c.cell.slot}`));
    return m;
  }, [conflicts]);
  const conflictByRowDay = useMemo(() => {
    const s = new Set(conflicts.map(c => `${c.cell.row}-${c.cell.day}`));
    const map: Record<string, string> = {};
    conflicts.forEach(c => { map[`${c.cell.row}-${c.cell.day}`] = c.id; });
    return { set: s, map };
  }, [conflicts]);

  const effectiveTimes = times ?? TIME_SLOTS;
  const effectiveFullDays = fullDays ?? FULL_DAYS;
  const timeColWidth = 96;
  const dayCount = days.length;
  const slotCount = effectiveTimes.length;

  // Dynamic academic week: show real dates alongside day names
  const fmtDayDate = (di: number) => {
    if (!weekStart) return '';
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + di);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  };

  return (
    <div className="w-full h-full overflow-auto" style={{ background: C.surface }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: timeColWidth }} />
          {days.map(d => <col key={d} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 px-2 py-2 text-center text-[9px] font-semibold tracking-widest uppercase"
              style={{ background: C.surfaceAlt, color: C.textMuted, fontFamily: 'DM Mono, monospace', borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
              <div>TIME</div>
              {isAdmin && <div className="text-[7px] mt-1" style={{ color: C.textMuted }}>click ✎ to edit</div>}
            </th>
            {days.map((d, di) => {
              const dateStr = fmtDayDate(di);
              return (
              <th key={`${d}-${di}`} className="sticky top-0 z-10 px-1 py-2 text-center group"
                style={{ background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`, borderRight: di < dayCount - 1 ? `1px solid ${C.borderSub}` : 'none' }}>
                <div className="flex items-center justify-center gap-1">
                  <button onClick={() => isAdmin && onRenameDay?.(di)} title={isAdmin ? "Click to rename day" : ""} className="text-[10px] font-bold tracking-widest uppercase hover:opacity-70" style={{ fontFamily: 'DM Mono, monospace', color: C.textSub, background: 'transparent' }}>{d}</button>
                  {isAdmin && onDeleteDay && <button onClick={(e) => { e.stopPropagation(); onDeleteDay(di); }} title="Delete day column" className="w-4 h-4 rounded flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-red-50" style={{ color: C.danger, fontSize: 9 }}>✕</button>}
                </div>
                <div className="text-[8px] font-medium flex items-center justify-center gap-1" style={{ color: C.textMuted }}>
                  <span>{effectiveFullDays[di] ?? ''}</span>
                  {dateStr && <span style={{ background: C.accentBg, color: C.accent, padding: '1px 4px', borderRadius: 4, fontSize: 7 }}>{dateStr}</span>}
                </div>
                {isAdmin && <div className="text-[7px] mt-0.5 opacity-0 group-hover:opacity-100" style={{ color: C.textMuted }}>click to edit</div>}
              </th>
            );})}
          </tr>
        </thead>
        <tbody>
          {effectiveTimes.map((time, si) => {
            const isLastRow = si === slotCount - 1;
            const nextTime = effectiveTimes[Math.min(si + 1, slotCount - 1)];
            return (
              <tr key={`${time}-${si}`}>
                <td className="sticky left-0 z-10 px-1 py-1 text-right group"
                  style={{ background: C.surfaceAlt, borderBottom: isLastRow ? 'none' : `1px solid ${C.borderSub}`, borderRight: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => isAdmin && onRenameTime?.(si)} title={isAdmin ? "Rename time slot" : ""} className="text-[10px] font-bold hover:opacity-70" style={{ fontFamily: 'DM Mono, monospace', color: C.textSub, background: 'transparent' }}>{time}</button>
                    {isAdmin && onDeleteTime && <button onClick={(e) => { e.stopPropagation(); onDeleteTime(si); }} title="Delete time slot (row)" className="w-3 h-3 rounded flex items-center justify-center opacity-60 hover:opacity-100" style={{ color: C.danger, fontSize: 7 }}>✕</button>}
                  </div>
                  <div className="text-[8px] flex items-center justify-end gap-1" style={{ color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>
                    <span>→ {nextTime}</span>
                    {isAdmin && <span className="opacity-0 group-hover:opacity-100 text-[7px]">✎</span>}
                  </div>
                </td>
                {days.map((_, di) => {
                  const cellSessions = daySlotLookup[di]?.[si] ?? [];
                  const hasConflict = cellSessions.some(({ row }) => conflictByRowDay.set.has(`${row}-${di}`)) || conflictByDaySlot.has(`${di}-${si}`);
                  // find one conflict id for highlight
                  let conflictId: string | null = null;
                  for (const { row } of cellSessions) {
                    const cid = conflictByRowDay.map[`${row}-${di}`];
                    if (cid) { conflictId = cid; break; }
                  }
                  const isEmpty = cellSessions.length === 0;
                  const matchesFilter = filter === null ||
                    (filter === 'available' && isEmpty) ||
                    (filter === 'conflict' && hasConflict) ||
                    (filter === 'session' && !isEmpty && !hasConflict);
                  const cellKey = `${di}-${si}`;
                  const isHovered = hovered === cellKey;
                  const showAdd = isAdmin && isEmpty && isHovered;
                  return (
                    <td key={di}
                      onClick={() => {
                        if (isAdmin && isEmpty) {
                          const defaultRow = rows[0] ?? (view === 'labs' ? 'CS-Lab1' : 'LT-101');
                          onEmptyCellClick(defaultRow, di, si);
                        }
                      }}
                      onMouseEnter={() => { setHovered(cellKey); if (conflictId) onConflictHighlight(conflictId); }}
                      onMouseLeave={() => { if (hovered === cellKey) setHovered(null); onConflictHighlight(null); }}
                      style={{
                        borderBottom: isLastRow ? 'none' : `1px solid ${C.borderSub}`,
                        borderRight: di < dayCount - 1 ? `1px solid ${C.borderSub}` : 'none',
                        height: 78, padding: 4, verticalAlign: 'top',
                        background: isHovered ? C.surfaceAlt : hasConflict ? C.dangerBg : 'transparent',
                        opacity: matchesFilter ? 1 : 0.15,
                        transition: 'background 0.12s',
                        cursor: isAdmin && isEmpty ? 'copy' : undefined,
                      }}>
                      {cellSessions.length > 0 && matchesFilter ? (
                        <div className="space-y-1">
                          {cellSessions.map(({ session, row }) => (
                            <button key={`${session.id}-${row}`} onClick={(e) => { e.stopPropagation(); onSessionClick(session, row, di); }}
                              className="w-full text-left px-2.5 py-2 rounded-lg overflow-hidden transition-all hover:brightness-105 hover:shadow-sm"
                              style={{ background: session.color + '14', border: `1.5px solid ${session.color}35`, borderLeft: `3px solid ${session.color}` }}>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-extrabold tracking-wide truncate" style={{ fontFamily: 'DM Mono, monospace', color: session.color }}>{session.code}</span>
                                <span className="ml-auto text-[7px] font-bold px-1 py-0.5 rounded" style={{ background: session.color + '20', color: session.color }}>{row}</span>
                              </div>
                              <div className="text-[10px] font-semibold leading-tight truncate mt-0.5" style={{ color: C.text, fontFamily: 'Outfit, sans-serif' }}>{session.name}</div>
                              <div className="flex items-center gap-1 mt-1 text-[8px] truncate" style={{ color: C.textSub }}>
                                <span>👤</span><span className="truncate">{session.staff}</span>
                              </div>
                              <div className="flex items-center gap-1 text-[7px] mt-0.5" style={{ color: C.textMuted }}>
                                <span>📍</span><span className="truncate">{view === 'staff' ? row : row} · {session.group}</span>
                                <span className="ml-auto" style={{ fontFamily: 'DM Mono, monospace', color: C.accent }}>{(effectiveTimes[session.slot ?? 0] ?? TIME_SLOTS[session.slot ?? 0] ?? '')}-{(effectiveTimes[Math.min((session.slot ?? 0) + (session.duration ?? 1), effectiveTimes.length - 1)] ?? TIME_SLOTS[Math.min((session.slot ?? 0) + (session.duration ?? 1), TIME_SLOTS.length - 1)] ?? '')}</span>
                              </div>
                              {hasConflict && <div className="text-[7px] font-bold mt-1" style={{ color: C.danger }}>⚡ conflict</div>}
                              <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: C.border }}>
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((session.enrolled / Math.max(1, session.capacity)) * 100))}%`, background: session.enrolled / session.capacity > 0.9 ? C.danger : session.color, opacity: 0.7 }} />
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : isEmpty ? (
                        showAdd ? (
                          <button className="w-full h-full rounded-lg flex items-center justify-center" style={{ border: `1.5px dashed ${C.accent}50`, color: C.accent, fontSize: 18, minHeight: 68 }} title="Add session at this time">+</button>
                        ) : (
                          <div className="w-full h-full" style={{ minHeight: 68 }} />
                        )
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[8px] text-center sticky bottom-0" style={{ background: C.surfaceAlt, color: C.textMuted, borderTop: `1px solid ${C.border}`, fontFamily: 'DM Mono, monospace' }}>
        Academic grid — Time vertical · Days horizontal · Cell shows Code · Name · Staff · Room/Lab · {view} view
      </div>
    </div>
  );
}

// ─── Conflicts sidebar ──────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  double_booking: 'Double Book', capacity: 'Capacity', staff_overlap: 'Staff Overlap',
  equipment: 'Equipment', student_group: 'Student Group', room_type: 'Room Type', closure: 'Closure',
};

function RightSidebar({ conflicts, highlighted, activeConflict, onSelect, onDismiss, onApply, appliedMsg, onClearApplied }: {
  conflicts: Conflict[]; highlighted: string | null;
  activeConflict: string | null; onSelect: (id: string) => void; onDismiss: (id: string) => void;
  onApply: (conflictId: string, alternativeId: string) => Promise<void> | void;
  appliedMsg: string | null; onClearApplied: () => void;
}) {
  const { tokens: C } = useTheme();
  const [applying, setApplying] = useState<string | null>(null);
  const tradeOff = (score: number) => score >= 90
    ? { label: 'Best fit', color: C.success, bg: C.successBg }
    : score >= 70
      ? { label: 'Minor trade-offs', color: C.warning, bg: C.warningBg }
      : { label: 'Notable trade-offs', color: C.danger, bg: C.dangerBg };
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>Conflicts</span>
          {conflicts.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: C.dangerBg, color: C.danger, fontFamily: 'DM Mono, monospace' }}>{conflicts.length}</span>
          )}
        </div>
        {conflicts.length === 0 && <span className="text-[10px]" style={{ color: C.success }}>All clear</span>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {appliedMsg && (
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: C.successBg, border: `1px solid ${C.success}55` }}>
            <span className="flex-1 text-[11px] font-semibold" style={{ color: C.success }}>{appliedMsg}</span>
            <button onClick={onClearApplied} className="text-[10px] hover:opacity-60" style={{ color: C.textMuted }}>✕</button>
          </div>
        )}
        {conflicts.length === 0 && !appliedMsg ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <div className="text-2xl">✓</div>
            <div className="text-xs font-semibold" style={{ color: C.success }}>All clear</div>
            <div className="text-[10px]" style={{ color: C.textMuted }}>Ready to publish.</div>
          </div>
        ) : conflicts.map(c => {
          const isActive = activeConflict === c.id || highlighted === c.id;
          return (
            <div key={c.id} onClick={() => onSelect(c.id)}
              className="rounded-xl p-3 cursor-pointer transition-all"
              style={{ background: isActive ? C.dangerBg : C.surface, border: `1px solid ${isActive ? C.danger + '55' : C.border}` }}>
              <div className="flex items-start justify-between gap-1.5 mb-1.5">
                <div className="flex flex-wrap gap-1">
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: C.dangerBg, color: C.danger, fontFamily: 'DM Mono, monospace' }}>{TYPE_LABEL[c.type] ?? c.type}</span>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: C.warningBg, color: C.warning, fontFamily: 'DM Mono, monospace' }}>HARD</span>
                </div>
                <button onClick={e => { e.stopPropagation(); onDismiss(c.id); }} className="text-[10px] flex-shrink-0 hover:opacity-50 transition-opacity" style={{ color: C.textMuted }}>✕</button>
              </div>
              <p className="text-[10px] leading-snug" style={{ color: C.textSub }}>{c.description}</p>
              {c.alternatives.length > 0 && !isActive && (
                <div className="mt-2 pt-2 flex items-center gap-2" style={{ borderTop: `1px solid ${C.border}` }}>
                  <span className="text-[9px] font-bold" style={{ fontFamily: 'DM Mono, monospace', color: C.accent }}>{c.alternatives[0].score}%</span>
                  <span className="text-[9px]" style={{ color: C.textMuted }}>{c.alternatives[0].room} · {DAYS[c.alternatives[0].day]} {TIME_SLOTS[c.alternatives[0].slot]}</span>
                  <span className="ml-auto text-[9px]" style={{ color: C.accent }}>tap for {c.alternatives.length} options ▸</span>
                </div>
              )}
              {isActive && c.alternatives.length > 0 && (
                <div className="mt-2 pt-2 space-y-2" style={{ borderTop: `1px solid ${C.border}` }}>
                  <div className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: 'DM Mono, monospace', color: C.textMuted }}>
                    {c.alternatives.length} ranked alternatives — admin confirms one
                  </div>
                  {c.alternatives.map((a, i) => {
                    const t = tradeOff(a.score);
                    const busy = applying === a.id;
                    return (
                      <div key={a.id} className="rounded-lg p-2" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}` }}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold" style={{ fontFamily: 'DM Mono, monospace', color: C.textMuted }}>#{i + 1}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ fontFamily: 'DM Mono, monospace', background: C.accentBg, color: C.accent }}>{a.score}%</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: t.bg, color: t.color }}>{t.label}</span>
                        </div>
                        <div className="text-[10px] font-semibold mt-1" style={{ color: C.text }}>{a.room} · {DAYS[a.day]} {TIME_SLOTS[a.slot]}</div>
                        <ul className="mt-1 space-y-0.5">
                          {(a.reasons ?? []).map((r, j) => (
                            <li key={j} className="text-[9px] leading-snug" style={{ color: C.textSub }}>✓ {r}</li>
                          ))}
                        </ul>
                        <button
                          disabled={busy}
                          onClick={e => {
                            e.stopPropagation();
                            setApplying(a.id);
                            Promise.resolve(onApply(c.id, a.id)).finally(() => setApplying(null));
                          }}
                          className="mt-1.5 w-full py-1 rounded-lg text-[10px] font-bold transition-all hover:brightness-110 disabled:opacity-40"
                          style={{ background: C.accent, color: '#fff' }}>
                          {busy ? 'Applying…' : `Apply this option`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Lecturer personal calendar ─────────────────────────────────────────────

function PersonalCalendar({ events, role }: { events: PersonalEvent[]; role: AppRole }) {
  const { tokens: C } = useTheme();
  const [selectedEv, setSelectedEv] = useState<PersonalEvent | null>(null);
  const HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
  const lookup: Record<number, Record<number, PersonalEvent>> = {};
  events.forEach(ev => { if (!lookup[ev.day]) lookup[ev.day] = {}; lookup[ev.day][ev.slot] = ev; });
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>{role === 'student' ? 'My Schedule' : 'My Teaching Schedule'}</div>
          <div className="text-[9px] mt-0.5" style={{ color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>W03 · Mon 19 – Fri 23 Jan 2026</div>
        </div>
        <div className="flex gap-2"><Btn variant="outline" onClick={() => window.print()}>Print / PDF</Btn></div>
      </div>
      <div className="overflow-auto rounded-xl" style={{ border: `1px solid ${C.border}` }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
          <thead><tr>
            <th style={{ width: 52, background: C.surfaceAlt, border: `1px solid ${C.border}` }} />
            {DAYS.map(d => <th key={d} className="text-[10px] font-bold text-center py-2" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, fontFamily: 'DM Mono, monospace', color: C.textSub }}>{d}</th>)}
          </tr></thead>
          <tbody>{HOURS.map((hr, si) => (
            <tr key={hr}>
              <td className="text-right text-[9px]" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.textMuted, fontFamily: 'DM Mono, monospace', padding: '4px 8px', verticalAlign: 'top', paddingTop: 6 }}>{hr}</td>
              {DAYS.map((_, di) => {
                const ev = lookup[di]?.[si];
                return (
                  <td key={di} onClick={() => ev && setSelectedEv(ev)} style={{ border: `1px solid ${C.border}`, background: ev ? ev.color + '33' : C.surface, height: 48, padding: ev ? 3 : 0, cursor: ev ? 'pointer' : 'default', verticalAlign: 'top' }}>
                    {ev && <div className="h-full px-2 py-1 rounded-md" style={{ background: ev.color + 'E6', border: `2px solid ${ev.color}CC`, boxShadow: `0 2px 8px ${ev.color}40` }}>
                      <div className="text-[9px] font-bold" style={{ fontFamily: 'DM Mono, monospace', color: '#fff' }}>{ev.code}</div>
                      <div className="text-[8px] truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>{ev.room}</div>
                    </div>}
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {selectedEv && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setSelectedEv(null)}>
          <div onClick={e => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-xs" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3"><div className="w-3 h-3 rounded-full" style={{ background: selectedEv.color }} /><div className="text-sm font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>{selectedEv.code}</div></div>
            <div className="text-xs font-semibold mb-3" style={{ color: C.textSub }}>{selectedEv.name}</div>
            <div className="space-y-1.5 text-[10px]" style={{ color: C.textMuted }}>
              <div>📍 {selectedEv.room}, {selectedEv.building}</div><div>📅 {DAYS[selectedEv.day]} · {TIME_SLOTS[selectedEv.slot]}</div>
              {selectedEv.staff && <div>👤 {selectedEv.staff}</div>}{selectedEv.group && <div>👥 {selectedEv.group}</div>}
            </div>
            <Btn variant="outline" onClick={() => setSelectedEv(null)} className="mt-4 w-full justify-center">Close</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Publish modal ──────────────────────────────────────────────────────────

function PublishModal({ conflictCount, onClose, onPublish }: { conflictCount: number; onClose: () => void; onPublish: () => void }) {
  const { tokens: C } = useTheme();
  const hasConflicts = conflictCount > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div className="text-base font-bold mb-1" style={{ fontFamily: 'Outfit, sans-serif', color: C.text, fontSize: 18 }}>Publish Schedule</div>
        <p className="mb-4" style={{ color: C.textMuted, fontSize: 14 }}>The current draft will go live for all students and staff.</p>
        {hasConflicts ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4" style={{ background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}25`, fontSize: 14, fontWeight: 600 }}>
            {conflictCount} hard conflict{conflictCount !== 1 ? 's' : ''} open — publishing will proceed anyway, and they stay open for later resolution.
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4" style={{ background: C.successBg, color: C.success, border: `1px solid ${C.success}25`, fontSize: 14 }}>
            All hard conflicts resolved. Ready to publish.
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn variant="success" onClick={onPublish}>Confirm Publish</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Version history modal (SCH-FR-07): view saved snapshots, incl. old ones ──

interface SnapshotRow { view: string; row: string; day: string; time: string; code: string; name: string; staff: string; group: string; }

function VersionsModal({ onClose }: { onClose: () => void }) {
  const { tokens: C } = useTheme();
  const [list, setList] = useState<ScheduleVersion[]>([]);
  const [snap, setSnap] = useState<{ label: string; sessions: number; live: boolean; mode: string; gaps: boolean; rows: SnapshotRow[] } | null>(null);
  const [cmpA, setCmpA] = useState<string | null>(null);
  const [cmpB, setCmpB] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ added: { id: string; code: string; name: string; room: string; day: number; slot: number }[]; removed: { id: string; code: string; name: string; room: string; day: number; slot: number }[]; moved: { id: string; code: string; from: { room: string; day: number; slot: number }; to: { room: string; day: number; slot: number } }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    versionsApi.list()
      .then(v => { if (!cancelled && Array.isArray(v)) setList(v); })
      .catch(() => { if (!cancelled) setErr('Could not load versions. Check backend connection.'); });
    return () => { cancelled = true; };
  }, []);
  const view = async (v: ScheduleVersion) => {
    setBusy(true); setErr(null); setDiff(null);
    try {
      const s = await versionsApi.snapshot(v.id);
      const rows: SnapshotRow[] = [];
      Object.entries(s.grid ?? {}).forEach(([view, viewRows]) => {
        Object.entries(viewRows ?? {}).forEach(([row, days]) => {
          Object.entries(days ?? {}).forEach(([day, slots]) => {
            const cells = slots && typeof slots === 'object' ? Object.entries(slots) : [];
            cells.forEach(([slot, sess]) => {
              if (!sess) return;
              const di = parseInt(day, 10), si = parseInt(slot, 10);
              rows.push({
                view, row,
                day: DAYS[di] ?? `Day ${day}`,
                time: `${TIME_SLOTS[si] ?? ''}→${TIME_SLOTS[Math.min(si + 1, TIME_SLOTS.length - 1)] ?? ''}`,
                code: sess.code ?? '', name: sess.name ?? '',
                staff: sess.staff ?? '', group: sess.group ?? '',
              });
            });
          });
        });
      });
      setSnap({ label: v.label, sessions: s.sessions, live: s.live === true, mode: s.mode || 'frozen', gaps: s.gaps === true, rows });
    } catch (e: any) {
      setErr(e?.message || 'No saved snapshot for this version yet.');
    } finally {
      setBusy(false);
    }
  };
  const compare = async () => {
    if (!cmpA || !cmpB || cmpA === cmpB) return;
    setBusy(true); setErr(null); setSnap(null);
    try {
      const d = await versionsApi.compare(cmpA, cmpB);
      setDiff({ added: d.added, removed: d.removed, moved: d.moved });
    } catch (e: any) {
      setErr(e?.message || 'Compare failed.');
    } finally {
      setBusy(false);
    }
  };
  const statusColor = (st: string) => st === 'published'
    ? { bg: C.successBg, text: C.success } : st === 'archived'
      ? { bg: C.surfaceAlt, text: C.textMuted } : { bg: C.warningBg, text: C.warning };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="rounded-2xl w-full max-w-lg overflow-hidden" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="text-base font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text, fontSize: 17 }}>
            {snap ? snap.label : 'Version history'}
          </div>
          <button onClick={snap || diff ? () => { setSnap(null); setDiff(null); } : onClose} className="ml-auto text-sm hover:opacity-60" style={{ color: C.textMuted }}>
            {snap ? '← Back' : '✕'}
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {err && <div className="px-3 py-2 rounded-lg mb-3" style={{ background: C.dangerBg, color: C.danger, fontSize: 13 }}>{err}</div>}
          {!snap && !diff ? (
            <div className="space-y-2">
              <div className="text-[11px] mb-1" style={{ color: C.textMuted }}>Tick two versions, then Compare — or View one.</div>
              {list.map(v => {
                const sc = statusColor(v.status);
                const picked = cmpA === v.id || cmpB === v.id;
                return (
                  <div key={v.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: picked ? C.accentBg : C.surfaceAlt, border: `1px solid ${picked ? C.accent : C.borderSub}` }}>
                    <input type="checkbox" checked={picked} onChange={() => {
                      if (cmpA === v.id) setCmpA(null);
                      else if (cmpB === v.id) setCmpB(null);
                      else if (!cmpA) setCmpA(v.id);
                      else if (!cmpB) setCmpB(v.id);
                      else { setCmpA(cmpB); setCmpB(v.id); }
                    }} title="Select for compare" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate" style={{ color: C.text }}>{v.label}</div>
                      <div className="text-[10px]" style={{ color: C.textMuted }}>
                        {new Date(v.timestamp).toLocaleString()} · {v.changes} changes · {v.conflicts} conflicts
                      </div>
                    </div>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: sc.bg, color: sc.text }}>{v.status}</span>
                    <Btn variant="outline" onClick={() => void view(v)} disabled={busy}>View</Btn>
                  </div>
                );
              })}
              {list.length === 0 && !err && <div className="text-xs" style={{ color: C.textMuted }}>No versions yet.</div>}
              {list.length >= 2 && (
                <button
                  onClick={() => void compare()} disabled={busy || !cmpA || !cmpB || cmpA === cmpB}
                  className="w-full py-2 rounded-xl text-xs font-bold transition-all hover:opacity-90 disabled:opacity-40"
                  style={{ background: C.accent, color: '#fff' }}>
                  {busy ? 'Comparing…' : 'Compare selected'}
                </button>
              )}
            </div>
          ) : diff && !snap ? (
            <div className="space-y-3">
              <div className="text-[11px]" style={{ color: C.textMuted }}>
                {diff.moved.length + diff.added.length + diff.removed.length === 0
                  ? 'No differences — the two versions hold the same sessions.'
                  : 'Side-by-side differences between the ticked versions.'}
              </div>
              {diff.moved.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold mb-1 uppercase tracking-widest" style={{ fontFamily: 'DM Mono, monospace', color: C.warning }}>Moved ({diff.moved.length})</div>
                  <div className="space-y-1.5">
                    {diff.moved.map(m => (
                      <div key={m.id} className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}`, color: C.text }}>
                        <span className="font-bold" style={{ fontFamily: 'DM Mono, monospace', color: C.accent }}>{m.code}</span>
                        {' '}{m.from.room} · day {String(m.from.day)} slot {String(m.from.slot)} → {m.to.room} · day {String(m.to.day)} slot {String(m.to.slot)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {diff.added.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold mb-1 uppercase tracking-widest" style={{ fontFamily: 'DM Mono, monospace', color: C.success }}>Added ({diff.added.length})</div>
                  <div className="space-y-1.5">
                    {diff.added.map(a => (
                      <div key={a.id} className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}`, color: C.text }}>
                        <span className="font-bold" style={{ fontFamily: 'DM Mono, monospace', color: C.accent }}>{a.code}</span> {a.name} · {a.room}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {diff.removed.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold mb-1 uppercase tracking-widest" style={{ fontFamily: 'DM Mono, monospace', color: C.danger }}>Removed ({diff.removed.length})</div>
                  <div className="space-y-1.5">
                    {diff.removed.map(a => (
                      <div key={a.id} className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}`, color: C.text }}>
                        <span className="font-bold" style={{ fontFamily: 'DM Mono, monospace', color: C.accent }}>{a.code}</span> {a.name} · {a.room}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[11px] mb-2" style={{ color: C.textMuted }}>
                {snap.sessions} sessions (read-only
                {snap.mode === 'reconstructed'
                  ? ' · rebuilt from change history — table as it was before later edits'
                  : snap.live ? ' · live draft state — reflects the current timetable' : ' snapshot'}
                {snap.gaps ? ' (some moves lack history — best effort)' : ''})
              </div>
              {snap.rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}` }}>
                  <span className="text-[10px] font-bold" style={{ fontFamily: 'DM Mono, monospace', color: C.accent }}>{r.code}</span>
                  <span className="flex-1 text-[11px] truncate" style={{ color: C.text }}>{r.name} · {r.staff}</span>
                  <span className="text-[10px]" style={{ color: C.textMuted }}>{r.row} · {r.day} {r.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end px-5 py-3" style={{ borderTop: `1px solid ${C.border}` }}>
          <Btn variant="outline" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Rename modal (days / time slots): frontend-styled, no browser prompt ──

function RenameModal({ title, initial, placeholder, validate, onClose, onSave }: {
  title: string; initial: string; placeholder?: string;
  validate?: (v: string) => string | null;
  onClose: () => void; onSave: (v: string) => void;
}) {
  const { tokens: C } = useTheme();
  const [value, setValue] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const v = value.trim();
    if (!v || v === initial) { onClose(); return; }
    const problem = validate ? validate(v) : null;
    if (problem) { setErr(problem); return; }
    onSave(v);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-xs" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div className="text-sm font-bold mb-3" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>{title}</div>
        <input
          autoFocus
          value={value}
          onChange={e => { setValue(e.target.value); setErr(null); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          placeholder={placeholder}
          style={{ width: '100%', padding: '9px 11px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 14, outline: 'none' }}
        />
        {err && <div className="mt-2 px-3 py-2 rounded-lg" style={{ background: C.dangerBg, color: C.danger, fontSize: 12 }}>{err}</div>}
        <div className="flex gap-2 justify-end mt-4">
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Session add/edit modal ─────────────────────────────────────────────────

function SessionFormModal({ title, subtitle, initial, staffOptions, roomOptions, onClose, onSave, onDelete }: {
  title: string; subtitle: string; initial: SessionFormValue; staffOptions: string[]; roomOptions: string[];
  onClose: () => void; onSave: (v: SessionFormValue) => void; onDelete?: () => void;
}) {
  const { tokens: C } = useTheme();
  const [form, setForm] = useState<SessionFormValue>(initial);
  // Room capacities from saved data: Capacity auto-fills, admin only types Enrolled
  const [roomCaps, setRoomCaps] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    roomsApi.list()
      .then(l => {
        if (cancelled || !Array.isArray(l)) return;
        const m: Record<string, number> = {};
        l.forEach(r => { m[r.name] = r.capacity; });
        if (!cancelled) setRoomCaps(m);
      })
      .catch(() => { /* offline — no auto-fill */ });
    return () => { cancelled = true; };
  }, []);
  const roomCap = form.room ? roomCaps[form.room] : undefined;
  // Auto-fill Capacity from the selected room's saved capacity (manual tweak still allowed after)
  useEffect(() => {
    if (roomCap !== undefined && form.capacity !== String(roomCap)) {
      setForm(f => (f.room === form.room && f.capacity !== String(roomCap) ? { ...f, capacity: String(roomCap) } : f));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.room, roomCaps]);
  const overCap = (parseInt(form.enrolled, 10) || 0) > (parseInt(form.capacity, 10) || 0);
  // Sync when parent re-opens modal with new initial (fixes stale add/edit data)
  useEffect(() => { setForm(initial); }, [initial.code, initial.name, initial.staff, initial.group, initial.capacity, initial.enrolled, initial.academic_year, initial.major, initial.day, initial.slot, initial.duration, initial.room]);
  const set = (k: keyof SessionFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const input: React.CSSProperties = { width: '100%', padding: '9px 11px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 14, outline: 'none' };
  const valid = form.code.trim() && form.name.trim() && form.staff.trim();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}` }}>
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text, fontFamily: 'Outfit, sans-serif' }}>{title}</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>{subtitle}</div>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Course code *</label><input value={form.code} onChange={set('code')} placeholder="CS305" style={input} /></div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Group</label><input value={form.group} onChange={set('group')} placeholder="CS-3A" style={input} /></div>
          <div className="col-span-2"><label style={{ fontSize: 12, color: C.textMuted }}>Course name *</label><input value={form.name} onChange={set('name')} placeholder="Course title" style={input} /></div>
          <div className="col-span-2"><label style={{ fontSize: 12, color: C.textMuted }}>Staff *</label>
            <select value={form.staff} onChange={set('staff')} style={input}>
              <option value="">Select staff…</option>
              {staffOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div style={{fontSize:10, color:C.textMuted, marginTop:4}}>
              {staffOptions.some(s=>s.startsWith('TA.')||s.startsWith('Eng.')) && !staffOptions.some(s=>s.startsWith('Dr.')||s.startsWith('Prof.')) ? '🧪 Lab staff only: TA./Eng.' : '🎓 Lecture staff only: Dr./Prof.'}
            </div>
          </div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Capacity (auto from room)</label><input type="number" value={form.capacity} onChange={set('capacity')} style={input} /></div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Enrolled</label><input type="number" value={form.enrolled} onChange={set('enrolled')} style={input} />
            {overCap && <div style={{ fontSize: 10, color: C.danger, marginTop: 4 }}>⚠ Enrolled exceeds room capacity ({form.capacity}) — saving will be blocked.</div>}
          </div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Day *</label>
            <select value={form.day} onChange={set('day')} style={input}>
              {DAYS.map((d,i) => <option key={d} value={String(i)}>{d} — {FULL_DAYS[i]}</option>)}
            </select>
          </div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Time / Start *</label>
            <select value={form.slot} onChange={set('slot')} style={input}>
              {TIME_SLOTS.map((t,i) => <option key={t} value={String(i)}>{t} {i+1 < TIME_SLOTS.length ? `→ ${TIME_SLOTS[i+1]}` : ''}</option>)}
            </select>
          </div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Duration</label>
            <select value={form.duration} onChange={set('duration')} style={input}>
              <option value="1">1 hour</option>
              <option value="2">2 hours</option>
              <option value="3">3 hours</option>
            </select>
          </div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Room / Hall *</label>
            <select value={form.room} onChange={set('room')} style={input}>
              {roomOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {roomCap !== undefined && (
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>Fits up to {roomCap} students.</div>
            )}
          </div>
        </div>
        <div className="flex gap-2 justify-between px-5 py-4" style={{ borderTop: `1px solid ${C.border}` }}>
          <div>{onDelete && <Btn variant="danger" onClick={onDelete}>Delete</Btn>}</div>
          <div className="flex gap-2">
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" onClick={() => valid && onSave(form)} disabled={!valid}>Save</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Staff manager modal ────────────────────────────────────────────────────

function StaffManagerModal({ staff, onClose, onAdd, onRemove }: {
  staff: string[]; onClose: () => void; onAdd: (name: string) => void; onRemove: (name: string) => void;
}) {
  const { tokens: C } = useTheme();
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Manage teaching staff ({staff.length})</div>
          <button onClick={onClose} style={{ color: C.textMuted }}>✕</button>
        </div>
        <div className="px-5 py-3 flex gap-2" style={{ borderBottom: `1px solid ${C.border}` }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="New name, e.g. Dr. Sara Ali" style={{ flex: 1, padding: '9px 11px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 14, outline: 'none' }} />
          <button disabled={!name.trim()} onClick={() => { onAdd(name.trim()); setName(''); }} className="px-4 py-2 rounded-lg" style={{ background: C.accent, color: '#fff', fontSize: 14, fontWeight: 700, opacity: name.trim() ? 1 : 0.4 }}>Add</button>
        </div>
        <div className="overflow-y-auto flex-1 px-3 py-2">
          {staff.map(s => (
            <div key={s} className="flex items-center gap-2 px-2 py-2 rounded-lg" style={{ borderBottom: `1px solid ${C.borderSub}` }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.accentBg, color: C.accent, fontSize: 12, fontWeight: 700 }}>{s.slice(0, 2)}</div>
              <span className="flex-1" style={{ color: C.text, fontSize: 14 }}>{s}</span>
              <button onClick={() => { if (window.confirm(`Remove ${s}? Their sessions stay but become unassigned.`)) onRemove(s); }} style={{ background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}30`, fontSize: 12, borderRadius: 8, padding: '4px 10px' }}>Remove</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Student manager modal ──────────────────────────────────────────────────

function StudentManagerModal({ students, onClose, onAdd, onRemove, onUpdateGroup }: {
  students: ManagedStudent[]; onClose: () => void;
  onAdd: (s: Omit<ManagedStudent, 'id'>) => void; onRemove: (id: string) => void; onUpdateGroup: (id: string, group: string) => void;
}) {
  const { tokens: C } = useTheme();
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [group, setGroup] = useState('CS-3A');
  const [year, setYear] = useState('Year 2');
  const [academicYear, setAcademicYear] = useState('2');
  const [major, setMajor] = useState('');
  const input: React.CSSProperties = { padding: '9px 11px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 14, outline: 'none', width: '100%' };
  const filtered = students.filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.group.toLowerCase().includes(q.toLowerCase()) || s.email.toLowerCase().includes(q.toLowerCase()));
  const canAdd = name.trim() && email.trim() && group.trim() && !(parseInt(academicYear) >=3 && !major);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Manage students ({students.length})</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>Add / move group / remove. Saved on this device.</div>
          </div>
          <button onClick={onClose} style={{ color: C.textMuted, fontSize: 16 }}>✕</button>
        </div>
        <div className="px-5 py-3 space-y-2" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="grid grid-cols-2 gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name *" style={input} />
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@bua.edu.eg *" style={input} />
            <input value={group} onChange={e => setGroup(e.target.value)} placeholder="Group e.g. CS-3A" style={input} />
            <select value={year} onChange={e => setYear(e.target.value)} style={input}>
              {['Year 1', 'Year 2', 'Year 3', 'Year 4'].map(y => <option key={y}>{y}</option>)}
            </select>
            <select value={academicYear} onChange={e => setAcademicYear(e.target.value)} style={input}>
              <option value="1">Year 1</option><option value="2">Year 2</option><option value="3">Year 3</option><option value="4">Year 4</option>
            </select>
            <select value={major} onChange={e => setMajor(e.target.value)} style={input} disabled={parseInt(academicYear) <3}>
              <option value="">{parseInt(academicYear)>=3 ? 'Major *' : 'Major (3-4 only)'}</option>
              <option value="CS">CS</option><option value="IT">IT</option><option value="AI">AI</option><option value="DS">DS</option>
            </select>
          </div>
          <button disabled={!canAdd} onClick={() => { const y=parseInt(academicYear); onAdd({ name: name.trim(), email: email.trim(), group: group.trim(), year, academic_year: isNaN(y)? undefined : y, major: (major as any) || undefined }); setName(''); setEmail(''); }} className="w-full py-2 rounded-lg" style={{ background: C.accent, color: '#fff', fontSize: 14, fontWeight: 700, opacity: canAdd ? 1 : 0.4 }}>Add student</button>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / group / email…" style={input} />
        </div>
        <div className="overflow-y-auto flex-1 px-3 py-2">
          {filtered.map(s => (
            <div key={s.id} className="flex items-center gap-2 px-2 py-2 rounded-lg" style={{ borderBottom: `1px solid ${C.borderSub}` }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.accentBg, color: C.accent, fontSize: 12, fontWeight: 700 }}>{s.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{s.name} {s.major ? <span style={{fontSize:10, background:'#fef3c7', color:'#92400e', padding:'1px 4px', borderRadius:4}}>{s.major}</span> : null} {s.academic_year ? <span style={{fontSize:10, background:'#e0e7ff', color:'#3730a3', padding:'1px 4px', borderRadius:4}}>Y{s.academic_year}</span> : null}</div>
                <div style={{ color: C.textMuted, fontSize: 12 }}>{s.email} · {s.year}</div>
              </div>
              <input value={s.group} onChange={e => onUpdateGroup(s.id, e.target.value)} title="Group" style={{ width: 90, padding: '6px 8px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, outline: 'none' }} />
              <button onClick={() => { if (window.confirm(`Remove ${s.name}?`)) onRemove(s.id); }} style={{ background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}30`, fontSize: 12, borderRadius: 8, padding: '5px 10px' }}>Remove</button>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-8" style={{ color: C.textMuted, fontSize: 14 }}>No students match.</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Floating AI assistant ──────────────────────────────────────────────────

interface ChatMessage { role: 'user' | 'bot'; text: string; time: string; }

function ChatBot({ isAdmin, timetableJson, conflictsCount }: {
  isAdmin: boolean; onClose: () => void; timetableJson: string; conflictsCount: number;
}) {
  const { tokens: C } = useTheme();
  const [open, setOpen] = useState(false);
  // Chat history lives in this tab's session: survives refresh, never wiped mid-session
  const CHAT_KEY = 'bua-chatbot-session';
  const greeting: ChatMessage = { role: 'bot', text: "Hello! I'm your ScheduleAI assistant, powered by Gemini. Ask me anything about the live timetable — or tap 📋 to send it for analysis.", time: new Date().toLocaleTimeString() };
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem(CHAT_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr as ChatMessage[];
      }
    } catch { /* corrupted storage: start fresh */ }
    return [greeting];
  });
  useEffect(() => {
    try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-50))); } catch { /* storage full/blocked */ }
  }, [messages]);
  const clearChat = () => setMessages([{ ...greeting, time: new Date().toLocaleTimeString() }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [gemini, setGemini] = useState<boolean | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);

  const push = (role: 'user' | 'bot', text: string) =>
    setMessages(m => [...m, { role, text, time: new Date().toLocaleTimeString() }]);

  const fallbackReply = (userMsg: string) => {
    const lower = userMsg.toLowerCase();
    if (lower.includes('conflict'))
      return `There are currently ${conflictsCount} open conflicts. Open the Conflicts panel on the right to review each one and its suggested alternatives.`;
    if (lower.includes('room'))
      return 'Use the Rooms page filters (capacity / equipment) or click an empty timetable cell to add a session.';
    if (lower.includes('publish'))
      return 'Use the Publish button in the timetable toolbar — it works even with open conflicts, which stay listed for later resolution.';
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('مرحبا') || lower.includes('اهلا'))
      return 'Hello! How can I help with scheduling today?';
    return 'I can help with conflicts, rooms, or publishing. Try "How many conflicts?" or "Find a room for 50 students".';
  };

  const askBackend = async (msg: string, withSnapshot: boolean) => {
    push('user', msg);
    setBusy(true);
    try {
      const res = await sendChat(msg, withSnapshot && timetableJson ? timetableJson : undefined);
      if (res && res.answer_ar) {
        setGemini(res.gemini_used === true);
        push('bot', (res.gemini_used ? '🤖 ' : '') + res.answer_ar);
      } else {
        throw new Error('empty answer');
      }
    } catch {
      setGemini(false);
      push('bot', fallbackReply(msg));
    } finally {
      setBusy(false);
    }
  };

  const handleSend = () => {
    if (!input.trim() || busy) return;
    const msg = input.trim();
    setInput('');
    void askBackend(msg, true);
  };

  const exportAndSend = () => {
    if (busy) return;
    const question = 'هذا هو جدول الحصص الحالي، يرجى تحليله';
    void askBackend(question, true);
  };

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center justify-center w-12 h-12 rounded-2xl shadow-xl transition-all hover:scale-105" style={{ background: C.accent, color: '#fff', boxShadow: `0 8px 24px ${C.accent}40` }} title="Open Assistant">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md h-[70vh] max-h-[600px] rounded-t-2xl flex flex-col m-4" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, boxShadow: '0 -8px 32px rgba(0,0,0,0.3)' }}>
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: C.accentBg, color: C.accent }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>ScheduleAI Assistant</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    {gemini === true ? '🤖 Gemini · live timetable' : gemini === false ? 'Offline mode · Bua University' : 'Online · Bua University'}
                  </div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={{ color: C.textMuted, fontSize: 18 }}>✕</button>
            </div>
            <div className="px-4 pt-2 flex-shrink-0 flex items-center justify-between">
              <span style={{ fontSize: 10, color: C.textMuted }}>Saved in this session</span>
              <button onClick={clearChat} style={{ fontSize: 11, color: C.textMuted }} title="Clear chat">🗑 Clear</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className="flex" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div className="max-w-[80%] px-3 py-2 rounded-2xl" style={{
                    background: m.role === 'user' ? C.accent : C.surfaceAlt,
                    color: m.role === 'user' ? '#fff' : C.text,
                    border: m.role === 'bot' ? `1px solid ${C.border}` : 'none',
                    borderBottomRightRadius: m.role === 'user' ? 4 : 16,
                    borderBottomLeftRadius: m.role === 'bot' ? 4 : 16,
                  }}>
                    <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                    <div className="text-[9px] mt-1" style={{ color: m.role === 'user' ? 'rgba(255,255,255,0.6)' : C.textMuted }}>{m.time}</div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="px-4 pt-2 flex-shrink-0">
              <button onClick={exportAndSend} disabled={busy}
                className="w-full py-2 rounded-xl text-xs font-bold transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: '#16a34a', color: '#fff' }} title="نسخ الجدول الحالي وإرساله للمساعد لتحليله">
                {busy ? '⏳ جاري الإرسال…' : '📋 نسخ الجدول وإرساله'}
              </button>
            </div>
            <div className="flex gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: `1px solid ${C.border}` }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Ask about conflicts, rooms, publishing…" className="flex-1 px-3 py-2 rounded-xl"
                style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text, outline: 'none', fontSize: 13 }} />
              <button onClick={handleSend} disabled={!input.trim() || busy} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: C.accent, color: '#fff', opacity: input.trim() && !busy ? 1 : 0.4 }}>Send</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Pinned assistant for pages without grid context (rooms/sections/analytics/student).
// Only one ChatBot is ever mounted (routes are exclusive); history is shared
// through sessionStorage, so the chat is saved across pages in one session.
function PinnedChatBot() {
  const { role } = useAuth();
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    conflictsApi.list()
      .then(l => { if (!cancelled && Array.isArray(l)) setN(l.length); })
      .catch(() => { /* offline */ });
    return () => { cancelled = true; };
  }, []);
  return <ChatBot isAdmin={role === 'admin'} onClose={() => {}} timetableJson="" conflictsCount={n} />;
}

// Main app layout with header
function AppLayout() {
  const { tokens: C } = useTheme();
  const { role, displayName, email, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = role === 'admin';
  const isStudent = role === 'student';
  const isLecturer = role === 'lecturer';

  // Admin preview-as: see lecturer/student views without logging out (view-only)
  const [previewRole, setPreviewRole] = useState<PreviewRole>(null);
  const [previewStudentId, setPreviewStudentId] = useState<string | null>(null);
  const effRole = previewRole ?? role;
  const pickPreview = (r: PreviewRole) => {
    setPreviewRole(r);
    if (r === 'student') navigate('/student');
    else if (r === 'lecturer') navigate('/dashboard');
  };

  const navigation = [
    { path: '/dashboard', label: 'Schedule', roles: ['admin', 'lecturer'] },
    { path: '/rooms', label: 'Rooms', roles: ['admin'] },
    { path: '/analytics', label: 'Analytics', roles: ['admin'] },
    { path: '/sections', label: 'Sections', roles: ['admin'] },
    { path: '/planning', label: 'Planning', roles: ['admin'] },
    { path: '/student', label: 'My Schedule', roles: ['student'] },
  ];

  const availableNav = navigation.filter(n => n.roles.includes(effRole!));

  return (
    <PreviewContext.Provider value={{ previewRole, previewStudentId, setPreviewRole, setPreviewStudentId }}>
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.bg }}>
      {/* Preview banner (admin looking as someone else) */}
      {previewRole && (
        <div className="flex items-center gap-2 px-4 py-1.5 flex-shrink-0" style={{ background: C.warningBg, borderBottom: `1px solid ${C.warning}55` }}>
          <span className="text-[11px] font-bold" style={{ color: C.warning }}>
            Previewing as {previewRole === 'student' ? 'Student' : 'Lecturer'} — view only
          </span>
          <button onClick={() => { setPreviewRole(null); setPreviewStudentId(null); navigate('/dashboard'); }}
            className="text-[11px] font-bold underline" style={{ color: C.accent }}>
            Back to Admin
          </button>
        </div>
      )}
      {/* Top Header */}
      <header className="flex items-center justify-between px-4 h-12 flex-shrink-0 border-b" style={{ background: C.headerBg, borderColor: C.headerBorder }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: C.accent }}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M10 2L18 7v11H2V7L10 2z" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="1.4" strokeLinejoin="round"/>
              <rect x="7" y="12" width="2.4" height="5" rx="0.5" fill="white" fillOpacity="0.9"/>
              <rect x="10.6" y="12" width="2.4" height="5" rx="0.5" fill="white" fillOpacity="0.9"/>
            </svg>
          </div>
          <span style={{ fontFamily: 'Outfit, sans-serif', color: C.textOnPrimary, fontSize: 15, fontWeight: 700 }}>Bua University</span>
        </div>

        <nav className="flex gap-1">
          {availableNav.map(n => (
            <button
              key={n.path}
              onClick={() => navigate(n.path)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: location.pathname === n.path ? C.navActiveBg : 'transparent',
                color: location.pathname === n.path ? C.navActiveText : 'rgba(255,255,255,0.6)',
                border: location.pathname === n.path ? `1px solid ${C.navActiveBorder}` : '1px solid transparent'
              }}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {role === 'admin' ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5" style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#fff', border: '1px solid #fbbf24', boxShadow: '0 1px 6px rgba(245,158,11,0.4)' }}>
              🛡️ Admin <span style={{opacity:0.9, fontWeight:600}}>· مسؤول</span>
            </span>
          ) : role ? (
            <span className="px-2 py-1 rounded-lg text-xs font-semibold capitalize" style={{ background: C.navActiveBg, color: C.navActiveText, border: `1px solid ${C.navActiveBorder}` }}>
              {role}
            </span>
          ) : null}
          <NotificationsBell email={email} role={role} />
          {isAdmin && (
            <select
              value={previewRole ?? ''}
              onChange={e => pickPreview((e.target.value || null) as PreviewRole)}
              title="Preview as lecturer/student (view only)"
              className="px-2 py-1 rounded-lg text-xs font-semibold"
              style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted, outline: 'none' }}
            >
              <option value="">Admin view</option>
              <option value="lecturer">Preview: Lecturer</option>
              <option value="student">Preview: Student</option>
            </select>
          )}
          <ProfileDropdown />
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
    </PreviewContext.Provider>
  );
}

function ProfileDropdown() {
  const { tokens: C } = useTheme();
  const { role, displayName, email, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const initials = (displayName?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'US');
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 hover:opacity-80 transition-opacity" title="Profile menu">
        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: C.accent, color: '#fff', fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 700 }}>
          {initials}
        </div>
        <span style={{ color: '#fff', fontSize: 13 }}>{displayName}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}><path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 rounded-xl overflow-hidden z-50 py-1" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, minWidth: 220, boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
          <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div className="text-xs font-semibold truncate" style={{ color: C.text }}>{email || displayName}</div>
            <div className="text-[11px] capitalize" style={{ color: C.textMuted }}>{roleLabel}</div>
          </div>
          <button onClick={() => { setOpen(false); setShowProfile(true); }} className="w-full text-left px-4 py-2.5 text-xs font-semibold flex items-center gap-2 hover:opacity-80" style={{ color: C.textSub }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M2.5 12.5a5.5 5.5 0 0111 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            My Profile
          </button>
          <div style={{ borderTop: `1px solid ${C.border}` }} />
          <button onClick={() => { setOpen(false); logout(); navigate('/login'); }} className="w-full text-left px-4 py-2.5 text-xs font-bold flex items-center gap-2 hover:opacity-80" style={{ color: '#ef4444' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3H3.5A1.5 1.5 0 002 4.5v7A1.5 1.5 0 003.5 13H6M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Sign out
          </button>
        </div>
      )}
      {showProfile && (
        <ProfileModal role={(role as any) ?? 'student'} onClose={() => setShowProfile(false)} onSave={() => setShowProfile(false)} />
      )}
    </div>
  );
}

// Dashboard page (Schedule view)
function DashboardPage() {
  // Import the existing dashboard logic - reuse from App.tsx
  return <DashboardContent />;
}

// The actual dashboard content (extracted from original App.tsx)
function DashboardContent() {
  const { tokens: C } = useTheme();
  const { role: loginRole, displayName } = useAuth();
  // Admin preview-as: everything below (views + edit gates) follows the preview role → view-only
  const { previewRole: _pv } = usePreview();
  const role = _pv ?? loginRole;
  const isAdmin = role === 'admin';

  // ── Dashboard state (mirrors original App.tsx) ─────────────────────────────
  const [gridView, setGridView] = useState<GridView>('rooms');
  const [gridDays, setGridDays] = useState<string[]>(DAYS);
  const [gridFullDays, setGridFullDays] = useState<string[]>(FULL_DAYS);
  const [gridTimes, setGridTimes] = useState<string[]>(TIME_SLOTS);
  const [weekStart, setWeekStart] = useState<Date>(() => new Date(2026, 0, 19)); // Mon 19 Jan 2026
  const [gridFilter, setGridFilter] = useState<GridFilter>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>(CONFLICTS);
  const [activeConflict, setActiveConflict] = useState<string | null>(null);
  const [conflictHighlight, setConflictHighlight] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [version, setVersion] = useState<VersionId>('draft-3');
  const [showPublish, setShowPublish] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ kind: 'day' | 'time' | 'new-day' | 'new-time'; idx: number; old: string } | null>(null);
  const [published, setPublished] = useState(false);
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ session: Session; row: string; day: number } | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(() => loadProfile('admin'));
  const [showStaffMgr, setShowStaffMgr] = useState(false);
  const [showStudentMgr, setShowStudentMgr] = useState(false);
  const [students, setStudents] = useState<ManagedStudent[]>(() => loadStudents());
  const [studentSessions, setStudentSessions] = useState<StudentSession[]>([]);
  const [lecturerEvents, setLecturerEvents] = useState<PersonalEvent[]>(LECTURER_EVENTS);
  const [moveStatus, setMoveStatus] = useState<string | null>(null);
  // Conflict-only: English reason message when admin adds/moves into a clash (SCH-FR-05)
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const formatConflictsEn = useCallback((list: { conflict_type: string; description: string; message_en?: string }[]) => {
    // Show every real blocking reason (room, capacity, staff, group, closure...) — self-clash already excluded
    const lines = ['❌ This change cannot be saved:'];
    list.forEach(c => lines.push(`- [${c.conflict_type}] ${c.message_en || c.description}`));
    return lines.join('\n');
  }, []);
  // Conflict-only: styled popup (no browser alert, no auto-hide — admin dismisses it)

  // Editable timetable state (admin)
  const [roomsTimetable, setRoomsTimetable] = useState(TIMETABLE_DATA.rooms);
  const [labsState, setLabsState] = useState(LABS_GRID);
  const [staffState, setStaffState] = useState(STAFF_GRID);
  const [roomRows, setRoomRows] = useState<string[]>(ROOMS);
  const [labRows, setLabRows] = useState<string[]>(LABS);
  const [staffRows, setStaffRows] = useState<string[]>(STAFF);
  const [sessionForm, setSessionForm] = useState<null | { mode: 'add' | 'edit'; view: GridView; row: string; day: number; slot?: number; session?: Session }>(null);

  const gridRows = useMemo(() => gridView === 'rooms' ? roomRows : gridView === 'labs' ? labRows : staffRows, [gridView, roomRows, labRows, staffRows]);
  const gridData = useMemo(() => gridView === 'rooms' ? roomsTimetable : gridView === 'labs' ? labsState : staffState, [gridView, roomsTimetable, labsState, staffState]);

  // Live timetable snapshot (clean JSON) forwarded as Gemini context by the assistant.
  // rooms+labs only: the staff view mirrors the same sessions (would duplicate
  // every row and confuse the analysis). Compact encoding, deduped by session
  // id, ordered by day then room, capped by session count (never sliced mid-JSON).
  // Every row carries an explicit hour range (HH:MM-HH:MM) so the model can
  // detect time conflicts accurately.
  const timeOf = (s: Session): string => {
    const i = typeof s.slot === 'number' ? s.slot : null;
    if (i === null || !TIME_SLOTS[i]) return '';
    const dur = typeof s.duration === 'number' && s.duration > 0 ? s.duration : 1;
    const end = TIME_SLOTS[Math.min(i + dur, TIME_SLOTS.length - 1)];
    return `${TIME_SLOTS[i]}-${end}`;
  };
  const timetableSnapshot = useMemo(() => {
    const rows: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const views: Array<[string, Record<string, Record<number, Session | null>>]> = [
      ['rooms', roomsTimetable], ['labs', labsState],
    ];
    for (const [view, grid] of views) {
      for (const [row, days] of Object.entries(grid)) {
        for (const [d, s] of Object.entries(days)) {
          if (!s || seen.has(s.id)) continue;
          if (rows.length >= 80) break;
          seen.add(s.id);
          const day = Number(d);
          rows.push({
            view, room: row, day: DAYS[day] ?? day, day_index: day,
            time: timeOf(s),
            code: s.code, name: s.name, staff: s.staff, group: s.group,
            capacity: s.capacity, enrolled: s.enrolled,
          });
        }
      }
    }
    rows.sort((a, b) =>
      (Number(a.day_index) - Number(b.day_index)) ||
      String(a.room).localeCompare(String(b.room)));
    return JSON.stringify({ timetable: rows, total_sessions: rows.length });
  }, [roomsTimetable, labsState]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const openAdd = useCallback((row: string, day: number, slot?: number) => {
    setConflictMsg(null);
    setSessionForm({ mode: 'add', view: gridView, row, day, slot });
  }, [gridView]);

  const openEdit = useCallback((session: Session, row: string, day: number) => {
    setSelected(null);
    setConflictMsg(null);
    setSessionForm({ mode: 'edit', view: gridView, row, day, session });
  }, [gridView]);

  const saveSession = useCallback(async (v: SessionFormValue) => {
    // ── Required-field validation (explicit, no silent return) ───────────────
    if (!v.code.trim()) { alert('Course code is required'); return; }
    if (!v.name.trim()) { alert('Course name is required'); return; }
    if (!v.staff.trim()) { alert('Staff is required'); return; }
    if (v.day === '' || v.day === undefined) { alert('Day is required'); return; }
    if (v.slot === '' || v.slot === undefined) { alert('Time slot is required'); return; }
    if (!v.room || !v.room.trim()) { alert('Room / Hall is required'); return; }
    const y = v.academic_year ? parseInt(v.academic_year, 10) : undefined;
    if (y && y >= 3 && !v.major) { alert('Major is required for academic years 3 and 4 (CS/IT/AI/DS)'); return; }
    const targetDay = v.day !== '' ? parseInt(v.day, 10) : undefined;
    const targetSlot = v.slot !== '' ? parseInt(v.slot, 10) : 0;
    const targetDuration = v.duration ? parseInt(v.duration, 10) : 1;
    const targetRoom = v.room?.trim() || null;
    if (targetDay === undefined || isNaN(targetDay) || targetDay < 0 || targetDay >= DAYS.length) { alert('Invalid day'); return; }
    if (isNaN(targetSlot) || targetSlot < 0 || targetSlot >= TIME_SLOTS.length) { alert('Invalid time slot'); return; }
    if (isNaN(targetDuration) || targetDuration < 1 || targetDuration > 3) { alert('Invalid duration'); return; }
    // Snapshot current modal context (avoid nesting setState inside updater)
    const snapshot = sessionForm;
    if (!snapshot) { console.error('[saveSession] no snapshot'); return; }
    // ── Conflict pre-check (SCH-FR-05): block save when admin adds into a clash ──
    // In edit mode the session itself is excluded so it never clashes with its own cell
    // Name/code-only edits never block: skip the check when nothing placement-relevant changed
    const prev = snapshot.session;
    const nextEnrolled = Math.min(parseInt(v.enrolled, 10) || 0, parseInt(v.capacity, 10) || 30);
    const placementChanged = snapshot.mode === 'add' || !prev ||
      v.staff.trim() !== (prev.staff || '') ||
      (v.group.trim() || 'GEN') !== (prev.group || '') ||
      (parseInt(v.capacity, 10) || 30) !== prev.capacity ||
      nextEnrolled !== prev.enrolled ||
      targetDay !== snapshot.day ||
      targetSlot !== (prev.slot ?? 0) ||
      targetDuration !== (prev.duration ?? 1) ||
      (v.room?.trim() || '') !== snapshot.row;
    if (!placementChanged) {
      setConflictMsg(null);
    } else {
    try {
      const pre = await allocationsApi.check({
        staff: v.staff.trim(), room: v.room?.trim(), day: DAYS[targetDay],
        slot: targetSlot, group: v.group.trim() || undefined,
        enrolled: parseInt(v.enrolled, 10) || 0,
        duration_slots: targetDuration,
        room_type_required: gridView === 'labs' ? 'Lab' : undefined,
        exclude_session_id: snapshot.mode === 'edit' ? snapshot.session?.id : undefined,
      });
      if (pre && !pre.ok) {
        const msg = formatConflictsEn(pre.conflicts);
        setConflictMsg(msg);
        setMoveStatus('Move blocked: conflict — see reason.');
        return;
      }
      setConflictMsg(null);
    } catch { /* offline: keep old optimistic behavior */ }
    }
    const id = snapshot.mode === 'add' ? `s-${Date.now()}` : snapshot.session!.id;
    const sess: Session = {
      id, code: v.code.trim(), name: v.name.trim(), staff: v.staff.trim(),
      group: v.group.trim() || 'GEN', capacity: parseInt(v.capacity, 10) || 30,
      enrolled: Math.min(parseInt(v.enrolled, 10) || 0, parseInt(v.capacity, 10) || 30),
      color: '#2563eb',
      academic_year: y, major: (v.major as Session['major']) || undefined,
      slot: targetSlot, duration: targetDuration,
    };
    const finalDay = targetDay;
    const finalRoom = targetRoom!; // validated above
    const movedRoom = finalRoom !== snapshot.row;
    const movedDay = finalDay !== snapshot.day;
    // ── Optimistic local update (immediate UI feedback) ──────────────────────
    const applySameRow = (prev: Record<string, Record<number, Session | null>>) => {
      const rowCopy = { ...(prev[snapshot.row] ?? {}) };
      if (movedDay) rowCopy[snapshot.day] = null;
      // if slot changed but same day/room, just overwrite same day cell
      rowCopy[finalDay] = sess;
      return { ...prev, [snapshot.row]: rowCopy };
    };
    const applyRoomMove = (prev: Record<string, Record<number, Session | null>>) => {
      const next = { ...prev };
      next[snapshot.row] = { ...(prev[snapshot.row] ?? {}), [snapshot.day]: null };
      next[finalRoom] = { ...(prev[finalRoom] ?? {}), [finalDay]: sess };
      return next;
    };
    if (snapshot.view === 'rooms') setRoomsTimetable(movedRoom ? applyRoomMove : applySameRow);
    else if (snapshot.view === 'labs') setLabsState(movedRoom ? applyRoomMove : applySameRow);
    else setStaffState(movedRoom ? applyRoomMove : applySameRow);
    setConflicts(prev => prev.filter(c => !(c.cell.row === snapshot.row && c.cell.day === snapshot.day) && !(c.cell.row === finalRoom && c.cell.day === finalDay)));
    setPublished(false);
    // Close modal immediately so empty-cell add visibly succeeds
    setSessionForm(null);
    setSelected(null);
    // ── Persist to backend (async, with error feedback) ──────────────────────
    // Smart backend clears old TIMETABLE[view][row][old_day][old_slot] automatically,
    // so single PUT to new day/slot/room suffices for reschedule.
    (async () => {
      try {
        await timetableApi.setSlot(snapshot.view, finalRoom, finalDay, sess);
        // If day/room changed, also ensure old cell is cleared (backend already handles via id scan,
        // but keep explicit clear for robustness when slot also changed within same day)
        if (movedRoom || movedDay) {
          try { await timetableApi.setSlot(snapshot.view, snapshot.row, snapshot.day, null); } catch {}
        }
        setMoveStatus(snapshot.mode === 'add' ? `Session "${sess.code}" added successfully` : `Session "${sess.code}" updated successfully`);
      } catch (e: any) {
        console.error('[saveSession] backend failed', e);
        alert('Failed to save to server: ' + (e?.message || String(e)));
      }
    })();
  }, [sessionForm, gridView, formatConflictsEn]);

  const moveSession = useCallback(async (fromRow: string, fromDay: number, toRow: string, toDay: number) => {
    if (role !== 'admin' || (fromRow === toRow && fromDay === toDay)) return;
    const sourceData = gridView === 'rooms' ? roomsTimetable : gridView === 'labs' ? labsState : staffState;
    const session = sourceData[fromRow]?.[fromDay] ?? null;
    if (!session || sourceData[toRow]?.[toDay]) return;
    // ── Conflict pre-check (SCH-FR-05): block drag when target clashes ──
    try {
      const pre = await allocationsApi.check({
        staff: session.staff, room: toRow, day: DAYS[toDay],
        slot: session.slot ?? 0, group: session.group, enrolled: session.enrolled,
        duration_slots: session.duration ?? 1,
        room_type_required: gridView === 'labs' ? 'Lab' : undefined,
      });
      if (pre && !pre.ok) {
        const msg = formatConflictsEn(pre.conflicts);
        setConflictMsg(msg);
        setMoveStatus('Move blocked: conflict — see reason.');
        return;
      }
      setConflictMsg(null);
    } catch { /* offline: keep old optimistic behavior */ }

    const move = (prev: Record<string, Record<number, Session | null>>) => {
      const sourceRow = { ...(prev[fromRow] ?? {}), [fromDay]: null };
      const nextRows = { ...prev, [fromRow]: sourceRow };
      if (fromRow === toRow) {
        nextRows[toRow] = { ...sourceRow, [toDay]: session };
      } else {
        nextRows[toRow] = { ...(prev[toRow] ?? {}), [toDay]: session };
      }
      return nextRows;
    };
    if (gridView === 'rooms') setRoomsTimetable(move);
    else if (gridView === 'labs') setLabsState(move);
    else setStaffState(move);
    setConflicts(prev => prev.filter(c =>
      !(c.cell.row === fromRow && c.cell.day === fromDay) &&
      !(c.cell.row === toRow && c.cell.day === toDay),
    ));
    setPublished(false);
    setMoveStatus(`Moving ${session.code}...`);
    Promise.all([
      timetableApi.setSlot(gridView, toRow, toDay, session),
      timetableApi.setSlot(gridView, fromRow, fromDay, null),
    ]).then(() => setMoveStatus(`${session.code} moved successfully`))
      .catch(() => setMoveStatus('Move failed to save. The local timetable was updated.'));
  }, [role, gridView, roomsTimetable, labsState, staffState, formatConflictsEn]);

  const deleteSession = useCallback(async () => {
    setSessionForm(current => {
      if (!current) return current;
      const clear = (prev: Record<string, Record<number, Session | null>>) => ({
        ...prev, [current.row]: { ...(prev[current.row] ?? {}), [current.day]: null },
      });
      if (current.view === 'rooms') setRoomsTimetable(clear);
      else if (current.view === 'labs') setLabsState(clear);
      else setStaffState(clear);
      setConflicts(prev => prev.filter(c => !(c.cell.row === current.row && c.cell.day === current.day)));
      setSelected(null);
      // Async backend call with success/error feedback
      timetableApi.setSlot(current.view, current.row, current.day, null)
        .then(() => setMoveStatus(`Session deleted successfully`))
        .catch((e: any) => setMoveStatus('Failed to delete: ' + (e?.message || String(e))));
      return null;
    });
  }, []);

  const deleteSelectedSession = useCallback(async () => {
    setSelected(current => {
      if (!current) return current;
      const clear = (prev: Record<string, Record<number, Session | null>>) => ({
        ...prev, [current.row]: { ...(prev[current.row] ?? {}), [current.day]: null },
      });
      if (gridView === 'rooms') setRoomsTimetable(clear);
      else if (gridView === 'labs') setLabsState(clear);
      else setStaffState(clear);
      setConflicts(prev => prev.filter(c => !(c.cell.row === current.row && c.cell.day === current.day)));
      // Async backend call with success/error feedback
      timetableApi.setSlot(gridView, current.row, current.day, null)
        .then(() => setMoveStatus(`Session deleted successfully`))
        .catch((e: any) => setMoveStatus('Failed to delete: ' + (e?.message || String(e))));
      return null;
    });
  }, [gridView]);

  const addStaff = useCallback(async (name: string) => {
    try {
      await staffApi.add(name);
      setStaffRows(prev => prev.includes(name) ? prev : [...prev, name]);
      setStaffState(prev => prev[name] ? prev : { ...prev, [name]: { 0: null, 1: null, 2: null, 3: null, 4: null } });
      setMoveStatus(`Staff "${name}" added successfully`);
    } catch (e: any) {
      setMoveStatus('Failed to add staff: ' + (e?.message || String(e)));
    }
  }, []);

  // Academic grid: + Row = new time slot, + Column = new day (both persisted)
  // Openers show the frontend modal; confirmRename() below executes the creation.
  const addGridRow = useCallback(() => {
    if (role !== 'admin') return;
    setRenameTarget({ kind: 'new-time', idx: -1, old: '' });
  }, [role]);

  const addGridColumn = useCallback(() => {
    if (role !== 'admin') return;
    setRenameTarget({ kind: 'new-day', idx: -1, old: '' });
  }, [role]);

  const renameGridColumn = useCallback((dayIdx: number) => {
    if (role !== 'admin') return;
    setRenameTarget({ kind: 'day', idx: dayIdx, old: gridDays[dayIdx] ?? '' });
  }, [role, gridDays]);

  const renameGridTime = useCallback((slotIdx: number) => {
    if (role !== 'admin') return;
    setRenameTarget({ kind: 'time', idx: slotIdx, old: gridTimes[slotIdx] ?? '' });
  }, [role, gridTimes]);

  const confirmRename = useCallback(async (label: string) => {
    if (!renameTarget) return;
    const { kind, idx } = renameTarget;
    try {
      if (kind === 'day') {
        await timetableApi.renameColumn(idx, label);
        setGridDays(prev => prev.map((d, i) => i === idx ? label : d));
        setGridFullDays(prev => prev.map((d, i) => i === idx ? label : d));
        setMoveStatus(`Day renamed to "${label}" successfully`);
      } else if (kind === 'time') {
        await timetableApi.renameSlot(idx, label);
        setGridTimes(prev => prev.map((t, i) => i === idx ? label : t));
        setMoveStatus(`Time slot renamed to "${label}" successfully`);
      } else if (kind === 'new-day') {
        const newIdx = gridDays.length;
        const extend = (prev: Record<string, Record<number, Session | null>>) => {
          const next = { ...prev };
          Object.keys(next).forEach(row => { next[row] = { ...next[row], [newIdx]: null }; });
          return next;
        };
        await timetableApi.addColumn(label);
        setGridDays(prev => [...prev, label]);
        setGridFullDays(prev => [...prev, label]);
        setRoomsTimetable(extend);
        setLabsState(extend);
        setStaffState(extend);
        setMoveStatus(`Day "${label}" added successfully`);
      } else {
        await timetableApi.addSlot(label);
        setGridTimes(prev => [...prev, label]);
        setMoveStatus(`Time slot "${label}" added successfully`);
      }
      setRenameTarget(null);
    } catch (e: any) {
      setMoveStatus(`Failed to save ${kind}: ` + (e?.message || String(e)));
      setRenameTarget(null);
    }
  }, [renameTarget, gridDays.length]);

  const deleteGridColumn = useCallback(async (dayIdx: number) => {
    if (role !== 'admin') return;
    const name = gridDays[dayIdx];
    if (!window.confirm(`Delete day "${name}"? All sessions on that day will be removed.`)) return;
    const shift = (prev: Record<string, Record<number, Session | null>>) => {
      const next: Record<string, Record<number, Session | null>> = {};
      Object.entries(prev).forEach(([row, days]) => {
        next[row] = {};
        Object.entries(days).forEach(([dStr, sess]) => {
          const d = Number(dStr);
          if (d === dayIdx) return;
          const nd = d > dayIdx ? d - 1 : d;
          next[row][nd] = sess as Session | null;
        });
      });
      return next;
    };
    try {
      await timetableApi.deleteColumn(dayIdx);
      setGridDays(prev => prev.filter((_, i) => i !== dayIdx));
      setGridFullDays(prev => prev.filter((_, i) => i !== dayIdx));
      setRoomsTimetable(shift);
      setLabsState(shift);
      setStaffState(shift);
      setMoveStatus(`Day "${name}" deleted successfully`);
    } catch (e: any) {
      setMoveStatus('Failed to delete day: ' + (e?.message || String(e)));
    }
  }, [role, gridDays]);

  const deleteGridRow = useCallback(async (slotIdx: number) => {
    if (role !== 'admin') return;
    const time = gridTimes[slotIdx];
    if (!window.confirm(`Delete time slot "${time}"? Sessions at that time will be removed.`)) return;
    const clearSlot = (prev: Record<string, Record<number, Session | null>>) => {
      const next = { ...prev };
      Object.keys(next).forEach(row => {
        const days = { ...next[row] };
        Object.keys(days).forEach(dStr => {
          const sess = days[Number(dStr)];
          if (sess && sess.slot === slotIdx) days[Number(dStr)] = null;
          else if (sess && sess.slot !== undefined && sess.slot > slotIdx) days[Number(dStr)] = { ...sess, slot: sess.slot - 1 };
        });
        next[row] = days;
      });
      return next;
    };
    try {
      await timetableApi.deleteSlot(slotIdx);
      setGridTimes(prev => prev.filter((_, i) => i !== slotIdx));
      setRoomsTimetable(clearSlot);
      setLabsState(clearSlot);
      setStaffState(clearSlot);
      setMoveStatus(`Time slot "${time}" deleted successfully`);
    } catch (e: any) {
      setMoveStatus('Failed to delete time slot: ' + (e?.message || String(e)));
    }
  }, [role, gridTimes]);

  const removeStaff = useCallback(async (name: string) => {
    try {
      await staffApi.remove(name);
      setStaffRows(prev => prev.filter(s => s !== name));
      setStaffState(prev => {
        const next = { ...prev };
        delete next[name];
        Object.keys(next).forEach(row => {
          Object.keys(next[row] ?? {}).forEach(d => {
            const s = next[row][Number(d)];
            if (s && s.staff === name) next[row][Number(d)] = { ...s, staff: 'Unassigned' };
          });
        });
        return next;
      });
      setMoveStatus(`Staff "${name}" removed successfully`);
    } catch (e: any) {
      setMoveStatus('Failed to remove staff: ' + (e?.message || String(e)));
    }
  }, []);

  const persistStudents = useCallback((next: ManagedStudent[]) => {
    setStudents(next);
    try { localStorage.setItem('bua-students-v1', JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const addStudent = useCallback(async (s: Omit<ManagedStudent, 'id'>) => {
    const optimistic = { ...s, id: `st-${Date.now()}` };
    persistStudents([...students, optimistic]);
    try {
      const created = await studentsApi.add(s);
      if (created && (created as unknown as ManagedStudent).id) {
        persistStudents([...students.filter(x => x.id !== optimistic.id), created as unknown as ManagedStudent]);
      }
      setMoveStatus(`Student "${s.name}" added successfully`);
    } catch (e: any) {
      persistStudents(students.filter(x => x.id !== optimistic.id));
      setMoveStatus('Failed to add student: ' + (e?.message || String(e)));
    }
  }, [students, persistStudents]);

  const removeStudent = useCallback(async (id: string) => {
    const toRemove = students.find(s => s.id === id);
    persistStudents(students.filter(s => s.id !== id));
    try {
      await studentsApi.remove(id);
      setMoveStatus(toRemove ? `Student "${toRemove.name}" removed successfully` : 'Student removed successfully');
    } catch (e: any) {
      // rollback
      if (toRemove) persistStudents([...students, toRemove]);
      setMoveStatus('Failed to remove student: ' + (e?.message || String(e)));
    }
  }, [students, persistStudents]);

  const updateStudentGroup = useCallback(async (id: string, group: string) => {
    const student = students.find(s => s.id === id);
    persistStudents(students.map(s => s.id === id ? { ...s, group } : s));
    try {
      await studentsApi.updateGroup(id, group);
      setMoveStatus(student ? `Student "${student.name}" moved to group "${group}"` : `Student moved to group "${group}"`);
    } catch (e: any) {
      if (student) persistStudents(students.map(s => s.id === id ? { ...s, group: student.group } : s));
      setMoveStatus('Failed to update group: ' + (e?.message || String(e)));
    }
  }, [students, persistStudents]);

  const handleDismissConflict = useCallback(async (id: string) => {
    setConflicts(prev => prev.filter(c => c.id !== id));
    setActiveConflict(prev => prev === id ? null : prev);
    try {
      await conflictsApi.dismiss(id);
      setMoveStatus('Conflict dismissed successfully');
    } catch (e: any) {
      // Could reload conflicts here, but keep local state for now
      setMoveStatus('Failed to dismiss conflict: ' + (e?.message || String(e)));
    }
  }, []);

  // SCH-FR-06: admin confirms one ranked alternative → backend moves the session,
  // then the result shows next to the alternatives and the grid refreshes
  const [appliedMsg, setAppliedMsg] = useState<string | null>(null);
  const handleApplyAlternative = useCallback(async (conflictId: string, alternativeId: string) => {
    const target = conflicts.flatMap(c => (c.alternatives ?? []).map(a => ({ c, a })))
      .find(x => x.c.id === conflictId && x.a.id === alternativeId);
    try {
      await conflictsApi.apply(conflictId, alternativeId);
      const [list, g] = await Promise.all([conflictsApi.list(), timetableApi.full()]);
      if (Array.isArray(list)) setConflicts(list as unknown as Conflict[]);
      const toGrid = (view: Record<string, Record<string, unknown>>) => {
        const out: Record<string, Record<number, Session | null>> = {};
        Object.entries(view).forEach(([row, days]) => {
          out[row] = {};
          Object.entries(days as Record<string, unknown>).forEach(([d, s]) => { out[row][Number(d)] = (s as Session | null) ?? null; });
        });
        return out;
      };
      if (g.rooms) setRoomsTimetable(toGrid(g.rooms as unknown as Record<string, Record<string, unknown>>));
      if (g.labs) setLabsState(toGrid(g.labs as unknown as Record<string, Record<string, unknown>>));
      if (g.staff) setStaffState(toGrid(g.staff as unknown as Record<string, Record<string, unknown>>));
      setActiveConflict(null);
      const where = target
        ? `${target.a.room} · ${DAYS[target.a.day] ?? ''} ${TIME_SLOTS[target.a.slot] ?? ''}`.trim()
        : 'new slot';
      setAppliedMsg(`✓ Applied — session moved to ${where}.`);
      setMoveStatus(`Alternative applied for ${conflictId} — timetable updated.`);
    } catch (e: any) {
      setMoveStatus('Failed to apply alternative: ' + (e?.message || String(e)));
    }
  }, [conflicts]);

  const handlePublish = useCallback(async () => {
    try {
      // Publish the current draft (never hardcoded): prefer draft-3, else any draft.
      const list = await versionsApi.list();
      const drafts = (Array.isArray(list) ? list : []).filter(v => v.status === 'draft');
      const target = drafts.find(v => v.id === 'draft-3') ?? drafts[0];
      if (!target) {
        setMoveStatus('No draft version to publish.');
        return;
      }
      await versionsApi.publish(target.id);
      setPublished(true);
      setShowPublish(false);
      setMoveStatus(`Published ${target.label} — visible to students and staff.`);
      // Notify student polling & any listening tab to re-fetch My Schedule immediately
      try { window.dispatchEvent(new CustomEvent('bua-publish-sync')); } catch {}
    } catch {
      setMoveStatus('Publish failed. Please check the backend connection.');
    }
  }, []);

  const handlePreviewChange = useCallback((newRole: AppRole) => {
    if (role !== 'admin') return;
    setGridView('rooms');
  }, [role]);

  const handleVersionChange = useCallback((v: VersionId) => {
    setVersion(v); setActiveConflict(null); setPublished(v === 'pub-1');
    if (v === 'draft-3') setConflicts(CONFLICTS);
    else if (v === 'draft-2') setConflicts(CONFLICTS.slice(0, 3));
    else setConflicts([]);
  }, []);

  // Sync from backend on mount
  const [backendLive, setBackendLive] = useState(false);
  // Poll My Schedule for students so Publish appears instantly without hard reload
  useEffect(() => {
    if (role !== 'student') return;
    let cancelled = false;
    const fetchSessions = async () => {
      try {
        const s = await studentsApi.sessions();
        if (!cancelled && Array.isArray(s)) setStudentSessions(s as unknown as typeof s);
      } catch { /* offline */ }
    };
    const id = window.setInterval(fetchSessions, 15000);
    const onFocus = () => fetchSessions();
    const onVisible = () => { if (document.visibilityState === 'visible') fetchSessions(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    // custom event dispatched after Publish for instant sync
    const onPublishSync = () => fetchSessions();
    window.addEventListener('bua-publish-sync', onPublishSync as EventListener);
    return () => { cancelled = true; window.clearInterval(id); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('bua-publish-sync', onPublishSync as EventListener); };
  }, [role]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [constants, grid, conflictList, roomList, staffList, studentList, liveStudentSessions] = await Promise.all([
          timetableApi.constants(), timetableApi.full(), conflictsApi.list(),
          roomsApi.list(), staffApi.list(), studentsApi.list(), studentsApi.sessions(),
        ]);
        if (cancelled) return;
        setBackendLive(true);
        if (constants.rooms?.length) setRoomRows(constants.rooms);
        if (constants.labs?.length) setLabRows(constants.labs);
        if (constants.days?.length) setGridDays(constants.days);
        if ((constants as any).fullDays?.length) setGridFullDays((constants as any).fullDays);
        if ((constants as any).timeSlots?.length) setGridTimes((constants as any).timeSlots);
        if (constants.staff?.length) {
          setStaffRows(constants.staff);
          setStaffState(prev => {
            const next = { ...prev };
            constants.staff.forEach((s: string) => { if (!next[s]) next[s] = { 0: null, 1: null, 2: null, 3: null, 4: null }; });
            return next;
          });
        }
        const toGrid = (view: Record<string, Record<string, unknown>>) => {
          const out: Record<string, Record<number, Session | null>> = {};
          Object.entries(view).forEach(([row, days]) => {
            out[row] = {};
            Object.entries(days as Record<string, unknown>).forEach(([d, s]) => { out[row][Number(d)] = (s as Session | null) ?? null; });
          });
          return out;
        };
        if (grid.rooms) setRoomsTimetable(toGrid(grid.rooms));
        if (grid.labs) setLabsState(toGrid(grid.labs));
        if (grid.staff) {
          const liveStaffGrid = toGrid(grid.staff);
          setStaffState(liveStaffGrid);
        }
        if (Array.isArray(conflictList)) setConflicts(conflictList as unknown as Conflict[]);
        if (Array.isArray(liveStudentSessions)) setStudentSessions(liveStudentSessions);
        if (Array.isArray(studentList) && studentList.length) {
          setStudents(studentList as unknown as ManagedStudent[]);
          try { localStorage.setItem('bua-students-v1', JSON.stringify(studentList)); } catch { /* ignore */ }
        }
        void roomList;
      } catch {
        if (!cancelled) setBackendLive(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const effectiveRole = role;
  const isPersonal = effectiveRole !== 'admin';
  const events = effectiveRole === 'lecturer' ? lecturerEvents : STUDENT_EVENTS;
  // Lecturer preview: pick any doctor by name → live personal schedule from the grids
  const { previewRole } = usePreview();
  const [previewStaff, setPreviewStaff] = useState<string | null>(null);
  useEffect(() => {
    if (previewRole === 'lecturer' && !previewStaff && staffRows.length) {
      setPreviewStaff(staffRows.find(s => s.toLowerCase().includes('chen')) ?? staffRows[0]);
    }
    if (previewRole !== 'lecturer' && previewStaff) setPreviewStaff(null);
  }, [previewRole, previewStaff, staffRows]);
  const previewLecturerEvents = useMemo(() => {
    if (previewRole !== 'lecturer' || !previewStaff) return null;
    const out: PersonalEvent[] = [];
    const collect = (row: string, days: Record<number, Session | null>) => {
      Object.entries(days ?? {}).forEach(([d, s]) => {
        if (!s || s.staff !== previewStaff) return;
        out.push({
          id: s.id, code: s.code, name: s.name, room: row,
          building: 'Bua University', day: Number(d), slot: s.slot ?? 0,
          color: s.color, staff: s.staff, group: s.group,
        });
      });
    };
    Object.entries(roomsTimetable).forEach(([row, days]) => collect(row, days));
    Object.entries(labsState).forEach(([row, days]) => collect(row, days));
    return out;
  }, [previewRole, previewStaff, roomsTimetable, labsState]);
  const activeNotifs = NOTIFS.filter(n => !dismissedNotifs.has(n.id));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.bg, fontFamily: 'Inter, sans-serif' }}>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {/* Schedule page (admin only) */}
        {!isPersonal && (
          <div className="flex h-full">
            {/* Centre: admin timetable (edge-to-edge) */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {/* Toolbar strip */}
              <div
                className="flex items-center gap-3 px-4 flex-shrink-0 overflow-x-auto"
                style={{ background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`, minHeight: 44, height: 'auto' }}
              >
                {/* Left: title + week label (dynamic academic week) */}
                <div className="flex items-center gap-3 flex-1 min-w-max py-1">
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <span style={{ fontFamily: 'Outfit, sans-serif', color: C.text, fontSize: 15, fontWeight: 700 }}>Weekly Timetable</span>
                    <span style={{ color: C.textMuted, fontFamily: 'DM Mono, monospace', fontSize: 11 }}>
                      {(() => {
                        const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
                        const end = new Date(weekStart); end.setDate(weekStart.getDate() + Math.max(0, gridDays.length-1));
                        return `${fmt(weekStart)} – ${fmt(end)} · ${weekStart.getFullYear()}`;
                      })()}
                      {isAdmin && <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded" style={{ background: C.accentBg, color: C.accent }}>editable</span>}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setWeekStart(d => { const n=new Date(d); n.setDate(d.getDate()-7); return n; })} className="px-2 py-1 rounded" style={{ border: `1px solid ${C.border}`, color: C.textMuted, fontSize: 11 }} title="Previous week">‹</button>
                      <input type="date" value={`${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,'0')}-${String(weekStart.getDate()).padStart(2,'0')}`} onChange={e => { const v=e.target.value; if(v){ const [y,m,d]=v.split('-').map(Number); setWeekStart(new Date(y,m-1,d)); }}} style={{ padding: '4px 6px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 11 }} />
                      <button onClick={() => setWeekStart(d => { const n=new Date(d); n.setDate(d.getDate()+7); return n; })} className="px-2 py-1 rounded" style={{ border: `1px solid ${C.border}`, color: C.textMuted, fontSize: 11 }} title="Next week">›</button>
                    </div>
                  )}
                  {moveStatus && <span className="hidden xl:inline text-xs" style={{ color: moveStatus.includes('failed') ? C.danger : C.success }}>{moveStatus}</span>}
                  {/* Conflict-only: Arabic reason when admin hits a clash (click to dismiss) */}
                  {conflictMsg && <span onClick={() => setConflictMsg(null)} title="Click to dismiss" className="hidden xl:inline text-xs font-bold cursor-pointer" style={{ color: C.danger, border: `1px solid ${C.danger}55`, borderRadius: 8, padding: '2px 8px', whiteSpace: 'pre-wrap', maxWidth: 420 }}>{conflictMsg}</span>}

                  {/* Divider */}
                  <div className="w-px h-5 flex-shrink-0" style={{ background: C.border }} />

                  {/* Grid view segmented control */}
                  <div className="flex rounded-md overflow-hidden flex-shrink-0" style={{ border: `1px solid ${C.border}` }}>
                    {(['rooms', 'labs', 'staff'] as GridView[]).map((v, i) => (
                      <button key={v} onClick={() => setGridView(v)}
                        className="px-4 py-1.5 font-semibold capitalize transition-all"
                        style={{ background: gridView === v ? C.accent : 'transparent', color: gridView === v ? '#fff' : C.textMuted, fontFamily: 'Inter, sans-serif', fontSize: 13, borderRight: i < 2 ? `1px solid ${C.border}` : 'none' }}>
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-3 ml-2 flex-shrink-0">
                    {[
                      { color: C.accent,  label: 'Session',   value: 'session' as const },
                      { color: C.danger,  label: 'Conflict',  value: 'conflict' as const },
                      { color: C.success, label: 'Available', value: 'available' as const },
                    ].map(({ color, label, value }) => {
                      const active = gridFilter === value;
                      return (
                        <button key={label} onClick={() => setGridFilter(active ? null : value)}
                          className="flex items-center gap-1.5 rounded px-1.5 py-1 transition-all hover:brightness-125"
                          aria-pressed={active} title={`Filter by ${label}`} style={{
                            background: active ? color + '22' : 'transparent',
                            border: `1px solid ${active ? color + '70' : 'transparent'}`,
                            opacity: gridFilter && !active ? 0.5 : 1,
                          }}>
                          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color + '55', border: `1px solid ${color}80` }} />
                          <span style={{ color: active ? color : C.textMuted, fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={addGridRow} className="px-2 py-1 rounded font-semibold" style={{ color: C.accent, border: `1px solid ${C.accent}55`, fontSize: 11 }} title="Add time slot (row)">+ Time</button>
                      <button onClick={addGridColumn} className="px-2 py-1 rounded font-semibold" style={{ color: C.success, border: `1px solid ${C.success}55`, fontSize: 11 }} title="Add day (column)">+ Day</button>
                      <span className="text-[9px] ml-1" style={{ color: C.textMuted }}>Click header to rename · ✕ to delete</span>
                    </div>
                  )}
                </div>

                {/* Right: admin actions + sidebar toggle */}
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    {/* Publish: always available — conflicts never block publishing. */}
                    <button
                      onClick={() => setShowPublish(true)}
                      className="px-3 py-1.5 rounded-md font-bold transition-all hover:opacity-90 active:scale-[0.97] flex-shrink-0 flex items-center gap-1.5"
                      style={{ background: published ? C.successBg : C.success, color: published ? C.success : '#fff', border: `1px solid ${C.success}55`, fontSize: 13 }}
                      title={conflicts.length > 0 ? `Publish now with ${conflicts.length} open conflicts` : 'Publish now'}
                    >
                      {published ? '✓ Published' : 'Publish'}
                      {conflicts.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full font-bold" style={{ background: published ? C.dangerBg : 'rgba(255,255,255,0.25)', color: published ? C.danger : '#fff', fontSize: 10 }}>
                          {conflicts.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setShowVersions(true)}
                      className="px-3 py-1.5 rounded-md font-bold transition-all hover:opacity-90 active:scale-[0.97] flex-shrink-0"
                      style={{ background: 'transparent', color: C.accent, border: `1px solid ${C.accent}55`, fontSize: 13 }}
                      title="Open version history — view any saved version, including old ones"
                    >
                      Versions
                    </button>
                    <button
                      onClick={() => setShowStudentMgr(true)}
                      className="px-3 py-1.5 rounded-md font-semibold transition-all hover:opacity-80 flex-shrink-0"
                      style={{ background: '#05966922', color: '#10b981', border: '1px solid #10b98140', fontSize: 13 }}
                    >
                      Manage students ({students.length})
                    </button>
                    <button
                      onClick={() => setShowStaffMgr(true)}
                      className="px-3 py-1.5 rounded-md font-semibold transition-all hover:opacity-80 flex-shrink-0"
                      style={{ background: C.accentBg, color: C.accent, border: `1px solid ${C.accent}40`, fontSize: 13 }}
                    >
                      Manage staff ({staffRows.length})
                    </button>
                    <span title={backendLive ? 'Backend connected (http://localhost:8000)' : 'Offline demo mode — backend unreachable'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: backendLive ? C.success : C.warning, display: 'inline-block' }} />
                      {backendLive ? 'API live' : 'Offline'}
                    </span>
                    <span style={{ color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }}>Admin edit: click empty cell +</span>
                  </div>
                )}
                <button
                  onClick={() => setShowSidebar(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all hover:opacity-80 flex-shrink-0"
                  style={{ background: showSidebar ? C.accentBg : 'transparent', color: showSidebar ? C.accent : C.textMuted, border: `1px solid ${showSidebar ? C.accent + '40' : C.border}` }}
                >
                  {showSidebar
                    ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M6 1l-4 4 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    : <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M4 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  }
                  {showSidebar ? 'Hide panel' : 'Show panel'}
                  {!showSidebar && conflicts.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full font-bold" style={{ background: C.dangerBg, color: C.danger, fontSize: 11 }}>{conflicts.length}</span>
                  )}
                </button>
              </div>

              {/* Timetable grid — academic standard: Time vertical, Days horizontal, persisted */}
              <div className="flex-1 overflow-hidden" style={{ background: C.surface }}>
                <TimetableGrid
                  view={gridView}
                  days={gridDays}
                  rows={gridRows}
                  data={gridData}
                  conflicts={conflicts}
                  filter={gridFilter}
                  isAdmin={isAdmin}
                  onSessionClick={(s, row, day) => setSelected({ session: s, row, day })}
                  onEmptyCellClick={openAdd}
                  onMoveSession={moveSession}
                  onConflictHighlight={setConflictHighlight}
                  weekStart={weekStart}
                  times={gridTimes}
                  fullDays={gridFullDays}
                  onRenameDay={renameGridColumn}
                  onDeleteDay={deleteGridColumn}
                  onRenameTime={renameGridTime}
                  onDeleteTime={deleteGridRow}
                />
              </div>
            </div>

            {/* Right sidebar (collapsible) */}
            {!isPersonal && showSidebar && (
              <div className="flex-shrink-0 flex flex-col" style={{ width: 300, borderLeft: `1px solid ${C.border}`, background: C.surface }}>
                <RightSidebar
                  conflicts={conflicts}
                  highlighted={conflictHighlight}
                  activeConflict={activeConflict}
                  onSelect={setActiveConflict}
                  onDismiss={handleDismissConflict}
                  onApply={handleApplyAlternative}
                  appliedMsg={appliedMsg}
                  onClearApplied={() => setAppliedMsg(null)}
                />
              </div>
            )}
          </div>
        )}

        {/* Student personal view */}
        {isPersonal && effectiveRole === 'student' && (
          <div className="flex-1 overflow-hidden">
            <StudentPortal backendSessions={studentSessions} />
          </div>
        )}

        {/* Lecturer personal view */}
        {isPersonal && effectiveRole === 'lecturer' && (
          <div className="flex-1 overflow-y-auto p-5">
            <StaffAvailability days={gridDays} slots={gridTimes} />
            {previewRole === 'lecturer' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 flex-wrap" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
                <span className="text-[11px] font-bold" style={{ color: C.textMuted }}>Lecturer:</span>
                <select
                  value={previewStaff ?? ''}
                  onChange={e => setPreviewStaff(e.target.value || null)}
                  className="px-2 py-1 rounded-lg text-xs font-semibold"
                  style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, outline: 'none', maxWidth: 240 }}
                >
                  {staffRows.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {previewLecturerEvents && (
                  <span className="text-[11px]" style={{ color: C.textSub }}>
                    {previewLecturerEvents.length} session{previewLecturerEvents.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
            <PersonalCalendar events={previewLecturerEvents ?? events} role={effectiveRole} />
          </div>
        )}
      </div>

      {/* Publish modal */}
      {showPublish && <PublishModal conflictCount={conflicts.length} onClose={() => setShowPublish(false)} onPublish={handlePublish} />}
      {showVersions && <VersionsModal onClose={() => setShowVersions(false)} />}
      {renameTarget && (
        <RenameModal
          title={
            renameTarget.kind === 'day' ? `Rename day "${renameTarget.old}"` :
            renameTarget.kind === 'time' ? `Rename time "${renameTarget.old}"` :
            renameTarget.kind === 'new-day' ? 'New day' : 'New time slot'
          }
          initial={renameTarget.kind === 'new-day' || renameTarget.kind === 'new-time' ? '' : renameTarget.old}
          placeholder={renameTarget.kind === 'new-day' ? 'e.g. Sat' : renameTarget.kind === 'new-time' ? 'HH:MM, e.g. 18:00' : renameTarget.kind === 'day' ? 'e.g. Sat' : 'HH:MM, e.g. 09:00'}
          validate={(v) => {
            const t = v.trim();
            if (renameTarget.kind === 'new-day' && gridDays.includes(t)) return 'Day already exists';
            if ((renameTarget.kind === 'time' || renameTarget.kind === 'new-time') && !/^\d{1,2}:\d{2}$/.test(t)) return 'Use HH:MM format, e.g. 09:00';
            if (renameTarget.kind === 'new-time' && gridTimes.includes(t)) return 'Time already exists';
            return null;
          }}
          onClose={() => setRenameTarget(null)}
          onSave={(v) => void confirmRename(v)}
        />
      )}

      {/* Session detail popover */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setSelected(null)}>
          <div onClick={e => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-xs" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ background: selected.session.color }} />
              <div className="text-sm font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text, fontSize: 16 }}>{selected.session.code}</div>
              <span className="ml-auto" style={{ color: C.textMuted, fontSize: 12 }}>{selected.row} · {DAYS[selected.day]}</span>
            </div>
            <div className="text-[7px] font-medium" style={{ color: C.accent, fontFamily: 'DM Mono, monospace' }}>
              {TIME_SLOTS[selected.session.slot ?? 0]}-{TIME_SLOTS[Math.min((selected.session.slot ?? 0) + (selected.session.duration ?? 1), TIME_SLOTS.length - 1)]}
            </div>
            <div className="font-semibold mb-3" style={{ color: C.textSub, fontSize: 14 }}>{selected.session.name}</div>
            <div className="space-y-1.5" style={{ color: C.textMuted, fontSize: 13 }}>
              <div>👤 {selected.session.staff}</div>
              <div>👥 {selected.session.group} · {selected.session.enrolled}/{selected.session.capacity}</div>
              <div className="space-y-0.5">
                <MiniBar value={Math.round((selected.session.enrolled / selected.session.capacity) * 100)} color={selected.session.enrolled / selected.session.capacity > 0.9 ? C.danger : C.success} />
                <span style={{ color: C.textMuted, fontSize: 12 }}>{Math.round((selected.session.enrolled / selected.session.capacity) * 100)}% capacity</span>
              </div>
              {selected.session.conflictId && <div className="font-bold" style={{ color: C.danger }}>⚡ Conflict flagged</div>}
            </div>
            <div className="flex gap-2 mt-4">
              <Btn variant="outline" onClick={() => setSelected(null)} className="flex-1 justify-center">Close</Btn>
              {isAdmin && (
                <>
                  <Btn variant="danger" onClick={deleteSelectedSession} className="flex-1 justify-center">Delete</Btn>
                  <Btn variant="primary" onClick={() => openEdit(selected.session, selected.row, selected.day)} className="flex-1 justify-center">Edit</Btn>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin add/edit session */}
      {sessionForm && (
        <SessionFormModal
          title={sessionForm.mode === 'add' ? 'Add session' : 'Edit session'}
          subtitle={`${sessionForm.row} · ${DAYS[sessionForm.day]} ${TIME_SLOTS[sessionForm.slot ?? sessionForm.session?.slot ?? 0] ?? TIME_SLOTS[0]} — يمكنك تغيير اليوم والوقت والقاعة أدناه`}
          initial={sessionForm.session ? {
            code: sessionForm.session.code, name: sessionForm.session.name,
            staff: sessionForm.session.staff, group: sessionForm.session.group,
            capacity: String(sessionForm.session.capacity), enrolled: String(sessionForm.session.enrolled),
            academic_year: sessionForm.session.academic_year ? String(sessionForm.session.academic_year) : '', major: sessionForm.session.major ?? '',
            day: String(sessionForm.day), slot: String(sessionForm.session.slot ?? sessionForm.slot ?? 0), duration: String(sessionForm.session.duration ?? 1), room: sessionForm.row,
          } : { code: '', name: '', staff: '', group: '', capacity: '30', enrolled: '0', academic_year: '', major: '', day: String(sessionForm.day), slot: String(sessionForm.slot ?? 0), duration: '1', room: sessionForm.row }}
          staffOptions={(() => {
            const isLab = sessionForm.view === 'labs';
            const filtered = staffRows.filter(n => isLab ? /^(TA\.|Eng\.)/.test(n) : /^(Dr\.|Prof\.)/.test(n));
            const cur = sessionForm.session?.staff;
            if (cur && !filtered.includes(cur)) return [cur, ...filtered];
            return filtered;
          })()}
          roomOptions={(() => {
            if (sessionForm.view === 'rooms') return ROOMS;
            if (sessionForm.view === 'labs') return LABS;
            return staffRows;
          })()}
          onClose={() => { setSessionForm(null); setConflictMsg(null); }}
          onSave={saveSession}
          onDelete={sessionForm.mode === 'edit' ? deleteSession : undefined}
        />
      )}

      {showStaffMgr && (
        <StaffManagerModal staff={staffRows} onClose={() => setShowStaffMgr(false)} onAdd={addStaff} onRemove={removeStaff} />
      )}

      {showStudentMgr && (
        <StudentManagerModal students={students} onClose={() => setShowStudentMgr(false)} onAdd={addStudent} onRemove={removeStudent} onUpdateGroup={updateStudentGroup} />
      )}

      {showProfile && (
        <ProfileModal role={role ?? 'student'} onClose={() => setShowProfile(false)} onSave={(p) => setProfile(p)} />
      )}

      {/* Floating ScheduleAI assistant (Gemini-backed) */}
      <ChatBot isAdmin={isAdmin} onClose={() => {}} timetableJson={timetableSnapshot} conflictsCount={conflicts.length} />

      {/* Conflict-only: styled frontend popup with the Arabic reason (no browser alert) */}
      {conflictMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setConflictMsg(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
            <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
              <div className="flex items-start gap-2">
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: C.danger, fontFamily: 'Outfit, sans-serif' }}>
                    {conflictMsg.split('\n')[0].replace('❌', '').trim() || 'Change blocked'}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted, fontFamily: 'Inter, sans-serif', marginTop: 2 }}>
                    Resolve the issue below, then try again.
                  </div>
                </div>
                <button onClick={() => setConflictMsg(null)} title="Dismiss" className="ml-auto" style={{ color: C.textMuted, fontSize: 16, lineHeight: 1 }}>✕</button>
              </div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-2" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {conflictMsg.split('\n').slice(1).filter(Boolean).map((line, i) => {
                const m = line.match(/^-\s*\[(.+?)\]\s*(.*)$/);
                if (!m) return <div key={i} style={{ fontSize: 13, color: C.textSub, fontFamily: 'Inter, sans-serif' }}>{line}</div>;
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="px-2 py-0.5 rounded-md flex-shrink-0" style={{ background: C.dangerBg, color: C.danger, fontFamily: 'DM Mono, monospace', fontSize: 10, fontWeight: 700 }}>{m[1]}</span>
                    <span style={{ fontSize: 13, color: C.text, fontFamily: 'Inter, sans-serif' }}>{m[2]}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end px-5 py-3" style={{ borderTop: `1px solid ${C.border}` }}>
              <Btn variant="primary" onClick={() => setConflictMsg(null)}>Got it</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Rooms page
function RoomsPage() {
  return (<><RoomsScreen /><PinnedChatBot /></>);
}

// Analytics page (live dashboards)
function AnalyticsPage() {
  return (<><AnalyticsScreen /><PinnedChatBot /></>);
}

// Sections page (admin master data + registration)
function SectionsPage() {
  return (<><SectionsScreen /><PinnedChatBot /></>);
}

// Planning page (terms, holidays, departments)
function PlanningPage() {
  return (<><PlanningScreen /><PinnedChatBot /></>);
}

// Student page (own view, or admin preview of any student: fixed Amara default + picker)
function StudentPage() {
  const { tokens: C } = useTheme();
  const { previewRole, previewStudentId, setPreviewStudentId } = usePreview();
  const [students, setStudents] = useState<ManagedStudent[]>([]);
  const [regs, setRegs] = useState<CourseRegistration[]>([]);
  const [secCodes, setSecCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (previewRole !== 'student') return;
    let cancelled = false;
    studentsApi.list()
      .then(list => {
        if (cancelled || !Array.isArray(list) || !list.length) return;
        setStudents(list);
        if (!previewStudentId) {
          const amara = list.find(s => s.name.toLowerCase().includes('amara')) ?? list[0];
          setPreviewStudentId(amara.id);
        }
      })
      .catch(() => { /* offline */ });
    return () => { cancelled = true; };
  }, [previewRole]);
  useEffect(() => {
    if (previewRole !== 'student' || !previewStudentId) return;
    let cancelled = false;
    (async () => {
      try {
        const [rr, secs] = await Promise.all([
          studentsApi.registrationsOf(previewStudentId), sectionsApi.list()]);
        if (cancelled) return;
        setRegs(Array.isArray(rr) ? rr : []);
        const m: Record<string, string> = {};
        (Array.isArray(secs) ? secs : []).forEach(s => { m[s.id] = s.code; });
        setSecCodes(m);
      } catch { /* offline */ }
    })();
    return () => { cancelled = true; };
  }, [previewRole, previewStudentId]);
  const sel = students.find(s => s.id === previewStudentId) ?? null;
  return (<>
    {previewRole === 'student' && (
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0 flex-wrap" style={{ background: C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
        <span className="text-[11px] font-bold" style={{ color: C.textMuted }}>Previewing as:</span>
        <select
          value={previewStudentId ?? ''}
          onChange={e => setPreviewStudentId(e.target.value || null)}
          className="px-2 py-1 rounded-lg text-xs font-semibold"
          style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, outline: 'none', maxWidth: 220 }}
        >
          {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {sel && <span className="text-[11px]" style={{ color: C.textSub }}>{sel.group} · {sel.year}</span>}
        {regs.length > 0 && (
          <span className="text-[11px]" style={{ color: C.textMuted }}>
            Registered: {regs.map(r => secCodes[r.section_id] ?? r.section_id).join(', ')}
          </span>
        )}
      </div>
    )}
    <StudentPortal backendSessions={[]} />
    <PinnedChatBot />
  </>);
}

// Login page
function LoginPage() {
  const { login } = useAuth();
  const handleLogin = (role: AppRole, displayName?: string, email?: string, token?: string) => {
    try {
      if (token) localStorage.setItem('auth_token', token);
      localStorage.setItem('auth_role', role);
      if (displayName) localStorage.setItem('auth_name', displayName);
      if (email) localStorage.setItem('auth_email', email);
    } catch { /* ignore */ }
    login(role, displayName, email);
  };
  return <LoginScreen onLogin={handleLogin} />;
}

export default function App() {
  const { tokens: C } = useTheme();

  return (
    <ThemeProvider>
      <AuthProvider>
        <div style={{ background: C.bg, minHeight: '100vh' }}>
          <Routes>
            <Route element={<PublicRoute><LoginPage /></PublicRoute>} path="/login" />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="rooms" element={<RoomsPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="sections" element={<SectionsPage />} />
              <Route path="planning" element={<PlanningPage />} />
              <Route path="student" element={<StudentPage />} />
            </Route>
          </Routes>
        </div>
      </AuthProvider>
    </ThemeProvider>
  );
}

// Need to import ThemeProvider
import { ThemeProvider } from './theme';