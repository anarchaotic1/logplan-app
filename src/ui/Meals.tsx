import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { addDays, fmtMin, nowMin, parseHM, snap15 } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import type { Meal, MealCat } from '../lib/model';
import { addPhoto, photoUrl } from '../lib/photos';
import { useLive, useNow, useReduce } from '../hooks';
import { useApp } from '../store';
import { addMeal, attachPhoto, detachPhoto, put, tagFor, uid } from '../data';
import { haptic } from '../lib/native';
import { removeWithUndo } from './act';
import { Icon, SPRING } from './common';
import { dateLabel, longDate } from './Day';

const TAGS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

function usePhoto(id: string, thumb: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; void photoUrl(id, thumb).then((u) => { if (on) setUrl(u); }); return () => { on = false; }; }, [id, thumb]);
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

export function Meals() {
  const { today } = useNow();
  const date = useApp((s) => s.date), setDate = useApp((s) => s.setDate), dir = useApp((s) => s.dir), announce = useApp((s) => s.announce);
  const reduce = useReduce();
  const meals = useLive(async () => (await byTypeDate<Meal>('meal', date)).sort((a, b) => a.time - b.time), [date], []);
  const cat = useLive(() => byType<MealCat>('mealCat'), [], []);
  const [name, setName] = useState(''), [time, setTime] = useState<number>(() => snap15(nowMin())), [tag, setTag] = useState<string | null>(null);
  const theTag = tag ?? tagFor(time);
  const add = async (n: string, t = theTag) => { if (!n.trim()) return; haptic('success'); await addMeal(date, time, n.trim(), t); setName(''); setTag(null); announce(`${n.trim()} added to ${t}`); };
  const fresh = name.trim() && !cat.some((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  const step = (n: number) => { haptic(); setDate(addDays(date, n)); };
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

      <form className="card col" aria-label="Add a meal" onSubmit={(e) => { e.preventDefault(); void add(name); }}>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 'min(8.75rem, 100%)', flex: 'none' }}><span>Time</span><input className="input" type="time" value={fmtMin(time)} onChange={(e) => e.target.value && setTime(parseHM(e.target.value))} /></label>
          <label className="field" style={{ flex: '1 1 9rem', minWidth: 0 }}><span>What did you eat?</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} enterKeyHint="done" /></label>
        </div>
        <div className="chips" role="group" aria-label="Meal type">{TAGS.map((t) => <button type="button" key={t} className={`chip${theTag === t ? ' on' : ''}`} aria-pressed={theTag === t} onClick={() => setTag(t)}>{t}</button>)}</div>
        <button type="submit" className="btn primary block" disabled={!name.trim()}>Add meal</button>
        {(cat.length > 0 || fresh) && <div className="col" style={{ gap: 6 }}>
          <span className="label">Favourites · one tap adds it</span>
          <div className="chips">
            {cat.map((c) => <button type="button" key={c.id} className="chip plain" aria-label={`Add ${c.name}`} onClick={() => void add(c.name, tag ?? c.tag)}><Icon name="plus" size={14} />{c.name}</button>)}
            {fresh && <button type="button" className="chip plain accent" onClick={() => { void put<MealCat>({ id: uid('mc'), type: 'mealCat', name: name.trim(), tag: theTag }); announce('Saved to favourites'); }}>Save "{name.trim()}" as a favourite</button>}
          </div>
        </div>}
      </form>

      <motion.div key={date} className="col" style={{ gap: 10 }} initial={reduce || !dir ? { opacity: 0 } : { opacity: 0, x: dir * 56 }} animate={{ opacity: 1, x: 0 }} transition={SPRING}>
        {meals.length === 0 && <p className="empty">No meals logged for this day.</p>}
        {meals.map((m) => (
          <section key={m.id} className="card col" aria-label={`${m.name}, ${m.tag}, ${fmtMin(m.time)}`} style={{ gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="do-time">{fmtMin(m.time)}</span>
              <span className="col grow" style={{ gap: 0 }}><span style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{m.name}</span><span className="label">{m.tag}</span></span>
              <button type="button" className="icon-btn bare" aria-label={`Delete ${m.name}`} onClick={() => void removeWithUndo(m, 'Meal')}><Icon name="trash" size={18} /></button>
            </div>
            <div className="thumbs">
              {(m.photos || []).map((p, i) => <Thumb key={p} meal={m} id={p} n={i + 1} />)}
              <Pick meal={m} camera /><Pick meal={m} />
            </div>
          </section>
        ))}
      </motion.div>
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
