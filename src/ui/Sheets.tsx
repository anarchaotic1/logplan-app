import { useEffect, useRef, useState } from 'react';
import { addDays, DOW, dow, fmtDur, fmtMin, nowMin, parseHM, snap15 } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import { CATS, type Block, type Countdown, type Habit, type HabitLog, type Meal, type MealCat, type Recurring, type Todo, type Topic } from '../lib/model';
import { useLive, useNow } from '../hooks';
import { useApp } from '../store';
import { addBlock, addHabit, addTodo, getFocus, patch, put, remove, saveJournal, startFocus, stopFocus, toggleHabit, uid } from '../data';
import { isDone } from '../lib/habits';
import { haptic, notifPermission } from '../lib/native';
import { AutoText, Check, Icon, Seg, Sheet, Why } from './common';
import { SettingsSheet } from './Settings';
import { OrbitSheet } from './Orbit';

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
  const close = useApp((s) => s.close), say = useApp((s) => s.say), lead = useApp((s) => s.settings.remindLead);
  const focus = useLive(getFocus, [], null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [repeat, setRepeat] = useState(false);
  useEffect(() => { if (fresh) setTimeout(() => titleRef.current?.focus(), 250); }, [fresh]);
  // A new block that was never given any text is discarded when the sheet closes.
  useEffect(() => () => { void db.rec.get(id).then((r) => { const x = r as Block | undefined; if (x && !x.deleted && !x.title.trim() && !x.log.trim()) void db.rec.delete(id); }); }, [id]);
  if (!b || b.deleted) return null;
  const set = (c: Partial<Block>) => void patch<Block>(b.id, c);
  const running = focus?.blockId === b.id;
  return <>
    <div className="row">
      <Check big on={b.done} label="Mark block done" onToggle={() => set({ done: !b.done, ...(b.done ? { actualDur: undefined } : {}) })} />
      <input ref={titleRef} className="input grow" aria-label="Block title" placeholder="What will you do?" defaultValue={b.title} onChange={(e) => set({ title: e.target.value })} style={{ fontFamily: 'var(--f-head)', fontSize: 17 }} />
    </div>
    <label className="field"><span>Cue (if-then)</span>
      <input className="input" placeholder="After lunch, at my desk…" defaultValue={b.cue || ''} onChange={(e) => set({ cue: e.target.value })} />
    </label>
    <div className="row">
      <label className="field grow"><span>Start</span><Time label="Start time" value={b.start} onChange={(v) => v != null && set({ start: snap15(v) })} /></label>
      <label className="field grow"><span>Minutes</span>
        <input className="input" type="number" inputMode="numeric" min={15} max={720} step={15} value={b.dur} onChange={(e) => set({ dur: Math.max(15, Math.min(720, snap15(+e.target.value || 15))) })} />
      </label>
    </div>
    <div className="chips" role="group" aria-label="Duration">{[15, 30, 45, 60, 90, 120].map((d) => <button type="button" key={d} className={`chip${b.dur === d ? ' on' : ''}`} onClick={() => set({ dur: d })}>{fmtDur(d)}</button>)}</div>
    <div className="chips" role="group" aria-label="Category">{CATS.map((c) => <button type="button" key={c} className={`chip${b.cat === c ? ' on' : ''}`} onClick={() => set({ cat: b.cat === c ? '' : c })}>{c}</button>)}</div>
    <label className="field"><span>Log — what actually happened</span><AutoText label="Log" rows={2} value={b.log} onChange={(v) => set({ log: v })} placeholder="Notes, result, what got in the way…" /></label>
    {b.done && (
      <div className="field"><span>How long did it take?</span>
        <div className="chips">{[-15, 0, 15, 30, 60].map((d) => { const v = Math.max(5, b.dur + d); return <button type="button" key={d} className={`chip${b.actualDur === v ? ' on' : ''}`} onClick={() => set({ actualDur: v })}>{d === 0 ? 'As planned' : `${d > 0 ? '+' : '−'}${Math.abs(d)}m`}</button>; })}</div>
      </div>
    )}
    <div className="chips">
      <button type="button" className={`chip${b.remindLead != null ? ' on' : ''}`} aria-pressed={b.remindLead != null} onClick={async () => { if (b.remindLead != null) set({ remindLead: null }); else if (await wantReminder()) set({ remindLead: lead }); }}>
        <Icon name="bell" size={15} />{b.remindLead != null ? `Remind ${b.remindLead}m before` : 'Remind me'}
      </button>
      {!b.done && <button type="button" className={`chip${running ? ' on' : ''}`} onClick={async () => { haptic('medium'); if (running) await stopFocus(true); else { await startFocus(b.id); close(); say('Focus timer started.'); } }}>
        <Icon name={running ? 'stop' : 'play'} size={14} />{running ? 'Stop and mark done' : 'Start focus timer'}
      </button>}
      <button type="button" className={`chip${repeat ? ' on' : ''}`} aria-expanded={repeat} onClick={() => setRepeat(!repeat)}>Repeat…</button>
    </div>
    {repeat && <RepeatRow onSave={async (days) => {
      await put<Recurring>({ id: uid('rc'), type: 'recurring', kind: 'block', title: b.title, start: b.start, dur: b.dur, cat: b.cat, cue: b.cue, days, from: addDays(b.date, 1) });
      setRepeat(false); say('Repeats from tomorrow. Manage in Plan.');
    }} initial={[dow(b.date)]} />}
    <button type="button" className="btn danger block" onClick={async () => { const snap = b; await remove(b.id); close(); say('Block deleted.', { label: 'Undo', run: () => void put<Block>(snap) }); }}><Icon name="trash" size={16} />Delete block</button>
  </>;
}
function RepeatRow({ onSave, initial }: { onSave: (days: number[]) => void; initial: number[] }) {
  const [days, setDays] = useState<number[]>(initial);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="dots" role="group" aria-label="Repeat on days">{DOW.map((d, i) => <button type="button" key={d} aria-pressed={days.includes(i)} className={days.includes(i) ? 'on' : ''} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}>{d[0]}<i /></button>)}</div>
      <button type="button" className="btn primary" disabled={!days.length} onClick={() => onSave(days)}>Save repeat</button>
    </div>
  );
}

function TodoSheet({ id }: { id: string }) {
  const t = useRec<Todo>(id);
  const close = useApp((s) => s.close), say = useApp((s) => s.say);
  if (!t || t.deleted) return null;
  const set = (c: Partial<Todo>) => void patch<Todo>(t.id, c);
  return <>
    <div className="row"><Check big on={t.done} label="Mark to-do done" onToggle={() => set({ done: !t.done })} />
      <input className="input grow" aria-label="To-do" defaultValue={t.text} onChange={(e) => set({ text: e.target.value })} /></div>
    <label className="field"><span>When and where will you do it?</span>
      <input className="input" placeholder="Right after stand-up, at my desk" defaultValue={t.when || ''} onChange={(e) => set({ when: e.target.value })} /></label>
    <div className="row">
      <label className="field grow"><span>Time</span><Time label="Time" value={t.time ?? null} onChange={(v) => set({ time: v })} /></label>
      <label className="field grow"><span>Reminder</span><Time label="Reminder time" value={t.remindAt ?? null} onChange={async (v) => { if (v == null || (await wantReminder())) set({ remindAt: v }); }} /></label>
    </div>
    <div className="chips">
      <button type="button" className="chip" onClick={() => { set({ date: addDays(t.date, 1) }); close(); say('Moved to tomorrow.'); }}>Move to tomorrow</button>
      {!t.main && <button type="button" className="chip" onClick={async () => { const cur = (await byTypeDate<Todo>('todo', t.date)).find((x) => x.main); if (cur) await patch<Todo>(cur.id, { main: false }); set({ main: true }); close(); }}>Make it the one thing</button>}
    </div>
    <Why source="Masicampo & Baumeister, 2011, JPSP; Gollwitzer & Sheeran, 2006">In lab studies, unfinished tasks kept intruding on people's attention until they made a specific plan for them. Deciding when and where is a small, modest help, not a guarantee.</Why>
    <button type="button" className="btn danger block" onClick={async () => { const snap = t; await remove(t.id); close(); say('To-do deleted.', { label: 'Undo', run: () => void put<Todo>(snap) }); }}><Icon name="trash" size={16} />Delete to-do</button>
  </>;
}

type Mode = 'todo' | 'block' | 'journal' | 'habit';
function CaptureSheet({ mode: initial }: { mode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initial || 'todo');
  const date = useApp((s) => s.date), close = useApp((s) => s.close), say = useApp((s) => s.say);
  const { today } = useNow();
  const [text, setText] = useState('');
  const [start, setStart] = useState<number>(() => Math.min(1380, Math.ceil((nowMin() + 1) / 15) * 15));
  const [dur, setDur] = useState(60);
  const habits = useLive(async () => (await byType<Habit>('habit')).filter((h) => !h.archived).sort((a, b) => a.order - b.order), [], []);
  const logs = useLive(() => byTypeDate<HabitLog>('habitLog', today), [today], []);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 250); return () => clearTimeout(t); }, [mode]);
  const submit = async () => {
    const v = text.trim(); if (!v) return;
    haptic('success');
    if (mode === 'todo') { await addTodo(date, v); say('To-do added.'); }
    if (mode === 'block') { await addBlock(date, start, dur, { title: v }); say(`Block added at ${fmtMin(start)}.`); }
    if (mode === 'journal') {
      const cur = (await db.rec.get(`journal:${today}`)) as { text?: string; deleted?: boolean } | undefined;
      const prev = cur && !cur.deleted ? cur.text || '' : '';
      await saveJournal(today, { text: `${prev}${prev ? '\n' : ''}${fmtMin(nowMin())}  ${v}` });
      say('Added to today\'s journal.');
    }
    setText(''); close();
  };
  return <>
    <Seg label="Capture type" value={mode} onChange={setMode} options={[{ v: 'todo', l: 'To-do' }, { v: 'block', l: 'Block' }, { v: 'journal', l: 'Journal' }, { v: 'habit', l: 'Habit' }]} />
    {mode === 'habit' ? (
      habits.length ? <div className="col" style={{ gap: 8 }}>{habits.map((h) => { const cur = logs.find((l) => l.habitId === h.id)?.value; return (
        <div key={h.id} className="row card" style={{ padding: '8px 14px' }}><Check big on={isDone(h, cur)} label={`Tick ${h.name} for today`} onToggle={() => void toggleHabit(h, today, cur)} /><span className="grow">{h.name}</span></div>); })}</div>
        : <p className="empty">No habits yet. Add one in the Habits tab.</p>
    ) : (
      <form className="col" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {mode === 'journal'
          ? <textarea ref={ref} className="input" rows={3} aria-label="Journal line" placeholder="A thought, a win, something to remember…" value={text} onChange={(e) => setText(e.target.value)} />
          : <input ref={ref} className="input" aria-label={mode === 'todo' ? 'New to-do' : 'New block title'} placeholder={mode === 'todo' ? 'What needs doing?' : 'What will you do?'} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />}
        {mode === 'block' && <div className="row">
          <label className="field grow"><span>Start</span><Time label="Start time" value={start} onChange={(v) => v != null && setStart(snap15(v))} /></label>
          <div className="field grow"><span>Length</span><div className="chips">{[30, 60, 90].map((d) => <button type="button" key={d} className={`chip${dur === d ? ' on' : ''}`} onClick={() => setDur(d)}>{fmtDur(d)}</button>)}</div></div>
        </div>}
        <button type="submit" className="btn primary block" disabled={!text.trim()}>Add</button>
      </form>
    )}
  </>;
}

function HabitSheet({ id }: { id?: string }) {
  const existing = useRec<Habit>(id);
  const { today } = useNow();
  const close = useApp((s) => s.close), say = useApp((s) => s.say);
  const [h, setH] = useState<Partial<Habit>>({ name: '', cue: '', target: { kind: 'daily' }, restDays: [], remindTime: null, activityMin: 0 });
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
    <label className="field"><span>Cue — after what, when, or where?</span><input className="input" placeholder="After work, once I've changed clothes" value={h.cue || ''} onChange={(e) => setH({ ...h, cue: e.target.value })} /></label>
    <Seg label="Target" value={t.kind} onChange={(kind) => setH({ ...h, target: { kind, perWeek: 3, count: 8 } })} options={[{ v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Per week' }, { v: 'count', l: 'Count' }]} />
    {t.kind === 'weekly' && <label className="field"><span>Times a week</span><div className="chips">{[1, 2, 3, 4, 5, 6].map((n) => <button type="button" key={n} className={`chip${t.perWeek === n ? ' on' : ''}`} onClick={() => setH({ ...h, target: { ...t, perWeek: n } })}>{n}×</button>)}</div></label>}
    {t.kind === 'count' && <div className="row"><label className="field grow"><span>Daily count</span><input className="input" type="number" inputMode="numeric" min={1} value={t.count || 1} onChange={(e) => setH({ ...h, target: { ...t, count: Math.max(1, +e.target.value || 1) } })} /></label>
      <label className="field grow"><span>Unit</span><input className="input" placeholder="glasses" value={t.unit || ''} onChange={(e) => setH({ ...h, target: { ...t, unit: e.target.value } })} /></label></div>}
    {t.kind !== 'weekly' && <div className="field"><span>Rest days</span><div className="dots">{DOW.map((d, i) => { const on = h.restDays!.includes(i); return <button type="button" key={d} aria-pressed={on} aria-label={`${d} rest day`} className={on ? 'on' : ''} onClick={() => setH({ ...h, restDays: on ? h.restDays!.filter((x) => x !== i) : [...h.restDays!, i] })}>{d[0]}<i /></button>; })}</div></div>}
    <div className="row">
      <label className="field grow"><span>Reminder at the cue</span><Time label="Reminder time" value={h.remindTime ?? null} onChange={(v) => setH({ ...h, remindTime: v })} /></label>
      <label className="field grow"><span>Activity minutes</span><input className="input" type="number" inputMode="numeric" min={0} placeholder="0" value={h.activityMin || ''} onChange={(e) => setH({ ...h, activityMin: Math.max(0, +e.target.value || 0) })} /></label>
    </div>
    <Why source="Gollwitzer & Sheeran, 2006 (94 tests); Sheeran, Listrom & Gollwitzer, 2024 (642 tests)">Linking an action to a specific cue ("after X, I will Y") helps people follow through. Across many studies the average benefit is positive but modest, and it works best for goals you already care about.</Why>
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
    {ex && <button type="button" className="btn danger block" onClick={async () => { await remove(ex.id); close(); }}>Delete countdown</button>}
  </>;
}
function TopicSheet({ id }: { id?: string }) {
  const ex = useRec<Topic>(id);
  const { today } = useNow();
  const close = useApp((s) => s.close);
  const [title, setTitle] = useState(''), [notes, setNotes] = useState('');
  useEffect(() => { if (ex) { setTitle(ex.title); setNotes(ex.notes); } }, [ex]);
  return <>
    <label className="field"><span>Topic</span><input className="input" placeholder="CMOS inverter delay" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label className="field"><span>Notes or questions to test yourself on</span><AutoText label="Notes" rows={4} value={notes} onChange={setNotes} placeholder="Write questions, not answers. Recall first, then check." /></label>
    <button type="button" className="btn primary block" disabled={!title.trim()} onClick={async () => {
      if (ex) await patch<Topic>(ex.id, { title: title.trim(), notes }); else await put<Topic>({ id: uid('tp'), type: 'topic', title: title.trim(), notes, interval: 0, due: addDays(today, 1), reviews: [] });
      close();
    }}>{ex ? 'Save topic' : 'Add topic — first review tomorrow'}</button>
    {ex && <button type="button" className="btn danger block" onClick={async () => { await remove(ex.id); close(); }}>Delete topic</button>}
  </>;
}
function MealsSheet() {
  const date = useApp((s) => s.date);
  const meals = useLive(async () => (await byTypeDate<Meal>('meal', date)).sort((a, b) => a.time - b.time), [date], []);
  const cat = useLive(() => byType<MealCat>('mealCat'), [], []);
  const [name, setName] = useState(''), [time, setTime] = useState<number>(() => snap15(nowMin()));
  const tagFor = (m: number) => (m < 660 ? 'Breakfast' : m < 960 ? 'Lunch' : m < 1260 ? 'Dinner' : 'Snack');
  const add = async (n: string, tag = tagFor(time)) => { if (!n.trim()) return; haptic(); await put<Meal>({ id: uid('m'), type: 'meal', date, time, name: n.trim(), tag }); setName(''); };
  return <>
    <form className="row" onSubmit={(e) => { e.preventDefault(); void add(name); }}>
      <div style={{ width: 120, flex: 'none' }}><Time label="Meal time" value={time} onChange={(v) => v != null && setTime(v)} /></div>
      <input className="input grow" aria-label="Meal" placeholder="What did you eat?" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="icon-btn on" aria-label="Add meal"><Icon name="plus" /></button>
    </form>
    <div className="chips">
      {cat.map((c) => <button type="button" key={c.id} className="chip" onClick={() => void add(c.name, c.tag)}>{c.name}</button>)}
      {name.trim() && !cat.some((c) => c.name.toLowerCase() === name.trim().toLowerCase()) && <button type="button" className="chip on" onClick={() => void put<MealCat>({ id: uid('mc'), type: 'mealCat', name: name.trim(), tag: tagFor(time) })}>Save "{name.trim()}" to favourites</button>}
    </div>
    <div className="card tight sep">
      {meals.length === 0 && <p className="empty">No meals logged for this day.</p>}
      {meals.map((m) => <div key={m.id} className="row" style={{ minHeight: 48 }}><span className="mono muted" style={{ width: 44, fontSize: 12 }}>{fmtMin(m.time)}</span><span className="col grow" style={{ gap: 0 }}><span>{m.name}</span><span className="label" style={{ fontSize: 9.5 }}>{m.tag}</span></span>
        <button type="button" className="icon-btn bare" aria-label={`Delete ${m.name}`} onClick={() => void remove(m.id)}><Icon name="close" size={16} /></button></div>)}
    </div>
  </>;
}

const TITLES: Record<string, string> = { block: 'Block', todo: 'To-do', capture: 'Quick capture', habit: 'Habit', countdown: 'Countdown', topic: 'Study topic', meals: 'Meals', settings: 'Settings', orbit: 'Year orbit' };
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
      {s?.kind === 'capture' && <CaptureSheet mode={p.mode} />}
      {s?.kind === 'habit' && <HabitSheet key={p.id || 'new'} id={p.id} />}
      {s?.kind === 'countdown' && <CountdownSheet key={p.id || 'new'} id={p.id} />}
      {s?.kind === 'topic' && <TopicSheet key={p.id || 'new'} id={p.id} />}
      {s?.kind === 'meals' && <MealsSheet />}
      {s?.kind === 'settings' && <SettingsSheet />}
      {s?.kind === 'orbit' && <OrbitSheet />}
    </Sheet>
  );
}
