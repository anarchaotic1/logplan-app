import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { addDays, daysBetween, DOW, mondayOf, weekDays } from '../lib/dates';
import { byType, byTypeDate } from '../lib/db';
import type { Habit, HabitLog } from '../lib/model';
import { consistency, forgivingStreak, isDone, isDue, type LogMap } from '../lib/habits';
import { useLive, useNow, useReduce } from '../hooks';
import { useApp } from '../store';
import { setHabitLog } from '../data';
import { haptic } from '../lib/native';
import { tickHabit } from './act';
import { Check, Count, Icon, SPRING } from './common';
import { MiniRing } from './Ring';

const WEEKS = 53;
/** A year at a glance. It is a picture, not a control: past days are edited from the week row or from the Calendar. */
function Heat({ habit, logs, today, pulse }: { habit: Habit; logs: LogMap; today: string; pulse: number }) {
  const ref = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null);
  const reduce = useReduce();
  const start = mondayOf(addDays(today, -7 * (WEEKS - 1)));
  const days = useMemo(() => Array.from({ length: WEEKS * 7 }, (_, i) => addDays(start, i)), [start]);
  const doneCount = days.filter((d) => d <= today && isDone(habit, logs[d])).length;
  useEffect(() => { if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth; }, []);
  // When today is ticked, a ripple spreads from today's cell. Web Animations on transform and opacity only, no re-render.
  useEffect(() => {
    if (!pulse || reduce || !ref.current) return;
    const cells = ref.current.children, i = days.indexOf(today);
    for (let k = Math.max(0, i - 7 * 14); k < cells.length; k++) {
      const dist = Math.hypot(Math.floor(k / 7) - Math.floor(i / 7), (k % 7) - (i % 7));
      if (dist < 12) cells[k].animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.5)', opacity: 0.4, offset: 0.35 }, { transform: 'scale(1)', opacity: 1 }], { duration: 440, delay: dist * 30, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);
  return (
    <div className="heat-scroll" ref={scroll} tabIndex={0} role="img" aria-label={`${habit.name}, last ${WEEKS} weeks: done on ${doneCount} days. Scrolls sideways.`}>
      <div className="heat" ref={ref} aria-hidden="true">
        {days.map((d) => <i key={d} className={`${d > today ? 'future' : isDone(habit, logs[d]) ? 'on' : !isDue(habit, d) ? 'rest' : ''}${d === today ? ' now' : ''}`} />)}
      </div>
    </div>
  );
}

export function Habits() {
  const { today } = useNow();
  const open = useApp((s) => s.open);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pulse, setPulse] = useState<Record<string, number>>({});
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived).sort((a, b) => a.order - b.order), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', addDays(today, -420), today), [today], []);
  const byHabit = useMemo(() => { const m: Record<string, LogMap> = {}; for (const l of logs) (m[l.habitId] ||= {})[l.date] = l.value; return m; }, [logs]);
  const week = weekDays(mondayOf(today));
  const bump = (id: string) => setPulse((p) => ({ ...p, [id]: (p[id] || 0) + 1 }));
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
        const weekDone = week.filter((d) => isDone(h, L[d])).length, need = h.target.kind === 'weekly' ? h.target.perWeek || 1 : 7 - h.restDays.length;
        return (
          <motion.section layout="position" transition={SPRING} key={h.id} className="card col" aria-label={h.name} style={{ paddingLeft: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              {h.target.kind === 'count'
                ? <div className="row" style={{ gap: 2 }}>
                    <button type="button" className="icon-btn" aria-label={`One less ${h.target.unit || h.name}`} onClick={() => void setHabitLog(h, today, Math.max(0, (cur || 0) - 1))}>−</button>
                    <span className="mono small" style={{ minWidth: 44, textAlign: 'center' }} role="status">{cur || 0}/{h.target.count}</span>
                    <button type="button" className="icon-btn on" aria-label={`One more ${h.target.unit || h.name}`} onClick={() => { const full = (cur || 0) + 1 === h.target.count; haptic(full ? 'success' : 'light'); if (full) bump(h.id); void setHabitLog(h, today, (cur || 0) + 1); }}>+</button>
                  </div>
                : <Check big on={done} label={`${done ? 'Completed' : 'Complete'} today: ${h.name}`} onToggle={(el) => { if (!done) bump(h.id); tickHabit(h, today, cur, el); }} />}
              <button type="button" className="col grow" style={{ gap: 1, minHeight: 48, justifyContent: 'center' }} aria-expanded={isOpen} aria-label={`${h.name}. ${isOpen ? 'Hide' : 'Show'} details`} onClick={() => setExpanded(isOpen ? null : h.id)}>
                <span style={{ fontFamily: 'var(--f-head)', fontSize: '1.0625rem', fontWeight: 500, overflowWrap: 'anywhere' }}>{h.name}</span>
                <span className="small muted">{h.cue || (h.target.kind === 'weekly' ? `${h.target.perWeek}× a week` : h.target.kind === 'count' ? `${h.target.count} ${h.target.unit || ''} a day` : 'Every day')}</span>
              </button>
              <MiniRing value={weekDone / need} size={36} label={`${weekDone} of ${need} this week`} />
              <div className="col" style={{ gap: 0, alignItems: 'flex-end', minWidth: 44 }}>
                <span className="mono accent" style={{ fontSize: '1.125rem' }}><Count value={streak} /></span>
                <span className="label" style={{ letterSpacing: '.04em' }}>{h.target.kind === 'weekly' ? 'weeks' : 'streak'}</span>
              </div>
            </div>
            <div className="dots" role="group" aria-label={`${h.name} this week`} style={{ paddingLeft: 8 }}>
              {week.map((d, i) => { const on = isDone(h, L[d]), rest = h.target.kind !== 'weekly' && !isDue(h, d) && d >= h.createdOn; return (
                <button type="button" key={d} disabled={d > today} role="checkbox" aria-checked={on} aria-label={`${DOW[i]}${rest ? ', rest day' : ''}`} className={`${on ? 'on' : ''}${rest ? ' rest' : ''}${d === today ? ' today' : ''}`}
                  onClick={(e) => { if (!on && d === today) bump(h.id); tickHabit(h, d, L[d], e.currentTarget.querySelector('i')); }}>{DOW[i][0]}<i /></button>); })}
            </div>
            <AnimatePresence initial={false}>
              {isOpen && <motion.div className="col" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={SPRING} style={{ overflow: 'hidden', paddingLeft: 8 }}>
                <div className="row" style={{ gap: 24 }}>
                  <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: '1.875rem' }}>{cons == null ? '—' : <><Count value={Math.round(cons * 100)} />%</>}</span><span className="label">done, last 4 weeks</span></div>
                  <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: '1.875rem' }}>{daysBetween(h.createdOn, today) + 1}</span><span className="label">days in</span></div>
                </div>
                <Heat habit={h} logs={L} today={today} pulse={pulse[h.id] || 0} />
                {h.restDays.length > 0 && <p className="small muted">Rest days: {[...h.restDays].sort().map((d) => DOW[d]).join(', ')}. They never count as a miss.</p>}
                <p className="small muted">To change an older day, open it from the Calendar.</p>
                <button type="button" className="btn" onClick={() => open('habit', { id: h.id })}>Edit habit</button>
              </motion.div>}
            </AnimatePresence>
          </motion.section>
        );
      })}
      {habits.length > 0 && <p className="small muted" style={{ textAlign: 'center' }}>Missed a day? It happens. One miss does not end a streak.</p>}
    </div>
  );
}
