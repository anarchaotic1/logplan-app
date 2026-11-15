import { useEffect, useRef, useState } from 'react';
import { addDays, DOW, dow, fmtDur, fmtMin, nowMin, parseHM, snap15, type ISODate } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import type { Block, Countdown, Habit, HabitLog, MealCat, Recurring, Todo } from '../lib/model';
import { useLive, useNow } from '../hooks';
import { useApp } from '../store';
import { HabitInfo } from './Habits';
import { addBlock, addHabit, addMeal, addTodo, getFocus, patch, put, startFocus, stopFocus, tagFor, uid } from '../data';
import { isDone } from '../lib/habits';
import { haptic, notifPermission } from '../lib/native';
import { AutoText, Check, Icon, Seg, Sheet } from './common';
import { SettingsSheet } from './Settings';
import { removeWithUndo, tickHabit, toggleBlock, toggleTodo } from './act';

function useRec<T>(id: string | undefined): T | undefined {
  return useLive(async () => (id ? ((await db.rec.get(id)) as T | undefined) : undefined), [id], undefined);
}
const Time = ({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) => (
  <input className="input" type="time" aria-label={label} value={value == null ? '' : fmtMin(value)} onChange={(e) => onChange(e.target.value ? parseHM(e.target.value) : null)} />
);
async function wantReminder(): Promise<boolean> {
  const p = await notifPermission(true);
  if (p === 'unsupported') { useApp.getState().say('Saved. Reminders ring in the installed Android app.'); return true; }
  if (p !== 'granted') { useApp.getState().say('Notifications are off for Log/Plan in Android settings.'); return false; }
  return true;
}

function BlockSheet({ id, fresh }: { id: string; fresh?: boolean }) {
  const b = useRec<Block>(id);
  const close = useApp((s) => s.close), say = useApp((s) => s.say), lead = useApp((s) => s.settings.remindLead), cats = useApp((s) => s.settings.cats);
  const focus = useLive(getFocus, [], null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [repeat, setRepeat] = useState(false);
  useEffect(() => { if (fresh) setTimeout(() => { if (useApp.getState().sheet) titleRef.current?.focus(); }, 250); }, [fresh]);
  // A new block that was never given any text is discarded when the sheet closes.
  useEffect(() => () => { void db.rec.get(id).then((r) => { const x = r as Block | undefined; if (x && !x.deleted && !x.title.trim() && !x.log.trim()) void db.rec.delete(id); }); }, [id]);
  if (!b || b.deleted) return null;
  const set = (c: Partial<Block>) => void patch<Block>(b.id, c);
  const running = focus?.blockId === b.id;
  return <>
    <div className="row">
      <Check big on={b.done} label={b.done ? 'Completed' : 'Complete this block'} onToggle={(el) => toggleBlock(b, el)} />
      <input ref={titleRef} className="input grow" aria-label="Block title" placeholder="What will you do?" defaultValue={b.title} onChange={(e) => set({ title: e.target.value })} style={{ fontFamily: 'var(--f-head)', fontSize: '1.0625rem' }} />
    </div>
    <label className="field"><span>Cue: after what, or where?</span>
      <input className="input" placeholder="After lunch, at my desk…" defaultValue={b.cue || ''} onChange={(e) => set({ cue: e.target.value })} />
    </label>
    <div className="row">
      <label className="field grow"><span>Start</span><Time label="Start time" value={b.start} onChange={(v) => v != null && set({ start: snap15(v) })} /></label>
      <label className="field grow"><span>Minutes</span>
        <input className="input" type="number" inputMode="numeric" min={15} max={720} step={15} value={b.dur} onChange={(e) => set({ dur: Math.max(15, Math.min(720, snap15(+e.target.value || 15))) })} />
      </label>
    </div>
    <div className="chips" role="group" aria-label="Duration">{[15, 30, 45, 60, 90, 120].map((d) => <button type="button" key={d} className={`chip${b.dur === d ? ' on' : ''}`} aria-pressed={b.dur === d} onClick={() => set({ dur: d })}>{fmtDur(d)}</button>)}</div>
    <div className="chips" role="group" aria-label="Category">{[...new Set([...cats, ...(b.cat ? [b.cat] : [])])].map((c) => <button type="button" key={c} className={`chip${b.cat === c ? ' on' : ''}`} aria-pressed={b.cat === c} onClick={() => set({ cat: b.cat === c ? '' : c })}>{c}</button>)}</div>
    <label className="field"><span>Log: what actually happened</span><AutoText label="Log" rows={2} value={b.log} onChange={(v) => set({ log: v })} placeholder="Notes, result, what got in the way…" /></label>
    {b.done && (
      <div className="field"><span>How long did it take?</span>
        <div className="chips">{[-15, 0, 15, 30, 60].map((d) => { const v = Math.max(5, b.dur + d); return <button type="button" key={d} className={`chip${b.actualDur === v ? ' on' : ''}`} aria-pressed={b.actualDur === v} onClick={() => set({ actualDur: v })}>{d === 0 ? 'As planned' : `${d > 0 ? '+' : '−'}${Math.abs(d)}m`}</button>; })}</div>
      </div>
    )}
    <div className="chips">
      <button type="button" className={`chip${b.remindLead != null ? ' on' : ''}`} aria-pressed={b.remindLead != null} onClick={async () => { if (b.remindLead != null) set({ remindLead: null }); else if (await wantReminder()) set({ remindLead: lead }); }}>
        <Icon name="bell" size={16} />{b.remindLead != null ? `Remind ${b.remindLead}m before` : 'Remind me'}
      </button>
      {!b.done && <button type="button" className={`chip plain${running ? ' on' : ''}`} onClick={async () => { haptic('medium'); if (running) await stopFocus(true); else { useApp.setState({ focusHidden: false }); await startFocus(b.id, useApp.getState().settings.focusLen); close(); } }}>
        <Icon name={running ? 'stop' : 'play'} size={14} />{running ? 'Stop and mark done' : 'Start focus timer'}
      </button>}
      <button type="button" className={`chip plain${repeat ? ' on' : ''}`} aria-expanded={repeat} onClick={() => setRepeat(!repeat)}>Repeat</button>
    </div>
    {repeat && <RepeatRow onSave={async (days) => {
      await put<Recurring>({ id: uid('rc'), type: 'recurring', kind: 'block', title: b.title, start: b.start, dur: b.dur, cat: b.cat, cue: b.cue, days, from: addDays(b.date, 1) });
      setRepeat(false); say('Repeats from the next day. Manage it in Calendar, Setup.');
    }} initial={[dow(b.date)]} />}
    <button type="button" className="btn danger block" onClick={() => { close(); void removeWithUndo(b, 'Block'); }}><Icon name="trash" size={16} />Delete block</button>
  </>;
}
function RepeatRow({ onSave, initial }: { onSave: (days: number[]) => void; initial: number[] }) {
  const [days, setDays] = useState<number[]>(initial);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="dots" role="group" aria-label="Repeat on days">{DOW.map((d, i) => <button type="button" key={d} role="checkbox" aria-checked={days.includes(i)} aria-label={d} className={days.includes(i) ? 'on' : ''} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}>{d[0]}<i /></button>)}</div>
      <button type="button" className="btn primary" disabled={!days.length} onClick={() => onSave(days)}>Save repeat</button>
    </div>
  );
}

function TodoSheet({ id }: { id: string }) {
  const t = useRec<Todo>(id);
  const close = useApp((s) => s.close), say = useApp((s) => s.say);
  const [repeat, setRepeat] = useState(false);
  if (!t || t.deleted) return null;
  const set = (c: Partial<Todo>) => void patch<Todo>(t.id, c);
  return <>
    <div className="row"><Check big on={t.done} label={t.done ? 'Completed' : 'Complete this to-do'} onToggle={(el) => toggleTodo(t, el)} />
      <input className="input grow" aria-label="To-do" defaultValue={t.text} onChange={(e) => set({ text: e.target.value })} /></div>
    <label className="field"><span>When and where will you do it?</span>
      <input className="input" placeholder="Right after stand-up, at my desk" defaultValue={t.when || ''} onChange={(e) => set({ when: e.target.value })} /></label>
    <div className="row">
      <label className="field grow"><span>Time</span><Time label="Time" value={t.time ?? null} onChange={(v) => set({ time: v })} /></label>
      <label className="field grow"><span>Reminder</span><Time label="Reminder time" value={t.remindAt ?? null} onChange={async (v) => { if (v == null || (await wantReminder())) set({ remindAt: v }); }} /></label>
    </div>
    <div className="chips">
      <button type="button" className="chip plain" onClick={() => { set({ date: addDays(t.date, 1) }); close(); say('Moved to the next day.', { label: 'Undo', run: () => void patch<Todo>(t.id, { date: t.date }) }); }}>Move to the next day</button>
      <button type="button" className={`chip plain${repeat ? ' on' : ''}`} aria-expanded={repeat} onClick={() => setRepeat(!repeat)}>Repeat</button>
    </div>
    {repeat && <RepeatRow initial={[dow(t.date)]} onSave={async (days) => {
      await put<Recurring>({ id: uid('rc'), type: 'recurring', kind: 'todo', title: t.text, start: t.time ?? undefined, days, from: addDays(t.date, 1) });
      setRepeat(false); say('Repeats from the next day. Manage it in Calendar, Setup.');
    }} />}
    <button type="button" className="btn danger block" onClick={() => { close(); void removeWithUndo(t, 'To-do'); }}><Icon name="trash" size={16} />Delete to-do</button>
  </>;
}

type Mode = 'todo' | 'block' | 'meal' | 'habit';
/** Quick capture: a to-do, a block, a meal or a habit tick in two taps. It adds to the day that is on screen. */
function CaptureSheet({ mode: initial, date: forDate }: { mode?: Mode; date?: ISODate }) {
  const [mode, setMode] = useState<Mode>(initial || 'todo');
  const shown = useApp((s) => s.date), calDay = useApp((s) => s.calDay), tab = useApp((s) => s.tab), close = useApp((s) => s.close), say = useApp((s) => s.say);
  const { today } = useNow();
  const date = forDate || (tab === 'calendar' ? calDay || today : tab === 'habits' ? today : shown);
  const [text, setText] = useState('');
  const [start, setStart] = useState<number>(() => Math.min(1380, Math.ceil((nowMin() + 1) / 15) * 15));
  const [dur, setDur] = useState(60);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived).sort((a, b) => a.order - b.order), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', date), [date], []);
  const favs = useLive(() => byType<MealCat>('mealCat'), [], []);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => { if (useApp.getState().sheet) ref.current?.focus(); }, 250); return () => clearTimeout(t); }, [mode]);
  const where = date === today ? 'today' : date;
  const submit = async (v = text.trim()) => {
    if (!v) return;
    haptic('success');
    if (mode === 'todo') { await addTodo(date, v); say(`To-do added to ${where}.`); }
    if (mode === 'block') { await addBlock(date, start, dur, { title: v }); say(`Block added at ${fmtMin(start)}, ${where}.`); }
    if (mode === 'meal') { const t = date === today ? snap15(nowMin()) : 720; await addMeal(date, t, v, tagFor(t)); say(`Meal added to ${where}. Add a photo in Meals.`); }
    setText(''); close();
  };
  return <>
    <Seg label="Capture type" value={mode} onChange={setMode} options={[{ v: 'todo', l: 'To-do' }, { v: 'block', l: 'Block' }, { v: 'meal', l: 'Meal' }, { v: 'habit', l: 'Habit' }]} />
    {date !== today && <p className="small muted">Adding to {date}.</p>}
    {mode === 'habit' ? (
      habits.length ? <div className="col" style={{ gap: 8 }}>{habits.map((h) => { const cur = logs.find((l) => l.habitId === h.id)?.value; return (
        <div key={h.id} className="row card" style={{ padding: '4px 14px 4px 4px' }}><Check big on={isDone(h, cur)} label={`${isDone(h, cur) ? 'Completed' : 'Complete'}: ${h.name}`} onToggle={(el) => tickHabit(h, date, cur, el)} /><span className="grow">{h.name}</span></div>); })}</div>
        : <p className="empty">No habits yet. Add one in the Habits tab.</p>
    ) : (
      <form className="col" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input ref={ref} className="input" aria-label={mode === 'todo' ? 'New to-do' : mode === 'block' ? 'New block title' : 'What did you eat?'} placeholder={mode === 'todo' ? 'What needs doing?' : mode === 'block' ? 'What will you do?' : 'What did you eat?'} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />
        {mode === 'block' && <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <label className="field" style={{ width: 'min(8.75rem, 100%)', flex: 'none' }}><span>Start</span><Time label="Start time" value={start} onChange={(v) => v != null && setStart(snap15(v))} /></label>
          <div className="field" style={{ flex: '1 1 9rem', minWidth: 0 }}><span>Length</span><div className="chips" role="group" aria-label="Length">{[30, 60, 90].map((d) => <button type="button" key={d} className={`chip${dur === d ? ' on' : ''}`} aria-pressed={dur === d} onClick={() => setDur(d)}>{fmtDur(d)}</button>)}</div></div>
        </div>}
        {mode === 'meal' && favs.length > 0 && <div className="chips" role="group" aria-label="Favourites">{favs.map((c) => <button type="button" key={c.id} className="chip plain" onClick={() => void submit(c.name)}><Icon name="plus" size={14} />{c.name}</button>)}</div>}
        <button type="submit" className="btn primary block" disabled={!text.trim()}>Add</button>
      </form>
    )}
  </>;
}

function HabitSheet({ id }: { id?: string }) {
  const existing = useRec<Habit>(id);
  const { today } = useNow();
  const close = useApp((s) => s.close), say = useApp((s) => s.say);
  const [h, setH] = useState<Partial<Habit>>({ name: '', cue: '', target: { kind: 'daily' }, restDays: [], remindTime: null });
  useEffect(() => { if (existing) setH(existing); }, [existing]);
  const t = h.target!;
  const save = async () => {
    if (!h.name?.trim()) return;
    if (h.remindTime != null && !(await wantReminder())) h.remindTime = null;
    if (existing) await patch<Habit>(existing.id, { ...h, name: h.name.trim() });
    else await addHabit({ ...h, name: h.name.trim() } as Habit, today, (await byType<Habit>('habit')).length);
    haptic('success'); close();
  };
  return <>
    <label className="field"><span>Habit</span><input className="input" placeholder="Gym" value={h.name || ''} onChange={(e) => setH({ ...h, name: e.target.value })} /></label>
    <label className="field"><span>Cue: after what, when, or where?</span><input className="input" placeholder="After work, once I've changed clothes" value={h.cue || ''} onChange={(e) => setH({ ...h, cue: e.target.value })} /></label>
    <Seg label="Target" value={t.kind} onChange={(kind) => setH({ ...h, target: { kind, perWeek: 3, count: 8 } })} options={[{ v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Per week' }, { v: 'count', l: 'Count' }]} />
    {t.kind === 'weekly' && <div className="field"><span>Times a week</span><div className="chips" role="group" aria-label="Times a week">{[1, 2, 3, 4, 5, 6].map((n) => <button type="button" key={n} className={`chip${t.perWeek === n ? ' on' : ''}`} aria-pressed={t.perWeek === n} onClick={() => setH({ ...h, target: { ...t, perWeek: n } })}>{n}×</button>)}</div></div>}
    {t.kind === 'count' && <div className="row"><label className="field grow"><span>Daily count</span><input className="input" type="number" inputMode="numeric" min={1} value={t.count || 1} onChange={(e) => setH({ ...h, target: { ...t, count: Math.max(1, +e.target.value || 1) } })} /></label>
      <label className="field grow"><span>Unit</span><input className="input" placeholder="glasses" value={t.unit || ''} onChange={(e) => setH({ ...h, target: { ...t, unit: e.target.value } })} /></label></div>}
    {t.kind !== 'weekly' && <div className="field"><span>Rest days</span><div className="dots" role="group" aria-label="Rest days">{DOW.map((d, i) => { const on = h.restDays!.includes(i); return <button type="button" key={d} role="checkbox" aria-checked={on} aria-label={`${d} is a rest day`} className={on ? 'on' : ''} onClick={() => setH({ ...h, restDays: on ? h.restDays!.filter((x) => x !== i) : [...h.restDays!, i] })}>{d[0]}<i /></button>; })}</div></div>}
    <label className="field"><span>Reminder at the cue</span><Time label="Reminder time" value={h.remindTime ?? null} onChange={(v) => setH({ ...h, remindTime: v })} /></label>
    <button type="button" className="btn primary block" disabled={!h.name?.trim()} onClick={() => void save()}>{existing ? 'Save habit' : 'Add habit'}</button>
    {existing && <button type="button" className="btn danger block" onClick={async () => { await patch<Habit>(existing.id, { archived: true }); close(); say('Habit archived. History is kept.', { label: 'Undo', run: () => void patch<Habit>(existing.id, { archived: false }) }); }}>Archive habit</button>}
  </>;
}

function CountdownSheet({ id }: { id?: string }) {
  const ex = useRec<Countdown>(id);
  const close = useApp((s) => s.close);
  const [label, setLabel] = useState(''), [target, setTarget] = useState('');
  useEffect(() => { if (ex) { setLabel(ex.label); setTarget(ex.target); } }, [ex]);
  return <>
    <label className="field"><span>Label</span><input className="input" placeholder="IELTS exam" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
    <label className="field"><span>Date</span><input className="input" type="date" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
    <button type="button" className="btn primary block" disabled={!label.trim() || !target} onClick={async () => { await put<Countdown>({ id: ex?.id || uid('c'), type: 'countdown', label: label.trim(), target }); close(); }}>Save</button>
    {ex && <button type="button" className="btn danger block" onClick={() => { close(); void removeWithUndo(ex, 'Countdown'); }}>Delete countdown</button>}
  </>;
}
const TITLES: Record<string, string> = { block: 'Block', todo: 'To-do', capture: 'Quick capture', habit: 'Habit', habitInfo: 'Habit history', countdown: 'Countdown', settings: 'Settings' };
export function Sheets() {
  const sheet = useApp((s) => s.sheet), close = useApp((s) => s.close);
  const last = useRef(sheet);
  if (sheet) last.current = sheet;
  const s = sheet || last.current;
  const p = s?.props || {};
  return (
    <Sheet open={!!sheet} onClose={close} title={s ? TITLES[s.kind] || '' : ''}>
      {s?.kind === 'block' && <BlockSheet key={p.id} id={p.id} fresh={p.fresh} />}
      {s?.kind === 'todo' && <TodoSheet key={p.id} id={p.id} />}
      {s?.kind === 'capture' && <CaptureSheet mode={p.mode} date={p.date} />}
      {s?.kind === 'habit' && <HabitSheet key={p.id || 'new'} id={p.id} />}
      {s?.kind === 'habitInfo' && <HabitInfo key={p.id} id={p.id} />}
      {s?.kind === 'countdown' && <CountdownSheet key={p.id || 'new'} id={p.id} />}
      {s?.kind === 'settings' && <SettingsSheet />}
    </Sheet>
  );
}
