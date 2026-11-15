import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtMin, parseISO, type ISODate } from '../lib/dates';
import { kvGet, kvSet } from '../lib/db';
import { DEFAULT_PLACE, moon as moonAt, shower, starsLit, sunTimes, tonight, type Place } from '../lib/sky';
import { haptic } from '../lib/native';
import { useReduce } from '../hooks';
import { useApp } from '../store';
import { Roll } from './common';

/** Where the sky is computed for: the chosen coordinates, or Bengaluru. */
export function usePlace(): Place {
  const p = useApp((s) => s.settings.place);
  return useMemo(() => (p.mode === 'default' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) ? DEFAULT_PLACE : { lat: p.lat, lon: p.lon }), [p.mode, p.lat, p.lon]);
}
/** Midday of a calendar day, so sky maths never straddles midnight. */
export const noonOf = (date: ISODate) => { const d = parseISO(date); d.setHours(12, 0, 0, 0); return d; };
const hm = (d: Date) => fmtMin(d.getHours() * 60 + d.getMinutes());

/** The quiet background: nine still stars, three of them twinkle. CSS only. */
const BG: [number, number, number][] = [[9, 12, 2], [84, 8, 2], [93, 37, 1.5], [5, 64, 1.5], [91, 86, 2], [52, 4, 1.5], [76, 55, 1.5], [28, 30, 1.5], [15, 92, 1.5]];
export function SkyBackground() {
  return <div className="sky-bg" aria-hidden="true">{BG.map(([x, y, r], i) => <i key={i} className={i < 3 ? 'tw' : ''} style={{ left: `${x}%`, top: `${y}%`, width: r, height: r, animationDelay: `${i * 1.3}s` }} />)}</div>;
}

/** Things found once are remembered, so the first-time flourish is not repeated. */
async function eggSeen(id: string): Promise<boolean> {
  const seen = await kvGet<Record<string, string>>('eggs_seen', {});
  if (seen[id]) return true;
  await kvSet('eggs_seen', { ...seen, [id]: new Date().toISOString() });
  return false;
}
export { eggSeen };
const PALE = Math.random() < 0.01; // about one app start in a hundred

/** The moon at its phase. Tapping it seven times says hello. */
function Moon({ at, small }: { at: Date; small: boolean }) {
  const m = moonAt(at);
  const [taps, setTaps] = useState(0), [hello, setHello] = useState(0);
  const r = 13, rx = r * Math.abs(1 - 2 * m.lit);
  const tap = () => {
    haptic();
    const n = taps + 1;
    if (n >= 7) { setTaps(0); setHello((h) => h + 1); void eggSeen('hello'); haptic('success'); } else setTaps(n);
  };
  useEffect(() => { if (!hello) return; const t = setTimeout(() => setHello(0), 4000); return () => clearTimeout(t); }, [hello]);
  const label = `Moon: ${m.name.toLowerCase()}, ${Math.round(m.lit * 100)} percent lit`;
  return <span className="moon-wrap">
    <span className="moon-label mono" aria-hidden="true">{m.name} · {Math.round(m.lit * 100)}%</span>
    <button type="button" className={`moon${small ? ' yawn' : ''}`} aria-label={label} onClick={tap}>
      <svg viewBox="-24 -24 48 48" width="48" height="48" aria-hidden="true">
        <circle r={r} fill="var(--surface-2)" stroke="var(--line-2)" />
        <path transform={m.waxing ? undefined : 'scale(-1 1)'} d={`M0 ${-r} A${r} ${r} 0 0 1 0 ${r} A${rx.toFixed(2)} ${r} 0 0 ${m.lit > 0.5 ? 1 : 0} 0 ${-r} Z`} fill="var(--text)" />
      </svg>
    </button>
    {hello > 0 && <span key={hello} className="led" role="status">HELLO</span>}
  </span>;
}

const W = 342, H = 200, BOX = { x: 76, y: 30, w: 190, h: 164 };
/** Tonight's constellation. `done` of `n` blocks light its stars in order: star k is lit when done/n >= k/S. */
export function Sky({ date, done, n, now, onOpen }: { date: ISODate; done: number; n: number; now: number | null; onOpen: () => void }) {
  const reduce = useReduce();
  const place = usePlace();
  const day = useMemo(() => noonOf(date), [date]);
  const t = useMemo(() => tonight(day, place), [day, place]);
  const sun = useMemo(() => sunTimes(day, place), [day, place]);
  const S = t.c.stars.length, lit = starsLit(done, n, S);
  const pts = t.c.stars.map(([name, x, y]) => ({ name, x: BOX.x + x * BOX.w, y: BOX.y + y * BOX.h }));
  // Stars that have just lit flare once; the wash plays once when the last one lights.
  const prev = useRef<{ date: ISODate; lit: number } | null>(null);
  const [flare, setFlare] = useState<{ from: number; to: number; k: number; wash: boolean } | null>(null);
  useEffect(() => {
    const p = prev.current; prev.current = { date, lit };
    if (!p || p.date !== date || lit <= p.lit) return;
    setFlare((f) => ({ from: p.lit, to: lit, k: (f?.k ?? 0) + 1, wash: lit === S && n > 0 && done >= n }));
    if (lit === S && done >= n) haptic('medium');
  }, [date, lit, S, n, done]);
  const complete = n > 0 && done >= n;
  // Captions: the constellation, or a small surprise.
  const hour = now != null ? Math.floor(now / 60) : 12;
  const wish = now != null && (now === 671 || now === 1391);
  const meteors = shower(day);
  const [stray] = useState(() => Math.random() < 0.04);
  const [pale, setPale] = useState(PALE);
  useEffect(() => { if (!pale) return; void eggSeen('pale'); const x = setTimeout(() => setPale(false), 4000); return () => clearTimeout(x); }, [pale]);
  useEffect(() => { if (wish) void eggSeen('wish'); }, [wish]);
  useEffect(() => { if (meteors && now != null) void eggSeen('meteor'); }, [meteors, now]);
  const caption = pale ? "That's here. That's home." : wish ? '11:11 · make a wish' : now != null && hour < 4 ? `${t.c.name} · go to sleep` : t.caption;
  const text = n ? `${done} of ${n} blocks done, ${lit} of ${S} stars lit in ${t.c.name}` : `No blocks planned. ${t.c.name} is tonight's constellation`;
  return (
    <div className={`sky${complete ? ' complete' : ''}`} style={{ viewTransitionName: 'day-ring' }}>
      <div className="sky-row"><span className="label">{sun ? `Sunset ${hm(sun.set)}` : 'No sunset today'}</span><Moon at={now != null ? new Date() : day} small={now != null && hour < 4} /></div>
      <svg viewBox={`0 14 ${W} ${H}`} role="img" aria-label={text}>
        {!reduce && now != null && (meteors || stray) && <line className={`meteor${meteors ? ' loop' : ''}`} x1="300" y1="44" x2="326" y2="30" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" />}
        {pale && <circle cx="52" cy="150" r="1.6" fill="#9CC4FF" />}
        {t.c.edges.map(([a, b], i) => { const on = a < lit && b < lit; return (
          <g key={i}>
            <line x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} stroke="var(--line-2)" strokeWidth="1.2" strokeDasharray="3 4" />
            <line className="sky-edge" pathLength={100} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" style={{ strokeDasharray: `${on ? 100 : 0} 100`, opacity: on ? 1 : 0 }} />
          </g>); })}
        {pts.map((p, i) => { const on = i < lit, left = p.x < W / 2 - 20, mid = !left && p.x <= W / 2 + 20; return (
          <g key={`${t.c.id}${i}`}>
            {flare && i >= flare.from && i < flare.to && <circle key={flare.k} className="sky-flare" cx={p.x} cy={p.y} r="6" fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
            <circle cx={p.x} cy={p.y} r="12" fill="var(--accent)" style={{ opacity: on ? 0.18 : 0, transition: 'opacity .5s' }} />
            <circle className={`sky-star${wish && i === 0 ? ' wish' : ''}`} cx={p.x} cy={p.y} r={on ? 5 : 3.5} fill={on ? 'var(--accent)' : 'var(--bg)'} stroke={on ? 'var(--accent)' : 'var(--muted)'} strokeWidth="1.5" style={{ animationDelay: `${i * 80}ms` }} />
            {on && <path d={`M${p.x - 2.2} ${p.y + 0.2}l1.6 1.6 2.8-3.4`} fill="none" stroke="var(--ink)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
            <text x={mid ? p.x + 10 : left ? p.x - 10 : p.x + 10} y={p.y + (mid ? 16 : 4)} textAnchor={left ? 'end' : 'start'} fontFamily="Space Mono, monospace" fontSize="11" fill="var(--muted)" aria-hidden="true">{p.name}</text>
          </g>); })}
      </svg>
      {flare?.wash && !reduce && <span key={flare.k} className="sky-wash" aria-hidden="true" />}
      <div className="sky-row"><span className="label">{caption}</span>
        <span className="sky-count" aria-hidden="true">{n ? <><span className="big-num" style={{ fontSize: '1.75rem' }}><Roll value={done} /><span className="muted" style={{ fontWeight: 400 }}>/{n}</span></span><span className="label" style={{ letterSpacing: '.06em' }}>blocks</span></> : <span className="label">tap to plan</span>}</span></div>
      <button type="button" className="sky-open" onClick={onOpen}><span className="sr">{`${n ? `${done}/${n} blocks done` : '0 tap to plan the day'}. Opens the hour-by-hour timeline.`}</span></button>
    </div>
  );
}
