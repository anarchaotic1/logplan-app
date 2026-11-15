import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { Block } from '../lib/model';
import { fmtMin } from '../lib/dates';
import { useReduce } from '../hooks';
import { Roll } from './common';

const R = 108, C = 2 * Math.PI * R, CX = 130;
/** The day as a 24-hour ring: one arc per block (thick and bright with a glow = done, thin and translucent = planned) and a marker for now.
 *  The marker sweeps to the current time when the ring opens, then keeps moving continuously. */
export function Ring({ blocks, now, onOpen, caption }: { blocks: Block[]; now: number | null; onOpen: () => void; caption?: string }) {
  const reduce = useReduce();
  const planned = blocks.filter((b) => b.title.trim() || b.log.trim());
  const done = planned.filter((b) => b.done).length;
  const shown = caption ?? (now != null ? fmtMin(now) : '');
  // After the opening sweep the marker glides linearly toward the next minute, so it never jumps.
  const [swept, setSwept] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSwept(true), 1400); return () => clearTimeout(t); }, []);
  // Blocks that were not done when first seen "ignite" when they become done.
  const seen = useRef(new Map<string, boolean>());
  const ignite = (b: Block) => { const was = seen.current.get(b.id); seen.current.set(b.id, b.done); return was === false && b.done; };
  // The accessible name starts with the visible text (WCAG "label in name"), then says what the control does.
  const text = planned.length ? `${done}/${planned.length} blocks done` : '0 tap to plan the day';
  return (
    <button type="button" className="ring-wrap" onClick={onOpen} aria-label={`${shown} ${text}. Opens the hour-by-hour timeline.`.trim()} style={{ viewTransitionName: 'day-ring' }}>
      <svg width="260" height="260" viewBox="0 0 260 260" aria-hidden="true" style={{ display: 'block' }}>
        <circle cx={CX} cy={CX} r={R} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="10" />
        {now != null && <circle cx={CX} cy={CX} r={R} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeDasharray={`${(now / 1440) * C} ${C}`} transform={`rotate(-90 ${CX} ${CX})`} />}
        {planned.map((b) => {
          const start = Math.max(0, b.start), end = Math.min(1440, b.start + b.dur);
          const len = ((end - start) / 1440) * C;
          const round = len > 14;
          const dash = `${Math.max(1, round ? len - 10 : len)} ${C}`;
          const rot = (start / 1440) * 360 - 90 + (round ? (5 / C) * 360 : 0);
          const fire = ignite(b);
          return (
            <motion.g key={b.id} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: reduce ? 0 : 0.15 + (start / 1440) * 0.7 }}>
              {b.done && <circle className={`arc-glow${fire ? ' ignite' : ''}`} cx={CX} cy={CX} r={R} fill="none" stroke="var(--accent)" strokeWidth="20" strokeLinecap={round ? 'round' : 'butt'} strokeDasharray={dash} transform={`rotate(${rot} ${CX} ${CX})`} />}
              <circle className="arc" cx={CX} cy={CX} r={R} fill="none" stroke="var(--accent)" strokeWidth={b.done ? 10 : 5} strokeLinecap={round ? 'round' : 'butt'} strokeDasharray={dash}
                transform={`rotate(${rot} ${CX} ${CX})`} style={{ strokeOpacity: b.done ? 1 : 0.34 }} />
            </motion.g>
          );
        })}
        <g fontFamily="Space Mono, monospace" fontSize="12" fill="var(--muted)" textAnchor="middle">
          <text x="130" y="14">00</text><text x="247" y="135">06</text><text x="130" y="256">12</text><text x="13" y="135">18</text>
        </g>
      </svg>
      {now != null && (
        <motion.div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          initial={reduce ? false : { rotate: 0 }} animate={{ rotate: ((now + (swept && !reduce ? 1 : 0)) / 1440) * 360 }}
          transition={reduce ? { duration: 0 } : swept ? { duration: 60, ease: 'linear' } : { type: 'spring', stiffness: 60, damping: 16 }}>
          {!reduce && <span className="comet" />}
          <span style={{ position: 'absolute', left: '50%', top: 9, width: 26, height: 26, marginLeft: -13, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle, rgba(255,255,255,.5), transparent 70%)' }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
          </span>
        </motion.div>
      )}
      <span className="ring-center" aria-hidden="true">
        <span className="mono muted tiny" style={{ letterSpacing: '.12em' }}>{shown}</span>
        {planned.length
          ? <span className="big-num"><Roll value={done} /><span className="muted" style={{ fontWeight: 400 }}>/{planned.length}</span></span>
          : <span className="big-num muted" style={{ fontWeight: 400 }}>0</span>}
        <span className="muted small">{planned.length ? 'blocks done' : 'tap to plan the day'}</span>
      </span>
    </button>
  );
}
export function MiniRing({ value, size = 30, label }: { value: number; size?: number; label?: string }) {
  const r = 11, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ flex: 'none' }}>
      <circle cx="15" cy="15" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
      <circle cx="15" cy="15" r={r} fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" transform="rotate(-90 15 15)"
        strokeDasharray={c} style={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))), transition: 'stroke-dashoffset .6s var(--ease)', opacity: value > 0 ? 1 : 0 }} />
    </svg>
  );
}
