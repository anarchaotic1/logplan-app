import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { addDays, fmtDur, fmtMin, mondayOf, weekDays } from '../lib/dates';
import { byType, byTypeDate } from '../lib/db';
import type { Block, Habit, HabitLog, Journal, Sleep } from '../lib/model';
import { adherence, adherenceByDay, bestHours, habitLift, MIN_DAYS_EACH, MIN_OVERRUN, MIN_PER_HOUR, MIN_SLEEP, overrunFactor, sleepRegularity } from '../lib/insights';
import { useLive, useNow } from '../hooks';
import { ev } from '../evidence';
import { Count, Seg, SOFT, Why } from './common';

function Bar({ value, label, right }: { value: number; label: string; right: string }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row between small"><span>{label}</span><span className="mono muted">{right}</span></div>
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
        <motion.div style={{ height: '100%', borderRadius: 4, background: 'var(--accent)', transformOrigin: 'left' }} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.02, Math.min(1, value)) }} transition={SOFT} />
      </div>
    </div>
  );
}
const Need = ({ children }: { children: React.ReactNode }) => <p className="small muted">{children}</p>;

export function Insights() {
  const { today } = useNow();
  const [span, setSpan] = useState<'28' | '84'>('28');
  const from = addDays(today, -(+span - 1));
  const blocks = useLive(() => byTypeDate<Block>('block', addDays(today, -83), today), [today], []);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', addDays(today, -83), today), [today], []);
  const sleeps = useLive(() => byTypeDate<Sleep>('sleep', addDays(today, -83), today), [today], []);
  const journals = useLive(() => byTypeDate<Journal>('journal', addDays(today, -83), today), [today], []);
  const inSpan = useMemo(() => blocks.filter((b) => b.date >= from), [blocks, from]);
  const adh = adherence(inSpan), hours = bestHours(inSpan), over = overrunFactor(inSpan);
  const trend = useMemo(() => Array.from({ length: 12 }, (_, i) => { const mon = addDays(mondayOf(today), -7 * (11 - i)); return adherence(blocks.filter((b) => b.date >= mon && b.date <= addDays(mon, 6))); }), [blocks, today]);
  const lift = useMemo(() => {
    const hd: Record<string, Set<string>> = {};
    for (const l of logs) if (l.value > 0) (hd[l.habitId] ||= new Set()).add(l.date);
    return habitLift(habits, hd, adherenceByDay(inSpan));
  }, [habits, logs, inSpan]);
  const sleep = sleepRegularity(sleeps.filter((s) => s.date >= from));
  const week = weekDays(mondayOf(today));
  const activity = logs.filter((l) => week.includes(l.date) && l.value > 0).reduce((n, l) => n + (habits.find((h) => h.id === l.habitId)?.activityMin || 0), 0);
  const hasActivity = habits.some((h) => h.activityMin);
  const moods = journals.filter((j) => j.date >= from && j.mood != null), energy = journals.filter((j) => j.date >= from && j.energy != null);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const W = 300, H = 60, pts = trend.map((t, i) => (t ? { x: (i / 11) * W, y: H - 6 - t.value * (H - 14) } : null)).filter(Boolean) as { x: number; y: number }[];

  return (
    <div className="page">
      <header className="col" style={{ gap: 3 }}><span className="label">Computed on this device</span><h1>Insights</h1></header>
      <Seg label="Period" value={span} onChange={setSpan} options={[{ v: '28', l: 'Last 4 weeks' }, { v: '84', l: 'Last 12 weeks' }]} />

      <section className="card col" aria-label="Adherence">
        <span className="label">Plan adherence</span>
        {adh ? <>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big-num"><Count value={Math.round(adh.value * 100)} />%</span><span className="small muted">of {adh.n} planned blocks done</span></div>
          {pts.length > 1 && <svg viewBox={`-4 0 ${W + 8} ${H}`} style={{ width: '100%', height: 60 }} role="img" aria-label="Weekly adherence over the last 12 weeks">
            <motion.path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />
            {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 3.6 : 2.2} fill={i === pts.length - 1 ? '#fff' : 'var(--accent)'} />)}
          </svg>}
          <span className="label" style={{ fontSize: 9.5 }}>by week · last 12 weeks</span>
        </> : <Need>Plan a few blocks and tick them off; your adherence shows up here.</Need>}
      </section>

      <section className="card col" aria-label="Best hours">
        <span className="label">Your most reliable hours</span>
        {hours.length ? hours.slice(0, 3).map((h) => <Bar key={h.hour} value={h.rate} label={`${fmtMin(h.hour * 60)} – ${fmtMin(h.hour * 60 + 60)}`} right={`${Math.round(h.rate * 100)}% of ${h.n}`} />)
          : <Need>Needs at least {MIN_PER_HOUR} planned blocks starting in the same hour.</Need>}
        {hours.length > 0 && <p className="small muted">Share of blocks you completed, by start hour. Put the work that matters most where you follow through most.</p>}
      </section>

      <section className="card col" aria-label="Planned versus actual">
        <span className="label">Planned vs actual time</span>
        {over ? <>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big-num">×<Count value={over.value} digits={2} /></span><span className="small muted">median over {over.n} timed blocks</span></div>
          <p className="small">{over.value > 1.08 ? `Your blocks usually take about ${Math.round((over.value - 1) * 100)}% longer than planned. A 60-minute plan is closer to ${fmtDur(Math.round((60 * over.value) / 5) * 5)}.` : over.value < 0.92 ? 'You usually finish earlier than planned.' : 'Your estimates are close to reality.'}</p>
        </> : <Need>Needs {MIN_OVERRUN} finished blocks with a recorded duration. Use the focus timer, or answer "How long did it take?" on a done block.</Need>}
        <Why source={ev('fallacy').source}>{ev('fallacy').claim}</Why>
      </section>

      <section className="card col" aria-label="Habits and good days">
        <span className="label">Habits that go with good days</span>
        {lift.length ? lift.map((l) => <div key={l.habit.id} className="row between"><span>{l.habit.name}</span><span className="mono small" style={{ color: l.lift >= 0 ? 'var(--accent)' : 'var(--muted)' }}>{l.lift >= 0 ? '+' : '−'}{Math.abs(Math.round(l.lift * 100))} pts <span className="muted">({l.withN} vs {l.withoutN} days)</span></span></div>)
          : <Need>Needs at least {MIN_DAYS_EACH} planned days with a habit and {MIN_DAYS_EACH} without.</Need>}
        {lift.length > 0 && <p className="small muted">Difference in plan adherence between days with and without the habit. This is a pattern in your data, not proof that the habit causes the good day.</p>}
      </section>

      <section className="card col" aria-label="Sleep regularity">
        <span className="label">Sleep regularity</span>
        {sleep ? <>
          <div className="row" style={{ gap: 20 }}>
            <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 30 }}>±{Math.round(sleep.value.bedSd)}m</span><span className="label">lights out</span></div>
            <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 30 }}>±{Math.round(sleep.value.wakeSd)}m</span><span className="label">wake</span></div>
            <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 30 }}>{fmtDur(Math.round(sleep.value.avgDur))}</span><span className="label">average</span></div>
          </div>
          <p className="small muted">Typical variation (standard deviation) over {sleep.n} nights. Smaller means more regular.</p>
        </> : <Need>Log lights-out and wake times in the Journal for {MIN_SLEEP} nights.</Need>}
        <Why source={ev('sleep').source}>{ev('sleep').claim}</Why>
      </section>

      {hasActivity && <section className="card col" aria-label="Activity minutes">
        <span className="label">Activity this week</span>
        <Bar value={activity / 300} label={`${activity} minutes`} right="150–300 recommended" />
        <Why source={ev('activity').source}>{ev('activity').claim}</Why>
      </section>}

      <section className="card col" aria-label="Mood and energy">
        <span className="label">Mood and energy</span>
        {moods.length >= 7 || energy.length >= 7 ? <div className="row" style={{ gap: 24 }}>
          {moods.length >= 7 && <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 30 }}>{avg(moods.map((m) => m.mood!)).toFixed(1)}</span><span className="label">mood · {moods.length} days</span></div>}
          {energy.length >= 7 && <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 30 }}>{avg(energy.map((m) => m.energy!)).toFixed(1)}</span><span className="label">energy · {energy.length} days</span></div>}
        </div> : <Need>Tap mood or energy in the Journal on 7 days to see an average.</Need>}
      </section>
      <Why source={ev('monitor').source}>{ev('monitor').claim}</Why>
    </div>
  );
}
