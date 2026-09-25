import React, { useEffect, useState } from 'react';
import { useTheme } from './theme';
import { planning } from './api/client';
import type { AcademicTerm, Holiday, Department } from './api/client';

// Planning master data (SCH-FR-01): terms, weekday holidays, departments.
// Same theme/layout family as Sections/Rooms screens.
export default function PlanningScreen() {
  const { tokens: C } = useTheme();
  const [live, setLive] = useState(false);
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [deps, setDeps] = useState<Department[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [tName, setTName] = useState('');
  const [tStart, setTStart] = useState('');
  const [tEnd, setTEnd] = useState('');
  const [hLabel, setHLabel] = useState('');
  const [hDay, setHDay] = useState('0');
  const [dName, setDName] = useState('');
  const [dCode, setDCode] = useState('');

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500); };
  const err = (e: unknown, fallback: string) => flash(e instanceof Error ? e.message : fallback);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, h, d] = await Promise.all([
          planning.terms(), planning.holidays(), planning.departments()]);
        if (!cancelled) { setTerms(t); setHolidays(h); setDeps(d); setLive(true); }
      } catch { /* offline */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const input: React.CSSProperties = { padding: '7px 10px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, outline: 'none' };

  return (
    <div className="h-full overflow-y-auto" style={{ background: C.bg }}>
      <div className="max-w-5xl mx-auto px-5 py-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-sm font-bold" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>
            Planning — Terms, Holidays & Departments {live && <span style={{ color: C.success, fontSize: 11 }}>● API live</span>}
          </div>
        </div>
        {msg && <div className="px-3 py-2 rounded-lg mb-3" style={{ background: C.dangerBg, color: C.danger, fontSize: 12 }}>{msg}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="text-xs font-bold mb-2" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>Academic terms</div>
            <div className="space-y-1.5 mb-3">
              {terms.map(t => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}` }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: C.text }}>{t.name}</div>
                    <div className="text-[10px]" style={{ color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>{t.start} → {t.end}</div>
                  </div>
                  {t.is_active
                    ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: C.successBg, color: C.success }}>ACTIVE</span>
                    : <button onClick={() => planning.activateTerm(t.id).then(u => setTerms(prev => prev.map(x => x.id === u.id ? u : { ...x, is_active: false }))).catch(e => err(e, 'Activate failed'))} className="text-[10px] hover:opacity-70" style={{ color: C.accent }}>Activate</button>}
                  <button onClick={() => planning.deleteTerm(t.id).then(() => setTerms(prev => prev.filter(x => x.id !== t.id))).catch(e => err(e, 'Delete failed'))} className="text-[10px] hover:opacity-60" style={{ color: C.textMuted }}>✕</button>
                </div>
              ))}
              {terms.length === 0 && <div className="text-[11px]" style={{ color: C.textMuted }}>No terms yet.</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <input value={tName} onChange={e => setTName(e.target.value)} placeholder="Name" style={{ ...input, width: 130 }} />
              <input type="date" value={tStart} onChange={e => setTStart(e.target.value)} style={input} />
              <input type="date" value={tEnd} onChange={e => setTEnd(e.target.value)} style={input} />
              <button onClick={() => planning.createTerm({ name: tName.trim(), start: tStart, end: tEnd }).then(nt => { setTerms(prev => [...prev, nt]); setTName(''); }).catch(e => err(e, 'Overlapping or invalid range'))} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: C.accent, color: '#fff' }}>Add</button>
            </div>
            <div className="mt-1" style={{ fontSize: 10, color: C.textMuted }}>Overlapping ranges are rejected.</div>
          </div>

          <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="text-xs font-bold mb-2" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>Weekday holidays (whole day closed)</div>
            <div className="space-y-1.5 mb-3">
              {holidays.map(h => (
                <div key={h.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}` }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: C.text }}>{h.label}</div>
                    <div className="text-[10px]" style={{ color: C.textMuted }}>Day {h.day}{h.reason ? ` · ${h.reason}` : ''}</div>
                  </div>
                  <button onClick={() => planning.removeHoliday(h.id).then(() => setHolidays(prev => prev.filter(x => x.id !== h.id))).catch(e => err(e, 'Delete failed'))} className="text-[10px] hover:opacity-60" style={{ color: C.textMuted }}>✕</button>
                </div>
              ))}
              {holidays.length === 0 && <div className="text-[11px]" style={{ color: C.textMuted }}>No holidays — teaching days are all open.</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <input value={hLabel} onChange={e => setHLabel(e.target.value)} placeholder="Label" style={{ ...input, width: 130 }} />
              <select value={hDay} onChange={e => setHDay(e.target.value)} style={input}>
                {[0, 1, 2, 3, 4].map(d => <option key={d} value={String(d)}>Day {d}</option>)}
              </select>
              <button onClick={() => planning.addHoliday({ label: hLabel.trim(), day: parseInt(hDay, 10) }).then(nh => { setHolidays(prev => [...prev, nh]); setHLabel(''); }).catch(e => err(e, 'Add failed'))} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: C.accent, color: '#fff' }}>Add</button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-4 mt-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <div className="text-xs font-bold mb-2" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>Departments</div>
          <div className="flex gap-2 flex-wrap mb-3">
            {deps.map(d => (
              <span key={d.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}`, color: C.text }}>
                {d.name} <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.textMuted }}>{d.code}</span>
                <button onClick={() => planning.removeDepartment(d.id).then(() => setDeps(prev => prev.filter(x => x.id !== d.id))).catch(e => err(e, 'Delete failed'))} className="hover:opacity-60" style={{ color: C.textMuted }}>✕</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <input value={dName} onChange={e => setDName(e.target.value)} placeholder="Name" style={{ ...input, width: 170 }} />
            <input value={dCode} onChange={e => setDCode(e.target.value)} placeholder="Code" style={{ ...input, width: 90 }} />
            <button onClick={() => planning.addDepartment({ name: dName.trim(), code: dCode.trim() }).then(nd => { setDeps(prev => [...prev, nd]); setDName(''); setDCode(''); }).catch(e => err(e, 'Add failed'))} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: C.accent, color: '#fff' }}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}
