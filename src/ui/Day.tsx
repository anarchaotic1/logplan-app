import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { addDays, daysBetween, DOW, dow, fmtDur, fmtMin, isoWeek, MONTHS, mondayOf, parseISO, weekDays, type ISODate } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import type { Block, Countdown, Habit, HabitLog, Journal, Meal, Todo } from '../lib/model';
import { useDebounced, useLive, useNow, useReduce } from '../hooks';
import { transition, useApp } from '../store';
import { addBlock, carryCandidates, carryOver, dismissCarry, ensureRecurring, getFocus, saveJournal, stopFocus } from '../data';
import { isDone } from '../lib/habits';
import { haptic } from '../lib/native';
import { tickHabit, toggleBlock, toggleTodo } from './act';
import { AutoText, Check, Icon, SPRING, SwipeRow } from './common';
import { MiniRing, Ring } from './Ring';
import { SleepCard } from './SleepArc';

export function dateLabel(date: string) {
  const d = parseISO(date);
  return `${DOW[dow(date)]} ${d.getDate()} ${MONTHS[d.getMonth()]} · WEEK ${isoWeek(date).week}`;
}
export const longDate = (date: string) => parseISO(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
export function weekProgress(h: Habit, logs: HabitLog[], day: string) {
  const days = weekDays(mondayOf(day));
  const done = days.filter((d) => isDone(h, logs.find((l) => l.habitId === h.id && l.date === d)?.value)).length;
  const need = h.target.kind === 'weekly' ? h.target.perWeek || 1 : 7 - h.restDays.length;
  return { done, need };
}
/** Horizontal swipe that steps one day back or forward. The arrow buttons next to it do the same without a gesture. */
function SwipeDay({ children, onStep, style }: { children: ReactNode; onStep: (n: number) => void; style?: React.CSSProperties }) {
  const reduce = useReduce();
  return (
    <motion.div style={{ touchAction: 'pan-y', ...style }} drag={reduce ? false : 'x'} dragDirectionLock dragConstraints={{ left: 0, right: 0 }} dragElastic={0.3} dragSnapToOrigin
      onDragEnd={(_, i) => { if (i.offset.x < -64 || i.velocity.x < -500) onStep(1); else if (i.offset.x > 64 || i.velocity.x > 500) onStep(-1); }}>
      {children}
    </motion.div>
  );
}

/** One day, in full and editable. The Today tab shows it for the selected date; the Calendar opens any day in it. */
export function DayView({ date, onDate, mode, onBack }: { date: ISODate; onDate: (d: ISODate) => void; mode: 'today' | 'calendar'; onBack?: () => void }) {
  const { today, min } = useNow();
  const open = useApp((s) => s.open), setTab = useApp((s) => s.setTab), setDate = useApp((s) => s.setDate), dir = useApp((s) => s.dir);
  const name = useApp((s) => s.settings.name), startHour = useApp((s) => s.settings.startHour);
  const reduce = useReduce();
  const [view, setView] = useState<'home' | 'timeline'>('home');
  const isToday = date === today;
  const blocks = useLive(async () => (await byTypeDate<Block>('block', date)).sort((a, b) => a.start - b.start), [date], []);
  const todos = useLive(() => byTypeDate<Todo>('todo', date), [date], []);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived).sort((a, b) => a.order - b.order), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', mondayOf(date), addDays(mondayOf(date), 6)), [date], []);
  const meals = useLive(async () => (await byTypeDate<Meal>('meal', date)).sort((a, b) => a.time - b.time), [date], []);
  const carry = useLive(() => (isToday ? carryCandidates(today) : Promise.resolve([])), [today, isToday], []);
  const countdowns = useLive(() => byType<Countdown>('countdown'), [], []);
  const focus = useLive(getFocus, [], null);
  useEffect(() => { if (date >= today) void ensureRecurring(date); }, [date, today]);

  const list = blocks.filter((b) => b.title.trim() || b.log.trim());
  const next = isToday ? list.find((b) => !b.done && b.start + b.dur > min) : undefined;
  const rest = [...todos].sort((a, b) => Number(a.done) - Number(b.done) || Number(!!b.main) - Number(!!a.main) || (a.time ?? 1e9) - (b.time ?? 1e9));
  const hour = Math.floor(min / 60);
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const urgent = countdowns.map((c) => ({ c, n: daysBetween(date, c.target) })).filter((x) => x.n >= 0 && x.n <= 7).sort((a, b) => a.n - b.n);
  const focusBlock = focus ? blocks.find((b) => b.id === focus.blockId) : undefined;
  const step = (n: number) => { haptic(); onDate(addDays(date, n)); };
  const newBlock = async () => { const b = await addBlock(date, Math.min(1380, isToday ? Math.ceil((min + 1) / 60) * 60 : 540)); open('block', { id: b.id, fresh: true }); };
  // Day changes slide in from the side they came from; the ring moves less than the cards (parallax).
  const enter = (depth: number) => (reduce || !dir ? { initial: { opacity: 0 }, animate: { opacity: 1 } } : { initial: { opacity: 0, x: dir * depth }, animate: { opacity: 1, x: 0 } });

  if (view === 'timeline') return <Timeline blocks={blocks} date={date} now={isToday ? min : null} startHour={startHour} onBack={() => transition(() => setView('home'))} />;
  return (
    <div className="page" style={mode === 'calendar' ? { viewTransitionName: 'cal-day' } : undefined}>
      <header className="col" style={{ gap: 6 }}>
        <div className="row between" style={{ gap: 4 }}>
          {onBack && <button type="button" className="icon-btn" aria-label="Back to the month" onClick={onBack}><Icon name="left" /></button>}
          <button type="button" className="icon-btn bare" aria-label="Previous day" onClick={() => step(-1)}><Icon name="left" size={18} /></button>
          <SwipeDay onStep={step} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}><span className="label" style={{ display: 'block', padding: '14px 0' }}>{dateLabel(date)}</span></SwipeDay>
          <button type="button" className="icon-btn bare" aria-label="Next day" onClick={() => step(1)}><Icon name="right" size={18} /></button>
          {mode === 'today' && <button type="button" className="icon-btn" aria-label="Settings" onClick={() => open('settings')}><Icon name="gear" /></button>}
        </div>
        <h1>{isToday ? `${greet}${name ? `, ${name}` : ''}` : longDate(date)}</h1>
      </header>

      {!isToday && mode === 'today' && <button type="button" className="chip on plain" style={{ alignSelf: 'flex-start' }} onClick={() => onDate(today)}>Back to today</button>}
      {carry.length > 0 && (
        <div className="notice" role="status">
          <span>{carry.length} unfinished from yesterday</span>
          <span className="row" style={{ gap: 4 }}>
            <button type="button" className="btn primary" onClick={() => { haptic(); void carryOver(today, carry); }}>Carry over</button>
            <button type="button" className="btn quiet" onClick={() => void dismissCarry(today)}>Dismiss</button>
          </span>
        </div>
      )}
      {focusBlock && focus && <FocusBar title={focusBlock.title} startedAt={focus.startedAt} />}

      <motion.div key={`r${date}`} {...enter(26)} transition={SPRING} style={{ alignSelf: 'center' }}>
        <SwipeDay onStep={step}>
          <Ring blocks={blocks} now={isToday ? min : null} onOpen={() => transition(() => setView('timeline'))} caption={isToday ? undefined : 'DAY PLAN'} />
        </SwipeDay>
      </motion.div>

      <motion.div key={`c${date}`} className="col" style={{ gap: 14 }} {...enter(64)} transition={SPRING}>
        {urgent.length > 0 && <ul className="chips" aria-label="Countdowns" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{urgent.map(({ c, n }) => <li key={c.id} className="tag" style={{ padding: '6px 10px' }}>{c.label} · {n === 0 ? 'today' : `${n}d`}</li>)}</ul>}

        <Intention date={date} />

        <section className="card tight" aria-label="Blocks">
          <div className="head" style={{ paddingLeft: 12 }}>
            <h2 className="label" style={{ fontWeight: 400 }}>Blocks{list.length ? ` · ${list.filter((b) => b.done).length}/${list.length}` : ''}</h2>
            <button type="button" className="btn quiet small" onClick={() => transition(() => setView('timeline'))}><Icon name="hours" size={16} />Hour view</button>
          </div>
          <div className="sep">
            {list.map((b) => (
              <SwipeRow key={b.id} onCommit={(el) => toggleBlock(b, el)}>
                <Check on={b.done} label={`${b.done ? 'Completed' : 'Complete'}: ${b.title || b.log}`} onToggle={(el) => toggleBlock(b, el)} />
                <span className="do-time">{fmtMin(b.start)}</span>
                <button type="button" className="do-title" onClick={() => open('block', { id: b.id })}>
                  <span className={b.done ? 'struck' : ''} style={{ fontWeight: 500 }}><span className="sr">Edit block </span>{b.title || b.log}</span>
                  <span className="muted small">{[fmtDur(b.dur), b.cat, b.cue].filter(Boolean).join(' · ')}</span>
                </button>
                {next?.id === b.id && <span className="tag">{b.start > min ? `next · ${fmtDur(b.start - min)}` : 'now'}</span>}
              </SwipeRow>
            ))}
            <button type="button" className="row muted" style={{ width: '100%', minHeight: 52, paddingLeft: 12 }} onClick={() => void newBlock()}>
              <span className="accent" style={{ display: 'inline-flex' }}><Icon name="plus" size={18} /></span>{list.length ? 'Add block' : 'Nothing planned yet. Add a block.'}
            </button>
          </div>
        </section>

        <section className="card tight" aria-label="To-dos">
          <div className="head" style={{ paddingLeft: 12 }}><h2 className="label" style={{ fontWeight: 400 }}>To-dos{todos.length ? ` · ${todos.filter((t) => t.done).length}/${todos.length}` : ''}</h2></div>
          <div className="sep">
            {rest.map((t) => (
              <SwipeRow key={t.id} onCommit={(el) => toggleTodo(t, el)}>
                <Check on={t.done} label={`${t.done ? 'Completed' : 'Complete'}: ${t.text}`} onToggle={(el) => toggleTodo(t, el)} />
                <button type="button" className="do-title" onClick={() => open('todo', { id: t.id })}>
                  <span className={t.done ? 'struck' : ''}><span className="sr">Edit to-do </span>{t.text}</span>
                  {(t.when || t.carriedFrom) && <span className="muted small">{[t.when, t.carriedFrom ? 'carried over' : ''].filter(Boolean).join(' · ')}</span>}
                </button>
                {t.time != null && <span className="mono muted small">{fmtMin(t.time)}</span>}
                {t.remindAt != null && <span className="accent" role="img" aria-label={`Reminder at ${fmtMin(t.remindAt)}`} style={{ display: 'inline-flex' }}><Icon name="bell" size={16} /></span>}
              </SwipeRow>
            ))}
            <button type="button" className="row muted" style={{ width: '100%', minHeight: 52, paddingLeft: 12 }} onClick={() => open('capture', { mode: 'todo', date })}>
              <span className="accent" style={{ display: 'inline-flex' }}><Icon name="plus" size={18} /></span>Add to-do
            </button>
          </div>
        </section>

        {habits.length > 0 && (
          <section aria-label="Habits" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
            {habits.map((h) => {
              const { done, need } = weekProgress(h, logs, date);
              const cur = logs.find((l) => l.habitId === h.id && l.date === date)?.value;
              const on = isDone(h, cur);
              return (
                <button type="button" key={h.id} className="card row" style={{ padding: '8px 12px', gap: 10, minHeight: 56, borderColor: on ? 'var(--a50)' : undefined, background: on ? 'var(--a08)' : undefined }} role="checkbox" aria-checked={on} onClick={(e) => tickHabit(h, date, cur, e.currentTarget.querySelector('svg'))}>
                  <MiniRing value={done / need} />
                  <span className="col grow" style={{ gap: 0 }}>
                    <span className="clip small" style={{ fontWeight: 500 }}>{h.name}<span className="sr">, {on ? 'done' : 'not done'} for this day,</span></span>
                    <span className="mono muted tiny"><span aria-hidden="true">{on ? '✓ ' : ''}</span>{done}/{need}<span className="sr"> this week</span></span>
                  </span>
                </button>
              );
            })}
          </section>
        )}

        {date <= today && <SleepCard date={date} isToday={isToday} />}

        <button type="button" className="card row" style={{ width: '100%', minHeight: 56 }} onClick={() => { setDate(date); setTab('meals'); }}>
          <span className="accent" style={{ display: 'inline-flex' }}><Icon name="meals" size={22} /></span>
          <span className="col grow" style={{ gap: 0 }}><span>Meals{meals.length ? ` · ${meals.length}` : ''}</span><span className="muted small clip">{meals.length ? meals.map((m) => m.name).join(', ') : 'Nothing logged for this day.'}</span></span>
          <Icon name="right" size={18} />
        </button>
      </motion.div>
    </div>
  );
}

/** The morning intention: one short line for the day, saved as you type. It is the only part of the old journal that is still shown. */
function Intention({ date }: { date: ISODate }) {
  const stored = useLive(async () => { const j = (await db.rec.get(`journal:${date}`)) as Journal | undefined; return j && !j.deleted ? j.intention : ''; }, [date], null as string | null);
  const [v, setV] = useState<string | null>(null);
  const dirty = useRef(false);
  useEffect(() => { setV(null); dirty.current = false; }, [date]);
  useEffect(() => { if (!dirty.current && stored != null) setV(stored); }, [stored]);
  const save = useDebounced((text: string) => { void saveJournal(date, { intention: text }); }, 500);
  return (
    <section className="card col" aria-label="Morning intention" style={{ gap: 4 }}>
      <h2 className="label accent" style={{ fontWeight: 400 }}>Morning intention</h2>
      <AutoText className="bare-input" label="Morning intention" placeholder="What matters most today?" value={v ?? ''} onChange={(t) => { dirty.current = true; setV(t); save(t); }}
        onBlur={() => { if (dirty.current && v != null) { void saveJournal(date, { intention: v.trim() }); dirty.current = false; } }} />
    </section>
  );
}
function FocusBar({ title, startedAt }: { title: string; startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 15000); return () => clearInterval(t); }, []);
  const m = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
  return (
    <div className="notice" role="status">
      <span className="grow">Focus · {title || 'block'} · <span className="mono">{fmtDur(m)}</span></span>
      <span className="row" style={{ gap: 4 }}>
        <button type="button" className="btn primary" onClick={() => { haptic('success'); void stopFocus(true); }}>Done</button>
        <button type="button" className="icon-btn bare" aria-label="Cancel focus timer" onClick={() => void stopFocus(false)}><Icon name="close" size={18} /></button>
      </span>
    </div>
  );
}

const HOUR = 96;
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
/** Hour-by-hour view of the day, 00 to 24. Tap an empty hour to add a block; every block has its own one-tap check. */
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
      <header className="row" style={{ position: 'sticky', top: -18, zIndex: 5, background: 'linear-gradient(var(--bg) 72%, transparent)', margin: '-18px -16px 0', padding: '18px 16px 12px' }}>
        <button type="button" className="icon-btn" aria-label="Back to the day overview" onClick={onBack}><Icon name="left" /></button>
        <div className="col grow" style={{ gap: 0 }}><span className="label">{dateLabel(date)}</span><h1 style={{ fontSize: '1.1875rem' }}>Hour view</h1></div>
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
            style={{ top: (b.start / 60) * HOUR + 1, height: Math.max((Math.min(Math.max(b.dur, 30), 1440 - b.start) / 60) * HOUR - 2, 46), left: `calc(54px + ${(lane / of) * 100}% - ${(lane / of) * 54}px)`, width: `calc(${100 / of}% - ${54 / of}px - ${of > 1 ? 4 : 0}px)` }}>
            <Check on={b.done} label={`${b.done ? 'Completed' : 'Complete'}: ${b.title || b.log || 'block'}`} onToggle={(el) => toggleBlock(b, el)} />
            <button type="button" className="grow" onClick={() => open('block', { id: b.id })}>
              <span className={`clip${b.done ? ' struck' : ''}`} style={{ fontWeight: 500 }}><span className="sr">Edit block </span>{b.title || b.log || 'Untitled'}</span>
              {b.dur >= 45 && <span className="muted small clip">{fmtMin(b.start)} · {fmtDur(b.dur)}{b.cue ? ` · ${b.cue}` : ''}</span>}
              {b.dur >= 90 && b.title && b.log && <span className="small clip">{b.log}</span>}
            </button>
          </motion.div>
        ))}
        {now != null && <div className="tl-now" style={{ top: (now / 60) * HOUR }} aria-hidden="true" />}
      </div>
    </div>
  );
}
