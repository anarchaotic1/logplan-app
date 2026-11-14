import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { addDays, daysBetween, DOW, fmtMin, isoWeek, MONTHS, mondayOf, monthGrid, parseISO, weekDays } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import type { Block, Countdown, Habit, HabitLog, Journal, Recurring, Template, Todo, Topic, WeekReview } from '../lib/model';
import { adherence, adherenceByDay } from '../lib/insights';
import { isDone } from '../lib/habits';
import { useDebounced, useLive, useNow } from '../hooks';
import { transition, useApp } from '../store';
import { applyTemplate, remove, reviewTopic, saveDayAsTemplate, saveReview } from '../data';
import { haptic } from '../lib/native';
import { ev } from '../evidence';
import { AutoText, Count, Icon, Seg, SOFT, SPRING, Why } from './common';

type View = 'week' | 'month' | 'study' | 'setup';

export function Plan() {
  const { today } = useNow();
  const date = useApp((s) => s.date), setDate = useApp((s) => s.setDate), setTab = useApp((s) => s.setTab), open = useApp((s) => s.open);
  const [view, setView] = useState<View>('week');
  const [reviewing, setReviewing] = useState(false);
  const monday = mondayOf(date), wk = isoWeek(date);
  const goDay = (d: string) => { haptic(); setDate(d); setTab('today'); };
  if (reviewing) return <Review monday={monday} onClose={() => setReviewing(false)} />;
  return (
    <div className="page">
      <header className="row between">
        <div className="col" style={{ gap: 3 }}><span className="label">Week {wk.week} · {wk.year}</span><h1>Plan</h1></div>
        <button type="button" className="icon-btn" aria-label="Open year orbit" onClick={() => open('orbit')}><Icon name="orbit" size={22} /></button>
      </header>
      <Seg label="Plan view" value={view} onChange={(v) => transition(() => setView(v))} options={[{ v: 'week', l: 'Week' }, { v: 'month', l: 'Month' }, { v: 'study', l: 'Study' }, { v: 'setup', l: 'Setup' }]} />
      {view === 'week' && <Week monday={monday} today={today} onDay={goDay} onReview={() => transition(() => setReviewing(true))} onStep={(n) => setDate(addDays(monday, 7 * n))} />}
      {view === 'month' && <Month date={date} today={today} onDay={goDay} onMonth={(d) => setDate(d)} />}
      {view === 'study' && <Study today={today} />}
      {view === 'setup' && <Setup today={today} date={date} />}
    </div>
  );
}

function Week({ monday, today, onDay, onReview, onStep }: { monday: string; today: string; onDay: (d: string) => void; onReview: () => void; onStep: (n: number) => void }) {
  const days = weekDays(monday);
  const blocks = useLive(() => byTypeDate<Block>('block', monday, days[6]), [monday], []);
  const todos = useLive(() => byTypeDate<Todo>('todo', monday, days[6]), [monday], []);
  const review = useLive(async () => (await db.rec.get(`wr:${monday}`)) as WeekReview | undefined, [monday], undefined);
  const adh = adherence(blocks), byDay = adherenceByDay(blocks);
  const range = `${parseISO(monday).getDate()} ${MONTHS[parseISO(monday).getMonth()]} – ${parseISO(days[6]).getDate()} ${MONTHS[parseISO(days[6]).getMonth()]}`;
  return <>
    <div className="row between">
      <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => onStep(-1)}><Icon name="left" /></button>
      <div className="col" style={{ gap: 0, alignItems: 'center' }}><span className="mono accent">W{isoWeek(monday).week}</span><span className="small muted">{range}</span></div>
      <button type="button" className="icon-btn" aria-label="Next week" onClick={() => onStep(1)}><Icon name="right" /></button>
    </div>
    <div className="card row" style={{ gap: 18 }}>
      <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 36 }}>{adh ? <><Count value={Math.round(adh.value * 100)} />%</> : '—'}</span><span className="label">adherence</span></div>
      <div className="row grow" style={{ gap: 6, alignItems: 'flex-end', height: 56 }} aria-hidden="true">
        {days.map((d, i) => <div key={d} className="col grow" style={{ gap: 4, alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
          <div style={{ width: '100%', flex: 1, borderRadius: 4, background: 'rgba(255,255,255,.06)', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
            <motion.div style={{ width: '100%', height: '100%', background: 'var(--accent)', transformOrigin: 'bottom', borderRadius: 4 }} initial={{ scaleY: 0 }} animate={{ scaleY: byDay.get(d) ?? 0 }} transition={{ ...SOFT, delay: i * 0.04 }} />
          </div>
          <span className="mono" style={{ fontSize: 9.5, color: d === today ? 'var(--accent)' : 'var(--muted)' }}>{DOW[i][0]}</span>
        </div>)}
      </div>
    </div>
    <div className="card tight sep">
      {days.map((d, i) => { const bs = blocks.filter((b) => b.date === d && b.title.trim()), ts = todos.filter((t) => t.date === d); return (
        <button type="button" key={d} className="row" style={{ width: '100%', minHeight: 52, textAlign: 'left' }} onClick={() => onDay(d)}>
          <span className="mono" style={{ width: 54, fontSize: 12, color: d === today ? 'var(--accent)' : 'var(--muted)' }}>{DOW[i]} {parseISO(d).getDate()}</span>
          <span className="grow small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bs.length ? bs.sort((a, b) => a.start - b.start).map((b) => b.title).join(' · ') : <span className="muted">No blocks</span>}</span>
          <span className="mono muted" style={{ fontSize: 11 }}>{bs.filter((b) => b.done).length}/{bs.length}{ts.length ? ` · ${ts.filter((t) => t.done).length}/${ts.length}✓` : ''}</span>
        </button>); })}
    </div>
    <button type="button" className="card click row between" onClick={onReview}>
      <span className="col" style={{ gap: 2 }}><span style={{ fontWeight: 500 }}>{review?.done ? 'Weekly review · done' : 'Start weekly review'}</span><span className="small muted">{review?.done ? 'Open to read or edit' : 'Five minutes: look back, pick one change, plan for one obstacle'}</span></span>
      <span className="accent"><Icon name={review?.done ? 'check' : 'right'} /></span>
    </button>
  </>;
}

function Review({ monday, onClose }: { monday: string; onClose: () => void }) {
  const [step, setStep] = useState(0), [ceremony, setCeremony] = useState(false);
  const reduce = useReducedMotion();
  const days = weekDays(monday);
  const blocks = useLive(() => byTypeDate<Block>('block', monday, days[6]), [monday], []);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', monday, days[6]), [monday], []);
  const journals = useLive(() => byTypeDate<Journal>('journal', monday, days[6]), [monday], []);
  const stored = useLive(async () => (await db.rec.get(`wr:${monday}`)) as WeekReview | undefined, [monday], undefined);
  const [r, setR] = useState({ good: '', drop: '', obstacle: '', plan: '' });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (stored && !loaded) { setR({ good: stored.good, drop: stored.drop, obstacle: stored.obstacle, plan: stored.plan }); setLoaded(true); } }, [stored, loaded]);
  const persist = useDebounced((c: typeof r) => void saveReview(monday, c), 400);
  const set = (c: Partial<typeof r>) => { const n = { ...r, ...c }; setR(n); persist(n); };
  const adh = adherence(blocks);
  const wins = journals.filter((j) => j.win.trim());
  const next = isoWeek(addDays(monday, 7)).week;
  const finish = async () => { await saveReview(monday, { ...r, done: true }); haptic('success'); setCeremony(true); setTimeout(onClose, reduce ? 900 : 2600); };
  const STEPS = ['Look back', 'Keep', 'Change', 'Obstacle'];
  return (
    <div className="page">
      <header className="row"><button type="button" className="icon-btn" aria-label="Close review" onClick={onClose}><Icon name="left" /></button>
        <div className="col grow" style={{ gap: 0 }}><span className="label">Week {isoWeek(monday).week} · step {step + 1} of 4</span><h2>{STEPS[step]}</h2></div></header>
      <div className="row" style={{ gap: 6 }} aria-hidden="true">{STEPS.map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? 'var(--accent)' : 'rgba(255,255,255,.1)', transition: 'background .3s' }} />)}</div>
      <AnimatePresence mode="wait">
        <motion.div key={step} className="col" initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }} transition={SPRING}>
          {step === 0 && <>
            <div className="card row" style={{ gap: 24 }}>
              <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 36 }}>{adh ? `${Math.round(adh.value * 100)}%` : '—'}</span><span className="label">{adh ? `${adh.n} blocks planned` : 'no blocks planned'}</span></div>
              <div className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 36 }}>{journals.filter((j) => j.text || j.win || j.lesson).length}</span><span className="label">journal days</span></div>
            </div>
            {habits.length > 0 && <div className="card tight sep">{habits.map((h) => { const n = days.filter((d) => isDone(h, logs.find((l) => l.habitId === h.id && l.date === d)?.value)).length; const need = h.target.kind === 'weekly' ? h.target.perWeek || 1 : 7 - h.restDays.length; return <div key={h.id} className="row between" style={{ minHeight: 44 }}><span>{h.name}</span><span className="mono accent small">{n}/{need}</span></div>; })}</div>}
            {wins.length > 0 && <div className="card col"><span className="label">Wins you wrote down</span>{wins.map((j) => <p key={j.id} className="small"><span className="mono muted">{DOW[days.indexOf(j.date)]} </span>{j.win}</p>)}</div>}
            <p className="small muted">Just read it. No score to beat; this is information for next week.</p>
          </>}
          {step === 1 && <label className="field"><span>What moved the needle this week?</span><AutoText label="What moved the needle" rows={4} value={r.good} onChange={(v) => set({ good: v })} placeholder="What worked, and why did it work?" /></label>}
          {step === 2 && <label className="field"><span>What will you drop or change next week?</span><AutoText label="What to drop or change" rows={4} value={r.drop} onChange={(v) => set({ drop: v })} placeholder="One thing. Smaller is better." /></label>}
          {step === 3 && <>
            <label className="field"><span>The most likely obstacle next week</span><AutoText label="Most likely obstacle" rows={2} value={r.obstacle} onChange={(v) => set({ obstacle: v })} placeholder="Late meetings eat my evening block…" /></label>
            <label className="field"><span>If that happens, then I will…</span><AutoText label="If-then plan" rows={2} value={r.plan} onChange={(v) => set({ plan: v })} placeholder="…do a 20-minute version right after dinner." /></label>
            <Why source={`${ev('fresh').source}; ${ev('cue').source}`}>{ev('fresh').claim}</Why>
          </>}
        </motion.div>
      </AnimatePresence>
      <div className="row">
        {step > 0 && <button type="button" className="btn grow" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 3 ? <button type="button" className="btn primary grow" onClick={() => { haptic(); setStep(step + 1); }}>Next</button>
          : <button type="button" className="btn primary grow" onClick={() => void finish()}>Finish review</button>}
      </div>
      <AnimatePresence>
        {ceremony && <motion.div className="lock" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ background: 'rgba(4,10,24,.94)' }}>
          <svg width="180" height="180" viewBox="0 0 180 180" aria-hidden="true">
            <circle cx="90" cy="90" r="74" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="8" />
            <motion.circle cx="90" cy="90" r="74" fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" transform="rotate(-90 90 90)" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }} />
            <motion.path d="M62 92l20 20 38-42" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: reduce ? 0 : 1.1 }} />
          </svg>
          <motion.div className="col" style={{ gap: 4 }} initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduce ? 0 : 1.2 }}>
            <span className="label">Week {isoWeek(monday).week} closed</span><h1>Week {next} begins</h1>
          </motion.div>
        </motion.div>}
      </AnimatePresence>
    </div>
  );
}

function Month({ date, today, onDay, onMonth }: { date: string; today: string; onDay: (d: string) => void; onMonth: (d: string) => void }) {
  const d = parseISO(date), y = d.getFullYear(), m = d.getMonth();
  const grid = useMemo(() => monthGrid(y, m), [y, m]);
  const blocks = useLive(() => byTypeDate<Block>('block', grid[0], grid[41]), [grid[0]], []);
  const byDay = adherenceByDay(blocks);
  const shift = (n: number) => { const t = new Date(y, m + n, 1); onMonth(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); };
  return <>
    <div className="row between">
      <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="left" /></button>
      <span className="mono accent">{MONTHS[m]} {y}</span>
      <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><Icon name="right" /></button>
    </div>
    <div className="cal" aria-hidden="true">{DOW.map((x) => <span key={x} className="label" style={{ textAlign: 'center', fontSize: 9.5 }}>{x[0]}</span>)}</div>
    <div className="cal">
      {grid.map((g) => { const a = byDay.get(g); return (
        <button type="button" key={g} className={`${parseISO(g).getMonth() !== m ? 'out' : ''}${g === today ? ' today' : ''}`} aria-label={`${g}${a != null ? `, ${Math.round(a * 100)} percent of plan done` : ''}`} onClick={() => onDay(g)}>
          {parseISO(g).getDate()}<i style={{ ['--a' as string]: a == null ? 0 : 0.25 + a * 0.75 }} />
        </button>); })}
    </div>
    <p className="small muted" style={{ textAlign: 'center' }}>The bar under a day shows how much of its plan got done.</p>
  </>;
}

function Study({ today }: { today: string }) {
  const open = useApp((s) => s.open);
  const topics = useLive(async () => (await byType<Topic>('topic')).sort((a, b) => (a.due < b.due ? -1 : 1)), [], []);
  const due = topics.filter((t) => t.due <= today), later = topics.filter((t) => t.due > today);
  const [shown, setShown] = useState<string | null>(null);
  return <>
    <div className="row between"><span className="label">{due.length ? `${due.length} to recall today` : 'Nothing due today'}</span>
      <button type="button" className="chip on" onClick={() => open('topic')}><Icon name="plus" size={14} />Topic</button></div>
    {due.map((t) => (
      <motion.div layout="position" transition={SPRING} key={t.id} className="card col">
        <div className="row between"><span style={{ fontFamily: 'var(--f-head)', fontSize: 17, fontWeight: 500 }}>{t.title}</span><span className="mono muted small">{t.reviews.length} reviews</span></div>
        {shown === t.id ? <>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{t.notes || 'No notes. Did you recall it?'}</p>
          <div className="row"><button type="button" className="btn grow" onClick={() => { void reviewTopic(t, false, today); setShown(null); }}>Not yet · tomorrow</button>
            <button type="button" className="btn primary grow" onClick={() => { haptic('success'); void reviewTopic(t, true, today); setShown(null); }}>Recalled</button></div>
        </> : <>
          <p className="small muted">Close your notes. Say or write everything you remember, then check.</p>
          <button type="button" className="btn" onClick={() => setShown(t.id)}>I tried — show my notes</button>
        </>}
      </motion.div>
    ))}
    {topics.length === 0 && <p className="empty">Add a topic after you study it. Log/Plan brings it back for a recall test at growing intervals: 1, 3, 7, 14, 30, 60, then 120 days.</p>}
    {later.length > 0 && <div className="card tight sep">{later.map((t) => (
      <button type="button" key={t.id} className="row between" style={{ width: '100%', minHeight: 48, textAlign: 'left' }} onClick={() => open('topic', { id: t.id })}>
        <span>{t.title}</span><span className="mono muted small">in {daysBetween(today, t.due)}d</span></button>))}</div>}
    <Why source={ev('study').source}>{ev('study').claim}</Why>
  </>;
}

function Setup({ today, date }: { today: string; date: string }) {
  const open = useApp((s) => s.open), say = useApp((s) => s.say);
  const templates = useLive(() => byType<Template>('template'), [], []);
  const rules = useLive(() => byType<Recurring>('recurring'), [], []);
  const countdowns = useLive(async () => (await byType<Countdown>('countdown')).sort((a, b) => (a.target < b.target ? -1 : 1)), [], []);
  const label = date === today ? 'today' : parseISO(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return <>
    <section className="col" style={{ gap: 8 }}><div className="row between"><span className="label">Countdowns</span><button type="button" className="chip on" onClick={() => open('countdown')}><Icon name="plus" size={14} />Add</button></div>
      {countdowns.length === 0 && <p className="empty">Exams, deadlines, trips.</p>}
      {countdowns.length > 0 && <div className="card tight sep">{countdowns.map((c) => { const n = daysBetween(today, c.target); return (
        <button type="button" key={c.id} className="row between" style={{ width: '100%', minHeight: 48, textAlign: 'left' }} onClick={() => open('countdown', { id: c.id })}>
          <span>{c.label}</span><span className={`mono small ${n >= 0 && n <= 7 ? 'accent' : 'muted'}`}>{n > 0 ? `${n} days` : n === 0 ? 'today' : `${-n}d ago`}</span></button>); })}</div>}
    </section>
    <section className="col" style={{ gap: 8 }}><span className="label">Day templates</span>
      <button type="button" className="btn" onClick={async () => { const name = prompt(`Name for a template made from the blocks of ${label}:`, 'Standard day'); if (!name) return; const n = await saveDayAsTemplate(name.trim(), date); say(n ? `Saved "${name}" with ${n} blocks.` : 'That day has no blocks to save.'); }}>Save {label} as a template</button>
      {templates.length > 0 && <div className="card tight sep">{templates.map((t) => (
        <div key={t.id} className="row" style={{ minHeight: 52 }}>
          <span className="col grow" style={{ gap: 0 }}><span>{t.name}</span><span className="small muted">{t.blocks.length} blocks · {t.blocks.slice(0, 3).map((b) => `${fmtMin(b.start)} ${b.title}`).join(', ')}</span></span>
          <button type="button" className="chip on" onClick={async () => { await applyTemplate(t, date); haptic('success'); say(`Added to ${label}.`); }}>Apply</button>
          <button type="button" className="icon-btn bare" aria-label={`Delete template ${t.name}`} onClick={() => void remove(t.id)}><Icon name="trash" size={16} /></button>
        </div>))}</div>}
    </section>
    <section className="col" style={{ gap: 8 }}><span className="label">Repeating</span>
      {rules.length === 0 && <p className="empty">Open a block and choose "Repeat…" to make it recur.</p>}
      {rules.length > 0 && <div className="card tight sep">{rules.map((r) => (
        <div key={r.id} className="row" style={{ minHeight: 52 }}>
          <span className="col grow" style={{ gap: 0 }}><span>{r.title || 'Untitled'}</span><span className="small muted">{r.start != null ? `${fmtMin(r.start)} · ` : ''}{[...r.days].sort().map((d) => DOW[d]).join(' ')}</span></span>
          <button type="button" className="icon-btn bare" aria-label={`Stop repeating ${r.title}`} onClick={() => { void remove(r.id); say('Stopped repeating. Existing blocks stay.'); }}><Icon name="trash" size={16} /></button>
        </div>))}</div>}
    </section>
  </>;
}
