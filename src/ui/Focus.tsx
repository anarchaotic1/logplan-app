import { useEffect, useRef, useState } from 'react';
import { db } from '../lib/db';
import type { Block } from '../lib/model';
import { getFocus, stopFocus } from '../data';
import { haptic } from '../lib/native';
import { useLive, useReduce } from '../hooks';
import { useApp } from '../store';

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** Eclipse focus: the moon crosses the sun over the real length of the session. Time is always computed from the
 *  start timestamp, so it stays right when the app was in the background. It does not silence notifications. */
export function FocusOverlay() {
  const focus = useLive(getFocus, [], null);
  const hidden = useApp((s) => s.focusHidden), defLen = useApp((s) => s.settings.focusLen);
  const block = useLive(async () => (focus ? ((await db.rec.get(focus.blockId)) as Block | undefined) : undefined), [focus?.blockId], undefined);
  if (!focus || hidden) return null;
  return <Eclipse key={focus.startedAt} startedAt={focus.startedAt} len={(focus.len || defLen) * 60000} title={block?.title || block?.log || 'Block'} />;
}
function Eclipse({ startedAt, len, title }: { startedAt: number; len: number; title: string }) {
  const reduce = useReduce();
  const announce = useApp((s) => s.announce);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const elapsed = now - startedAt, total = elapsed >= len;
  // With reduced motion the picture changes once a minute instead of sliding.
  const p = Math.min(1, (reduce ? Math.floor(elapsed / 60000) * 60000 : elapsed) / len);
  useEffect(() => { if (total) { haptic('medium'); announce(`Focus time is up for ${title}.`); } }, [total, title, announce]);
  const hide = () => useApp.setState({ focusHidden: true });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { hide(); return; }
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const b = [...(ref.current?.querySelectorAll<HTMLElement>('button') || [])];
      b[(b.indexOf(document.activeElement as HTMLElement) + (e.shiftKey ? b.length - 1 : 1)) % b.length]?.focus();
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); requestAnimationFrame(() => (document.querySelector<HTMLElement>('[data-focus-btn]') ?? prev)?.focus?.()); };
  }, []);
  const end = (done: boolean) => { haptic(done ? 'success' : 'light'); void stopFocus(done); useApp.getState().say(done ? `Done: ${title}` : 'Focus ended.'); };
  return (
    <div ref={ref} className={`eclipse${total ? ' total' : ''}`} role="dialog" aria-modal="true" aria-label={`Focus on ${title}`}>
      <span className="label">Eclipse focus · {Math.round(len / 60000)} min</span>
      <svg viewBox="0 0 280 280" role="img" aria-label={total ? 'Totality: the moon covers the sun' : `The moon has covered ${Math.round(p * 100)} percent of the sun`}>
        <circle className="corona" cx="140" cy="140" r="96" fill="var(--accent)" opacity={total ? 0.34 : 0.16} />
        <circle cx="140" cy="140" r="70" fill="var(--text)" />
        <circle className="disc" cx="140" cy="140" r="72" fill="#02050F" style={{ transform: `translateX(${(-(1 - p) * 190).toFixed(1)}px)` }} />
      </svg>
      <span className="eclipse-time" role="timer" aria-label={total ? 'Time is up' : `${Math.ceil((len - elapsed) / 60000)} minutes left`}>{total ? 'Totality' : mmss(len - elapsed)}</span>
      <span className="muted small" style={{ overflowWrap: 'anywhere' }}>{title}{total ? ' · time is up' : ''}</span>
      <div className="row wrap" style={{ justifyContent: 'center', marginTop: 18, gap: 8 }}>
        <button type="button" className={`btn${total ? ' primary' : ''}`} onClick={() => end(true)}>Mark complete</button>
        <button type="button" className="btn" onClick={() => end(false)}>End focus</button>
        {!total && <button type="button" className="btn quiet" onClick={hide}>Hide</button>}
      </div>
    </div>
  );
}
