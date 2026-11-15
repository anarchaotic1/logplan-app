import { useMemo, useState } from 'react';
import { addDays, DOW, mondayOf, weekDays } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import type { Habit, HabitLog } from '../lib/model';
import { bestStreak, forgivingStreak, isDone, isDue, MILESTONES, rate, type LogMap } from '../lib/habits';
import { useLive, useNow } from '../hooks';
import { useApp } from '../store';
import { setHabitLog } from '../data';
import { haptic } from '../lib/native';
import { tickHabit } from './act';
import { Count, Icon } from './common';
import { dateLabel } from './Day';
import { eggSeen } from './Sky';

const unitOf = (h: Habit) => (h.target.kind === 'weekly' ? 'week' : 'day');
function useHabitLogs(today: string, days: number) {
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', addDays(today, -days), today), [today, days], []);
  return useMemo(() => { const m: Record<string, LogMap> = {}; for (const l of logs) (m[l.habitId] ||= {})[l.date] = l.value; return m; }, [logs]);
}

export function Habits() {
  const { today } = useNow();
  const open = useApp((s) => s.open), say = useApp((s) => s.say), announce = useApp((s) => s.announce);
  const [pulse, setPulse] = useState<Record<string, number>>({});
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived).sort((a, b) => a.order - b.order), [], []);
  const byHabit = useHabitLogs(today, 420);
  const week = weekDays(mondayOf(today));
  const doneToday = habits.filter((h) => isDone(h, byHabit[h.id]?.[today])).length;
  /** Tick today from the orb. A streak that reaches 7, 21, 50 or 100 gets one small flourish, once. */
  const tick = (h: Habit, el: Element | null) => {
    const L = byHabit[h.id] || {}, cur = L[today], was = isDone(h, cur);
    if (h.target.kind === 'count') {
      const full = h.target.count || 1, next = was ? 0 : (cur || 0) + 1;
      haptic(next >= full ? 'success' : 'light');
      void setHabitLog(h, today, next);
      announce(`${h.name}: ${next} of ${full}`);
      if (next < full) return;
    } else tickHabit(h, today, cur, el);
    if (was) return;
    setPulse((p) => ({ ...p, [h.id]: (p[h.id] || 0) + 1 }));
    const n = forgivingStreak(h, { ...L, [today]: h.target.kind === 'count' ? h.target.count || 1 : 1 }, today);
    if (MILESTONES.includes(n)) void eggSeen(`streak:${h.id}:${n}`).then((seen) => { if (!seen) { haptic('medium'); say(`${n} ${unitOf(h)}s of ${h.name}.`); } });
  };
  return (
    <div className="page">
      <header className="row between">
        <div className="col" style={{ gap: 3 }}><span className="label">{dateLabel(today)}</span><h1>Habits</h1></div>
        <div className="row" style={{ gap: 10 }}>
          {habits.length > 0 && <span className="mono muted small" role="status"><span className="accent">{doneToday}</span> / {habits.length} today</span>}
          <button type="button" className="icon-btn on" aria-label="Add habit" onClick={() => open('habit')}><Icon name="plus" /></button>
        </div>
      </header>
      {habits.length === 0 && <div className="card col" style={{ alignItems: 'center', textAlign: 'center', padding: 28 }}>
        <p>No habits yet.</p><p className="small muted">Start with one, tied to something you already do every day.</p>
        <button type="button" className="btn primary" onClick={() => open('habit')}>Add your first habit</button>
      </div>}
      {habits.length > 0 && <div className="orbs" role="group" aria-label="Habits today">
        {habits.map((h) => {
          const L = byHabit[h.id] || {}, cur = L[today], done = isDone(h, cur), streak = forgivingStreak(h, L, today);
          const fill = h.target.kind === 'count' ? Math.min(1, (cur || 0) / (h.target.count || 1)) : done ? 1 : 0;
          const label = h.target.kind === 'count' ? `${h.name}: ${cur || 0} of ${h.target.count} ${h.target.unit || ''} today. ${done ? 'Tap to clear.' : 'Tap to add one.'}` : `${done ? 'Completed' : 'Complete'} today: ${h.name}`;
          return (
            <div key={h.id} className="orb-box">
              <button type="button" className={`orb${done ? ' on' : ''}`} role={h.target.kind === 'count' ? undefined : 'checkbox'} aria-checked={h.target.kind === 'count' ? undefined : done} aria-label={label} onClick={(e) => tick(h, e.currentTarget)}>
                {pulse[h.id] ? <span key={pulse[h.id]} className="orb-burst" aria-hidden="true" /> : null}
                <span className="orb-clip" aria-hidden="true"><span className="orb-liq" style={{ height: `${fill * 100}%`, opacity: fill > 0 ? 1 : 0 }}>
                  <svg viewBox="0 0 144 10" preserveAspectRatio="none"><path d="M0 5 Q18 -1 36 5 T72 5 T108 5 T144 5 V10 H0 Z" fill="var(--accent)" /></svg>
                </span></span>
                <span className="orb-num" aria-hidden="true"><Count value={streak} /></span>
              </button>
              <span className="mono muted tiny clip" style={{ maxWidth: '100%' }} aria-hidden="true">{h.name}</span>
            </div>);
        })}
      </div>}
      {habits.length > 0 && <h2 className="label" style={{ fontWeight: 400 }}>This week</h2>}
      {habits.map((h, hi) => {
        const L = byHabit[h.id] || {};
        const weekDone = week.filter((d) => isDone(h, L[d])).length, need = h.target.kind === 'weekly' ? h.target.perWeek || 1 : Math.max(1, 7 - h.restDays.length);
        return (
          <section key={h.id} className="card col habit-card" aria-label={h.name} style={{ animationDelay: `${Math.min(hi, 6) * 80}ms` }}>
            <button type="button" className="row between" style={{ minHeight: 48, width: '100%', padding: '0 10px' }} onClick={() => open('habitInfo', { id: h.id })}>
              <span className="col" style={{ gap: 0 }}>
                <span style={{ fontFamily: 'var(--f-head)', fontSize: '1.0625rem', fontWeight: 500, overflowWrap: 'anywhere' }}>{h.name}<span className="sr"> history.</span></span>
                <span className="mono muted tiny">{Math.min(100, Math.round((weekDone / need) * 100))}% this week · {weekDone} of {need}</span>
              </span>
              <Icon name="right" size={18} />
            </button>
            <div className="dots" role="group" aria-label={`${h.name} this week`}>
              {week.map((d, i) => { const on = isDone(h, L[d]), rest = h.target.kind !== 'weekly' && !isDue(h, d) && d >= h.createdOn; return (
                <button type="button" key={d} disabled={d > today} role="checkbox" aria-checked={on} aria-label={`${DOW[i]}${rest ? ', rest day' : ''}`} className={`${on ? 'on' : ''}${rest ? ' rest' : ''}${d === today ? ' today' : ''}`}
                  style={{ animationDelay: `${Math.min(hi, 6) * 80 + i * 40}ms` }} onClick={(e) => (d === today && h.target.kind !== 'count' ? tick(h, e.currentTarget.querySelector('i')) : tickHabit(h, d, L[d], e.currentTarget.querySelector('i')))}>{DOW[i][0]}<i /></button>); })}
            </div>
          </section>
        );
      })}
      {habits.length > 0 && <p className="small muted" style={{ textAlign: 'center' }}>Missed a day? It happens. One miss does not end a streak.</p>}
    </div>
  );
}

const WEEKS = 12;
/** A habit's last 12 weeks, its best streak and how often it was done. Opened from the habit's name. */
export function HabitInfo({ id }: { id: string }) {
  const { today } = useNow();
  const open = useApp((s) => s.open);
  const h = useLive(async () => (await db.rec.get(id)) as Habit | undefined, [id], undefined);
  const all = useHabitLogs(today, 3700);
  if (!h) return null;
  const L = all[h.id] || {};
  const start = mondayOf(addDays(today, -7 * (WEEKS - 1)));
  const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(start, i));
  const doneCount = days.filter((d) => d <= today && isDone(h, L[d])).length;
  const streak = forgivingStreak(h, L, today), best = Math.max(bestStreak(h, L, today), streak), r = rate(h, L, today, WEEKS);
  const cur = L[today];
  return <>
    <div className="col" style={{ gap: 2 }}><span className="label">Last 12 weeks</span><h3 style={{ fontSize: '1.5rem' }}>{h.name}</h3>
      <span className="small muted">{h.cue || (h.target.kind === 'weekly' ? `${h.target.perWeek} times a week` : h.target.kind === 'count' ? `${h.target.count} ${h.target.unit || ''} a day` : 'Every day')}</span></div>
    {streak === 42 && <p className="notice" role="status"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14v13H5zM5 17v3M9 17v3M13 17v3M17 17v3M19 17v3M5 8h14" /></svg><span className="grow">42 in a row. Don't panic.</span></p>}
    <div className="heat12" role="img" aria-label={`Done on ${doneCount} of the last ${WEEKS * 7} days. Columns are weeks, rows are Monday to Sunday.`}>
      {days.map((d, i) => <i key={d} className={`${d > today ? 'future' : isDone(h, L[d]) ? 'on' : !isDue(h, d) ? 'rest' : ''}${d === today ? ' now' : ''}`} style={{ animationDelay: `${(Math.floor(i / 7) + (i % 7)) * 30}ms` }} />)}
    </div>
    <div className="row" style={{ gap: 12 }}>
      <div className="card col grow" style={{ gap: 2 }}><span className="label">Best streak</span><span className="big-num accent" style={{ fontSize: '1.75rem' }}>{best}<span className="mono muted tiny" style={{ marginLeft: 6, fontWeight: 400 }}>{unitOf(h)}s</span></span></div>
      <div className="card col grow" style={{ gap: 2 }}><span className="label">12-week rate</span><span className="big-num accent" style={{ fontSize: '1.75rem' }}>{r == null ? '–' : `${Math.round(r * 100)}%`}</span></div>
    </div>
    {h.target.kind === 'count' && <div className="row between"><span>Today</span><span className="row" style={{ gap: 4 }}>
      <button type="button" className="icon-btn" aria-label={`One less ${h.target.unit || h.name}`} onClick={() => void setHabitLog(h, today, Math.max(0, (cur || 0) - 1))}>−</button>
      <span className="mono small" style={{ minWidth: 48, textAlign: 'center' }} role="status">{cur || 0}/{h.target.count}</span>
      <button type="button" className="icon-btn on" aria-label={`One more ${h.target.unit || h.name}`} onClick={() => { haptic(); void setHabitLog(h, today, (cur || 0) + 1); }}>+</button>
    </span></div>}
    {h.restDays.length > 0 && <p className="small muted">Rest days: {[...h.restDays].sort().map((d) => DOW[d]).join(', ')}. They never count as a miss.</p>}
    <p className="small muted">Current streak: {streak} {unitOf(h)}{streak === 1 ? '' : 's'}. One missed day does not end it. To change a day before this week, open it from the Calendar.</p>
    <button type="button" className="btn" onClick={() => open('habit', { id: h.id })}>Edit habit</button>
  </>;
}
