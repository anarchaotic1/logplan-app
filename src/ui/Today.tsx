import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { addDays, DOW, dow, fmtDur, fmtMin, isoWeek, MONTHS, mondayOf, parseISO, weekDays } from '../lib/dates';
import { byType, byTypeDate, db, patch } from '../lib/db';
import type { Block, Countdown, Habit, HabitLog, Journal, Todo } from '../lib/model';
import { useLive, useNow } from '../hooks';
import { transition, useApp } from '../store';
import { carryCandidates, carryOver, dismissCarry, ensureRecurring, getFocus, setMain, stopFocus, toggleHabit, addBlock } from '../data';
import { isDone } from '../lib/habits';
import { daysBetween } from '../lib/dates';
import { haptic } from '../lib/native';
import { Check, Icon, SPRING } from './common';
import { MiniRing, Ring } from './Ring';

export function dateLabel(date: string) {
  const d = parseISO(date);
  return `${DOW[dow(date)]} ${d.getDate()} ${MONTHS[d.getMonth()]} · WEEK ${isoWeek(date).week}`;
}
export function weekProgress(h: Habit, logs: HabitLog[], today: string) {
  const days = weekDays(mondayOf(today));
  const done = days.filter((d) => isDone(h, logs.find((l) => l.habitId === h.id && l.date === d)?.value)).length;
  const need = h.target.kind === 'weekly' ? h.target.perWeek || 1 : 7 - h.restDays.length;
  return { done, need };
}

export function Today() {
  const { today, min } = useNow();
  const date = useApp((s) => s.date), setDate = useApp((s) => s.setDate), open = useApp((s) => s.open), setTab = useApp((s) => s.setTab);
  const name = useApp((s) => s.settings.name), startHour = useApp((s) => s.settings.startHour);
  const [view, setView] = useState<'home' | 'timeline'>('home');
  const isToday = date === today;
  const blocks = useLive(() => byTypeDate<Block>('block', date), [date], []);
  const todos = useLive(() => byTypeDate<Todo>('todo', date), [date], []);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived).sort((a, b) => a.order - b.order), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', mondayOf(date), addDays(mondayOf(date), 6)), [date], []);
  const journal = useLive(async () => (await db.rec.get(`journal:${date}`)) as Journal | undefined, [date], undefined);
  const carry = useLive(() => (isToday ? carryCandidates(today) : Promise.resolve([])), [today, isToday], []);
  const countdowns = useLive(() => byType<Countdown>('countdown'), [], []);
  const focus = useLive(getFocus, [], null);
  useEffect(() => { if (date >= today) void ensureRecurring(date); }, [date, today]);

  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const upNext = sorted.filter((b) => !b.done && b.title.trim() && (!isToday || b.start + b.dur > min)).slice(0, 2);
  const main = todos.find((t) => t.main);
  const rest = todos.filter((t) => !t.main).sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? 1e9) - (b.time ?? 1e9));
  const hour = Math.floor(min / 60);
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const hasEntry = !!journal && !journal.deleted && !!(journal.text || journal.win || journal.lesson || journal.intention);
  const urgent = countdowns.map((c) => ({ c, n: daysBetween(today, c.target) })).filter((x) => x.n >= 0 && x.n <= 7).sort((a, b) => a.n - b.n);
  const focusBlock = focus ? blocks.find((b) => b.id === focus.blockId) : undefined;
  const step = (n: number) => { haptic(); setDate(addDays(date, n)); };

  if (view === 'timeline') return <Timeline blocks={sorted} date={date} now={isToday ? min : null} startHour={startHour} onBack={() => transition(() => setView('home'))} />;
  return (
    <div className="page">
      <header className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 3 }}>
          <div className="row" style={{ gap: 0, marginLeft: -12, height: 28 }}>
            <button type="button" className="icon-btn bare" style={{ width: 36, height: 44 }} aria-label="Previous day" onClick={() => step(-1)}><Icon name="left" size={14} /></button>
            <span className="label" style={{ whiteSpace: 'nowrap' }}>{dateLabel(date)}</span>
            <button type="button" className="icon-btn bare" style={{ width: 36, height: 44 }} aria-label="Next day" onClick={() => step(1)}><Icon name="right" size={14} /></button>
          </div>
          <h1>{isToday ? `${greet}${name ? `, ${name}` : ''}` : parseISO(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="icon-btn" aria-label="Open year orbit" onClick={() => open('orbit')}><Icon name="orbit" size={22} /></button>
          <button type="button" className="icon-btn" aria-label="Settings" onClick={() => open('settings')}><Icon name="gear" /></button>
        </div>
      </header>

      {!isToday && <button type="button" className="chip on" style={{ alignSelf: 'flex-start' }} onClick={() => setDate(today)}>Back to today</button>}
      {carry.length > 0 && (
        <div className="notice" role="status">
          <span>{carry.length} unfinished from yesterday</span>
          <span className="row" style={{ gap: 4 }}>
            <button type="button" className="btn primary" style={{ minHeight: 44, padding: '0 14px' }} onClick={() => { haptic(); void carryOver(today, carry); }}>Carry over</button>
            <button type="button" className="btn" style={{ border: 0, background: 'none', padding: '0 10px' }} onClick={() => void dismissCarry(today)}>Dismiss</button>
          </span>
        </div>
      )}
      {focusBlock && focus && <FocusBar title={focusBlock.title} startedAt={focus.startedAt} />}

      <SwipeDay onStep={step}>
        <Ring key={date} blocks={sorted} now={isToday ? min : null} onOpen={() => transition(() => setView('timeline'))} caption={isToday ? undefined : 'DAY PLAN'} />
      </SwipeDay>

      {urgent.length > 0 && <div className="chips">{urgent.map(({ c, n }) => <span key={c.id} className="chip on">{c.label} · {n === 0 ? 'today' : `${n}d`}</span>)}</div>}

      <div className="card row" style={{ gap: 14 }}>
        <Check big on={!!main?.done} label="Mark main thing done" onToggle={() => { if (main) void patch<Todo>(main.id, { done: !main.done }); }} />
        <label className="col grow" style={{ gap: 3 }}>
          <span className="label accent" style={{ fontSize: 10.5 }}>{isToday ? "Today's one thing" : 'The one thing'}</span>
          <MainInput key={date + (main?.id || '')} value={main?.text || ''} done={!!main?.done} onSave={(t) => void setMain(date, t)} />
        </label>
      </div>

      <section className="card tight sep" aria-label="Up next">
        {upNext.length === 0 && (
          <button type="button" className="row" style={{ width: '100%', minHeight: 56, textAlign: 'left' }} onClick={async () => { const b = await addBlock(date, Math.min(1380, isToday ? Math.ceil((min + 1) / 60) * 60 : 540)); open('block', { id: b.id, fresh: true }); }}>
            <span className="mono accent" style={{ width: 44, fontSize: 13 }}>+</span><span className="muted">Nothing planned next. Add a block.</span>
          </button>
        )}
        {upNext.map((b) => (
          <button type="button" key={b.id} className="row" style={{ width: '100%', padding: '10px 0', textAlign: 'left', gap: 14 }} onClick={() => open('block', { id: b.id })}>
            <span className="mono accent" style={{ width: 44, fontSize: 13, flex: 'none' }}>{fmtMin(b.start)}</span>
            <span className="col grow" style={{ gap: 2 }}>
              <span style={{ fontWeight: 500 }}>{b.title}</span>
              <span className="muted small">{[b.cue, fmtDur(b.dur)].filter(Boolean).join(' · ')}</span>
            </span>
            {isToday && <span className="mono muted" style={{ fontSize: 11 }}>{b.start > min ? `in ${fmtDur(b.start - min)}` : 'now'}</span>}
          </button>
        ))}
      </section>

      <section className="card tight sep" aria-label="To-dos">
        {rest.map((t) => (
          <div key={t.id} className="row" style={{ padding: '8px 0', minHeight: 48 }}>
            <Check on={t.done} label={`Mark "${t.text}" done`} onToggle={() => void patch<Todo>(t.id, { done: !t.done })} />
            <button type="button" className={`grow${t.done ? ' struck' : ''}`} style={{ textAlign: 'left', minHeight: 44 }} onClick={() => open('todo', { id: t.id })}>
              {t.text}{t.when ? <span className="muted small"> · {t.when}</span> : null}
            </button>
            {t.time != null && <span className="mono muted" style={{ fontSize: 11 }}>{fmtMin(t.time)}</span>}
            {t.remindAt != null && <span className="accent" aria-label={`Reminder at ${fmtMin(t.remindAt)}`}><Icon name="bell" size={14} /></span>}
          </div>
        ))}
        <button type="button" className="row muted" style={{ width: '100%', minHeight: 48, textAlign: 'left' }} onClick={() => open('capture', { mode: 'todo' })}>
          <span className="accent" style={{ width: 28, display: 'inline-flex', justifyContent: 'center' }}><Icon name="plus" size={18} /></span>Add to-do
        </button>
      </section>

      {habits.length > 0 && (
        <div className="row" style={{ gap: 10 }}>
          {habits.slice(0, 3).map((h) => {
            const { done, need } = weekProgress(h, logs, date);
            const cur = logs.find((l) => l.habitId === h.id && l.date === date)?.value;
            return (
              <button type="button" key={h.id} className="card row grow" style={{ padding: '10px 12px', gap: 10, textAlign: 'left', minHeight: 52 }} aria-pressed={isDone(h, cur)}
                aria-label={`${h.name}: ${done} of ${need} this week. ${isDone(h, cur) ? 'Done' : 'Not done'} for this day. Tap to toggle.`} onClick={() => { haptic(isDone(h, cur) ? 'light' : 'success'); void toggleHabit(h, date, cur); }}>
                <MiniRing value={done / need} />
                <span className="col" style={{ gap: 0, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>{done}/{need}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button type="button" className="row" onClick={() => setTab('journal')}
        style={{ height: 56, padding: '0 16px', borderRadius: 28, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(var(--accent-rgb),.10)', textAlign: 'left' }}>
        <span className="accent"><Icon name="journal" /></span>
        <span className="col" style={{ gap: 0, lineHeight: 1.25 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{hasEntry ? "Continue today's entry" : isToday ? "Write today's entry" : 'Write an entry for this day'}</span>
          <span className="muted small">One win · one lesson · tomorrow's plan</span>
        </span>
      </button>
    </div>
  );
}

function MainInput({ value, done, onSave }: { value: string; done: boolean; onSave: (t: string) => void }) {
  const [v, setV] = useState(value);
  return <input className={`plain${done ? ' struck' : ''}`} style={{ fontFamily: 'var(--f-head)', fontSize: 17, fontWeight: 500 }} placeholder="What matters most?" aria-label="The one thing" value={v}
    onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}
function SwipeDay({ children, onStep }: { children: React.ReactNode; onStep: (n: number) => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.div style={{ alignSelf: 'center', touchAction: 'pan-y' }} drag={reduce ? false : 'x'} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.35} dragSnapToOrigin
      onDragEnd={(_, i) => { if (i.offset.x < -70) onStep(1); else if (i.offset.x > 70) onStep(-1); }}>
      {children}
    </motion.div>
  );
}
function FocusBar({ title, startedAt }: { title: string; startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 15000); return () => clearInterval(t); }, []);
  const m = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
  return (
    <div className="notice" role="status">
      <span className="grow">Focus · {title || 'block'} · <span className="mono">{fmtDur(m)}</span></span>
      <button type="button" className="btn primary" style={{ padding: '0 14px' }} onClick={() => { haptic('success'); void stopFocus(true); }}>Done</button>
      <button type="button" className="icon-btn bare" aria-label="Cancel focus timer" onClick={() => void stopFocus(false)}><Icon name="close" size={16} /></button>
    </div>
  );
}

const HOUR = 56;
function lanes(blocks: Block[]) {
  const out: { b: Block; lane: number; of: number }[] = [];
  let group: { b: Block; lane: number; of: number }[] = [], end = -1;
  const flush = () => { const n = Math.max(1, ...group.map((g) => g.lane + 1)); group.forEach((g) => (g.of = n)); out.push(...group); group = []; };
  for (const b of blocks) {
    if (b.start >= end) { flush(); end = -1; }
    const used = new Set(group.filter((g) => g.b.start + Math.max(g.b.dur, 30) > b.start).map((g) => g.lane));
    let lane = 0; while (used.has(lane)) lane++;
    group.push({ b, lane, of: 1 });
    end = Math.max(end, b.start + Math.max(b.dur, 30));
  }
  flush();
  return out;
}
function Timeline({ blocks, date, now, startHour, onBack }: { blocks: Block[]; date: string; now: number | null; startHour: number; onBack: () => void }) {
  const open = useApp((s) => s.open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = now != null ? now - 90 : blocks.length ? blocks[0].start - 60 : startHour * 60;
    ref.current?.closest('.main')?.scrollTo({ top: Math.max(0, (target / 60) * HOUR) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  return (
    <div className="page">
      <header className="row" style={{ position: 'sticky', top: -20, zIndex: 5, background: 'linear-gradient(var(--bg) 70%, transparent)', margin: '-20px -20px 0', padding: '20px 20px 12px' }}>
        <button type="button" className="icon-btn" aria-label="Back to day overview" onClick={onBack}><Icon name="left" /></button>
        <div className="col grow" style={{ gap: 0 }}><span className="label" style={{ whiteSpace: 'nowrap' }}>{dateLabel(date)}</span><h2>Timeline</h2></div>
      </header>
      <div className="tl" ref={ref} style={{ viewTransitionName: 'day-ring' }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div className="tl-hour" key={h}>
            <span>{String(h).padStart(2, '0')}</span>
            <button type="button" aria-label={`Add a block at ${String(h).padStart(2, '0')}:00`} onClick={async () => { haptic(); const b = await addBlock(date, h * 60); open('block', { id: b.id, fresh: true }); }} />
          </div>
        ))}
        {lanes(blocks).map(({ b, lane, of }) => (
          <motion.div layout="position" transition={SPRING} key={b.id} className={`tl-block${b.done ? ' done' : ''}`}
            style={{ top: (b.start / 60) * HOUR + 1, height: Math.max((Math.min(b.dur, 1440 - b.start) / 60) * HOUR - 3, 26), left: `calc(54px + ${(lane / of) * 100}% - ${(lane / of) * 54}px)`, width: `calc(${100 / of}% - ${54 / of}px - ${of > 1 ? 4 : 0}px)`, right: 'auto' }}>
            <Check on={b.done} label={`Mark ${b.title || 'block'} done`} onToggle={() => void patch<Block>(b.id, { done: !b.done })} />
            <button type="button" className="grow" onClick={() => open('block', { id: b.id })}>
              <span style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} className={b.done ? 'muted' : ''}>{b.title || b.log || 'Untitled'}</span>
              {b.dur >= 45 && <span className="muted small">{fmtMin(b.start)} · {fmtDur(b.dur)}{b.cue ? ` · ${b.cue}` : ''}</span>}
              {b.dur >= 90 && b.title && b.log && <span className="small" style={{ marginTop: 2 }}>{b.log}</span>}
            </button>
          </motion.div>
        ))}
        {now != null && <div className="tl-now" style={{ top: (now / 60) * HOUR }} aria-hidden="true" />}
      </div>
    </div>
  );
}
