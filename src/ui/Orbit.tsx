import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { addDays, firstISOMonday, isoWeek, MONTHS, parseISO, weeksInISOYear } from '../lib/dates';
import { byTypeDate } from '../lib/db';
import type { Block } from '../lib/model';
import { adherence } from '../lib/insights';
import { useLive, useNow } from '../hooks';
import { transition, useApp } from '../store';
import { haptic } from '../lib/native';
import { Icon } from './common';

/** The year as an orbit of weeks. Each node glows by that week's plan adherence. */
export function OrbitSheet() {
  const { today } = useNow();
  const date = useApp((s) => s.date), setDate = useApp((s) => s.setDate), close = useApp((s) => s.close), setTab = useApp((s) => s.setTab);
  const reduce = useReducedMotion();
  const [year, setYear] = useState(() => isoWeek(date).year);
  const total = weeksInISOYear(year), first = firstISOMonday(year);
  const blocks = useLive(() => byTypeDate<Block>('block', first, addDays(first, total * 7 - 1)), [first, total], []);
  const weeks = useMemo(() => Array.from({ length: total }, (_, i) => { const mon = addDays(first, i * 7), end = addDays(mon, 6); return { i, mon, adh: adherence(blocks.filter((b) => b.date >= mon && b.date <= end)) }; }), [blocks, first, total]);
  const cur = isoWeek(today), view = isoWeek(date);
  const [sel, setSel] = useState<number>(() => (view.year === year ? view.week - 1 : 0));
  const s = weeks[Math.min(sel, total - 1)];
  const R = 140, C = 170;
  // Nodes sit about 17 px apart, too close to tap reliably, so the whole ring is a dial: touch or drag anywhere and the nearest week is selected.
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.22) return;
    const i = Math.round((((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2) + 1) % 1) * total) % total;
    if (i !== sel) { haptic(); setSel(i); }
  };
  const go = () => { haptic('medium'); close(); transition(() => { setDate(s.mon <= today && addDays(s.mon, 6) >= today ? today : s.mon); }); setTab('plan'); };
  const range = `${parseISO(s.mon).getDate()} ${MONTHS[parseISO(s.mon).getMonth()]} – ${parseISO(addDays(s.mon, 6)).getDate()} ${MONTHS[parseISO(addDays(s.mon, 6)).getMonth()]}`;
  return <>
    <div className="row between">
      <button type="button" className="icon-btn" aria-label="Previous year" onClick={() => { setYear(year - 1); setSel(0); }}><Icon name="left" /></button>
      <span className="big-num" style={{ fontSize: 30 }}>{year}</span>
      <button type="button" className="icon-btn" aria-label="Next year" onClick={() => { setYear(year + 1); setSel(0); }}><Icon name="right" /></button>
    </div>
    <div className="orbit-dial" style={{ position: 'relative', width: '100%', maxWidth: 340, aspectRatio: '1', alignSelf: 'center', touchAction: 'none' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') scrub(e); }}>
      <svg viewBox="0 0 340 340" style={{ width: '100%', height: '100%', overflow: 'visible' }} role="group" aria-label={`Weeks of ${year}`}>
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
        {weeks.map((w) => {
          const a = (w.i / total) * Math.PI * 2 - Math.PI / 2, x = C + R * Math.cos(a), y = C + R * Math.sin(a);
          const isCur = cur.year === year && cur.week - 1 === w.i, isSel = sel === w.i, v = w.adh?.value ?? 0;
          return (
            <motion.g key={`${year}-${w.i}`} initial={reduce ? false : { opacity: 0, scale: 0.2 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 22, delay: reduce ? 0 : w.i * 0.012 }} style={{ transformOrigin: `${x}px ${y}px`, cursor: 'pointer' }}
              role="button" tabIndex={0} aria-label={`Week ${w.i + 1}${w.adh ? `, ${Math.round(v * 100)} percent done` : ', nothing planned'}${isCur ? ', this week' : ''}`} aria-pressed={isSel}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(w.i); } }}>
              <circle cx={x} cy={y} r="16" fill="transparent" />
              {w.adh && <circle cx={x} cy={y} r={5 + v * 5} fill="var(--accent)" opacity={0.12 + v * 0.18} />}
              <circle cx={x} cy={y} r={isSel ? 6 : 4} fill={w.adh ? 'var(--accent)' : 'rgba(255,255,255,.22)'} opacity={w.adh ? 0.35 + v * 0.65 : 1} />
              {isCur && <circle cx={x} cy={y} r="10" fill="none" stroke="#fff" strokeWidth="1.2" />}
              {isSel && <circle cx={x} cy={y} r="13" fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
            </motion.g>
          );
        })}
        {[0, 3, 6, 9].map((m) => { const a = (m / 12) * Math.PI * 2 - Math.PI / 2; return <text key={m} x={C + (R - 26) * Math.cos(a)} y={C + (R - 26) * Math.sin(a) + 4} textAnchor="middle" fontFamily="Space Mono, monospace" fontSize="10" fill="#98A8C6">{MONTHS[m]}</text>; })}
      </svg>
      <div className="ring-center" aria-live="polite">
        <span className="label">Week {s.i + 1}</span>
        <span className="big-num" style={{ fontSize: 40 }}>{s.adh ? `${Math.round(s.adh.value * 100)}%` : '—'}</span>
        <span className="small muted">{range}</span>
        <span className="small muted">{s.adh ? `${s.adh.n} blocks planned` : 'nothing planned'}</span>
      </div>
    </div>
    <div className="row">
      <button type="button" className="icon-btn" aria-label="Select previous week" onClick={() => setSel((sel + total - 1) % total)}><Icon name="left" /></button>
      <button type="button" className="btn primary grow" onClick={go}>Open week {s.i + 1}</button>
      <button type="button" className="icon-btn" aria-label="Select next week" onClick={() => setSel((sel + 1) % total)}><Icon name="right" /></button>
    </div>
  </>;
}
