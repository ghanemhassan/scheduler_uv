import React, { useEffect, useState } from 'react';
import { useTheme } from '../theme';
import { staff as staffApi } from '../api/client';

interface Entry { id: string; staff: string; day: number; slot: number | null; reason: string }

// Lecturer submits their own unavailable windows (SCH-FR-03).
// Shown inside the lecturer personal view; admins file via API.
export default function StaffAvailability({ days, slots }: { days: string[]; slots: string[] }) {
  const { tokens: C } = useTheme();
  const [items, setItems] = useState<Entry[]>([]);
  const [day, setDay] = useState('0');
  const [slot, setSlot] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await staffApi.availability();
      setItems(Array.isArray(list) ? list : []);
    } catch { /* offline */ }
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    try {
      const created = await staffApi.addUnavailability({
        day: parseInt(day, 10),
        ...(slot === '' ? {} : { slot: parseInt(slot, 10) }),
        reason: reason.trim(),
      });
      setItems(prev => [...prev, created]);
      setReason('');
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Submit failed');
    }
  };
  const remove = async (id: string) => {
    setItems(prev => prev.filter(x => x.id !== id));
    try { await staffApi.removeUnavailability(id); } catch { /* offline */ }
  };

  const input: React.CSSProperties = { padding: '7px 10px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, outline: 'none' };

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
      <div className="text-xs font-bold mb-1" style={{ fontFamily: 'Outfit, sans-serif', color: C.text }}>My unavailable times</div>
      <div className="mb-2" style={{ fontSize: 11, color: C.textMuted }}>New placements at these times will be blocked with AVAILABILITY.</div>
      {msg && <div className="px-3 py-2 rounded-lg mb-2" style={{ background: C.dangerBg, color: C.danger, fontSize: 12 }}>{msg}</div>}
      <div className="space-y-1.5 mb-3">
        {items.map(u => (
          <div key={u.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderSub}` }}>
            <span className="text-xs font-semibold" style={{ color: C.text }}>
              {days[u.day] ?? `Day ${u.day}`} {u.slot === null || u.slot === undefined ? '· whole day' : `· ${slots[u.slot] ?? ''}`}
            </span>
            {u.reason && <span className="text-[11px] truncate" style={{ color: C.textMuted }}>· {u.reason}</span>}
            <button onClick={() => void remove(u.id)} className="ml-auto text-[10px] hover:opacity-60" style={{ color: C.textMuted }}>✕</button>
          </div>
        ))}
        {items.length === 0 && <div className="text-[11px]" style={{ color: C.textMuted }}>No exceptions — you are bookable every teaching day.</div>}
      </div>
      <div className="flex gap-2 flex-wrap">
        <select value={day} onChange={e => setDay(e.target.value)} style={input}>
          {days.map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
        </select>
        <select value={slot} onChange={e => setSlot(e.target.value)} style={input}>
          <option value="">Whole day</option>
          {slots.map((s, i) => <option key={s} value={String(i)}>{s}</option>)}
        </select>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" style={{ ...input, width: 160 }} />
        <button onClick={() => void add()} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: C.accent, color: '#fff' }}>Add</button>
      </div>
    </div>
  );
}
