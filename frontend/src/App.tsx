import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTheme } from './theme';
import LoginScreen from './LoginScreen';
import RoomsScreen from './RoomsScreen';
import StudentPortal from './StudentPortal';
import ProfileModal, { loadProfile, type UserProfile } from './ProfileModal';
import { timetable as timetableApi, conflicts as conflictsApi, rooms as roomsApi, staff as staffApi, students as studentsApi, versions as versionsApi, auth as authApi } from './api/client';
import type { StudentSession } from './api/client';
import {
  DAYS, TIME_SLOTS, ROOMS, LABS, STAFF,
  TIMETABLE_DATA, CONFLICTS,
  type Session, type Conflict, type Alternative,
} from './data';

type AppRole   = 'admin' | 'lecturer' | 'student';
type AppPage   = 'schedule' | 'rooms';
type GridView  = 'rooms' | 'labs' | 'staff';
type GridFilter = 'session' | 'conflict' | 'available' | null;
type VersionId = 'draft-3' | 'draft-2' | 'pub-1';
type SideTab   = 'conflicts';

// ── Labs & Staff grid data ────────────────────────────────────────────────────
const LABS_GRID: Record<string, Record<number, Session | null>> = {
  'CS-Lab1': {
    0: { id: 'lb1', code: 'CS201L',   name: 'Data Structures Lab', staff: 'Dr. Chen Wei',    group: 'CS-2A',  capacity: 60, enrolled: 28, color: '#2563eb' },
    1: null,
    2: { id: 'lb2', code: 'CS301L',   name: 'Algorithms Lab',      staff: 'Dr. Chen Wei',    group: 'CS-3A',  capacity: 60, enrolled: 24, color: '#2563eb' },
    3: null,
    4: { id: 'lb3', code: 'CS401L',   name: 'ML Lab',              staff: 'Dr. Lena Kovač',  group: 'CS-4A',  capacity: 60, enrolled: 22, color: '#7c3aed' },
  },
  'CS-Lab2': {
    0: null,
    1: { id: 'lb4', code: 'CS501L',   name: 'Distributed Sys Lab', staff: 'Dr. Lena Kovač',  group: 'CS-MSc', capacity: 40, enrolled: 18, color: '#7c3aed' },
    2: null,
    3: { id: 'lb5', code: 'CS601L',   name: 'Research Lab',        staff: 'Dr. Chen Wei',    group: 'PhD-1',  capacity: 40, enrolled: 12, color: '#2563eb' },
    4: null,
  },
  'CS-Lab3': {
    0: { id: 'lb12', code: 'CS302L',  name: 'OS Lab',              staff: 'Dr. Mona Khalil', group: 'CS-3B',  capacity: 50, enrolled: 23, color: '#2563eb' },
    1: null,
    2: null,
    3: { id: 'lb13', code: 'CS101L',  name: 'Intro CS Lab',        staff: 'Dr. Ahmed Hassan', group: 'CS-1A', capacity: 50, enrolled: 42, color: '#2563eb' },
    4: null,
  },
  'Phys-Lab': {
    0: { id: 'lb6', code: 'PHYS101L', name: 'Mechanics Lab',       staff: 'Dr. Raj Patel',   group: 'ENG-1A', capacity: 48, enrolled: 24, color: '#0891b2' },
    1: null, 2: null,
    3: { id: 'lb7', code: 'PHYS201L', name: 'Electrodynamics Lab', staff: 'Dr. Raj Patel',   group: 'PHYS-2A',capacity: 48, enrolled: 20, color: '#0891b2' },
    4: null,
  },
  'Phys-Lab2': {
    0: null,
    1: { id: 'lb14', code: 'PHYS102L', name: 'Waves Lab',          staff: 'Dr. Fatma Ali',   group: 'ENG-1B', capacity: 40, enrolled: 22, color: '#0891b2' },
    2: null, 3: null, 4: null,
  },
  'Chem-Lab': {
    0: null,
    1: { id: 'lb8', code: 'CHEM201L', name: 'Organic Chem Lab',    staff: 'Dr. Raj Patel',   group: 'CHEM-2B',capacity: 30, enrolled: 16, color: '#d97706' },
    2: null, 3: null,
    4: { id: 'lb9', code: 'CHEM401L', name: 'Spectroscopy Lab',    staff: 'Dr. Raj Patel',   group: 'CHEM-4A',capacity: 30, enrolled: 14, color: '#d97706' },
  },
  'Chem-Lab B': {
    0: null, 1: null,
    2: { id: 'lb15', code: 'CHEM102L', name: 'General Chem Lab',   staff: 'Prof. Karim Adel', group: 'CHEM-1A', capacity: 30, enrolled: 21, color: '#d97706' },
    3: null, 4: null,
  },
  'BioLab': {
    0: null, 1: null,
    2: { id: 'lb10', code: 'BIO101L', name: 'Cell Biology Lab',    staff: 'Dr. Marcus Bell', group: 'BIO-1A', capacity: 28, enrolled: 19, color: '#be185d' },
    3: { id: 'lb11', code: 'BIO301L', name: 'Genetics Lab',        staff: 'Dr. Marcus Bell', group: 'BIO-3A', capacity: 28, enrolled: 18, color: '#be185d' },
    4: null,
  },
  'BioLab2': {
    0: null,
    1: { id: 'lb16', code: 'BIO201L', name: 'Microbiology Lab',    staff: 'Dr. Heba Mostafa', group: 'BIO-2A', capacity: 24, enrolled: 22, color: '#be185d' },
    2: null, 3: null, 4: null,
  },
  'Eng-Workshop': {
    0: { id: 'lb17', code: 'ENG202L', name: 'Electronics Workshop', staff: 'Eng. Omar Farouk', group: 'EE-2B', capacity: 30, enrolled: 22, color: '#059669' },
    1: null, 2: null, 3: null, 4: null,
  },
};

const STAFF_GRID: Record<string, Record<number, Session | null>> = {
  'Dr. Chen Wei':        { 0: { id: 'sf1',  code: 'CS301',   name: 'Algorithms',      staff: 'Dr. Chen Wei',        group: 'CS-3A',   capacity: 240, enrolled: 108, color: '#2563eb' }, 1: null, 2: { id: 'sf2',  code: 'CS201',   name: 'Data Structures',  staff: 'Dr. Chen Wei',        group: 'CS-2A',   capacity: 120, enrolled: 78,  color: '#2563eb' }, 3: null, 4: null },
  'Prof. Amara Nwosu':   { 0: null, 1: { id: 'sf3',  code: 'ENG201',  name: 'Circuit Analysis', staff: 'Prof. Amara Nwosu',   group: 'EE-2A',   capacity: 120, enrolled: 72,  color: '#059669' }, 2: { id: 'sf4', code: 'ENG401', name: 'Control Systems',  staff: 'Prof. Amara Nwosu',   group: 'EE-4A',   capacity: 30, enrolled: 28,  color: '#059669' }, 3: null, 4: { id: 'sf5', code: 'ENG301', name: 'Thermodynamics',   staff: 'Prof. Amara Nwosu',   group: 'MECH-3A', capacity: 20, enrolled: 20, color: '#059669', conflictId: 'c3' } },
  'Dr. Lena Kovač':      { 0: null, 1: { id: 'sf6',  code: 'CS501',   name: 'Distributed Sys',  staff: 'Dr. Lena Kovač',      group: 'CS-MSc',  capacity: 30,  enrolled: 24,  color: '#7c3aed' }, 2: null, 3: { id: 'sf7', code: 'CS401',  name: 'ML Foundations',   staff: 'Dr. Lena Kovač',      group: 'CS-4A',   capacity: 240, enrolled: 94,  color: '#7c3aed' }, 4: null },
  'Dr. Raj Patel':       { 0: null, 1: { id: 'sf8',  code: 'CHEM201', name: 'Organic Chem',     staff: 'Dr. Raj Patel',       group: 'CHEM-2B', capacity: 300, enrolled: 143, color: '#d97706' }, 2: null, 3: { id: 'sf9', code: 'PHYS201', name: 'Electrodynamics',  staff: 'Dr. Raj Patel',       group: 'PHYS-2A', capacity: 300, enrolled: 98,  color: '#0891b2', conflictId: 'c2' }, 4: { id: 'sf10', code: 'PHYS101', name: 'Mechanics', staff: 'Dr. Raj Patel', group: 'ENG-1A', capacity: 240, enrolled: 120, color: '#0891b2', conflictId: 'c2' } },
  'Prof. Sara Johansson':{ 0: null, 1: { id: 'sf11', code: 'MATH201', name: 'Linear Algebra',   staff: 'Prof. Sara Johansson', group: 'ENG-2B',  capacity: 240, enrolled: 235, color: '#7c3aed', conflictId: 'c1' }, 2: null, 3: { id: 'sf12', code: 'MATH301', name: 'Calculus III',   staff: 'Prof. Sara Johansson', group: 'MATH-3A', capacity: 120, enrolled: 68, color: '#7c3aed' }, 4: null },
  'Dr. Marcus Bell':     { 0: { id: 'sf13', code: 'BIO101',  name: 'Cell Biology',     staff: 'Dr. Marcus Bell',     group: 'BIO-1A',  capacity: 300, enrolled: 187, color: '#be185d' }, 1: null, 2: null, 3: { id: 'sf14', code: 'BIO301', name: 'Genetics', staff: 'Dr. Marcus Bell', group: 'BIO-3A', capacity: 28, enrolled: 19, color: '#be185d' }, 4: null },
  'Dr. Ahmed Hassan':    { 0: { id: 'sf15', code: 'CS101',   name: 'Intro to CS',      staff: 'Dr. Ahmed Hassan',    group: 'CS-1A',   capacity: 180, enrolled: 172, color: '#2563eb' }, 1: null, 2: null, 3: null, 4: null },
  'Dr. Fatma Ali':       { 0: null, 1: { id: 'sf16', code: 'MATH101', name: 'Calculus I',       staff: 'Dr. Fatma Ali',       group: 'ENG-1B',  capacity: 180, enrolled: 165, color: '#7c3aed' }, 2: null, 3: null, 4: null },
  'Prof. John Smith':    { 0: null, 1: null, 2: null, 3: { id: 'sf17', code: 'ENG101',  name: 'Statics',            staff: 'Prof. John Smith',    group: 'MECH-1A', capacity: 180, enrolled: 150, color: '#059669' }, 4: null },
  'Dr. Mona Khalil':     { 0: { id: 'sf18', code: 'CS302',   name: 'Operating Systems', staff: 'Dr. Mona Khalil',     group: 'CS-3B',   capacity: 25,  enrolled: 23,  color: '#2563eb' }, 1: null, 2: null, 3: null, 4: null },
  'Eng. Omar Farouk':    { 0: null, 1: null, 2: { id: 'sf19', code: 'ENG202',  name: 'Electronics I',      staff: 'Eng. Omar Farouk',    group: 'EE-2B',   capacity: 25,  enrolled: 22,  color: '#059669', conflictId: 'c5' }, 3: null, 4: null },
  'Dr. Heba Mostafa':    { 0: null, 1: null, 2: { id: 'sf20', code: 'BIO201',  name: 'Microbiology',       staff: 'Dr. Heba Mostafa',    group: 'BIO-2A',  capacity: 25,  enrolled: 24,  color: '#be185d', conflictId: 'c6' }, 3: null, 4: null },
  'Prof. Karim Adel':    { 0: null, 1: null, 2: null, 3: { id: 'sf21', code: 'CHEM102', name: 'General Chem II',    staff: 'Prof. Karim Adel',    group: 'CHEM-1A', capacity: 25,  enrolled: 21,  color: '#d97706' }, 4: null },
  'Dr. Nadia Samir':     { 0: null, 1: { id: 'sf22', code: 'CS402',   name: 'HCI Studio',         staff: 'Dr. Nadia Samir',     group: 'CS-4B',   capacity: 22,  enrolled: 20,  color: '#7c3aed' }, 2: null, 3: null, 4: null },
  'TA. Youssef Nabil':   { 0: null, 1: null, 2: null, 3: null, 4: null },
};

const GRID_ROWS: Record<GridView, string[]>  = { rooms: ROOMS, labs: LABS, staff: STAFF };
// stateful getters live inside App (see useMemo below) — kept for backwards compat
function getGridData(v: GridView) { return v === 'rooms' ? TIMETABLE_DATA.rooms : v === 'labs' ? LABS_GRID : STAFF_GRID; }

// ── Static data ───────────────────────────────────────────────────────────────
const VERSIONS: { id: VersionId; label: string; tag: 'draft' | 'published' }[] = [
  { id: 'draft-3', label: 'Draft v3 (current)', tag: 'draft' },
  { id: 'draft-2', label: 'Draft v2',           tag: 'draft' },
  { id: 'pub-1',   label: 'Published v1',        tag: 'published' },
];

interface PersonalEvent { id: string; code: string; name: string; room: string; building: string; day: number; slot: number; color: string; staff?: string; group?: string; }
const STUDENT_EVENTS: PersonalEvent[] = [
  { id: 'e1', code: 'CS301',   name: 'Algorithms',     room: 'LT-101', building: 'Block A', day: 0, slot: 0, color: '#2563eb', staff: 'Dr. Chen Wei'    },
  { id: 'e2', code: 'MATH201', name: 'Linear Algebra',  room: 'LT-101', building: 'Block A', day: 1, slot: 1, color: '#7c3aed', staff: 'Prof. Johansson' },
  { id: 'e3', code: 'CS401',   name: 'ML Foundations',  room: 'LT-101', building: 'Block A', day: 2, slot: 3, color: '#2563eb', staff: 'Dr. Kovač'       },
  { id: 'e4', code: 'CS201',   name: 'Data Structures', room: 'LT-102', building: 'Block A', day: 3, slot: 2, color: '#2563eb', staff: 'Dr. Chen Wei'    },
  { id: 'e5', code: 'PHYS101', name: 'Mechanics',       room: 'LT-101', building: 'Block A', day: 4, slot: 4, color: '#0891b2', staff: 'Dr. Raj Patel'   },
];
const LECTURER_EVENTS: PersonalEvent[] = [
  { id: 'l1', code: 'CS301', name: 'Algorithms',      room: 'LT-101', building: 'Block A', day: 0, slot: 0, color: '#2563eb', group: 'CS-3A' },
  { id: 'l2', code: 'CS201', name: 'Data Structures',  room: 'LT-102', building: 'Block A', day: 2, slot: 2, color: '#2563eb', group: 'CS-2A' },
  { id: 'l3', code: 'CS401', name: 'ML Foundations',   room: 'LT-101', building: 'Block A', day: 3, slot: 3, color: '#7c3aed', group: 'CS-4A' },
];

interface Notif { id: string; type: 'info' | 'warning' | 'change'; text: string; }
const NOTIFS: Notif[] = [
  { id: 'n1', type: 'change',  text: 'MATH201 moved from LT-101 → LT-201 effective next Monday.' },
  { id: 'n2', type: 'warning', text: 'PHYS101 Fri 12:00 — Dr. Patel double-booked with PHYS201.' },
  { id: 'n3', type: 'info',    text: 'Week 4 schedule published. Export ICS to sync your calendar.' },
];
const NOTIF_COLOR: Record<string, string> = { change: '#f59e0b', warning: '#ef4444', info: '#38bdf8' };

const AI_METRICS = { score: 68, capacityFit: 82, staffUtil: 91, roomEfficiency: 74, hardTotal: 32, hardViolated: 6, softTotal: 47, softUnmet: 11 };

// ─── Shared primitives ────────────────────────────────────────────────────────
function Btn({ children, onClick, variant = 'ghost', disabled, small, className = '' }: {
  children: React.ReactNode; onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'success' | 'outline' | 'accent';
  disabled?: boolean; small?: boolean; className?: string;
}) {
  const { tokens: C } = useTheme();
  const s: Record<string, React.CSSProperties> = {
    primary: { background: C.accent,     color: '#fff',     border: 'none' },
    ghost:   { background: 'transparent',color: C.textSub,  border: 'none' },
    danger:  { background: C.dangerBg,   color: C.danger,   border: `1px solid ${C.danger}30` },
    success: { background: C.successBg,  color: C.success,  border: `1px solid ${C.success}30` },
    outline: { background: 'transparent',color: C.textSub,  border: `1px solid ${C.border}` },
    accent:  { background: C.accentBg,   color: C.accent,   border: `1px solid ${C.accent}30` },
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

// ── Version switcher ──────────────────────────────────────────────────────────
function VersionSwitcher({ active, onChange }: { active: VersionId; onChange: (v: VersionId) => void }) {
  const { tokens: C } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = VERSIONS.find(v => v.id === active)!;
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textSub }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: current.tag === 'draft' ? C.warning : C.success }} />
        {current.label}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d={open ? 'M1 6l3-3 3 3' : 'M1 2l3 3 3-3'} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 rounded-xl overflow-hidden z-50"
          style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, minWidth: 180, boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
          {(['draft', 'published'] as const).map(tag => (
            <div key={tag}>
              <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest" style={{ color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>{tag}</div>
              {VERSIONS.filter(v => v.tag === tag).map(v => (
                <button key={v.id} onClick={() => { onChange(v.id); setOpen(false); }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs transition-all hover:opacity-80"
                  style={{ background: active === v.id ? C.navActiveBg : 'transparent', color: active === v.id ? C.navActiveText : C.textSub }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tag === 'draft' ? C.warning : C.success }} />
                  {v.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Role preview switcher ─────────────────────────────────────────────────
function RolePreviewSwitcher({ preview, onChange }: { preview: AppRole; onChange: (r: AppRole) => void }) {
  const { tokens: C } = useTheme();
  return (
    <div className="flex items-center rounded-lg overflow-hidden" style={{ border: `1px solid ${C.accent}30`, background: C.accentBg }}>
      <div className="flex">
        {(['admin', 'lecturer', 'student'] as AppRole[]).map((r, i) => (
          <button key={r} onClick={() => onChange(r)}
            className="px-3 py-1.5 text-sm font-semibold transition-all capitalize"
            style={{ background: preview === r ? C.accent : 'transparent', color: preview === r ? '#fff' : C.textMuted, fontFamily: 'Inter, sans-serif', borderRight: i < 2 ? `1px solid ${C.accent}20` : 'none' }}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Publish modal ─────────────────────────────────────────────────────────────
function PublishModal({ conflictCount, onClose, onPublish }: { conflictCount: number; onClose: () => void; onPublish: () => void }) {
  const { tokens: C } = useTheme();
  const hasConflicts = conflictCount > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div className="text-base font-bold mb-1" style={{ fontFamily: 'Outfit, sans-serif', color: C.text, fontSize: 18 }}>Publish Schedule</div>
        <p className="mb-4" style={{ color: C.textMuted, fontSize: 14 }}>Draft v3 will go live for all students and staff.</p>
        {hasConflicts && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4" style={{ background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}25`, fontSize: 14, fontWeight: 600 }}>
            Warning: {conflictCount} hard conflict{conflictCount !== 1 ? 's' : ''} remain. You can resolve them later.
          </div>
        )}
        {!blocked && (
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

// ── Session pill ──────────────────────────────────────────────────────────────
function SessionPill({ session, hasConflict, isDraggable, onClick, onDragStart, onDragEnd }: {
  session: Session;
  hasConflict: boolean;
  isDraggable: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { tokens: C } = useTheme();
  return (
    <button onClick={onClick}
      draggable={isDraggable}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', session.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`w-full h-full text-left px-2 py-1.5 rounded-md overflow-hidden transition-all hover:brightness-110 ${hasConflict ? 'conflict-pulse' : ''}`}
      style={{ background: session.color + '1e', border: `1.5px solid ${session.color}48`, cursor: isDraggable ? 'grab' : undefined }}>
      <div className="text-[9px] font-bold leading-tight truncate" style={{ fontFamily: 'DM Mono, monospace', color: session.color }}>{session.code}</div>
      <div className="text-[8px] truncate mt-0.5 leading-tight" style={{ color: C.textSub }}>{session.name}</div>
      {hasConflict && <div className="text-[7px] font-bold mt-0.5" style={{ color: C.danger }}>⚡ conflict</div>}
    </button>
  );
}

// ── Edge-to-edge timetable grid ───────────────────────────────────────────────
function TimetableGrid({ view, days, rows, data, conflicts, filter, isAdmin, onSessionClick, onEmptyCellClick, onMoveSession, onConflictHighlight }: {
  view: GridView;
  days: string[];
  rows: string[];
  data: Record<string, Record<number, Session | null>>;
  conflicts: Conflict[];
  filter: GridFilter;
  isAdmin: boolean;
  onSessionClick: (s: Session, row: string, day: number) => void;
  onEmptyCellClick: (row: string, day: number) => void;
  onMoveSession: (fromRow: string, fromDay: number, toRow: string, toDay: number) => void;
  onConflictHighlight: (id: string | null) => void;
}) {
  const { tokens: C } = useTheme();
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{ row: string; day: number } | null>(null);
  const labelWidth = view === 'staff' ? 170 : 110;

  const conflictCells = new Set(conflicts.map(c => `${c.cell.row}-${c.cell.day}`));
  const conflictMap: Record<string, string> = {};
  conflicts.forEach(c => { conflictMap[`${c.cell.row}-${c.cell.day}`] = c.id; });

  return (
    <div className="w-full h-full overflow-auto">
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: view === 'staff' ? 1050 : 820, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: labelWidth }} />
          {days.map(d => <col key={d} />)}
        </colgroup>
        <thead>
          <tr>
            {/* Row label header */}
            <th className="sticky top-0 left-0 z-20 px-3 py-3 text-left text-[9px] font-semibold tracking-widest uppercase"
              style={{ background: C.surfaceAlt, color: C.textMuted, fontFamily: 'DM Mono, monospace', borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
              {view === 'staff' ? 'STAFF' : view === 'labs' ? 'LAB' : 'ROOM'}
            </th>
            {days.map((d, di) => (
              <th key={d} className="sticky top-0 z-10 px-2 py-3 text-center text-[9px] font-semibold tracking-widest uppercase"
                style={{ background: C.surfaceAlt, color: C.textSub, fontFamily: 'DM Mono, monospace', borderBottom: `1px solid ${C.border}`, borderRight: di < 4 ? `1px solid ${C.borderSub}` : 'none' }}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const rowData = data[row] ?? {};
            const isLast = ri === rows.length - 1;
            return (
              <tr key={row}>
                <td className="sticky left-0 z-10 px-3 py-2 font-bold truncate"
                  style={{ background: C.surfaceAlt, borderBottom: isLast ? 'none' : `1px solid ${C.borderSub}`, borderRight: `1px solid ${C.border}`, color: C.textSub, fontFamily: view === 'staff' ? 'Inter, sans-serif' : 'DM Mono, monospace', fontSize: view === 'staff' ? 10 : 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: labelWidth }}>
                  {row}
                </td>
                {days.map((_, di) => {
                  const session = rowData[di] ?? null;
                  const cellKey = `${row}-${di}`;
                  const hasConflict = conflictCells.has(cellKey);
                  const conflictId = conflictMap[cellKey];
                  const matchesFilter = filter === null ||
                    (filter === 'available' && !session) ||
                    (filter === 'conflict' && hasConflict) ||
                    (filter === 'session' && !!session && !hasConflict);
                  const isLastCol = di === days.length - 1;
                  const showAdd = isAdmin && !session && hovered === cellKey;
                  const isDropTarget = isAdmin && !!dragged && !session && (dragged.row !== row || dragged.day !== di);
                  return (
                    <td key={di}
                      className="drop-cell"
                      onClick={() => { if (isAdmin && !session) onEmptyCellClick(row, di); }}
                      onDragOver={event => { if (isDropTarget) { event.preventDefault(); setHovered(cellKey); } }}
                      onDrop={event => {
                        event.preventDefault();
                        if (isDropTarget && dragged) onMoveSession(dragged.row, dragged.day, row, di);
                        setDragged(null);
                      }}
                      onMouseEnter={() => { setHovered(cellKey); if (conflictId) onConflictHighlight(conflictId); }}
                      onMouseLeave={() => { if (hovered === cellKey) setHovered(null); onConflictHighlight(null); }}
                      style={{
                        borderBottom: isLast ? 'none' : `1px solid ${C.borderSub}`,
                        borderRight: isLastCol ? 'none' : `1px solid ${C.borderSub}`,
                        height: 64,
                        padding: 4,
                        background: isDropTarget && hovered === cellKey ? C.successBg : hovered === cellKey ? C.surfaceHover : hasConflict ? C.dangerBg : 'transparent',
                        opacity: matchesFilter ? 1 : 0.12,
                        verticalAlign: 'top',
                        transition: 'background 0.1s',
                        cursor: isDropTarget ? 'copy' : isAdmin && !session ? 'copy' : undefined,
                      }}>
                      {session && matchesFilter && <SessionPill session={session} hasConflict={hasConflict} isDraggable={isAdmin}
                        onClick={() => onSessionClick(session, row, di)}
                        onDragStart={() => setDragged({ row, day: di })}
                        onDragEnd={() => setDragged(null)} />}
                      {showAdd && (
                        <button className="w-full h-full rounded-md" style={{ border: `1.5px dashed ${C.accent}60`, color: C.accent, fontSize: 18, minHeight: 56 }} title="Add session">+</button>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Conflict panel ────────────────────────────────────────────────────────────
function ConflictPanel({ conflicts, highlighted, activeConflict, onSelect, onDismiss }: {
  conflicts: Conflict[]; highlighted: string | null;
  activeConflict: string | null; onSelect: (id: string) => void; onDismiss: (id: string) => void;
}) {
  const { tokens: C } = useTheme();
  const TYPE_LABEL: Record<string, string> = { double_booking: 'Double Book', capacity: 'Capacity', staff_overlap: 'Staff Overlap', equipment: 'Equipment', student_group: 'Student Group', room_type: 'Room Type', closure: 'Closure' };
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {conflicts.length === 0 ? (
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
            {c.alternatives.length > 0 && (
              <div className="mt-2 pt-2 flex items-center gap-2" style={{ borderTop: `1px solid ${C.border}` }}>
                <span className="text-[9px] font-bold" style={{ fontFamily: 'DM Mono, monospace', color: C.accent }}>{c.alternatives[0].score}%</span>
                <span className="text-[9px]" style={{ color: C.textMuted }}>{c.alternatives[0].room} · {DAYS[c.alternatives[0].day]} {TIME_SLOTS[c.alternatives[0].slot]}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Right sidebar (conflicts only) ────────────────────────────────────────────
function RightSidebar({ conflicts, highlighted, activeConflict, onSelect, onDismiss }: {
  conflicts: Conflict[]; highlighted: string | null;
  activeConflict: string | null; onSelect: (id: string) => void; onDismiss: (id: string) => void;
}) {
  const { tokens: C } = useTheme();
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>Conflicts</span>
          {conflicts.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: C.dangerBg, color: C.danger, fontFamily: 'DM Mono, monospace' }}>{conflicts.length}</span>
          )}
        </div>
        {conflicts.length === 0 && (
          <span className="text-[10px]" style={{ color: C.success }}>All clear</span>
        )}
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <ConflictPanel conflicts={conflicts} highlighted={highlighted} activeConflict={activeConflict} onSelect={onSelect} onDismiss={onDismiss} />
      </div>
    </div>
  );
}

// ── Personal calendar ─────────────────────────────────────────────────────────
function PersonalCalendar({ events, role }: { events: PersonalEvent[]; role: AppRole }) {
  const { tokens: C } = useTheme();
  const [selected, setSelected] = useState<PersonalEvent | null>(null);
  const HOURS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'];
  const exportICS = () => {
    const baseDates = ['20260119', '20260120', '20260121', '20260122', '20260123'];
    const slotHour = (s: number) => String(8 + s).padStart(2, '0');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bua University//EN', 'CALSCALE:GREGORIAN',
      ...events.flatMap(ev => [
        'BEGIN:VEVENT',
        `UID:${ev.id}@bua.edu.eg`,
        `DTSTAMP:20260115T080000Z`,
        `DTSTART:2026${baseDates[ev.day].slice(4)}T${slotHour(ev.slot)}0000`,
        `DTEND:2026${baseDates[ev.day].slice(4)}T${slotHour(ev.slot + 1)}0000`,
        `SUMMARY:${ev.code} — ${ev.name}`,
        `LOCATION:${ev.room}\\, ${ev.building}`,
        `DESCRIPTION:Day ${DAYS[ev.day]} ${TIME_SLOTS[ev.slot]}`,
        'END:VEVENT',
      ]),
      'END:VCALENDAR'];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'timetable.ics'; a.click();
    URL.revokeObjectURL(url);
  };
  const lookup: Record<number, Record<number, PersonalEvent>> = {};
  events.forEach(ev => { if (!lookup[ev.day]) lookup[ev.day] = {}; lookup[ev.day][ev.slot] = ev; });
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>{role === 'student' ? 'My Schedule' : 'My Teaching Schedule'}</div>
          <div className="text-[9px] mt-0.5" style={{ color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>W03 · Mon 19 – Fri 23 Jan 2026</div>
        </div>
        <div className="flex gap-2"><Btn variant="outline" onClick={() => window.print()}>Print</Btn><Btn variant="outline" onClick={exportICS}>Export ICS</Btn></div>
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
              {DAYS.map((_, di) => { const ev = lookup[di]?.[si]; return (
                <td key={di} onClick={() => ev && setSelected(ev)} style={{ border: `1px solid ${C.border}`, background: ev ? ev.color + '33' : C.surface, height: 48, padding: ev ? 3 : 0, cursor: ev ? 'pointer' : 'default', verticalAlign: 'top' }}>
                  {ev && <div className="h-full px-2 py-1 rounded-md" style={{ background: ev.color + 'E6', border: `2px solid ${ev.color}CC`, boxShadow: `0 2px 8px ${ev.color}40` }}>
                    <div className="text-[9px] font-bold" style={{ fontFamily: 'DM Mono, monospace', color: '#fff' }}>{ev.code}</div>
                    <div className="text-[8px] truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>{ev.room}</div>
                  </div>}
                </td>
              ); })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setSelected(null)}>
          <div onClick={e => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-xs" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3"><div className="w-3 h-3 rounded-full" style={{ background: selected.color }} /><div className="text-sm font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>{selected.code}</div></div>
            <div className="text-xs font-semibold mb-3" style={{ color: C.textSub }}>{selected.name}</div>
            <div className="space-y-1.5 text-[10px]" style={{ color: C.textMuted }}>
              <div>📍 {selected.room}, {selected.building}</div><div>📅 {DAYS[selected.day]} · {TIME_SLOTS[selected.slot]}</div>
              {selected.staff && <div>👤 {selected.staff}</div>}{selected.group && <div>👥 {selected.group}</div>}
            </div>
            <Btn variant="outline" onClick={() => setSelected(null)} className="mt-4 w-full justify-center">Close</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin: add/edit session modal ─────────────────────────────────────────────
export interface SessionFormValue { code: string; name: string; staff: string; group: string; capacity: string; enrolled: string; }

function SessionFormModal({ title, subtitle, initial, staffOptions, onClose, onSave, onDelete }: {
  title: string; subtitle: string; initial: SessionFormValue; staffOptions: string[];
  onClose: () => void; onSave: (v: SessionFormValue) => void; onDelete?: () => void;
}) {
  const { tokens: C } = useTheme();
  const [form, setForm] = useState<SessionFormValue>(initial);
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
          </div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Capacity</label><input type="number" value={form.capacity} onChange={set('capacity')} style={input} /></div>
          <div><label style={{ fontSize: 12, color: C.textMuted }}>Enrolled</label><input type="number" value={form.enrolled} onChange={set('enrolled')} style={input} /></div>
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

// ── Admin: staff manager (add/remove people) ──────────────────────────────────
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

// ── Admin: student manager ────────────────────────────────────────────────────
export interface ManagedStudent { id: string; name: string; email: string; group: string; year: string; }

const DEFAULT_STUDENTS: ManagedStudent[] = [
  { id: 'st1', name: 'Amara Osei', email: 'amara@badr.edu.eg', group: 'CS-3A', year: 'Year 3' },
  { id: 'st2', name: 'Youssef Adel', email: 'youssef@badr.edu.eg', group: 'CS-2A', year: 'Year 2' },
  { id: 'st3', name: 'Mariam Hany', email: 'mariam@badr.edu.eg', group: 'ENG-2B', year: 'Year 2' },
  { id: 'st4', name: 'Omar Khaled', email: 'omar@badr.edu.eg', group: 'CS-3B', year: 'Year 3' },
  { id: 'st5', name: 'Nour Elhouda', email: 'nour@badr.edu.eg', group: 'BIO-2A', year: 'Year 2' },
  { id: 'st6', name: 'Karim Samy', email: 'karim@badr.edu.eg', group: 'EE-2A', year: 'Year 2' },
  { id: 'st7', name: 'Salma Tarek', email: 'salma@badr.edu.eg', group: 'CS-1A', year: 'Year 1' },
  { id: 'st8', name: 'Mostafa Fathy', email: 'mostafa@badr.edu.eg', group: 'MECH-3A', year: 'Year 3' },
];

function loadStudents(): ManagedStudent[] {
  try {
    const raw = localStorage.getItem('bua-students-v1');
    if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) return p; }
  } catch { /* ignore */ }
  return DEFAULT_STUDENTS;
}

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
  const input: React.CSSProperties = { padding: '9px 11px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 14, outline: 'none', width: '100%' };
  const filtered = students.filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.group.toLowerCase().includes(q.toLowerCase()) || s.email.toLowerCase().includes(q.toLowerCase()));
  const canAdd = name.trim() && email.trim() && group.trim();
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
          </div>
          <button disabled={!canAdd} onClick={() => { onAdd({ name: name.trim(), email: email.trim(), group: group.trim(), year }); setName(''); setEmail(''); }} className="w-full py-2 rounded-lg" style={{ background: C.accent, color: '#fff', fontSize: 14, fontWeight: 700, opacity: canAdd ? 1 : 0.4 }}>Add student</button>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / group / email…" style={input} />
        </div>
        <div className="overflow-y-auto flex-1 px-3 py-2">
          {filtered.map(s => (
            <div key={s.id} className="flex items-center gap-2 px-2 py-2 rounded-lg" style={{ borderBottom: `1px solid ${C.borderSub}` }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.accentBg, color: C.accent, fontSize: 12, fontWeight: 700 }}>{s.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{s.name}</div>
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

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ authRole, profileName, previewRole, onPreviewChange, page, setPage, version, setVersion, onPublish, published, conflictCount, onLogout, onProfile }: {
  authRole: AppRole; profileName: string; previewRole: AppRole; onPreviewChange: (r: AppRole) => void;
  page: AppPage; setPage: (p: AppPage) => void;
  version: VersionId; setVersion: (v: VersionId) => void;
  onPublish: () => void; published: boolean; conflictCount: number; onLogout: () => void; onProfile: () => void;
}) {
  const { tokens: C, isDark, toggle } = useTheme();
  return (
    <header className="flex items-center gap-2 px-4 h-12 flex-shrink-0" style={{ background: C.headerBg, borderBottom: `1px solid ${C.headerBorder}` }}>
      <div className="flex items-center gap-2 mr-1 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: C.accent }}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 2L18 7v11H2V7L10 2z" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="1.4" strokeLinejoin="round"/><rect x="7" y="12" width="2.4" height="5" rx="0.5" fill="white" fillOpacity="0.9"/><rect x="10.6" y="12" width="2.4" height="5" rx="0.5" fill="white" fillOpacity="0.9"/></svg>
        </div>
        <div className="hidden sm:block">
          <div className="text-[11px] font-bold leading-tight" style={{ fontFamily: 'Outfit, sans-serif', color: C.textOnPrimary }}>Bua University</div>
        </div>
      </div>

      {previewRole === 'admin' && (
        <nav className="flex gap-0.5">
          {([['schedule', 'Schedule'], ['rooms', 'Rooms']] as [AppPage, string][]).map(([p, label]) => (
            <button key={p} onClick={() => setPage(p)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: page === p ? C.navActiveBg : 'transparent', color: page === p ? C.navActiveText : 'rgba(255,255,255,0.45)', border: page === p ? `1px solid ${C.navActiveBorder}` : '1px solid transparent' }}>
              {label}
            </button>
          ))}
        </nav>
      )}

      <div className="flex-1" />
      <span className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize" style={{ background: C.navActiveBg, color: C.navActiveText, border: `1px solid ${C.navActiveBorder}` }}>
        {authRole}
      </span>

      {previewRole === 'admin' && (
        <>
          <VersionSwitcher active={version} onChange={setVersion} />
          {published
            ? <span className="text-[9px] px-2 py-1 rounded-full font-bold" style={{ background: C.successBg, color: C.success, fontFamily: 'DM Mono, monospace' }}>PUBLISHED</span>
            : <button onClick={onPublish} className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90 active:scale-[0.97]" style={{ background: C.success, color: '#fff', fontFamily: 'Inter, sans-serif' }}>
                Publish {conflictCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[8px]" style={{ background: 'rgba(255,255,255,0.25)' }}>{conflictCount}</span>}
              </button>
          }
        </>
      )}

      <button onClick={toggle} className="flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:opacity-70" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}>
        {isDark ? <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                : <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M11.5 9.5A5 5 0 014.5 2.5a5.5 5.5 0 107 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>}
      </button>
      <button onClick={onProfile} title={`Profile — ${profileName}`} className="flex items-center gap-2 pl-2 flex-shrink-0 hover:opacity-80" style={{ borderLeft: `1px solid ${C.headerBorder}`, background: 'transparent', borderTop: 'none', borderRight: 'none', borderBottom: 'none' }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: C.accent, color: '#fff', fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 700 }}>
          {profileName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || (authRole === 'admin' ? 'AD' : authRole === 'lecturer' ? 'LR' : 'ST')}
        </div>
        <span className="hidden md:block" style={{ color: '#fff', fontSize: 13, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profileName}</span>
      </button>
      <button onClick={onLogout} className="hover:opacity-60 transition-opacity" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }} title="Sign out">↩</button>
    </header>
  );
}

// ── Admin Chat Bot ────────────────────────────────────────────────────────────
interface ChatMessage { role: 'user' | 'bot'; text: string; time: string; }

function ChatBot({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const { tokens: C } = useTheme();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'bot', text: 'Hello! I\'m your ScheduleAI assistant. Ask me about conflicts, room availability, or scheduling rules.', time: new Date().toLocaleTimeString() },
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  const botReply = (userMsg: string) => {
    const lower = userMsg.toLowerCase();
    let reply = 'I can help with: conflict resolution, room search, scheduling rules, or publishing status. Try asking "How many conflicts?" or "Find room for 50 students".';
    if (lower.includes('conflict')) reply = `Currently ${conflicts.length} hard conflict${conflicts.length !== 1 ? 's' : ''}. Open the sidebar to review alternatives.`;
    else if (lower.includes('room') && lower.includes('student') || lower.includes('capacity')) reply = 'Use the Rooms page (capacity/equipment filters) or click an empty cell in the grid to add a session with auto-suggestions.';
    else if (lower.includes('publish')) reply = published ? 'Schedule is published.' : conflicts.length > 0 ? `Cannot publish: ${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} must be resolved first.` : 'Ready to publish — no hard conflicts.';
    else if (lower.includes('staff')) reply = `${staffRows.length} staff members. Use "Manage staff" in the toolbar to add/remove.`;
    else if (lower.includes('student')) reply = `${students.length} students registered. Use "Manage students" in the toolbar.`;
    else if (lower.includes('version')) reply = version === 'pub-1' ? 'Published v1 is live.' : `Currently on ${VERSIONS.find(v => v.id === version)?.label}.`;
    setMessages(m => [...m, { role: 'bot', text: reply, time: new Date().toLocaleTimeString() }]);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setMessages(m => [...m, { role: 'user', text: msg, time: new Date().toLocaleTimeString() }]);
    setInput('');
    setTimeout(() => botReply(msg), 400);
  };

  return (
    <>
      {/* Floating button */}
      {!open && isAdmin && (
        <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center justify-center w-12 h-12 rounded-2xl shadow-xl transition-all hover:scale-105" style={{ background: C.accent, color: '#fff', boxShadow: `0 8px 24px ${C.accent}40` }} title="Open Assistant">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
      {/* Chat panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md h-[70vh] max-h-[600px] rounded-t-2xl flex flex-col" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, boxShadow: '0 -8px 32px rgba(0,0,0,0.3)' }}>
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: C.accentBg, color: C.accent }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>ScheduleAI Assistant</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>Online · Bua University</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={{ color: C.textMuted, fontSize: 18 }}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" ref={messagesEndRef}>
              {messages.map((m, i) => (
                <div key={i} className="flex" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div className="max-w-[80%] px-3 py-2 rounded-2xl" style={{
                    background: m.role === 'user' ? C.accent : C.surfaceAlt,
                    color: m.role === 'user' ? '#fff' : C.text,
                    border: m.role === 'bot' ? `1px solid ${C.border}` : 'none',
                    borderBottomRightRadius: m.role === 'user' ? 4 : 16,
                    borderBottomLeftRadius: m.role === 'bot' ? 4 : 16,
                  }}>
                    <p style={{ fontSize: 13, lineHeight: 1.5 }}>{m.text}</p>
                    <div className="text-[9px] mt-1" style={{ color: m.role === 'user' ? 'rgba(255,255,255,0.6)' : C.textMuted }}>{m.time}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: `1px solid ${C.border}` }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Ask about conflicts, rooms, publishing…"
                className="flex-1 px-3 py-2 rounded-xl text-sm"
                style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text, outline: 'none', fontSize: 13 }}
              />
              <button onClick={handleSend} disabled={!input.trim()} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: C.accent, color: '#fff', opacity: input.trim() ? 1 : 0.4 }}>Send</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { tokens: C } = useTheme();

  const [loggedIn,          setLoggedIn]          = useState(false);
  const [authRole,          setAuthRole]           = useState<AppRole>('student');
  const [previewRole,       setPreviewRole]        = useState<AppRole>('student');
  const [page,              setPage]               = useState<AppPage>('schedule');
  const [gridView,          setGridView]           = useState<GridView>('rooms');
  const [gridDays,          setGridDays]           = useState<string[]>(DAYS);
  const [gridFilter,        setGridFilter]         = useState<GridFilter>(null);
  const [conflicts,         setConflicts]          = useState(CONFLICTS);
  const [activeConflict,    setActiveConflict]     = useState<string | null>(null);
  const [conflictHighlight, setConflictHighlight]  = useState<string | null>(null);
  const [showSidebar,       setShowSidebar]        = useState(true);
  const [version,           setVersion]            = useState<VersionId>('draft-3');
  const [showPublish,       setShowPublish]        = useState(false);
  const [published,         setPublished]          = useState(false);
  const [dismissedNotifs,   setDismissedNotifs]    = useState<Set<string>>(new Set());
  const [selected,          setSelected]           = useState<{ session: Session; row: string; day: number } | null>(null);
  const [showProfile,       setShowProfile]        = useState(false);
  const [profile,           setProfile]            = useState<UserProfile>(() => loadProfile('student'));
  const [showStaffMgr,      setShowStaffMgr]       = useState(false);
  const [showStudentMgr,    setShowStudentMgr]     = useState(false);
  const [students, setStudents] = useState<ManagedStudent[]>(() => loadStudents());
  const [studentSessions, setStudentSessions] = useState<StudentSession[]>([]);
  const [lecturerEvents, setLecturerEvents] = useState<PersonalEvent[]>(LECTURER_EVENTS);
  const [moveStatus, setMoveStatus] = useState<string | null>(null);

  // Editable timetable state (admin)
  const [roomsTimetable, setRoomsTimetable] = useState(TIMETABLE_DATA.rooms);
  const [labsState, setLabsState] = useState(LABS_GRID);
  const [staffState, setStaffState] = useState(STAFF_GRID);
  const [roomRows, setRoomRows] = useState<string[]>(ROOMS);
  const [labRows, setLabRows] = useState<string[]>(LABS);
  const [staffRows, setStaffRows] = useState<string[]>(STAFF);
  const [sessionForm, setSessionForm] = useState<null | { mode: 'add' | 'edit'; view: GridView; row: string; day: number; session?: Session }>(null);

  const gridRows = useMemo(() => gridView === 'rooms' ? roomRows : gridView === 'labs' ? labRows : staffRows, [gridView, roomRows, labRows, staffRows]);
  const gridData = useMemo(() => gridView === 'rooms' ? roomsTimetable : gridView === 'labs' ? labsState : staffState, [gridView, roomsTimetable, labsState, staffState]);

  const handleLogin = useCallback((role: AppRole, displayName?: string) => {
    setAuthRole(role); setPreviewRole(role); setLoggedIn(true); setPage('schedule');
    const base = loadProfile(role);
    setProfile(displayName ? { ...base, name: displayName } : base);
  }, []);
  const handleLogout = useCallback(() => {
    try { void authApi.logout(); } catch { /* offline */ }
    setLoggedIn(false); setPublished(false); setConflicts(CONFLICTS); setDismissedNotifs(new Set()); setActiveConflict(null); setVersion('draft-3'); setSelected(null);
  }, []);
  const handleDismissConflict = useCallback((id: string) => {
    setConflicts(prev => prev.filter(c => c.id !== id)); setActiveConflict(prev => prev === id ? null : prev);
    try { void conflictsApi.dismiss(id); } catch { /* offline */ }
  }, []);
  const handlePublish = useCallback(async () => {
    try {
      await versionsApi.publish('draft-3');
      setPublished(true);
      setShowPublish(false);
    } catch {
      setMoveStatus('Publish failed. Please check the backend connection.');
    }
  }, []);
  const handlePreviewChange = useCallback((role: AppRole) => {
    // Only a real admin may preview other roles; students/lecturers stay on their own dashboard.
    if (authRole !== 'admin') return;
    setPreviewRole(role); setPage('schedule'); setGridView('rooms');
  }, [authRole]);
  const handleVersionChange = useCallback((v: VersionId) => {
    setVersion(v); setActiveConflict(null); setPublished(v === 'pub-1');
    if (v === 'draft-3') setConflicts(CONFLICTS);
    else if (v === 'draft-2') setConflicts(CONFLICTS.slice(0, 3));
    else setConflicts([]);
  }, []);

  // Sync from backend on login (falls back to static mock data offline)
  const [backendLive, setBackendLive] = useState(false);
  useEffect(() => {
    if (!loggedIn) return;
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
          if (authRole === 'lecturer') {
            const roomByCode: Record<string, string> = {};
            Object.entries(toGrid(grid.rooms ?? {})).forEach(([room, days]) => {
              Object.values(days).forEach(session => { if (session) roomByCode[session.code] = room; });
            });
            const fallbackByCode = Object.fromEntries(LECTURER_EVENTS.map(event => [event.code, event]));
            const liveEvents: PersonalEvent[] = [];
            Object.entries(liveStaffGrid).forEach(([staffRow, days]) => {
              Object.entries(days).forEach(([day, session]) => {
                if (!session || (staffRow !== profile.name && session.staff !== profile.name)) return;
                const fallback = fallbackByCode[session.code];
                liveEvents.push({
                  id: session.id,
                  code: session.code,
                  name: session.name,
                  room: roomByCode[session.code] ?? fallback?.room ?? 'TBA',
                  building: fallback?.building ?? 'Bua University',
                  day: Number(day),
                  slot: fallback?.slot ?? 0,
                  color: session.color,
                  staff: session.staff,
                  group: session.group,
                });
              });
            });
            setLecturerEvents(liveEvents);
          }
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
  }, [loggedIn, authRole, profile.name]);

  const openAdd = useCallback((row: string, day: number) => {
    setSessionForm({ mode: 'add', view: gridView, row, day });
  }, [gridView]);

  const openEdit = useCallback((session: Session, row: string, day: number) => {
    setSelected(null);
    setSessionForm({ mode: 'edit', view: gridView, row, day, session });
  }, [gridView]);

  const saveSession = useCallback((v: SessionFormValue) => {
    setSessionForm(current => {
      if (!current) return current;
      const id = current.mode === 'add' ? `s-${Date.now()}` : current.session!.id;
      const sess: Session = {
        id, code: v.code.trim(), name: v.name.trim(), staff: v.staff.trim(),
        group: v.group.trim() || 'GEN', capacity: parseInt(v.capacity, 10) || 30,
        enrolled: Math.min(parseInt(v.enrolled, 10) || 0, parseInt(v.capacity, 10) || 30),
        color: '#2563eb',
      };
      const apply = (prev: Record<string, Record<number, Session | null>>) => ({
        ...prev, [current.row]: { ...(prev[current.row] ?? {}), [current.day]: sess },
      });
      if (current.view === 'rooms') setRoomsTimetable(apply);
      else if (current.view === 'labs') setLabsState(apply);
      else setStaffState(apply);
      // adding/editing clears conflict on that cell (scheduler resolved it manually)
      setConflicts(prev => prev.filter(c => !(c.cell.row === current.row && c.cell.day === current.day)));
      setPublished(false);
      try { void timetableApi.setSlot(current.view, current.row, current.day, sess); } catch { /* offline */ }
      return null;
    });
  }, []);

  const moveSession = useCallback((fromRow: string, fromDay: number, toRow: string, toDay: number) => {
    if (authRole !== 'admin' || previewRole !== 'admin' || (fromRow === toRow && fromDay === toDay)) return;
    const sourceData = gridView === 'rooms' ? roomsTimetable : gridView === 'labs' ? labsState : staffState;
    const session = sourceData[fromRow]?.[fromDay] ?? null;
    if (!session || sourceData[toRow]?.[toDay]) return;

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
  }, [authRole, previewRole, gridView, roomsTimetable, labsState, staffState]);

  const deleteSession = useCallback(() => {
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
      try { void timetableApi.setSlot(current.view, current.row, current.day, null); } catch { /* offline */ }
      return null;
    });
  }, []);

  const deleteSelectedSession = useCallback(() => {
    setSelected(current => {
      if (!current) return current;
      const clear = (prev: Record<string, Record<number, Session | null>>) => ({
        ...prev, [current.row]: { ...(prev[current.row] ?? {}), [current.day]: null },
      });
      if (gridView === 'rooms') setRoomsTimetable(clear);
      else if (gridView === 'labs') setLabsState(clear);
      else setStaffState(clear);
      setConflicts(prev => prev.filter(c => !(c.cell.row === current.row && c.cell.day === current.day)));
      try { void timetableApi.setSlot(gridView, current.row, current.day, null); } catch { /* offline */ }
      return null;
    });
  }, [gridView]);

  const addStaff = useCallback((name: string) => {
    setStaffRows(prev => prev.includes(name) ? prev : [...prev, name]);
    setStaffState(prev => prev[name] ? prev : { ...prev, [name]: { 0: null, 1: null, 2: null, 3: null, 4: null } });
    try { void staffApi.add(name); } catch { /* offline */ }
  }, []);

  const addGridRow = useCallback(() => {
    if (authRole !== 'admin' || previewRole !== 'admin') return;
    const label = window.prompt(`New ${gridView === 'rooms' ? 'room' : gridView === 'labs' ? 'lab' : 'staff'} name:`)?.trim();
    if (!label) return;
    const empty = Object.fromEntries(gridDays.map((_, index) => [index, null])) as Record<number, Session | null>;
    if (gridView === 'rooms') {
      setRoomRows(prev => prev.includes(label) ? prev : [...prev, label]);
      setRoomsTimetable(prev => prev[label] ? prev : { ...prev, [label]: empty });
    } else if (gridView === 'labs') {
      setLabRows(prev => prev.includes(label) ? prev : [...prev, label]);
      setLabsState(prev => prev[label] ? prev : { ...prev, [label]: empty });
    } else {
      addStaff(label);
      return;
    }
    void timetableApi.addRow(gridView, label);
  }, [authRole, previewRole, gridView, gridDays, addStaff]);

  const addGridColumn = useCallback(() => {
    if (authRole !== 'admin' || previewRole !== 'admin') return;
    const label = window.prompt('New column name (for example Sat or Week 2):')?.trim();
    if (!label || gridDays.includes(label)) return;
    setGridDays(prev => [...prev, label]);
    void timetableApi.addColumn(label);
  }, [authRole, previewRole, gridDays]);

  const removeStaff = useCallback((name: string) => {
    setStaffRows(prev => prev.filter(s => s !== name));
    setStaffState(prev => {
      const next = { ...prev };
      delete next[name];
      // unassign removed staff from sessions (keep session, clear staff name)
      Object.keys(next).forEach(row => {
        Object.keys(next[row] ?? {}).forEach(d => {
          const s = next[row][Number(d)];
          if (s && s.staff === name) next[row][Number(d)] = { ...s, staff: 'Unassigned' };
        });
      });
      return next;
    });
    try { void staffApi.remove(name); } catch { /* offline */ }
  }, []);

  const persistStudents = useCallback((next: ManagedStudent[]) => {
    setStudents(next);
    try { localStorage.setItem('bua-students-v1', JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const addStudent = useCallback((s: Omit<ManagedStudent, 'id'>) => {
    const optimistic = { ...s, id: `st-${Date.now()}` };
    persistStudents([...students, optimistic]);
    try {
      void studentsApi.add(s).then(created => {
        if (created && (created as unknown as ManagedStudent).id) {
          persistStudents([...students.filter(x => x.id !== optimistic.id), created as unknown as ManagedStudent]);
        }
      });
    } catch { /* offline */ }
  }, [students, persistStudents]);

  const removeStudent = useCallback((id: string) => {
    persistStudents(students.filter(s => s.id !== id));
    try { void studentsApi.remove(id); } catch { /* offline */ }
  }, [students, persistStudents]);

  const updateStudentGroup = useCallback((id: string, group: string) => {
    persistStudents(students.map(s => s.id === id ? { ...s, group } : s));
    try { void studentsApi.updateGroup(id, group); } catch { /* offline */ }
  }, [students, persistStudents]);

  if (!loggedIn) return <LoginScreen onLogin={handleLogin} />;

  const effectiveRole = authRole;
  const isPersonal    = effectiveRole !== 'admin';
  const isAdmin       = effectiveRole === 'admin';
  const events        = effectiveRole === 'lecturer' ? lecturerEvents : STUDENT_EVENTS;
  const activeNotifs  = NOTIFS.filter(n => !dismissedNotifs.has(n.id));

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.bg, fontFamily: 'Inter, sans-serif' }}>
      <Header authRole={authRole} profileName={profile.name} previewRole={previewRole} onPreviewChange={handlePreviewChange}
        page={page} setPage={setPage} version={version} setVersion={handleVersionChange}
        onPublish={() => setShowPublish(true)} published={published} conflictCount={conflicts.length} onLogout={handleLogout} onProfile={() => setShowProfile(true)} />

      {/* Notifications */}
      {activeNotifs.length > 0 && (
        <div style={{ borderBottom: `1px solid ${C.border}` }}>
          {activeNotifs.map(n => (
            <div key={n.id} className="flex items-center gap-3 px-4 py-2 text-xs" style={{ background: NOTIF_COLOR[n.type] + '10', borderBottom: `1px solid ${C.borderSub}` }}>
              <span style={{ color: NOTIF_COLOR[n.type], fontFamily: 'DM Mono, monospace', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>{n.type}</span>
              <span className="flex-1" style={{ color: C.textSub }}>{n.text}</span>
              <button onClick={() => setDismissedNotifs(prev => new Set([...prev, n.id]))} className="hover:opacity-50 transition-opacity text-[10px]" style={{ color: C.textMuted }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden">

        {/* Rooms page */}
        {page === 'rooms' && effectiveRole === 'admin' && <RoomsScreen />}

        {/* Schedule page */}
        {page === 'schedule' && (
          <div className="flex h-full">

            {/* ── Centre: student portal (with registration) ── */}
            {isPersonal && effectiveRole === 'student' && (
              <div className="flex-1 overflow-hidden">
                <StudentPortal backendSessions={studentSessions} />
              </div>
            )}

            {/* ── Centre: lecturer personal view ── */}
            {isPersonal && effectiveRole === 'lecturer' && (
              <div className="flex-1 overflow-y-auto p-5">
                <PersonalCalendar events={events} role={effectiveRole} />
              </div>
            )}

            {/* ── Centre: admin timetable (edge-to-edge) ── */}
            {!isPersonal && (
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                {/* Toolbar strip — docked flush to the grid top */}
                <div
                  className="flex items-center gap-3 px-4 flex-shrink-0 overflow-x-auto"
                  style={{ background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`, minHeight: 44, height: 'auto' }}
                >
                  {/* Left: title + week label */}
                  <div className="flex items-center gap-3 flex-1 min-w-max py-1">
                    <div className="flex-shrink-0">
                      <span style={{ fontFamily: 'Outfit, sans-serif', color: C.text, fontSize: 15, fontWeight: 700 }}>Weekly Timetable</span>
                      <span style={{ marginLeft: 10, color: C.textMuted, fontFamily: 'DM Mono, monospace', fontSize: 12 }}>W03 · Mon 19 – Fri 23 Jan 2026</span>
                    </div>
                    {moveStatus && <span className="hidden xl:inline text-xs" style={{ color: moveStatus.includes('failed') ? C.danger : C.success }}>{moveStatus}</span>}

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
                        <button onClick={addGridRow} className="px-2 py-1 rounded font-semibold" style={{ color: C.accent, border: `1px solid ${C.accent}55`, fontSize: 11 }} title="Add a timetable row">+ Row</button>
                        <button onClick={addGridColumn} className="px-2 py-1 rounded font-semibold" style={{ color: C.success, border: `1px solid ${C.success}55`, fontSize: 11 }} title="Add a timetable column">+ Column</button>
                      </div>
                    )}
                  </div>

                  {/* Right: admin actions + sidebar toggle */}
                  {isAdmin && (
                    <div className="flex items-center gap-2">
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

                {/* Timetable grid — fills all remaining space, edge-to-edge */}
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
                  />
                </div>
              </div>
            )}

            {/* ── Right sidebar (collapsible) ── */}
            {!isPersonal && showSidebar && (
              <div className="flex-shrink-0 flex flex-col" style={{ width: 300, borderLeft: `1px solid ${C.border}`, background: C.surface }}>
                <RightSidebar
                  conflicts={conflicts}
                  highlighted={conflictHighlight}
                  activeConflict={activeConflict}
                  onSelect={setActiveConflict}
                  onDismiss={handleDismissConflict}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Publish modal */}
      {showPublish && <PublishModal conflictCount={conflicts.length} onClose={() => setShowPublish(false)} onPublish={handlePublish} />}

      {/* Session detail popover — admin can edit/delete */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setSelected(null)}>
          <div onClick={e => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-xs" style={{ background: C.surfaceRaised, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ background: selected.session.color }} />
              <div className="text-sm font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text, fontSize: 16 }}>{selected.session.code}</div>
              <span className="ml-auto" style={{ color: C.textMuted, fontSize: 12 }}>{selected.row} · {DAYS[selected.day]}</span>
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
          subtitle={`${sessionForm.row} · ${DAYS[sessionForm.day]} ${TIME_SLOTS[sessionForm.day] ?? ''}`}
          initial={sessionForm.session ? {
            code: sessionForm.session.code, name: sessionForm.session.name,
            staff: sessionForm.session.staff, group: sessionForm.session.group,
            capacity: String(sessionForm.session.capacity), enrolled: String(sessionForm.session.enrolled),
          } : { code: '', name: '', staff: '', group: '', capacity: '30', enrolled: '0' }}
          staffOptions={staffRows}
          onClose={() => setSessionForm(null)}
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
        <ProfileModal role={authRole} onClose={() => setShowProfile(false)} onSave={(p) => setProfile(p)} />
      )}

      {/* Admin Chat Bot */}
      <ChatBot isAdmin={isAdmin} onClose={() => {}} />

    </div>
  );
}
