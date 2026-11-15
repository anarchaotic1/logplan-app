import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { addDays, fmtMin } from './lib/dates';
import { byType, byTypeDate, db, kvGet, kvSet, onDirty } from './lib/db';
import type { Block, Habit, HabitLog, Todo } from './lib/model';
import { adherence } from './lib/day';
import { isDone } from './lib/habits';
import { planNotifications } from './lib/notif';
import { applyNotifications, onBack, onResume, unlock } from './lib/native';
import { referencedPhotos } from './lib/sync';
import { useLive, useMedia, useNow, useReduce } from './hooks';
import { getFocus } from './data';
import { TABS, transition, useApp, type Tab } from './store';
import { Check, Icon, SPRING } from './ui/common';
import { DayView, dateLabel } from './ui/Day';
import { Calendar } from './ui/Calendar';
import { Meals, MealView, PhotoViewer } from './ui/Meals';
import { Habits } from './ui/Habits';
import { Sheets } from './ui/Sheets';
import { MiniRing } from './ui/Ring';
import { SkyBackground } from './ui/Sky';
import { FocusOverlay } from './ui/Focus';
import { tickHabit, toggleBlock, toggleTodo } from './ui/act';

const LABEL: Record<Tab, string> = { today: 'Today', calendar: 'Calendar', meals: 'Meals', habits: 'Habits' };

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
/** Laptop only: today at a glance, with the same one-tap checks as the main pane. */
function Glance() {
  const { today, min } = useNow();
  const setTab = useApp((s) => s.setTab), setDate = useApp((s) => s.setDate);
  const blocks = useLive(async () => (await byTypeDate<Block>('block', today)).sort((a, b) => a.start - b.start), [today], []);
  const todos = useLive(() => byTypeDate<Todo>('todo', today), [today], []);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived).sort((a, b) => a.order - b.order), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', today), [today], []);
  const adh = adherence(blocks);
  const next = blocks.filter((b) => !b.done && b.title.trim() && b.start + b.dur > min).slice(0, 4);
  const open = todos.filter((t) => !t.done).slice(0, 6);
  return (
    <aside className="glance" aria-label="Today at a glance">
      <span className="label">{dateLabel(today)}</span>
      <button type="button" className="card row" style={{ width: '100%' }} onClick={() => { setDate(today); setTab('today'); }}>
        <MiniRing value={adh?.value ?? 0} size={44} />
        <span className="col" style={{ gap: 0 }}><span className="big-num" style={{ fontSize: '1.625rem' }}>{adh ? `${adh.done}/${adh.n}` : '0'}</span><span className="label">blocks done · {fmtMin(min)}</span></span>
      </button>
      <h2 className="label" style={{ fontWeight: 400 }}>Up next</h2>
      <div className="card tight sep">{next.length ? next.map((b) => <div key={b.id} className="row" style={{ gap: 4, minHeight: 52 }}><Check on={b.done} label={`Complete: ${b.title}`} onToggle={(el) => toggleBlock(b, el)} /><span className="do-time">{fmtMin(b.start)}</span><span className="grow small">{b.title}</span></div>) : <p className="empty">Nothing planned next.</p>}</div>
      <h2 className="label" style={{ fontWeight: 400 }}>To-dos · {todos.filter((t) => t.done).length}/{todos.length}</h2>
      <div className="card tight sep">{open.map((t) => <div key={t.id} className="row" style={{ gap: 4, minHeight: 52 }}><Check on={t.done} label={`Complete: ${t.text}`} onToggle={(el) => toggleTodo(t, el)} /><span className="grow small">{t.text}</span></div>)}{open.length === 0 && <p className="empty">All clear.</p>}</div>
      <h2 className="label" style={{ fontWeight: 400 }}>Habits today</h2>
      <div className="card tight sep">{habits.map((h) => { const cur = logs.find((l) => l.habitId === h.id)?.value; return <div key={h.id} className="row" style={{ gap: 4, minHeight: 52 }}><Check on={isDone(h, cur)} label={`${isDone(h, cur) ? 'Completed' : 'Complete'}: ${h.name}`} onToggle={(el) => tickHabit(h, today, cur, el)} /><span className="grow small">{h.name}</span></div>; })}{habits.length === 0 && <p className="empty">No habits yet.</p>}</div>
      <p className="small muted" style={{ marginTop: 'auto', lineHeight: 2 }}><kbd>N</kbd> capture · <kbd>1</kbd>–<kbd>4</kbd> sections · <kbd>T</kbd> today · <kbd>←</kbd><kbd>→</kbd> day · <kbd>/</kbd> search · <kbd>X</kbd> complete the focused row</p>
    </aside>
  );
}

export function App() {
  const tab = useApp((s) => s.tab), setTab = useApp((s) => s.setTab), ready = useApp((s) => s.ready), sheet = useApp((s) => s.sheet), toast = useApp((s) => s.toast), live = useApp((s) => s.live);
  const date = useApp((s) => s.date), setDate = useApp((s) => s.setDate), viewer = useApp((s) => s.viewer);
  const open = useApp((s) => s.open), lock = useApp((s) => s.settings.lock), largeText = useApp((s) => s.settings.largeText);
  const mealOpen = useApp((s) => s.mealOpen), focusHidden = useApp((s) => s.focusHidden);
  const focus = useLive(getFocus, [], null);
  const { today } = useNow();
  const reduce = useReduce();
  const wide = useMedia('(min-width: 860px)'), fine = useMedia('(pointer: fine)');
  const [locked, setLocked] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { document.documentElement.classList.toggle('rm', reduce); }, [reduce]);
  useEffect(() => { document.documentElement.classList.toggle('lg', largeText); }, [largeText]);
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
  // Photos removed by the user in an earlier session: drop the bytes now (sync, when connected, also clears the remote copy).
  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const trash = await kvGet<string[]>('photoTrash', []);
      if (!trash.length || (await kvGet('sync', null))) return;
      const used = await referencedPhotos(db);
      await db.photos.bulkDelete(trash.filter((id) => !used.has(id)));
      await kvSet('photoTrash', []);
    })();
  }, [ready]);
  // Android back button: close the photo, a sheet, an opened calendar day, else go to Today, else leave the app.
  useEffect(() => onBack(() => {
    const s = useApp.getState();
    if (s.viewer) { useApp.setState({ viewer: null }); return true; }
    if (document.querySelector('.eclipse')) { useApp.setState({ focusHidden: true }); return true; }
    if (s.mealOpen) { useApp.setState({ mealOpen: null }); return true; }
    if (s.sheet) { s.close(); return true; }
    if (s.tab === 'calendar' && s.calDay) { transition(() => s.setCalDay(null)); return true; }
    if (s.tab !== 'today') { s.setTab('today'); return true; }
    return false;
  }), []);
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
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input,textarea,select,[contenteditable],[role=slider]')) return;
      const s = useApp.getState();
      if (s.sheet || s.viewer || s.mealOpen || document.querySelector('.eclipse')) return;
      const k = e.key.toLowerCase();
      const stepDay = (n: number) => { if (s.tab === 'calendar' && s.calDay) s.setCalDay(addDays(s.calDay, n)); else if (s.tab !== 'calendar') s.setDate(addDays(s.date, n)); };
      if (k === 'n') { e.preventDefault(); s.open('capture'); }
      else if (k >= '1' && k <= '4') s.setTab(TABS[+k - 1]);
      else if (k === 't') { s.setDate(today); s.setTab('today'); }
      else if (k === '/') { e.preventDefault(); s.setCalDay(null); s.setTab('calendar'); setTimeout(() => document.querySelector<HTMLInputElement>('input[type=search]')?.focus(), 350); }
      else if (k === 'arrowleft') stepDay(-1);
      else if (k === 'arrowright') stepDay(1);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [today]);

  if (!ready) return <SkyBackground />;
  const tabs = (cls: string) => TABS.map((t, i) => (
    <button type="button" key={t} className={`tab${tab === t ? ' on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
      {tab === t && <motion.span layoutId={`pill-${cls}`} className="pill" transition={SPRING} />}
      <Icon name={t} size={22} />{LABEL[t]}{cls === 'side' && <kbd>{i + 1}</kbd>}
    </button>
  ));
  const modal = locked || !!viewer || !!mealOpen || (!!focus && !focusHidden);
  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>
      <SkyBackground />
      <div className="shell" inert={modal || undefined}>
        {wide && <nav className="side" aria-label="Sections">
          <div className="row" style={{ padding: '0 14px 18px', fontFamily: 'var(--f-head)', fontWeight: 600, fontSize: '1.125rem' }}>LOG<span className="muted" style={{ fontWeight: 400 }}>/PLAN</span></div>
          {tabs('side')}
          <button type="button" className="tab" style={{ marginTop: 'auto' }} onClick={() => open('settings')}><Icon name="gear" />Settings</button>
        </nav>}
        <main className="main" ref={mainRef} id="main">
          {tab === 'today' && <DayView date={date} onDate={setDate} mode="today" />}
          {tab === 'calendar' && <Calendar />}
          {tab === 'meals' && <Meals />}
          {tab === 'habits' && <Habits />}
        </main>
        {wide && <Glance />}
        {!wide && <nav className="nav" aria-label="Sections">{tabs('nav')}</nav>}
        {/* Kept mounted while a sheet is open, so focus can return to it when the sheet closes. */}
        <button type="button" className="fab" aria-label="Quick capture" style={sheet ? { display: 'none' } : undefined} onClick={() => open('capture')}><Icon name="plus" size={24} /></button>
      </div>
      <Sheets />
      <MealView />
      <FocusOverlay />
      <PhotoViewer />
      {/* Always in the page, so screen readers announce what appears inside. */}
      <div className="toast-zone" role="status" aria-live="polite">
        <AnimatePresence>
          {toast && <motion.div key={toast.id} className="toast" initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }} animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }} transition={reduce ? { duration: 0.15 } : SPRING}>
            <span style={{ overflowWrap: 'anywhere' }}>{toast.text}</span>{toast.action && <button type="button" onClick={() => { toast.action!.run(); useApp.setState({ toast: null }); useApp.getState().announce('Undone'); }}>{toast.action.label}</button>}
          </motion.div>}
        </AnimatePresence>
      </div>
      <div className="sr" role="status" aria-live="polite">{live}</div>
      {locked && <div className="lock" role="dialog" aria-modal="true" aria-label="Log/Plan is locked">
        <span className="accent"><Icon name="lock" size={40} /></span><h1>Locked</h1>
        <button type="button" className="btn primary" onClick={async () => { if (await unlock()) setLocked(false); }}>Unlock</button>
      </div>}
      {fine && wide && <Cursor />}
    </MotionConfig>
  );
}
