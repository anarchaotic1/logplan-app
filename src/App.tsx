import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { addDays } from './lib/dates';
import { byType, byTypeDate } from './lib/db';
import type { Block, Habit, HabitLog, Todo } from './lib/model';
import { adherence } from './lib/insights';
import { planNotifications } from './lib/notif';
import { applyNotifications, onBack, onResume, unlock } from './lib/native';
import { onDirty } from './lib/db';
import { useLive, useMedia, useNow } from './hooks';
import { TABS, useApp, type Tab } from './store';
import { Icon, SPRING } from './ui/common';
import { Today, dateLabel } from './ui/Today';
import { Journal } from './ui/Journal';
import { Habits } from './ui/Habits';
import { Insights } from './ui/Insights';
import { Plan } from './ui/Plan';
import { Sheets } from './ui/Sheets';
import { MiniRing } from './ui/Ring';
import { fmtMin } from './lib/dates';

const LABEL: Record<Tab, string> = { today: 'Today', journal: 'Journal', habits: 'Habits', insights: 'Insights', plan: 'Plan' };
const STARS: [number, number, number, number][] = [[11, 7, 2, 0.9], [34, 3, 1, 0.8], [71, 12, 2, 0.75], [93, 31, 1, 0.8], [6, 36, 1, 0.7], [88, 58, 2, 0.6], [17, 71, 1, 0.7], [52, 66, 1, 0.6], [63, 88, 2, 0.45]];
const TWINKLE: [number, number, number][] = [[16, 11, 0], [81, 25, 1.4], [6, 48, 2.6]];

function Sky({ glow }: { glow: number }) {
  return (
    <div className="sky" aria-hidden="true" style={{ ['--glow' as string]: glow }}>
      {STARS.map(([x, y, s, o], i) => <i key={i} style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, opacity: o }} />)}
      {TWINKLE.map(([x, y, d], i) => <i key={`t${i}`} className="tw" style={{ left: `${x}%`, top: `${y}%`, width: 2, height: 2, animationDelay: `${d}s` }} />)}
    </div>
  );
}
function Cursor() {
  const dot = useRef<HTMLDivElement>(null), ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let x = -100, y = -100, rx = x, ry = y, raf = 0, moving = false;
    const loop = () => { rx += (x - rx) * 0.18; ry += (y - ry) * 0.18; if (ring.current) ring.current.style.transform = `translate(${rx}px,${ry}px)`; if (Math.abs(x - rx) + Math.abs(y - ry) > 0.3) raf = requestAnimationFrame(loop); else moving = false; };
    const move = (e: PointerEvent) => { x = e.clientX; y = e.clientY; if (dot.current) dot.current.style.transform = `translate(${x}px,${y}px)`; if (!moving) { moving = true; raf = requestAnimationFrame(loop); } };
    const down = () => ring.current?.classList.add('down'), up = () => ring.current?.classList.remove('down');
    window.addEventListener('pointermove', move, { passive: true }); window.addEventListener('pointerdown', down); window.addEventListener('pointerup', up);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); };
  }, []);
  return <><div ref={ring} className="cursor-ring" aria-hidden="true" /><div ref={dot} className="cursor-dot" aria-hidden="true" /></>;
}
function Glance() {
  const { today, min } = useNow();
  const setTab = useApp((s) => s.setTab), setDate = useApp((s) => s.setDate), open = useApp((s) => s.open);
  const blocks = useLive(async () => (await byTypeDate<Block>('block', today)).sort((a, b) => a.start - b.start), [today], []);
  const todos = useLive(() => byTypeDate<Todo>('todo', today), [today], []);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', today), [today], []);
  const adh = adherence(blocks);
  const next = blocks.filter((b) => !b.done && b.title.trim() && b.start + b.dur > min).slice(0, 4);
  return (
    <aside className="glance" aria-label="Day at a glance">
      <span className="label">{dateLabel(today)}</span>
      <button type="button" className="card click row" onClick={() => { setDate(today); setTab('today'); }}>
        <MiniRing value={adh?.value ?? 0} size={44} />
        <span className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: 26 }}>{adh ? `${blocks.filter((b) => b.done && b.title.trim()).length}/${adh.n}` : '0'}</span><span className="label">blocks done · {fmtMin(min)}</span></span>
      </button>
      <span className="label">Up next</span>
      <div className="card tight sep">{next.length ? next.map((b) => <button type="button" key={b.id} className="row" style={{ width: '100%', minHeight: 44, textAlign: 'left' }} onClick={() => open('block', { id: b.id })}><span className="mono accent small" style={{ width: 44 }}>{fmtMin(b.start)}</span><span className="grow small">{b.title}</span></button>) : <p className="empty">Nothing planned next.</p>}</div>
      <span className="label">To-dos · {todos.filter((t) => t.done).length}/{todos.length}</span>
      <div className="card tight sep">{todos.filter((t) => !t.done).slice(0, 6).map((t) => <button type="button" key={t.id} className="row small" style={{ width: '100%', minHeight: 44, textAlign: 'left' }} onClick={() => open('todo', { id: t.id })}>{t.text}</button>)}{todos.every((t) => t.done) && <p className="empty">All clear.</p>}</div>
      <span className="label">Habits today · {habits.filter((h) => (logs.find((l) => l.habitId === h.id)?.value || 0) > 0).length}/{habits.length}</span>
      <p className="small muted" style={{ marginTop: 'auto' }}><kbd>N</kbd> capture · <kbd>1</kbd>–<kbd>5</kbd> sections · <kbd>T</kbd> today · <kbd>J</kbd> journal · <kbd>←</kbd><kbd>→</kbd> day</p>
    </aside>
  );
}

export function App() {
  const tab = useApp((s) => s.tab), setTab = useApp((s) => s.setTab), ready = useApp((s) => s.ready), sheet = useApp((s) => s.sheet), toast = useApp((s) => s.toast);
  const open = useApp((s) => s.open), lock = useApp((s) => s.settings.lock);
  const { today } = useNow();
  const wide = useMedia('(min-width: 860px)'), fine = useMedia('(pointer: fine)');
  const [locked, setLocked] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const todayBlocks = useLive(() => byTypeDate<Block>('block', today), [today], []);
  const glow = adherence(todayBlocks)?.value ?? 0.35;

  // App lock: on start and whenever the app returns from the background.
  useEffect(() => {
    if (!ready || !lock) return;
    const ask = async () => { setLocked(true); if (await unlock()) setLocked(false); };
    void ask();
    return onResume(() => void ask());
  }, [ready, lock]);
  // Keep scheduled notifications in step with the data (debounced; looks ahead only).
  useEffect(() => {
    if (!ready) return;
    let t: ReturnType<typeof setTimeout>;
    const run = async () => {
      const now = new Date(), horizon = addDays(today, 30);
      const habits = await byType<Habit>('habit');
      const doneToday: Record<string, number> = {};
      (await byTypeDate<HabitLog>('habitLog', today)).forEach((l) => (doneToday[l.habitId] = l.value));
      await applyNotifications(planNotifications({ now, today, habits, doneToday, blocks: await byTypeDate<Block>('block', today, horizon), todos: await byTypeDate<Todo>('todo', today, horizon) })).catch(() => {});
    };
    const soon = () => { clearTimeout(t); t = setTimeout(() => void run(), 1500); };
    soon();
    const off = onDirty(soon);
    return () => { clearTimeout(t); off(); };
  }, [ready, today]);
  // Android back button: close a sheet, else go to Today, else leave the app.
  useEffect(() => onBack(() => { const s = useApp.getState(); if (s.sheet) { s.close(); return true; } if (s.tab !== 'today') { s.setTab('today'); return true; } return false; }), []);
  // Hide the bottom bar while the on-screen keyboard is open.
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return;
    const h = () => document.body.classList.toggle('kb', window.innerHeight - vv.height > 140);
    vv.addEventListener('resize', h); return () => vv.removeEventListener('resize', h);
  }, []);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [tab]);
  // Keyboard shortcuts (laptop). Never while typing.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input,textarea,select,[contenteditable]')) return;
      const s = useApp.getState();
      if (s.sheet) return;
      const k = e.key.toLowerCase();
      if (k === 'n') { e.preventDefault(); s.open('capture'); }
      else if (k >= '1' && k <= '5') s.setTab(TABS[+k - 1]);
      else if (k === 't') { s.setDate(today); s.setTab('today'); }
      else if (k === 'j') s.setTab('journal');
      else if (k === 'arrowleft') s.setDate(addDays(s.date, -1));
      else if (k === 'arrowright') s.setDate(addDays(s.date, 1));
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [today]);

  if (!ready) return <Sky glow={0.3} />;
  const tabs = (cls: string, id: string) => TABS.map((t, i) => (
    <button type="button" key={t} className={`tab${tab === t ? ' on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
      {tab === t && <motion.span layoutId={`pill-${id}`} className="pill" transition={SPRING} />}
      <Icon name={t} size={22} />{LABEL[t]}{cls === 'side' && <kbd>{i + 1}</kbd>}
    </button>
  ));
  return (
    <MotionConfig reducedMotion="user">
      <Sky glow={glow} />
      <div className="shell" inert={locked || undefined}>
        <nav className="side" aria-label="Sections">
          <div className="row" style={{ padding: '0 14px 18px', fontFamily: 'var(--f-head)', fontWeight: 600, fontSize: 18 }}>LOG<span className="muted" style={{ fontWeight: 400 }}>/PLAN</span></div>
          {wide && tabs('side', 'side')}
          <button type="button" className="tab" style={{ marginTop: 'auto' }} onClick={() => open('settings')}><Icon name="gear" />Settings</button>
        </nav>
        <main className="main" ref={mainRef} id="main">
          {tab === 'today' && <Today />}
          {tab === 'journal' && <Journal />}
          {tab === 'habits' && <Habits />}
          {tab === 'insights' && <Insights />}
          {tab === 'plan' && <Plan />}
        </main>
        {wide && <Glance />}
        {!wide && <nav className="nav" aria-label="Sections">{tabs('nav', 'nav')}</nav>}
        {!sheet && <button type="button" className="fab" aria-label="Quick capture" onClick={() => open('capture')}><Icon name="plus" size={24} /></button>}
      </div>
      <Sheets />
      <AnimatePresence>
        {toast && <motion.div key={toast.id} className="toast" role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={SPRING}>
          <span>{toast.text}</span>{toast.action && <button type="button" onClick={() => { toast.action!.run(); useApp.setState({ toast: null }); }}>{toast.action.label}</button>}
        </motion.div>}
      </AnimatePresence>
      {locked && <div className="lock" role="dialog" aria-modal="true" aria-label="Log/Plan is locked">
        <span className="accent"><Icon name="lock" size={40} /></span><h1>Locked</h1>
        <button type="button" className="btn primary" onClick={async () => { if (await unlock()) setLocked(false); }}>Unlock</button>
      </div>}
      {fine && wide && <Cursor />}
    </MotionConfig>
  );
}
