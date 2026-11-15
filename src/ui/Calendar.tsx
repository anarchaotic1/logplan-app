import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { daysBetween, DOW, fmtMin, monthGrid, parseISO, type ISODate } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import type { Block, Countdown, Meal, Rec, Recurring, Sleep, Template } from '../lib/model';
import { adherenceByDay } from '../lib/day';
import { searchRecs, type Hit } from '../lib/search';
import { useLive, useNow, useReduce } from '../hooks';
import { transition, useApp } from '../store';
import { applyTemplate, remove, saveDayAsTemplate } from '../data';
import { haptic } from '../lib/native';
import { removeWithUndo } from './act';
import { Icon, Seg, SPRING } from './common';
import { DayView, longDate } from './Day';

const RR = 16, RC = 2 * Math.PI * RR;
const monthName = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
let lastPicked: ISODate | null = null;
const KIND: Record<Hit['kind'], string> = { block: 'Block', todo: 'To-do', meal: 'Meal', intention: 'Intention' };

export function Calendar() {
  const calDay = useApp((s) => s.calDay), setCalDay = useApp((s) => s.setCalDay);
  const [view, setView] = useState<'month' | 'setup'>('month');
  if (calDay) return <DayView date={calDay} mode="calendar" onDate={setCalDay} onBack={() => transition(() => setCalDay(null))} />;
  return (
    <div className="page">
      <header className="col" style={{ gap: 3 }}><span className="label">Any day, in full</span><h1>Calendar</h1></header>
      <Seg label="Calendar view" value={view} onChange={(v) => transition(() => setView(v))} options={[{ v: 'month', l: 'Month' }, { v: 'setup', l: 'Setup' }]} />
      {view === 'month' ? <Month /> : <Setup />}
    </div>
  );
}

function Month() {
  const { today } = useNow();
  const reduce = useReduce();
  const calMonth = useApp((s) => s.calMonth), setCalDay = useApp((s) => s.setCalDay);
  const [q, setQ] = useState('');
  const [dir, setDir] = useState(0);
  const [picked, setPickedState] = useState<ISODate | null>(lastPicked); // survives the round trip into a day, so the day view shrinks back into its cell
  const setPicked = (g: ISODate) => { lastPicked = g; setPickedState(g); };
  const gridRef = useRef<HTMLDivElement>(null);
  const d0 = parseISO(calMonth), y = d0.getFullYear(), m = d0.getMonth();
  const grid = useMemo(() => monthGrid(y, m), [y, m]);
  const blocks = useLive(() => byTypeDate<Block>('block', grid[0], grid[41]), [grid[0]], []);
  const meals = useLive(() => byTypeDate<Meal>('meal', grid[0], grid[41]), [grid[0]], []);
  const sleeps = useLive(() => byTypeDate<Sleep>('sleep', grid[0], grid[41]), [grid[0]], []);
  const countdowns = useLive(() => byType<Countdown>('countdown'), [], []);
  const byDay = useMemo(() => adherenceByDay(blocks), [blocks]);
  const mealDays = useMemo(() => new Set(meals.map((x) => x.date)), [meals]);
  const sleepDays = useMemo(() => new Set(sleeps.map((x) => x.date)), [sleeps]);
  const cdBy = useMemo(() => { const mp = new Map<string, string[]>(); for (const c of countdowns) mp.set(c.target, [...(mp.get(c.target) || []), c.label]); return mp; }, [countdowns]);

  const shift = (n: number) => { haptic(); setDir(n); const t = new Date(y, m + n, 1); useApp.setState({ calMonth: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01` }); };
  const pick = (g: ISODate) => { haptic(); setPicked(g); requestAnimationFrame(() => document.querySelector('.day-card')?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })); };
  // Arrow keys move between days, like a grid.
  const keys = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step || !gridRef.current) return;
    const cells = [...gridRef.current.querySelectorAll<HTMLElement>('.cal-cell')], i = cells.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || !cells[i + step]) return;
    e.preventDefault(); e.stopPropagation(); cells[i + step].focus();
  };
  const sel = picked && grid.includes(picked) ? picked : grid.includes(today) ? today : null;
  const selBlocks = sel ? blocks.filter((b) => b.date === sel && (b.title.trim() || b.log.trim())).sort((a, b) => a.start - b.start) : [];
  const selA = sel ? byDay.get(sel) : undefined;
  return <>
    <Search q={q} setQ={setQ} />
    {!q.trim() && <>
      <div className="row between">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="left" /></button>
        <motion.h2 key={calMonth} aria-live="polite" initial={reduce || !dir ? { opacity: 0 } : { opacity: 0, x: dir * 24 }} animate={{ opacity: 1, x: 0 }} transition={SPRING}>{monthName(d0)}</motion.h2>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><Icon name="right" /></button>
      </div>
      <div className="cal" aria-hidden="true">{DOW.map((x) => <span key={x} className="label" style={{ textAlign: 'center', letterSpacing: 0 }}>{x.slice(0, 2)}</span>)}</div>
      <motion.div key={calMonth} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} style={{ touchAction: 'pan-y' }} drag={reduce ? false : 'x'} dragDirectionLock dragConstraints={{ left: 0, right: 0 }} dragElastic={0.25} dragSnapToOrigin
        onDragEnd={(_, i) => { if (i.offset.x < -64 || i.velocity.x < -500) shift(1); else if (i.offset.x > 64 || i.velocity.x > 500) shift(-1); }}>
        <div className="cal" ref={gridRef} role="group" aria-label={monthName(d0)} onKeyDown={keys} style={{ ['--dx' as string]: `${dir * 14}px` }}>
          {grid.map((g, i) => {
            const a = byDay.get(g), hasMeal = mealDays.has(g), hasSleep = sleepDays.has(g), cds = cdBy.get(g);
            const label = `${longDate(g)}${g === today ? ', today' : ''}. ${a ? `${a.done} of ${a.n} blocks done, ${Math.round(a.value * 100)} percent` : 'No blocks'}${hasMeal ? ', meals logged' : ''}${hasSleep ? ', sleep logged' : ''}${cds ? `, countdown: ${cds.join(', ')}` : ''}.`;
            return (
              <button type="button" key={g} className={`cal-cell${parseISO(g).getMonth() !== m ? ' out' : ''}${g === today ? ' today' : ''}${sel === g ? ' sel' : ''}${a && a.value >= 1 ? ' full' : ''}`} aria-label={label} aria-current={g === today ? 'date' : undefined} aria-pressed={sel === g}
                style={{ animationDelay: `${((i % 7) + Math.floor(i / 7)) * 50}ms` }} onClick={() => pick(g)}>
                <span className="ringbox">
                  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
                    {g === today && <circle className="breathe" cx="20" cy="20" r="19" fill="none" stroke="var(--accent)" strokeWidth="1.2" />}
                    <circle cx="20" cy="20" r={RR} fill="none" stroke="var(--line)" strokeWidth="3" />
                    {a && a.value > 0 && <circle className="cal-ring" cx="20" cy="20" r={RR} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" transform="rotate(-90 20 20)"
                      strokeDasharray={RC} strokeDashoffset={RC * (1 - a.value)} style={{ ['--c' as string]: RC, animationDelay: `${((i % 7) + Math.floor(i / 7)) * 50}ms` }} />}
                  </svg>
                  <span className="num">{parseISO(g).getDate()}</span>
                </span>
                <span className="cal-marks" aria-hidden="true">{hasMeal && <i className="meal" />}{hasSleep && <i className="sleep" />}</span>
                {cds && <i className="cal-cd" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </motion.div>
      {sel && <section key={sel} className="card col day-card" aria-label={`${longDate(sel)}, summary`} style={{ viewTransitionName: 'cal-day' }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="col" style={{ gap: 0 }}><span className="label">{DOW[(parseISO(sel).getDay() + 6) % 7]}{sel === today ? ' · today' : ''}</span><h2 style={{ fontSize: '1.5rem' }}>{parseISO(sel).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</h2></div>
          <svg width="96" height="56" viewBox="0 0 120 70" role="img" aria-label={selA ? `${selA.done} of ${selA.n} blocks done` : 'No blocks'}>
            <g transform="translate(60,35) rotate(-14)">
              <path d="M-48 0 A48 15 0 0 1 48 0" fill="none" stroke="var(--line)" strokeWidth="3" />
              <circle r="17" fill="var(--surface-2)" stroke="var(--line)" />
              <path d="M-48 0 A48 15 0 0 0 48 0" fill="none" stroke="var(--line)" strokeWidth="3" />
              {selA && selA.value > 0 && <path className="ring-draw" d="M-48 0 A48 15 0 0 0 48 0" pathLength={100} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" style={{ strokeDasharray: `${(selA.value * 100).toFixed(1)} 100` }} />}
            </g>
          </svg>
        </div>
        {selBlocks.length === 0 && <p className="muted small">No blocks planned.</p>}
        {selBlocks.slice(0, 4).map((b) => <div key={b.id} className="row between" style={{ gap: 10 }}><span className={`clip${b.done ? ' struck' : ''}`}>{b.done && <span className="sr">Done: </span>}{b.title || b.log}</span><span className="mono muted small">{fmtMin(b.start)}</span></div>)}
        {selBlocks.length > 4 && <p className="muted small">and {selBlocks.length - 4} more</p>}
        <p className="mono muted tiny">{[mealDays.has(sel) ? 'meals logged' : '', sleepDays.has(sel) ? 'sleep logged' : '', ...(cdBy.get(sel) || [])].filter(Boolean).join(' · ') || 'nothing else logged'}</p>
        <button type="button" className="btn block" onClick={() => transition(() => setCalDay(sel))}>Open {sel === today ? 'today' : 'this day'}</button>
      </section>}
      <p className="legend" aria-hidden="true">
        <span><svg width="14" height="14" viewBox="0 0 34 34"><circle cx="17" cy="17" r="13" fill="none" stroke="var(--accent)" strokeWidth="5" strokeDasharray="55 82" transform="rotate(-90 17 17)" /></svg>blocks done</span>
        <span><span className="cal-marks"><i className="meal" /></span>meal</span><span><span className="cal-marks"><i className="sleep" /></span>sleep</span>
        <span><i style={{ width: 7, height: 7, background: 'var(--accent)', transform: 'rotate(45deg)', display: 'inline-block' }} />countdown</span>
      </p>
      {calMonth.slice(0, 7) !== today.slice(0, 7) && <button type="button" className="chip plain" style={{ alignSelf: 'center' }} onClick={() => { setDir(calMonth < today ? 1 : -1); useApp.setState({ calMonth: `${today.slice(0, 7)}-01` }); }}>This month</button>}
    </>}
  </>;
}

/** One search box over everything logged by day: blocks, to-dos, meals and morning intentions. */
function Search({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const setCalDay = useApp((s) => s.setCalDay);
  const [hits, setHits] = useState<Hit[] | null>(null);
  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    let off = false;
    const t = setTimeout(async () => { const recs = (await db.rec.where('type').anyOf('block', 'todo', 'meal', 'journal').toArray()) as Rec[]; if (!off) setHits(searchRecs(recs, q)); }, 180);
    return () => { off = true; clearTimeout(t); };
  }, [q]);
  return <>
    <div role="search" style={{ position: 'relative' }}>
      <span className="muted" style={{ position: 'absolute', left: 14, top: 14, display: 'flex', pointerEvents: 'none' }}><Icon name="search" /></span>
      <input className="input" type="search" enterKeyHint="search" aria-label="Search all days" placeholder="Search blocks, to-dos, meals, intentions" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 44, paddingRight: q ? 52 : 12, borderRadius: 24 }} />
      {q && <button type="button" className="icon-btn bare" aria-label="Clear search" style={{ position: 'absolute', right: 0, top: 0 }} onClick={() => setQ('')}><Icon name="close" size={18} /></button>}
    </div>
    {q.trim() && <section aria-label="Search results" className="col" style={{ gap: 8 }}>
      <p className="small muted" role="status">{hits == null ? 'Searching…' : hits.length ? `${hits.length}${hits.length === 60 ? '+' : ''} result${hits.length === 1 ? '' : 's'}, newest day first` : 'Nothing found.'}</p>
      {hits && hits.length > 0 && <div className="card tight sep" style={{ paddingLeft: 12 }}>{hits.map((h) => (
        <button type="button" key={`${h.kind}${h.id}`} className="row" style={{ width: '100%', minHeight: 56, padding: '6px 0' }} onClick={() => transition(() => setCalDay(h.date))}>
          <span className="col grow" style={{ gap: 1 }}><span className={h.done ? 'struck' : ''} style={{ overflowWrap: 'anywhere' }}>{h.text}</span>
            <span className="muted small">{KIND[h.kind]}{h.done ? ' · done' : ''} · {longDate(h.date)} {parseISO(h.date).getFullYear()}{h.time != null ? ` · ${fmtMin(h.time)}` : ''}</span></span>
          <Icon name="right" size={18} />
        </button>))}</div>}
    </section>}
  </>;
}

/** Things that shape future days: countdowns, day templates, repeating items, the day-start hour and categories. */
function Setup() {
  const { today } = useNow();
  const open = useApp((s) => s.open), say = useApp((s) => s.say), date = useApp((s) => s.date);
  const s = useApp((x) => x.settings), set = useApp((x) => x.setSetting);
  const templates = useLive(() => byType<Template>('template'), [], []);
  const rules = useLive(() => byType<Recurring>('recurring'), [], []);
  const countdowns = useLive(async () => (await byType<Countdown>('countdown')).sort((a, b) => (a.target < b.target ? -1 : 1)), [], []);
  const [tname, setTname] = useState(''), [cat, setCat] = useState('');
  const label = date === today ? 'today' : longDate(date);
  return <>
    <section className="col" style={{ gap: 8 }} aria-label="Countdowns"><div className="head"><h2 className="label" style={{ fontWeight: 400 }}>Countdowns</h2><button type="button" className="chip plain" onClick={() => open('countdown')}><Icon name="plus" size={16} />Add</button></div>
      {countdowns.length === 0 && <p className="empty">Exams, deadlines, trips. They show on the calendar and on the days before.</p>}
      {countdowns.length > 0 && <div className="card tight sep" style={{ paddingLeft: 12 }}>{countdowns.map((c) => { const n = daysBetween(today, c.target); return (
        <button type="button" key={c.id} className="row between" style={{ width: '100%', minHeight: 52 }} onClick={() => open('countdown', { id: c.id })}>
          <span style={{ overflowWrap: 'anywhere' }}><span className="sr">Edit countdown </span>{c.label}</span><span className={`mono small ${n >= 0 && n <= 7 ? 'accent' : 'muted'}`} style={{ whiteSpace: 'nowrap' }}>{n > 0 ? `${n} days` : n === 0 ? 'today' : `${-n}d ago`}</span></button>); })}</div>}
    </section>
    <section className="col" style={{ gap: 8 }} aria-label="Day templates"><h2 className="label" style={{ fontWeight: 400 }}>Day templates</h2>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); const name = tname.trim(); if (!name) return; const n = await saveDayAsTemplate(name, date); if (n) { setTname(''); say(`Saved "${name}" with ${n} blocks.`); } else say(`${label === 'today' ? 'Today' : label} has no blocks to save.`); }}>
        <input className="input grow" aria-label={`Name for a template made from the blocks of ${label}`} placeholder={`Save ${label} as…`} value={tname} onChange={(e) => setTname(e.target.value)} />
        <button type="submit" className="btn" disabled={!tname.trim()}>Save</button>
      </form>
      {templates.length > 0 && <div className="card tight sep" style={{ paddingLeft: 12 }}>{templates.map((t) => (
        <div key={t.id} className="row" style={{ minHeight: 56, gap: 6 }}>
          <span className="col grow" style={{ gap: 0 }}><span>{t.name}</span><span className="small muted clip">{t.blocks.length} blocks · {t.blocks.slice(0, 3).map((b) => `${fmtMin(b.start)} ${b.title}`).join(', ')}</span></span>
          <button type="button" className="chip plain" aria-label={`Apply template ${t.name} to ${label}`} onClick={async () => { await applyTemplate(t, date); haptic('success'); say(`Added to ${label}.`); }}>Apply</button>
          <button type="button" className="icon-btn bare" aria-label={`Delete template ${t.name}`} onClick={() => void removeWithUndo(t, 'Template')}><Icon name="trash" size={18} /></button>
        </div>))}</div>}
    </section>
    <section className="col" style={{ gap: 8 }} aria-label="Repeating"><h2 className="label" style={{ fontWeight: 400 }}>Repeating blocks and to-dos</h2>
      {rules.length === 0 && <p className="empty">Open a block or a to-do and choose "Repeat" to make it recur.</p>}
      {rules.length > 0 && <div className="card tight sep" style={{ paddingLeft: 12 }}>{rules.map((r) => (
        <div key={r.id} className="row" style={{ minHeight: 56 }}>
          <span className="col grow" style={{ gap: 0 }}><span>{r.title || 'Untitled'}</span><span className="small muted">{r.kind === 'todo' ? 'To-do' : 'Block'} · {r.start != null ? `${fmtMin(r.start)} · ` : ''}{[...r.days].sort().map((d) => DOW[d]).join(' ')}</span></span>
          <button type="button" className="icon-btn bare" aria-label={`Stop repeating ${r.title}`} onClick={() => { void remove(r.id); say('Stopped repeating. Existing items stay.'); }}><Icon name="trash" size={18} /></button>
        </div>))}</div>}
    </section>
    <section className="col" style={{ gap: 8 }} aria-label="Day and categories"><h2 className="label" style={{ fontWeight: 400 }}>Day and categories</h2>
      <label className="field"><span>Day starts at</span><select className="input" value={s.startHour} onChange={(e) => set('startHour', +e.target.value)}>{[0, 1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
      <p className="small muted">Before this hour, the app still treats the previous date as today. The timeline always shows 00 to 24.</p>
      <ul className="chips" aria-label="Block categories" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{s.cats.map((c) => (
        <li key={c}><button type="button" className="chip plain" aria-label={`Remove category ${c}`} onClick={() => set('cats', s.cats.filter((x) => x !== c))}>{c}<Icon name="close" size={14} /></button></li>))}</ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); const c = cat.trim(); if (c && !s.cats.includes(c)) set('cats', [...s.cats, c]); setCat(''); }}>
        <input className="input grow" aria-label="New category" placeholder="New category" value={cat} maxLength={20} onChange={(e) => setCat(e.target.value)} />
        <button type="submit" className="btn" disabled={!cat.trim()}>Add</button>
      </form>
      <p className="small muted">Removing a category does not change blocks that already use it.</p>
    </section>
  </>;
}
