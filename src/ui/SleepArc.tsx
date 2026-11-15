import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtDur, fmtMin, parseHM, type ISODate } from '../lib/dates';
import { db, byTypeDate } from '../lib/db';
import type { Sleep } from '../lib/model';
import { sleepDur, sleepMin, sleepPos } from '../lib/day';
import { saveSleep } from '../data';
import { useLive } from '../hooks';
import { useApp } from '../store';
import { haptic } from '../lib/native';
import { removeWithUndo } from './act';
import { Icon } from './common';

const W = 300, H = 158, CX = 150, CY = 146, R = 118, LEN = Math.PI * R;
const pt = (p: number) => { const a = Math.PI * (1 - p); return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) }; };
const GAP = 30 / (18 * 60); // bedtime and wake time stay at least 30 minutes apart on the arc

/** Sleep for the night that ended on `date`: an arc from evening (moon) to midday (sun) with two draggable handles.
 *  The two time fields below it do the same job without dragging, and each handle is also a keyboard slider. */
export function SleepCard({ date, isToday }: { date: ISODate; isToday: boolean }) {
  const rec = useLive(async () => { const r = (await db.rec.get(`sleep:${date}`)) as Sleep | undefined; return r && !r.deleted ? r : null; }, [date], null);
  const announce = useApp((s) => s.announce);
  const [drag, setDrag] = useState<{ which: 'bed' | 'wake'; bed: number; wake: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const bed = drag ? drag.bed : rec?.bed ?? 23 * 60, wake = drag ? drag.wake : rec?.wake ?? 7 * 60;
  const pb = sleepPos(bed), pw = sleepPos(wake);
  const dur = sleepDur({ bed, wake });
  const save = async (b: number, w: number) => { await saveSleep(date, b, w); announce(`Sleep saved: ${fmtDur(sleepDur({ bed: b, wake: w }))}, ${fmtMin(b)} to ${fmtMin(w)}`); };

  const posOf = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W - CX, y = CY - ((e.clientY - r.top) / r.height) * H;
    return 1 - Math.max(0, Math.min(Math.PI, Math.atan2(Math.max(y, 0), x))) / Math.PI;
  };
  const down = (which: 'bed' | 'wake') => (e: PointerEvent) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); haptic(); setDrag({ which, bed, wake }); };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const p = posOf(e);
    if (drag.which === 'bed') setDrag({ ...drag, bed: sleepMin(Math.min(p, sleepPos(drag.wake) - GAP)) });
    else setDrag({ ...drag, wake: sleepMin(Math.max(p, sleepPos(drag.bed) + GAP)) });
  };
  const up = () => { if (!drag) return; const d = drag; setDrag(null); haptic('medium'); void save(d.bed, d.wake); };
  // Keyboard steps build on the latest value even when keys arrive faster than the save round trip.
  const latest = useRef({ bed, wake });
  useEffect(() => { latest.current = { bed, wake }; }, [bed, wake]);
  const key = (which: 'bed' | 'wake') => (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : e.key === 'PageUp' ? 30 : e.key === 'PageDown' ? -30 : 0;
    if (!step) return;
    e.preventDefault();
    const c = latest.current, cb = sleepPos(c.bed), cw = sleepPos(c.wake);
    const p = Math.max(0, Math.min(1, (which === 'bed' ? cb : cw) + step / (18 * 60)));
    latest.current = which === 'bed' ? { bed: sleepMin(Math.min(p, cw - GAP)), wake: c.wake } : { bed: c.bed, wake: sleepMin(Math.max(p, cb + GAP)) };
    void save(latest.current.bed, latest.current.wake);
  };
  const B = pt(pb), Wk = pt(pw);
  const handle = (which: 'bed' | 'wake', P: { x: number; y: number }, v: number) => (
    <g className="handle" role="slider" tabIndex={0} aria-label={which === 'bed' ? 'Bedtime' : 'Wake time'} aria-valuemin={0} aria-valuemax={1080} aria-valuenow={Math.round((which === 'bed' ? pb : pw) * 1080)} aria-valuetext={fmtMin(v)}
      onPointerDown={down(which)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key(which)}>
      <circle cx={P.x} cy={P.y} r="30" fill="transparent" />
      <circle className="knob" cx={P.x} cy={P.y} r="13" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
      <g transform={`translate(${P.x - 7} ${P.y - 7}) scale(.58)`} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
        {which === 'bed' ? <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></>}
      </g>
    </g>
  );
  if (!rec && !drag) return <EmptySleep date={date} isToday={isToday} onLog={(b, w) => void save(b, w)} />;
  return (
    <section className="card col" aria-label="Sleep" style={{ gap: 6 }}>
      <div className="head"><h2 className="label" style={{ fontWeight: 400 }}>Sleep · {isToday ? 'last night' : 'the night before'}</h2>
        {rec && <button type="button" className="btn quiet small muted" style={{ minHeight: 48 }} onClick={() => void removeWithUndo(rec, 'Sleep entry')}>Clear</button>}</div>
      <div style={{ position: 'relative' }}>
        <svg ref={svg} className={`sleep-arc${drag ? ' drag' : ''}`} viewBox={`0 0 ${W} ${H}`}>
          <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="8" strokeLinecap="round" />
          <path className="sleep-fill" d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${Math.max(0.1, (pw - pb) * LEN)} ${LEN * 2}`} strokeDashoffset={-pb * LEN} />
          <g fontFamily="Space Mono, monospace" fontSize="12" fill="var(--muted)" textAnchor="middle" aria-hidden="true">
            <text x={CX - R + 22} y={CY + 4}>18</text><text x={pt(1 / 3).x + 20} y={pt(1 / 3).y + 16}>00</text><text x={pt(2 / 3).x - 20} y={pt(2 / 3).y + 16}>06</text><text x={CX + R - 22} y={CY + 4}>12</text>
          </g>
          {handle('bed', B, bed)}{handle('wake', Wk, wake)}
        </svg>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center', pointerEvents: 'none' }}>
          <div className="big-num" style={{ fontSize: 'min(2rem,40px)' }}>{fmtDur(dur)}</div>
          <div className="muted small">asleep</div>
        </div>
      </div>
      <div className="row">
        <label className="field grow"><span>Bedtime</span><input className="input" type="time" value={fmtMin(bed)} onChange={(e) => e.target.value && void save(parseHM(e.target.value), wake)} /></label>
        <label className="field grow"><span>Woke up</span><input className="input" type="time" value={fmtMin(wake)} onChange={(e) => e.target.value && void save(bed, parseHM(e.target.value))} /></label>
      </div>
    </section>
  );
}
function EmptySleep({ date, isToday, onLog }: { date: ISODate; isToday: boolean; onLog: (bed: number, wake: number) => void }) {
  // Start from the most recent night that was logged, so a regular sleeper only nudges the handles.
  const [last, setLast] = useState<Sleep | null>(null);
  useEffect(() => { void byTypeDate<Sleep>('sleep', '0000-00-00', date).then((r) => setLast(r.sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null)); }, [date]);
  return (
    <section className="card row" aria-label="Sleep">
      <span className="accent"><Icon name="moon" size={22} /></span>
      <span className="col grow" style={{ gap: 0 }}><span>Sleep</span><span className="muted small">{isToday ? 'Last night is not logged yet.' : 'Not logged for this night.'}</span></span>
      <button type="button" className="btn" onClick={() => { haptic(); onLog(last?.bed ?? 23 * 60, last?.wake ?? 7 * 60); }}>Log sleep</button>
    </section>
  );
}
