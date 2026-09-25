import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useTheme } from './theme';
import {
  analytics as analyticsApi, conflicts as conflictsApi, rooms as roomsApi,
  sections as sectionsApi, timetable as timetableApi, versions as versionsApi,
} from './api/client';
import type { Conflict, Room, Section, ScheduleVersion, TimetableView } from './api/client';

// ─── Live Analytics dashboards (SCH-FR-10 + AI metrics), same theme as other screens ───

// Backend conflict types → dashboard labels
const CONFLICT_LABELS: { match: string[]; label: string; color: string }[] = [
  { match: ['double_booking'], label: 'Room Conflict', color: '#ef4444' },
  { match: ['capacity'], label: 'Capacity Conflict', color: '#f59e0b' },
  { match: ['equipment'], label: 'Equipment Conflict', color: '#06b6d4' },
  { match: ['staff_overlap'], label: 'Staff Availability Conflict', color: '#8b5cf6' },
  { match: ['closure'], label: 'Room Closure Conflict', color: '#64748b' },
  { match: ['student_group'], label: 'Student Group Conflict', color: '#10b981' },
  { match: ['room_type'], label: 'Room Type Conflict', color: '#f97316' },
];

const UNDERUTIL_PCT = 40;

function Card({ children }: { children: React.ReactNode }) {
  const { tokens: C } = useTheme();
  return (
    <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const { tokens: C } = useTheme();
  return (
    <div className="text-sm font-bold mb-3" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>
      {children}
    </div>
  );
}

function Donut({ title, data }: { title: string; data: { label: string; value: number; color: string }[] }) {
  const { tokens: C } = useTheme();
  const shown = data.filter(d => d.value > 0);
  const total = shown.reduce((n, d) => n + d.value, 0);
  return (
    <Card>
      <div className="text-xs font-bold mb-1" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>{title}</div>
      {total === 0 ? (
        <div className="flex items-center justify-center" style={{ height: 150, fontSize: 12, color: C.textMuted }}>No data</div>
      ) : (
        <>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip contentStyle={{ background: C.tooltipBg, border: `1px solid ${C.tooltipBorder}`, color: C.tooltipText, fontSize: 12, borderRadius: 8 }} />
                <Pie data={shown} dataKey="value" nameKey="label" innerRadius={42} outerRadius={62} paddingAngle={3} strokeWidth={0}>
                  {shown.map(d => <Cell key={d.label} fill={d.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 space-y-1">
            {shown.map(d => (
              <div key={d.label} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                <span className="flex-1" style={{ fontSize: 11, color: C.textSub }}>{d.label}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 700, color: C.text }}>{d.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  const { tokens: C } = useTheme();
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}` }}>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 700, color: C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMuted }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.textMuted }}>{sub}</div>}
    </div>
  );
}

export default function AnalyticsScreen() {
  const { tokens: C } = useTheme();
  const [live, setLive] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [grid, setGrid] = useState<Record<string, TimetableView> | null>(null);
  const [summary, setSummary] = useState<{
    avg_utilization: number; rooms_at_capacity: number; total_conflicts: number;
    utilization_by_room: { name: string; utilization: number }[];
    utilization_by_day: { name: string; utilization: number }[];
    utilization_by_hour: { name: string; utilization: number }[];
  } | null>(null);
  const [equipment, setEquipment] = useState<{ room: string; equipment: string; total: number; working: number; broken: number; shortfall_pct: number }[]>([]);
  const [validation, setValidation] = useState<{ total: number; errors: number; warnings: number; issues: { severity: string; code: string; message: string; where: string }[] } | null>(null);
  const [edits, setEdits] = useState<{ total_edits: number; active_days: number; avg_edits_per_day: number; by_action: Record<string, number> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, r, s, v, g, a, e, vd, ed] = await Promise.all([
          conflictsApi.list(), roomsApi.list(), sectionsApi.list(),
          versionsApi.list(), timetableApi.full(), analyticsApi.summary(),
          analyticsApi.equipment(), analyticsApi.validation(), analyticsApi.edits(),
        ]);
        if (!cancelled) {
          setConflicts(c); setRooms(r); setSections(s);
          setVersions(v); setGrid(g); setSummary(a);
          setEquipment(e); setValidation(vd); setEdits(ed); setLive(true);
        }
      } catch { /* offline — cards show zeros */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Donut shares (live) ──
  const roomsByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    rooms.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const colors: Record<string, string> = { Available: '#10b981', Maintenance: '#f59e0b', Closed: '#ef4444' };
    return Object.entries(counts).map(([label, value]) => ({ label, value, color: colors[label] ?? '#94a3b8' }));
  }, [rooms]);
  const conflictRows = useMemo(() => {
    const counts: Record<string, number> = {};
    conflicts.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
    return CONFLICT_LABELS
      .map(l => ({ label: l.label, value: l.match.reduce((n, t) => n + (counts[t] || 0), 0), color: l.color }))
      .filter(r => r.value > 0 || ['Room Conflict', 'Capacity Conflict', 'Equipment Conflict', 'Staff Availability Conflict', 'Room Closure Conflict'].includes(r.label));
  }, [conflicts]);

  // ── 2. Room utilization ──
  const roomStats = useMemo(() => {
    const rows = (summary?.utilization_by_room ?? []).map(u => {
      let used = 0, total = 0;
      const days = grid?.rooms?.[u.name];
      if (days) Object.values(days).forEach(slots => {
        const cells = slots && typeof slots === 'object' ? Object.values(slots) : [slots];
        cells.forEach(s => { total += 1; if (s) used += 1; });
      });
      return { name: u.name, pct: u.utilization, used, total };
    }).sort((a, b) => b.pct - a.pct);
    return rows;
  }, [summary, grid]);
  const mostUsed = roomStats[0];
  const leastUsed = roomStats[roomStats.length - 1];

  // ── 3. Capacity ──
  const capacity = useMemo(() => {
    const capByRoom: Record<string, number> = {};
    rooms.forEach(r => { capByRoom[r.name] = r.capacity; });
    let waste = 0, overloaded = 0, placed = 0;
    Object.entries(grid?.rooms ?? {}).forEach(([row, days]) => {
      Object.values(days ?? {}).forEach(slots => {
        const cells = slots && typeof slots === 'object' ? Object.values(slots) : [slots];
        cells.forEach(s => {
          if (!s) return;
          placed += 1;
          const sess = s as { capacity?: number; enrolled?: number };
          const cap = capByRoom[row] ?? sess.capacity ?? 0;
          const enrolled = sess.enrolled ?? 0;
          if (enrolled > cap) overloaded += 1;
          else waste += Math.max(0, cap - enrolled);
        });
      });
    });
    const under = roomStats.filter(r => r.pct < UNDERUTIL_PCT).length;
    // waste per room (top wasters) for the chart
    const wasteByRoom: Record<string, number> = {};
    Object.entries(grid?.rooms ?? {}).forEach(([row, days]) => {
      Object.values(days ?? {}).forEach(slots => {
        const cells = slots && typeof slots === 'object' ? Object.values(slots) : [slots];
        cells.forEach(s => {
          if (!s) return;
          const sess = s as { enrolled?: number };
          const cap = capByRoom[row] ?? 0;
          wasteByRoom[row] = (wasteByRoom[row] ?? 0) + Math.max(0, cap - (sess.enrolled ?? 0));
        });
      });
    });
    const wasteTop = Object.entries(wasteByRoom)
      .map(([name, seats]) => ({ name, seats }))
      .sort((a, b) => b.seats - a.seats)
      .slice(0, 8);
    return { waste, overloaded, placed, under, avg: summary?.avg_utilization ?? 0, wasteTop };
  }, [grid, rooms, summary, roomStats]);

  // ── 4. Scheduling ──
  const scheduling = useMemo(() => {
    const ids = new Set<string>();
    Object.values(grid ?? {}).forEach(view => {
      Object.values(view ?? {}).forEach(days => {
        Object.values(days ?? {}).forEach(slots => {
          const cells = slots && typeof slots === 'object' ? Object.values(slots) : [slots];
          cells.forEach(s => { const id = (s as { id?: string } | null)?.id; if (id) ids.add(id); });
        });
      });
    });
    const scheduled = sections.filter(s => ids.has(s.id) || ids.has(s.id.replace(/^sec-/, ''))).length;
    return {
      total: sections.length, scheduled,
      unallocated: Math.max(0, sections.length - scheduled),
      published: versions.filter(v => v.status === 'published').length,
      draft: versions.filter(v => v.status === 'draft').length,
    };
  }, [sections, grid, versions]);

  // ── 5. AI recommendation metrics (from ranked alternatives on open conflicts) ──
  const ai = useMemo(() => {
    const feasible = conflicts.reduce((n, c) => n + (c.alternatives?.length ?? 0), 0);
    const rejected = conflicts.filter(c => !(c.alternatives?.length)).length;
    const withAlt = conflicts.filter(c => (c.alternatives?.length ?? 0) > 0).length;
    return {
      feasible, rejected,
      satisfaction: conflicts.length ? Math.round((withAlt / conflicts.length) * 100) : 100,
    };
  }, [conflicts]);

  const tip = { background: C.tooltipBg, border: `1px solid ${C.tooltipBorder}`, color: C.tooltipText, fontSize: 12, borderRadius: 8 };

  return (
    <div className="h-full overflow-y-auto" style={{ background: C.bg }}>
    <div className="max-w-6xl mx-auto px-5 py-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-sm font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>
          Analytics Dashboard {live && <span style={{ color: C.success, fontSize: 11 }}>● API live</span>}
        </div>
        {!live && <span style={{ color: C.warning, fontSize: 11 }}>offline — waiting for backend…</span>}
      </div>

      {/* 1. Conflict Analytics */}
      <SectionTitle>1 · Conflict Analytics — open conflicts per type</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        {conflictRows.map(r => (
          <Card key={r.label}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: r.color }} />
              <span style={{ fontSize: 11, color: C.textMuted }}>{r.label}</span>
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 700, color: C.text }}>{r.value}</div>
          </Card>
        ))}
      </div>
      {conflicts.length > 0 && (
        <Card>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={conflictRows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={C.borderSub} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 9 }} interval={0} angle={-18} textAnchor="end" height={52} />
                <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tip} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {conflictRows.map(r => <Cell key={r.label} fill={r.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 mb-6">
        <Donut title="Conflict share by type" data={conflictRows.map(r => ({ label: r.label, value: r.value, color: r.color }))} />
        <Donut
          title="Sections — scheduled vs unallocated"
          data={[
            { label: 'Scheduled', value: scheduling.scheduled, color: C.success },
            { label: 'Unallocated', value: scheduling.unallocated, color: C.warning },
          ]}
        />
        <Donut title="Rooms by status" data={roomsByStatus} />
      </div>

      {/* 2. Room Utilization */}
      <SectionTitle>2 · Room Utilization — usage share per room</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Most used" value={mostUsed ? `${mostUsed.name}` : '—'} sub={mostUsed ? `${mostUsed.pct}% · ${mostUsed.used}/${mostUsed.total} slots` : undefined} />
        <Stat label="Least used" value={leastUsed ? `${leastUsed.name}` : '—'} sub={leastUsed ? `${leastUsed.pct}% · ${leastUsed.used}/${leastUsed.total} slots` : undefined} />
        <Stat label="Rooms tracked" value={roomStats.length} />
        <Stat label="Avg utilization" value={`${capacity.avg}%`} />
      </div>
      <Card>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={roomStats.slice(0, 12)} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={C.borderSub} strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 9 }} interval={0} angle={-22} textAnchor="end" height={56} />
              <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={tip} />
              <Bar dataKey="pct" fill={C.accent} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2" style={{ fontSize: 11, color: C.textMuted }}>Top 12 rooms by utilization · hours = filled slots per room</div>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 mb-6">
        <Card>
          <div className="text-xs font-bold mb-2" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>Peak times — sessions per hour</div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={summary?.utilization_by_hour ?? []} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="peakFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.accent} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={C.accent} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.borderSub} strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 9 }} />
                <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} />
                <Tooltip contentStyle={tip} />
                <Area type="monotone" dataKey="utilization" name="Load %" stroke={C.accent} strokeWidth={2} fill="url(#peakFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="text-xs font-bold mb-2" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>Peak days — load per weekday</div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary?.utilization_by_day ?? []} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke={C.borderSub} strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 10 }} />
                <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} />
                <Tooltip contentStyle={tip} />
                <Bar dataKey="utilization" name="Load %" fill={C.violet} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* 3. Capacity */}
      <SectionTitle>3 · Capacity — waste, load and fit</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Capacity waste (empty seats in placed sessions)" value={capacity.waste} />
        <Stat label="Avg room occupancy" value={`${capacity.avg}%`} />
        <Stat label="Sessions over capacity" value={capacity.overloaded} sub="enrolled > room capacity" />
        <Stat label={`Underutilized rooms (<${UNDERUTIL_PCT}%)`} value={capacity.under} />
      </div>
      {capacity.wasteTop.length > 0 && (
        <Card>
          <div className="text-xs font-bold mb-2" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>Top wasters — empty seats per room</div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={capacity.wasteTop} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={C.borderSub} strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: C.textMuted, fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: C.textMuted, fontSize: 10 }} width={80} />
                <Tooltip contentStyle={tip} />
                <Bar dataKey="seats" name="Empty seats" fill={C.warning} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <div className="mb-6" />

      {/* 4. Scheduling */}
      <SectionTitle>4 · Scheduling — sections and versions</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Stat label="Total sections" value={scheduling.total} />
        <Stat label="Scheduled sections" value={scheduling.scheduled} sub="placed in grid" />
        <Stat label="Unallocated sections" value={scheduling.unallocated} sub="no grid cell" />
        <Stat label="Published versions" value={scheduling.published} />
        <Stat label="Draft versions" value={scheduling.draft} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Admin edits (total)" value={edits?.total_edits ?? 0} sub="timetable/version/conflict writes" />
        <Stat label="Avg edits / active day" value={edits?.avg_edits_per_day ?? 0} />
      </div>

      {/* 5. AI Recommendation Metrics */}
      <SectionTitle>5 · AI Recommendation Metrics — feasible vs blocked</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Feasible candidates" value={ai.feasible} sub="ranked alternatives on open conflicts" />
        <Stat label="Rejected (no feasible fix)" value={ai.rejected} sub="conflicts with zero alternatives" />
        <Stat label="Conflict reasons" value={conflicts.length} sub="open conflicts by type (see §1)" />
        <Stat label="Preference satisfaction" value={`${ai.satisfaction}%`} sub="conflicts with ≥1 alternative" />
      </div>
      <Card>
        <div className="flex items-center justify-between mb-1.5">
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Preference satisfaction</span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 700, color: C.success }}>{ai.satisfaction}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: C.borderSub }}>
          <div className="h-full rounded-full" style={{ width: `${ai.satisfaction}%`, background: C.success }} />
        </div>
        <div className="mt-1.5" style={{ fontSize: 11, color: C.textMuted }}>Share of open conflicts that have at least one feasible alternative</div>
      </Card>
      <div className="mb-6" />

      {/* 6. Equipment Bottlenecks */}
      <SectionTitle>6 · Equipment Bottlenecks — working vs total units per lab</SectionTitle>
      <Card>
        {equipment.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMuted }}>No inventoried equipment.</div>
        ) : (
          <div className="space-y-2">
            {equipment.map(row => (
              <div key={`${row.room}-${row.equipment}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1" style={{ fontSize: 12, color: C.text }}>{row.room} · {row.equipment}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 700, color: row.broken > 0 ? C.warning : C.success }}>
                    {row.working}/{row.total} working
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: C.borderSub }}>
                  <div className="h-full rounded-full" style={{ width: `${row.total ? Math.round((row.working / row.total) * 100) : 0}%`, background: row.broken > 0 ? C.warning : C.success }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="mb-6" />

      {/* 7. Data Validation */}
      <SectionTitle>7 · Data Validation — planning data quality report</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Total issues" value={validation?.total ?? 0} />
        <Stat label="Errors" value={validation?.errors ?? 0} sub="over capacity" />
        <Stat label="Warnings" value={validation?.warnings ?? 0} sub="missing staff/group/capacity" />
        <Stat label="Status" value={(validation?.errors ?? 0) === 0 ? 'Clean' : 'Fix needed'} />
      </div>
      <Card>
        {!validation || validation.issues.length === 0 ? (
          <div style={{ fontSize: 12, color: C.success }}>✓ No data issues — sessions have staff, groups and fit room capacity.</div>
        ) : (
          <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 220 }}>
            {validation.issues.map((it, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0" style={{
                  fontFamily: 'DM Mono, monospace',
                  background: it.severity === 'error' ? C.dangerBg : it.severity === 'warning' ? C.warningBg : C.infoBg,
                  color: it.severity === 'error' ? C.danger : it.severity === 'warning' ? C.warning : C.info,
                }}>{it.severity.toUpperCase()}</span>
                <span className="flex-1" style={{ fontSize: 11, color: C.text }}>{it.message}</span>
                {it.where && <span style={{ fontSize: 10, color: C.textMuted }}>{it.where}</span>}
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="pb-6" />
    </div>
    </div>
  );
}
