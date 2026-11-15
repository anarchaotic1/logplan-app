import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { addDays, fmtMin, nowMin, parseHM, snap15 } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import type { Meal, MealCat } from '../lib/model';
import { addPhoto, photoUrl } from '../lib/photos';
import { useLive, useNow, useReduce } from '../hooks';
import { useApp } from '../store';
import { addMeal, attachPhoto, detachPhoto, patch, put, tagFor, uid } from '../data';
import { GROUPS, GROUP_COLORS, MACROS, MACRO_PRESETS, macroTotals, mealGroups, type MacroKey } from '../lib/day';
import { arcPoint, arcPos, sunTimes } from '../lib/sky';
import { noonOf, usePlace } from './Sky';
import { haptic } from '../lib/native';
import { removeWithUndo } from './act';
import { Icon, SPRING } from './common';
import { dateLabel, longDate } from './Day';

const TAGS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const MACRO_COLORS = ['var(--accent)', 'var(--blue)', 'var(--violet)'];

function usePhoto(id: string, thumb: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; void photoUrl(id, thumb).then((u) => { if (on) setUrl(u); }); return () => { on = false; }; }, [id, thumb]);
  return url;
}
function usePhotoMaybe(id: string | undefined, thumb: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; setUrl(null); if (id) void photoUrl(id, thumb).then((u) => { if (on) setUrl(u); }); return () => { on = false; }; }, [id, thumb]);
  return url;
}
function Thumb({ meal, id, n }: { meal: Meal; id: string; n: number }) {
  const url = usePhoto(id, true);
  const reduce = useReduce();
  return (
    <button type="button" className="thumb" aria-label={`Photo ${n} of ${meal.name}. Opens full screen.`} onClick={() => useApp.setState({ viewer: { mealId: meal.id, photoId: id } })}>
      {url ? <motion.img layoutId={reduce ? undefined : `photo-${id}`} src={url} alt="" draggable={false} /> : <span className="sr">Photo is not on this device yet</span>}
    </button>
  );
}
/** Camera and gallery both go through a plain file input: no extra permission, and the same code runs in the browser.
 *  With `capture`, Android opens the camera directly. */
function Pick({ meal, camera }: { meal: Meal; camera?: boolean }) {
  const say = useApp((s) => s.say), announce = useApp((s) => s.announce);
  const [busy, setBusy] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { for (const f of Array.from(files).slice(0, 6)) await attachPhoto(meal.id, await addPhoto(f)); haptic('success'); announce(`Photo added to ${meal.name}`); }
    catch (e) { say(e instanceof Error ? e.message : 'Could not add that picture.'); }
    finally { setBusy(false); }
  };
  return (
    <label className="pick">
      <Icon name={camera ? 'camera' : 'image'} size={22} /><span>{busy ? 'Adding…' : camera ? 'Camera' : 'Gallery'}</span>
      <input type="file" accept="image/*" {...(camera ? { capture: 'environment' as const } : { multiple: true })} aria-label={`${camera ? 'Take a photo' : 'Choose photos'} for ${meal.name}`}
        onChange={(e) => { const f = e.target.files; void add(f).then(() => { e.target.value = ''; }); }} />
    </label>
  );
}

let lastSide = 0; // which face of the header was showing; kept for the session

/** Header card with two faces: macro rings, and the day as the sun's path with a dot per meal. Tap (or Enter) flips it. */
function FlipHeader({ meals, isToday, date }: { meals: Meal[]; isToday: boolean; date: string }) {
  const { min } = useNow();
  const reduce = useReduce();
  const place = usePlace();
  const targets = useApp((s) => s.settings.macroTargets);
  const [side, setSide] = useState(lastSide), [turn, setTurn] = useState(0);
  const flip = () => { haptic(); lastSide = side ? 0 : 1; setSide(lastSide); setTurn((t) => t + 1); };
  const tot = macroTotals(meals);
  const sun = useMemo(() => sunTimes(noonOf(date), place), [date, place]);
  const toMin = (d: Date) => d.getHours() * 60 + d.getMinutes();
  const setT = sun ? arcPos(toMin(sun.set)) : 1, riseT = sun ? arcPos(toMin(sun.rise)) : 0;
  const line = (from: number, to: number) => Array.from({ length: 25 }, (_, i) => { const p = arcPoint(from + ((to - from) * i) / 24); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
  // The sun travels to the current time each time this face is shown (a short run of frames, then it rests).
  const target = arcPos(min), night = isToday && sun != null && (target > setT || target < riseT);
  const [sunT, setSunT] = useState(target);
  useEffect(() => {
    if (!side || !isToday) return;
    if (reduce) { setSunT(target); return; }
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => { const k = Math.min(1, (t - t0 - 250) / 1600); if (k >= 0) setSunT(target * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
    setSunT(0); raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, turn, isToday, reduce]);
  useEffect(() => { if (side && isToday) setSunT(target); /* keep up with the clock */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const sp = arcPoint(sunT);
  let lastX = -99;
  return (
    <div className={`flip${side ? ' back' : ''}${tot.logged === 0 ? ' empty' : ''}`}>
      <div className="flip-inner">
        <section className="face a" aria-label="Macros today" aria-hidden={side ? true : undefined}>
          <div className="row between"><span className="label">Macros</span><span className="label" aria-hidden="true">Tap to flip</span></div>
          <div className="macro-row">
            {MACROS.map((k, i) => { const g = Math.round(tot[k]), t = targets[k] || 1; return (
              <div key={k} className="macro">
                <svg viewBox="0 0 100 100" role="img" aria-label={`${k}: ${g} of ${t} grams`}>
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="9" />
                  {g > 0 && <circle key={turn} className="ring-draw" cx="50" cy="50" r="42" fill="none" stroke={MACRO_COLORS[i]} strokeWidth="9" strokeLinecap="round" pathLength={100} transform="rotate(-90 50 50)" style={{ strokeDasharray: `${Math.min(100, (g / t) * 100).toFixed(1)} 100` }} />}
                  <text x="50" y="59" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="26" fill="var(--text)" aria-hidden="true">{g}</text>
                </svg>
                <span className="small" style={{ textTransform: 'capitalize', fontFamily: 'var(--f-head)' }}>{k}</span>
                <span className="mono muted tiny">of {t} g</span>
              </div>); })}
          </div>
          {tot.logged === 0 && <p className="tiny muted" style={{ textAlign: 'center' }}>No macros yet. Open a meal to add them, or skip them.</p>}
        </section>
        <section className="face b" aria-label="Meals along the day" aria-hidden={side ? undefined : true}>
          <div className="row between" style={{ padding: '12px 16px 0' }}><span className="label">Horizon{isToday ? ` · now ${fmtMin(min)}` : ''}</span><span className="label">{sun ? `Sunset ${fmtMin(toMin(sun.set))}` : 'No sunset'}</span></div>
          <svg viewBox="0 0 342 122" role="img" aria-label={meals.length ? `Meals along the day: ${meals.map((m) => `${m.name} at ${fmtMin(m.time)}`).join(', ')}` : 'No meals on the day arc yet'}>
            <polyline points={line(0, 1)} fill="none" stroke="var(--line-2)" strokeWidth="2" strokeDasharray="3 5" />
            {sun && <polyline points={line(riseT, setT)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="3 5" />}
            <line x1="0" y1="96" x2="342" y2="96" stroke="var(--accent)" strokeWidth="1" opacity=".5" />
            {isToday && (night
              ? <circle cx={sp.x} cy={sp.y} r="9" fill="var(--bg)" stroke="var(--text)" strokeWidth="2" />
              : <><circle cx={sp.x} cy={sp.y} r="20" fill="var(--accent)" opacity=".22" /><circle cx={sp.x} cy={sp.y} r="11" fill="var(--text)" /></>)}
            {meals.map((m) => { const p = arcPoint(arcPos(m.time)); const show = p.x - lastX > 40; if (show) lastX = p.x; return (
              <g key={m.id}>
                <circle className="dot-in" cx={p.x} cy={p.y} r="5.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
                {show && <text x={p.x} y="114" textAnchor="middle" fontFamily="Space Mono, monospace" fontSize="11" fill="var(--muted)" aria-hidden="true">{fmtMin(m.time)}</text>}
              </g>); })}
          </svg>
        </section>
      </div>
      <button type="button" className="flip-btn" aria-label={side ? 'Flip to macros' : 'Flip to horizon view'} onClick={flip} />
    </div>
  );
}

/** A meal on the spine: its photo (or a plain disc) with four satellites, one per plate group. Lit = it was on the plate. */
function Plate({ meal }: { meal: Meal }) {
  const g = mealGroups(meal), id = meal.photos?.[0];
  const url = usePhotoMaybe(id, true);
  return (
    <span className="plate" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="43" fill="none" stroke="var(--line)" strokeWidth="1" />
        <g className="orbit">{g.map((on, k) => { const a = (k * Math.PI) / 2 - Math.PI / 2; return <circle key={k} cx={50 + 43 * Math.cos(a)} cy={50 + 43 * Math.sin(a)} r={on ? 6.5 : 5} fill={on ? GROUP_COLORS[k] : 'var(--bg)'} stroke={GROUP_COLORS[k]} strokeWidth="2" />; })}</g>
      </svg>
      <span className="plate-photo" style={url ? undefined : { background: `linear-gradient(135deg, var(--surface-2), ${GROUP_COLORS[Math.max(0, g.indexOf(true))]})` }}>{url && <img src={url} alt="" draggable={false} />}</span>
    </span>
  );
}

export function Meals() {
  const { today } = useNow();
  const date = useApp((s) => s.date), setDate = useApp((s) => s.setDate), dir = useApp((s) => s.dir), announce = useApp((s) => s.announce), showCal = useApp((s) => s.settings.showCalories);
  const reduce = useReduce();
  const meals = useLive(async () => (await byTypeDate<Meal>('meal', date)).sort((a, b) => a.time - b.time), [date], []);
  const cat = useLive(() => byType<MealCat>('mealCat'), [], []);
  const [name, setName] = useState(''), [time, setTime] = useState<number>(() => snap15(nowMin())), [tag, setTag] = useState<string | null>(null), [groups, setGroups] = useState([false, false, false, false]);
  const [adding, setAdding] = useState(false), [fresh, setFresh] = useState<string | null>(null);
  const theTag = tag ?? tagFor(time);
  const add = async (n: string, t = theTag) => {
    if (!n.trim()) return; haptic('success');
    const m = await addMeal(date, time, n.trim(), t, groups.some(Boolean) ? { groups } : {});
    setFresh(m.id); setName(''); setTag(null); setGroups([false, false, false, false]); setAdding(false); announce(`${n.trim()} added to ${t}`);
  };
  const isNew = name.trim() && !cat.some((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  const step = (n: number) => { haptic(); setDate(addDays(date, n)); };
  const nextTag = TAGS.find((t) => !meals.some((m) => m.tag === t)) ?? 'meal';
  const formOpen = adding || meals.length === 0;
  return (
    <div className="page">
      <header className="col" style={{ gap: 6 }}>
        <div className="row between" style={{ gap: 4 }}>
          <button type="button" className="icon-btn bare" aria-label="Previous day" onClick={() => step(-1)}><Icon name="left" size={18} /></button>
          <span className="label grow" style={{ textAlign: 'center' }}>{dateLabel(date)}</span>
          <button type="button" className="icon-btn bare" aria-label="Next day" onClick={() => step(1)}><Icon name="right" size={18} /></button>
        </div>
        <h1>Meals{date === today ? '' : ` · ${longDate(date)}`}</h1>
      </header>
      {date !== today && <button type="button" className="chip on plain" style={{ alignSelf: 'flex-start' }} onClick={() => setDate(today)}>Back to today</button>}

      <FlipHeader meals={meals} isToday={date === today} date={date} />

      <motion.div key={date} className="spine" initial={reduce || !dir ? { opacity: 0 } : { opacity: 0, x: dir * 56 }} animate={{ opacity: 1, x: 0 }} transition={SPRING}>
        {meals.length === 0 && <p className="empty">No meals logged for this day.</p>}
        {meals.map((m, i) => { const lit = mealGroups(m).filter(Boolean).length; return (
          <button type="button" key={m.id} className={`meal-row${fresh === m.id ? ' drop' : ''}`} style={{ animationDelay: fresh === m.id ? undefined : `${Math.min(i, 6) * 80}ms` }} data-meal={m.id}
            onClick={() => { haptic(); useApp.setState({ mealOpen: m.id }); }}>
            <Plate meal={m} />
            <span className="col grow" style={{ gap: 1 }}>
              <span style={{ fontFamily: 'var(--f-head)', fontSize: '1.0625rem', overflowWrap: 'anywhere' }}>{m.name}</span>
              <span className="label" style={{ order: -1 }}>{m.tag} {fmtMin(m.time)}</span>
              <span className="mono muted tiny">{lit} of 4 groups{showCal && m.calories ? ` · ${m.calories} kcal` : ''}<span className="sr">{m.photos?.length ? `, ${m.photos.length} photo${m.photos.length === 1 ? '' : 's'}` : ''}. Opens the meal.</span></span>
            </span>
            <Icon name="right" size={18} />
          </button>); })}
        {!formOpen && <button type="button" className="meal-row add" aria-expanded={false} onClick={() => { setTime(snap15(nowMin())); setAdding(true); }}>
          <span className="plate-add" aria-hidden="true"><Icon name="plus" size={26} /></span><span className="muted" style={{ fontFamily: 'var(--f-head)' }}>Add {nextTag.toLowerCase()}</span>
        </button>}
      </motion.div>

      {formOpen && <form className="card col" aria-label="Add a meal" onSubmit={(e) => { e.preventDefault(); void add(name); }}>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 'min(8.75rem, 100%)', flex: 'none' }}><span>Time</span><input className="input" type="time" value={fmtMin(time)} onChange={(e) => e.target.value && setTime(parseHM(e.target.value))} /></label>
          <label className="field" style={{ flex: '1 1 9rem', minWidth: 0 }}><span>What did you eat?</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} enterKeyHint="done" autoFocus={adding} /></label>
        </div>
        <div className="chips" role="group" aria-label="Meal type">{TAGS.map((t) => <button type="button" key={t} className={`chip${theTag === t ? ' on' : ''}`} aria-pressed={theTag === t} onClick={() => setTag(t)}>{t}</button>)}</div>
        <GroupChips value={groups} onChange={setGroups} />
        <div className="row"><button type="submit" className="btn primary grow" disabled={!name.trim()}>Add meal</button>{adding && meals.length > 0 && <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>}</div>
        {(cat.length > 0 || isNew) && <div className="col" style={{ gap: 6 }}>
          <span className="label">Favourites · one tap adds it</span>
          <div className="chips">
            {cat.map((c) => <button type="button" key={c.id} className="chip plain" aria-label={`Add ${c.name}`} onClick={() => void add(c.name, tag ?? c.tag)}><Icon name="plus" size={14} />{c.name}</button>)}
            {isNew && <button type="button" className="chip plain accent" onClick={() => { void put<MealCat>({ id: uid('mc'), type: 'mealCat', name: name.trim(), tag: theTag }); announce('Saved to favourites'); }}>Save "{name.trim()}" as a favourite</button>}
          </div>
        </div>}
      </form>}
    </div>
  );
}
/** What was on the plate: four toggles. The name and a tick carry the meaning, the colour is extra. */
function GroupChips({ value, onChange }: { value: boolean[]; onChange: (v: boolean[]) => void }) {
  return (
    <div className="field"><span>What was on the plate</span>
      <div className="group-chips" role="group" aria-label="What was on the plate">
        {GROUPS.map((g, k) => <button type="button" key={g} className={`chip gchip${value[k] ? ' on' : ''}`} style={{ ['--g' as string]: GROUP_COLORS[k] }} aria-pressed={value[k]} onClick={() => { haptic(); onChange(value.map((v, i) => (i === k ? !v : v))); }}>{g}</button>)}
      </div>
    </div>
  );
}

/** One meal, full screen: its photo, what was on the plate, optional macros, and its pictures. */
export function MealView() {
  const id = useApp((s) => s.mealOpen);
  return id ? <MealBody key={id} id={id} /> : null;
}
function MealBody({ id }: { id: string }) {
  const meal = useLive(async () => { const m = (await db.rec.get(id)) as Meal | undefined; return m && !m.deleted ? m : null; }, [id], undefined as Meal | null | undefined);
  const showCal = useApp((s) => s.settings.showCalories);
  const hero = usePhotoMaybe(meal?.photos?.[0], false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useApp.setState({ mealOpen: null });
  useEffect(() => { if (meal === null) close(); }, [meal]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (useApp.getState().viewer) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('button,input')].filter((el) => el.offsetParent !== null);
      const first = f[0], last = f[f.length - 1], cur = document.activeElement;
      if (e.shiftKey && (cur === first || !ref.current.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !ref.current.contains(cur))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-meal="${id}"]`)?.focus()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!meal) return null;
  const g = mealGroups(meal), mac = meal.macros;
  const setMacro = (k: MacroKey, v: number) => void patch<Meal>(meal.id, { macros: { protein: 0, carbs: 0, fat: 0, ...mac, [k]: Math.max(0, Math.min(999, Math.round(v) || 0)) } });
  return (
    <div ref={ref} className="meal-view" role="dialog" aria-modal="true" aria-label={`${meal.name}, ${meal.tag}, ${fmtMin(meal.time)}`}>
      <div className="meal-hero" style={hero ? undefined : { background: `linear-gradient(135deg, var(--surface-2), ${GROUP_COLORS[Math.max(0, g.indexOf(true))]})` }}>{hero && <img src={hero} alt={`Photo of ${meal.name}`} draggable={false} />}</div>
      <div className="meal-bar">
        <button type="button" className="icon-btn" aria-label="Close meal" onClick={close}><Icon name="close" /></button>
        <button type="button" className="icon-btn" aria-label={`Delete ${meal.name}`} onClick={() => { close(); void removeWithUndo(meal, 'Meal'); }}><Icon name="trash" /></button>
      </div>
      <div className="meal-panel">
        <span className="label">{meal.tag} {fmtMin(meal.time)}</span>
        <h2 style={{ fontSize: '1.625rem' }}>{meal.name}</h2>
        <GroupChips value={g} onChange={(v) => void patch<Meal>(meal.id, { groups: v })} />
        <div className="field"><span>Macros in grams (optional)</span>
          {MACROS.map((k) => (
            <div key={k} className="row" style={{ gap: 6 }} role="group" aria-label={k}>
              <span className="small" style={{ width: '4.2rem', textTransform: 'capitalize', flex: 'none' }}>{k}</span>
              {MACRO_PRESETS[k].map((v, i) => <button type="button" key={v} className={`chip plain size${mac?.[k] === v ? ' on' : ''}`} aria-pressed={mac?.[k] === v} aria-label={`${k} ${['small', 'medium', 'large'][i]}, ${v} grams`} onClick={() => { haptic(); setMacro(k, v); }}>{'SML'[i]}</button>)}
              <input className="input" style={{ minWidth: 0, flex: 1, textAlign: 'center', padding: '10px 4px' }} type="number" inputMode="numeric" min={0} max={999} aria-label={`${k} in grams`} placeholder="g" value={mac?.[k] || ''} onChange={(e) => setMacro(k, +e.target.value)} />
            </div>))}
          {mac && <button type="button" className="btn quiet small" style={{ alignSelf: 'flex-start' }} onClick={() => void patch<Meal>(meal.id, { macros: undefined })}>Clear macros</button>}
        </div>
        {showCal && <label className="field"><span>Calories (kcal)</span><input className="input" type="number" inputMode="numeric" min={0} max={9999} value={meal.calories || ''} onChange={(e) => void patch<Meal>(meal.id, { calories: Math.max(0, Math.min(9999, Math.round(+e.target.value) || 0)) || undefined })} /></label>}
        <div className="field"><span>Photos</span>
          <div className="thumbs">
            {(meal.photos || []).map((p, i) => <Thumb key={p} meal={meal} id={p} n={i + 1} />)}
            <Pick meal={meal} camera /><Pick meal={meal} />
          </div>
        </div>
        <button type="button" className="btn block" onClick={close}>Close</button>
      </div>
    </div>
  );
}

/** Full-screen photo. It grows out of its thumbnail; drag it down (or press Close, Escape or Back) to dismiss. */
export function PhotoViewer() {
  const v = useApp((s) => s.viewer), say = useApp((s) => s.say);
  const reduce = useReduce();
  const close = () => useApp.setState({ viewer: null });
  return <AnimatePresence>{v && <ViewerBody key={v.photoId} mealId={v.mealId} photoId={v.photoId} reduce={reduce} onClose={close} onDelete={async () => {
    const m = (await db.rec.get(v.mealId)) as Meal | undefined;
    close();
    if (!m) return;
    await detachPhoto(m, v.photoId);
    say('Photo removed.', { label: 'Undo', run: () => void attachPhoto(m.id, v.photoId) });
  }} />}</AnimatePresence>;
}
function ViewerBody({ mealId, photoId, reduce, onClose, onDelete }: { mealId: string; photoId: string; reduce: boolean; onClose: () => void; onDelete: () => void }) {
  const url = usePhoto(photoId, false), thumb = usePhoto(photoId, true);
  const meal = useLive(async () => (await db.rec.get(mealId)) as Meal | undefined, [mealId], undefined);
  const y = useMotionValue(0);
  const dim = useTransform(y, [-260, 0, 260], [0.25, 1, 0.25]);
  const scale = useTransform(y, [-260, 0, 260], [0.72, 1, 0.72]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { e.preventDefault(); const b = [...document.querySelectorAll<HTMLElement>('.viewer button')]; b[(b.indexOf(document.activeElement as HTMLElement) + (e.shiftKey ? b.length - 1 : 1)) % b.length]?.focus(); } };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Photo of ${meal?.name || 'meal'}`}>
      <motion.div className="back" style={{ opacity: dim }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} onClick={onClose} />
      <motion.div className="bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <button ref={closeRef} type="button" className="icon-btn" aria-label="Close photo" onClick={onClose}><Icon name="close" /></button>
        <button type="button" className="icon-btn" aria-label="Delete photo" onClick={onDelete}><Icon name="trash" /></button>
      </motion.div>
      {(url || thumb) && <motion.img layoutId={reduce ? undefined : `photo-${photoId}`} src={url || thumb!} alt={`${meal?.name || 'Meal'}${meal ? `, ${meal.tag}, ${fmtMin(meal.time)}` : ''}`} draggable={false}
        style={{ y, scale }} initial={reduce ? { opacity: 0 } : false} animate={{ opacity: 1 }} exit={reduce ? { opacity: 0 } : undefined} transition={SPRING}
        drag={reduce ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.9} dragSnapToOrigin
        onDragEnd={(_, i) => { if (Math.abs(i.offset.y) > 120 || Math.abs(i.velocity.y) > 700) onClose(); }} />}
    </div>
  );
}
