import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { addDays, daysBetween, DOW, dow, mondayOf, weekDays } from '../lib/dates';
import { byType, byTypeDate } from '../lib/db';
import type { Habit, HabitLog } from '../lib/model';
import { automaticityCurve, consistency, forgivingStreak, isDone, isDue, type LogMap } from '../lib/habits';
import { useLive, useNow } from '../hooks';
import { useApp } from '../store';
import { setHabitLog, toggleHabit } from '../data';
import { haptic } from '../lib/native';
import { ev } from '../evidence';
import { Check, Count, Icon, SPRING, Why } from './common';

function Curve({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="small muted">The curve appears after a couple of days.</p>;
  const W = 300, H = 70, n = points.length - 1;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${((i / n) * W).toFixed(1)} ${(H - 4 - v * (H - 10)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 70, display: 'block' }} role="img" aria-label={`Modelled automaticity, now about ${Math.round(points[n] * 100)} percent`}>
      <line x1="0" x2={W} y1={H - 4 - 0.95 * (H - 10)} y2={H - 4 - 0.95 * (H - 10)} stroke="rgba(255,255,255,.18)" strokeDasharray="3 5" />
      <motion.path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
    </svg>
  );
}
function Heat({ habit, logs, today, onToggle }: { habit: Habit; logs: LogMap; today: string; onToggle: (d: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const start = mondayOf(addDays(today, -7 * 25));
  const days = useMemo(() => Array.from({ length: 26 * 7 }, (_, i) => addDays(start, i)), [start]);
  // Ripple outward from the tapped day. Uses the Web Animations API on transform and opacity only, with no re-render.
  const ripple = (i: number) => {
    if (reduce || !ref.current) return;
    const cells = ref.current.children;
    for (let k = 0; k < cells.length; k++) {
      const dist = Math.hypot(Math.floor(k / 7) - Math.floor(i / 7), (k % 7) - (i % 7));
      if (dist < 8) cells[k].animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.55)', opacity: 0.45, offset: 0.35 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, delay: dist * 26, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  };
  return (
    <div className="heat" ref={ref} role="group" aria-label={`${habit.name}, last 26 weeks. Tap a day to change it.`}>
      {days.map((d, i) => {
        const on = isDone(habit, logs[d]), future = d > today;
        return <i key={d} role="button" tabIndex={-1} aria-label={`${d}${on ? ', done' : ''}`}
          onClick={() => { if (future) return; haptic(); ripple(i); onToggle(d); }}
          style={{ background: on ? 'var(--accent)' : future ? 'transparent' : !isDue(habit, d) ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.07)', outline: d === today ? '1px solid rgba(255,255,255,.5)' : 'none', cursor: future ? 'default' : 'pointer', transition: 'background .3s' }} />;
      })}
    </div>
  );
}

export function Habits() {
  const { today } = useNow();
  const open = useApp((s) => s.open);
  const [expanded, setExpanded] = useState<string | null>(null);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived).sort((a, b) => a.order - b.order), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', addDays(today, -420), today), [today], []);
  const byHabit = useMemo(() => { const m: Record<string, LogMap> = {}; for (const l of logs) (m[l.habitId] ||= {})[l.date] = l.value; return m; }, [logs]);
  const week = weekDays(mondayOf(today));
  return (
    <div className="page">
      <header className="row between">
        <div className="col" style={{ gap: 3 }}><span className="label">Consistency over streaks</span><h1>Habits</h1></div>
        <button type="button" className="icon-btn on" aria-label="Add habit" onClick={() => open('habit')}><Icon name="plus" /></button>
      </header>
      {habits.length === 0 && <div className="card col" style={{ alignItems: 'center', textAlign: 'center', padding: 28 }}>
        <p>No habits yet.</p><p className="small muted">Start with one, tied to something you already do every day.</p>
        <button type="button" className="btn primary" onClick={() => open('habit')}>Add your first habit</button>
      </div>}
      {habits.map((h) => {
        const L = byHabit[h.id] || {};
        const cur = L[today], done = isDone(h, cur), streak = forgivingStreak(h, L, today), cons = consistency(h, L, today);
        const isOpen = expanded === h.id;
        const age = daysBetween(h.createdOn, today) + 1;
        return (
          <motion.section layout="position" transition={SPRING} key={h.id} className="card col" aria-label={h.name}>
            <div className="row">
              {h.target.kind === 'count'
                ? <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="icon-btn" aria-label={`One less ${h.target.unit || h.name}`} onClick={() => void setHabitLog(h, today, Math.max(0, (cur || 0) - 1))}>−</button>
                    <span className="mono" style={{ minWidth: 44, textAlign: 'center' }} aria-live="polite">{cur || 0}/{h.target.count}</span>
                    <button type="button" className="icon-btn on" aria-label={`One more ${h.target.unit || h.name}`} onClick={() => { haptic((cur || 0) + 1 === h.target.count ? 'success' : 'light'); void setHabitLog(h, today, (cur || 0) + 1); }}>+</button>
                  </div>
                : <Check big on={done} label={`Mark ${h.name} done today`} onToggle={() => void toggleHabit(h, today, cur)} />}
              <button type="button" className="col grow" style={{ gap: 1, textAlign: 'left', minHeight: 44, justifyContent: 'center' }} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : h.id)}>
                <span style={{ fontFamily: 'var(--f-head)', fontSize: 17, fontWeight: 500 }}>{h.name}</span>
                <span className="small muted">{h.cue || (h.target.kind === 'weekly' ? `${h.target.perWeek}× a week` : 'Add a cue to anchor it')}</span>
              </button>
              <div className="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                <span className="mono accent" style={{ fontSize: 18 }}><Count value={streak} /></span>
                <span className="label" style={{ fontSize: 9.5 }}>{h.target.kind === 'weekly' ? 'weeks' : 'streak'}</span>
              </div>
            </div>
            <div className="dots" role="group" aria-label={`${h.name} this week`}>
              {week.map((d, i) => { const on = isDone(h, L[d]), rest = h.target.kind !== 'weekly' && !isDue(h, d) && d >= h.createdOn; return (
                <button type="button" key={d} disabled={d > today} aria-pressed={on} aria-label={`${DOW[i]}${on ? ', done' : ''}${rest ? ', rest day' : ''}`} className={`${on ? 'on' : ''}${rest ? ' rest' : ''}${d === today ? ' today' : ''}`}
                  onClick={() => { haptic(); void toggleHabit(h, d, L[d]); }}>{DOW[i][0]}<i /></button>); })}
            </div>
            <AnimatePresence initial={false}>
              {isOpen && <motion.div className="col" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={SPRING} style={{ overflow: 'hidden' }}>
                <div className="row" style={{ gap: 24 }}>
                  <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 30 }}>{cons == null ? '—' : <><Count value={Math.round(cons * 100)} />%</>}</span><span className="label">last 4 weeks</span></div>
                  <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 30 }}>{age}</span><span className="label">days in</span></div>
                </div>
                <div className="col" style={{ gap: 4 }}><span className="label">Automaticity (modelled)</span><Curve points={automaticityCurve(h, L, today)} />
                  <p className="small muted">An illustration of the typical curve, not a measurement of you. The dashed line is the level the study's median person reached after about 66 days; individuals ranged from 18 to 254.</p></div>
                <Heat habit={h} logs={L} today={today} onToggle={(d) => void toggleHabit(h, d, L[d])} />
                {h.restDays.length > 0 && <p className="small muted">Rest days: {h.restDays.sort().map((d) => DOW[d]).join(', ')}. They never count as a miss.</p>}
                <button type="button" className="btn" onClick={() => open('habit', { id: h.id })}>Edit habit</button>
              </motion.div>}
            </AnimatePresence>
          </motion.section>
        );
      })}
      {habits.length > 0 && <p className="small muted" style={{ textAlign: 'center' }}>Missed a day? It happens. One miss does not reset your streak; just pick it up at the next cue.</p>}
      <Why source={ev('habit').source}>{ev('habit').claim}</Why>
    </div>
  );
}
export { dow };
