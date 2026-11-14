import { useEffect, useMemo, useState } from 'react';
import { addDays, fmtDur, fmtMin, parseHM, parseISO } from '../lib/dates';
import { byType, byTypeDate, db } from '../lib/db';
import type { Journal as J, Meal, Sleep } from '../lib/model';
import { useDebounced, useLive, useNow } from '../hooks';
import { useApp } from '../store';
import { emptyJournal, saveJournal, saveSleep, uid } from '../data';
import { haptic } from '../lib/native';
import { ev } from '../evidence';
import { AutoText, Icon, Why } from './common';
import { dateLabel } from './Today';

const PROMPTS = [
  { win: 'What went well today, and why?', lesson: 'What would you do differently?', ifThen: 'If ___ happens tomorrow, then I will ___.' },
  { win: 'What are you glad you did today?', lesson: 'What got in the way?', ifThen: 'When I sit down tomorrow morning, I will first ___.' },
  { win: 'What moved the needle today?', lesson: 'What did today teach you?', ifThen: 'If I feel like skipping ___, then I will ___.' },
  { win: 'Which moment today are you proud of?', lesson: 'What drained your energy?', ifThen: 'After ___ tomorrow, I will ___.' },
];
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.82));
}
function Photo({ id, onRemove }: { id: string; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let u = ''; void db.photos.get(id).then((p) => { if (p) { u = URL.createObjectURL(p.blob); setUrl(u); } }); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  return <div>{url && <img src={url} alt="Journal photo" />}<button type="button" className="icon-btn" aria-label="Remove photo" onClick={onRemove} style={{ position: 'absolute', right: 0, top: 0, width: 44, height: 44, background: 'rgba(4,10,24,.6)', border: 0 }}><Icon name="close" size={16} /></button></div>;
}
function Scale({ value, onChange, label, lo, hi }: { value?: number | null; onChange: (v: number | null) => void; label: string; lo: string; hi: string }) {
  return (
    <div className="field"><span>{label}</span>
      <div className="scale" role="radiogroup" aria-label={label}>{[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} role="radio" aria-checked={value === n} aria-label={`${label} ${n} of 5${n === 1 ? `, ${lo}` : n === 5 ? `, ${hi}` : ''}`} className={value === n ? 'on' : ''} style={{ ['--lvl' as string]: n }} onClick={() => { haptic(); onChange(value === n ? null : n); }}>{n}</button>))}
      </div>
      <div className="row between muted" style={{ fontSize: 11 }}><span>{lo}</span><span>{hi}</span></div>
    </div>
  );
}

export function Journal() {
  const { today } = useNow();
  const date = useApp((s) => s.date), setDate = useApp((s) => s.setDate), open = useApp((s) => s.open), say = useApp((s) => s.say);
  const [searching, setSearching] = useState(false);
  const stored = useLive(async () => (await db.rec.get(`journal:${date}`)) as J | undefined, [date], undefined);
  const [j, setJ] = useState<J>(emptyJournal(date));
  const [loaded, setLoaded] = useState('');
  useEffect(() => { if (loaded !== date || (stored && stored.updatedAt > j.updatedAt)) { setJ(stored && !stored.deleted ? stored : emptyJournal(date)); setLoaded(date); } /* eslint-disable-next-line */ }, [stored, date]);
  const persist = useDebounced((d: string, c: Partial<J>) => void saveJournal(d, c), 450);
  const set = (c: Partial<J>) => { setJ((p) => ({ ...p, ...c })); persist(date, { ...j, ...c }); };
  const sleep = useLive(async () => (await db.rec.get(`sleep:${date}`)) as Sleep | undefined, [date], undefined);
  const meals = useLive(() => byTypeDate<Meal>('meal', date), [date], []);
  const past = useLive(async () => {
    const d = parseISO(date); const out: J[] = [];
    const cands = [1, 2, 3, 4, 5].map((y) => `${d.getFullYear() - y}${date.slice(4)}`).concat([addDays(date, -28), addDays(date, -7)]);
    for (const c of cands) { const r = (await db.rec.get(`journal:${c}`)) as J | undefined; if (r && !r.deleted && (r.text || r.win || r.lesson)) out.push(r); }
    return out.slice(0, 2);
  }, [date], [] as J[]);
  const p = PROMPTS[(parseISO(date).getDate() + parseISO(date).getMonth()) % PROMPTS.length];
  const [tag, setTag] = useState('');
  const addTag = () => { const t = tag.trim().replace(/^#/, '').toLowerCase(); if (t && !j.tags.includes(t)) set({ tags: [...j.tags, t] }); setTag(''); };
  const dur = sleep && !sleep.deleted ? ((sleep.wake - sleep.bed) + 1440) % 1440 : null;

  if (searching) return <Search onClose={() => setSearching(false)} onPick={(d) => { setDate(d); setSearching(false); }} />;
  return (
    <div className="page">
      <header className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 3 }}>
          <div className="row" style={{ gap: 0, marginLeft: -12, height: 28 }}>
            <button type="button" className="icon-btn bare" style={{ width: 36, height: 44 }} aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><Icon name="left" size={14} /></button>
            <span className="label" style={{ whiteSpace: 'nowrap' }}>{dateLabel(date)}</span>
            <button type="button" className="icon-btn bare" style={{ width: 36, height: 44 }} aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}><Icon name="right" size={14} /></button>
          </div>
          <h1>Journal</h1>
        </div>
        <button type="button" className="icon-btn" aria-label="Search journal" onClick={() => setSearching(true)}><Icon name="search" /></button>
      </header>

      <label className="card col" style={{ gap: 6 }}>
        <span className="label accent">Morning intention</span>
        <AutoText className="plain" label="Morning intention" value={j.intention} onChange={(v) => set({ intention: v })} placeholder="Today I want to…" />
      </label>

      <div className="card col">
        <div className="row between"><span className="label">Sleep</span>{dur != null && <span className="mono small accent">{fmtDur(dur)}</span>}</div>
        <div className="row">
          <label className="field grow"><span>Lights out</span><input className="input" type="time" value={sleep && !sleep.deleted ? fmtMin(sleep.bed) : ''} onChange={(e) => e.target.value && void saveSleep(date, parseHM(e.target.value), sleep?.wake ?? 420)} /></label>
          <label className="field grow"><span>Woke up</span><input className="input" type="time" value={sleep && !sleep.deleted ? fmtMin(sleep.wake) : ''} onChange={(e) => e.target.value && void saveSleep(date, sleep?.bed ?? 1380, parseHM(e.target.value))} /></label>
        </div>
      </div>

      <div className="card col">
        <Scale label="Mood" lo="low" hi="great" value={j.mood} onChange={(v) => set({ mood: v })} />
        <Scale label="Energy" lo="drained" hi="charged" value={j.energy} onChange={(v) => set({ energy: v })} />
      </div>

      <label className="card col" style={{ gap: 6 }}>
        <span className="label">Free writing</span>
        <AutoText className="plain" rows={5} label="Free writing" value={j.text} onChange={(v) => set({ text: v })} placeholder="Whatever is on your mind. No one else reads this." />
      </label>

      <div className="card col">
        <span className="label accent">Evening</span>
        <label className="field"><span>One win</span><AutoText label="One win" value={j.win} onChange={(v) => set({ win: v })} placeholder={p.win} /></label>
        <label className="field"><span>One lesson</span><AutoText label="One lesson" value={j.lesson} onChange={(v) => set({ lesson: v })} placeholder={p.lesson} /></label>
        <label className="field"><span>One if-then for tomorrow</span><AutoText label="One if-then for tomorrow" value={j.ifThen} onChange={(v) => set({ ifThen: v })} placeholder={p.ifThen} /></label>
      </div>

      <div className="card col">
        <span className="label">Tags</span>
        <div className="chips">
          {j.tags.map((t) => <button type="button" key={t} className="chip on" aria-label={`Remove tag ${t}`} onClick={() => set({ tags: j.tags.filter((x) => x !== t) })}>#{t}<Icon name="close" size={12} /></button>)}
          <form onSubmit={(e) => { e.preventDefault(); addTag(); }} style={{ flex: 1, minWidth: 120 }}><input className="input" aria-label="Add tag" placeholder="Add tag" value={tag} onChange={(e) => setTag(e.target.value)} onBlur={addTag} style={{ minHeight: 44 }} /></form>
        </div>
      </div>

      <div className="card col">
        <div className="row between"><span className="label">Photos</span><span className="muted" style={{ fontSize: 11 }}>stay on this device</span></div>
        <div className="photo-grid">
          {j.photos.map((id) => <Photo key={id} id={id} onRemove={() => { set({ photos: j.photos.filter((x) => x !== id) }); void db.photos.delete(id); }} />)}
          {j.photos.length < 6 && <label className="row" style={{ justifyContent: 'center', cursor: 'pointer', borderStyle: 'dashed' }} aria-label="Add photo">
            <span className="muted"><Icon name="camera" size={22} /></span>
            <input type="file" accept="image/*" style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
              try { const id = uid('ph'); await db.photos.put({ id, blob: await shrink(f), createdAt: Date.now() }); set({ photos: [...j.photos, id] }); } catch { say('Could not read that image.'); }
            }} />
          </label>}
        </div>
      </div>

      <button type="button" className="card click row between" onClick={() => open('meals')}>
        <span className="row"><span className="accent"><Icon name="food" /></span><span>Meals</span></span>
        <span className="mono muted small">{meals.length ? `${meals.length} logged` : 'none logged'}</span>
      </button>

      {past.length > 0 && <div className="col" style={{ gap: 8 }}>
        <span className="label">Looking back</span>
        {past.map((r) => <button type="button" key={r.id} className="card click" onClick={() => setDate(r.date)}>
          <span className="label">{parseISO(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <p className="small" style={{ marginTop: 4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.win || r.text || r.lesson}</p>
        </button>)}
      </div>}
      <Why source={ev('journal').source}>{ev('journal').claim}</Why>
    </div>
  );
}

function Search({ onClose, onPick }: { onClose: () => void; onPick: (d: string) => void }) {
  const [q, setQ] = useState('');
  const all = useLive(() => byType<J>('journal'), [], []);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase(); if (s.length < 2) return [];
    const tag = s.startsWith('#') ? s.slice(1) : null;
    return all.filter((r) => (tag ? r.tags.includes(tag) : [r.text, r.win, r.lesson, r.ifThen, r.intention, r.tags.join(' ')].join('\n').toLowerCase().includes(s))).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60);
  }, [q, all]);
  const snippet = (r: J) => { const body = [r.intention, r.text, r.win, r.lesson, r.ifThen].filter(Boolean).join(' · '); const i = body.toLowerCase().indexOf(q.trim().toLowerCase()); return (i > 40 ? '…' : '') + body.slice(Math.max(0, i - 40), i + 120); };
  return (
    <div className="page">
      <div className="row"><button type="button" className="icon-btn" aria-label="Close search" onClick={onClose}><Icon name="left" /></button>
        <input className="input grow" autoFocus aria-label="Search journal" placeholder="Search entries, or #tag" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {q.trim().length >= 2 && <p className="label" role="status">{hits.length} {hits.length === 1 ? 'entry' : 'entries'}</p>}
      {hits.map((r) => <button type="button" key={r.id} className="card click" onClick={() => onPick(r.date)}>
        <span className="label">{parseISO(r.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <p className="small" style={{ marginTop: 4 }}>{snippet(r)}</p>
      </button>)}
      {q.trim().length < 2 && <p className="empty">{all.length} {all.length === 1 ? 'entry' : 'entries'} so far. Type at least two letters.</p>}
    </div>
  );
}
