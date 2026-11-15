import { AnimatePresence, motion, useDragControls, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useRef, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react';
import { haptic } from '../lib/native';
import { useReduce } from '../hooks';

export const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const;
export const SOFT = { type: 'spring', stiffness: 220, damping: 26 } as const;

const P: Record<string, ReactNode> = {
  today: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  meals: <path d="M6 2v8a2 2 0 002 2v10M6 2v8M9 2v8M18 2c-2 1-2 4-2 6s0 4 2 4v10" />,
  habits: <path d="M12 3c3 4 4 6 2 9 1 0 3 1 3 4a5 5 0 01-10 0c0-3 3-4 3-6 0-2 1-4 2-7z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  left: <path d="M15 18l-6-6 6-6" />, right: <path d="M9 6l6 6-6 6" />,
  bell: <><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 00-2.3-1.3L14 3h-4l-.3 2.5a7 7 0 00-2.3 1.3l-2.3-1-2 3.4 2 1.5a7 7 0 000 2.6l-2 1.5 2 3.4 2.3-1a7 7 0 002.3 1.3L10 21h4l.3-2.5a7 7 0 002.3-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  hours: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  play: <path d="M7 5l12 7-12 7V5z" />, stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  cloud: <path d="M7 18a4 4 0 01-.5-8A6 6 0 0118 9.5a4.2 4.2 0 01-.5 8.5H7z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4V8z" /><circle cx="12" cy="13" r="3.5" /></>,
  image: <><rect x="4" y="5" width="16" height="14" rx="2.5" /><path d="M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17" /><circle cx="15" cy="9.5" r="1.3" /></>,
  moon: <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></>,
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>{P[name]}</svg>;
}
/** One-tap completion control: a 48 px target. `onToggle` receives the element so effects can start from it. */
export function Check({ on, onToggle, label, big }: { on: boolean; onToggle: (el: HTMLElement) => void; label: string; big?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} className={`check${big ? ' big' : ''}`}
      onClick={(e) => { e.stopPropagation(); onToggle(e.currentTarget); }}>
      <span className="box"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
    </button>
  );
}
/** A list row that can also be completed by swiping right (the check inside it is the non-gesture alternative),
 *  and from the keyboard with X, or Space on its title. Spring physics, rubber-banding, and a velocity-based commit. */
export function SwipeRow({ onCommit, children }: { onCommit: (el: HTMLElement | null) => void; children: ReactNode }) {
  const reduce = useReduce();
  const x = useMotionValue(0);
  const reveal = useTransform(x, [0, 84], [0, 1]);
  const pop = useTransform(x, [0, 84, 130], [0.5, 1, 1.25]);
  const ref = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const commit = () => onCommit(ref.current?.querySelector<HTMLElement>('.check') ?? null);
  const key = (e: RKeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input,textarea')) return;
    if (e.key === 'x' || e.key === 'X' || (e.key === ' ' && t.classList.contains('do-title'))) { e.preventDefault(); commit(); }
  };
  return (
    <div className="swipe" ref={ref} onKeyDown={key}>
      <motion.div className="swipe-bg" style={{ opacity: reveal }} aria-hidden="true"><motion.span style={{ scale: pop, display: 'flex' }}><Icon name="check" size={24} /></motion.span></motion.div>
      <motion.div className="swipe-fg" style={{ x }} drag={reduce ? false : 'x'} dragDirectionLock dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0.03, right: 0.55 }} dragSnapToOrigin
        dragTransition={{ bounceStiffness: 520, bounceDamping: 32 }}
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={(_, i) => { setTimeout(() => { dragged.current = false; }, 60); if (i.offset.x > 84 || (i.velocity.x > 520 && i.offset.x > 24)) commit(); }}
        onClickCapture={(e) => { if (dragged.current) { e.stopPropagation(); e.preventDefault(); } }}>
        {children}
      </motion.div>
    </div>
  );
}
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Modal sheet: traps focus and closes on Escape. The store gives focus back to what opened it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const reduce = useReduce();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], cur = document.activeElement;
      if (e.shiftKey && (cur === first || !ref.current.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !ref.current.contains(cur))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    requestAnimationFrame(() => { if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus(); });
    return () => document.removeEventListener('keydown', key); // focus goes back to the opener in the store's close()
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && <>
        <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
        <motion.div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
          initial={reduce ? { opacity: 0 } : { y: '100%' }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: '100%' }} transition={SPRING}
          drag={reduce ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} dragListener={false} dragControls={drag}
          onDragEnd={(_, i) => { if (i.offset.y > 110 || i.velocity.y > 600) onClose(); }}>
          <div className="grab" aria-hidden="true" onPointerDown={(e) => drag.start(e)} style={{ touchAction: 'none' }} />
          <div className="row between" style={{ marginBottom: 8, touchAction: 'none' }} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button')) drag.start(e); }}>
            <h2>{title}</h2>
            <button type="button" className="icon-btn bare" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
          </div>
          <div className="sheet-body">{children}</div>
        </motion.div>
      </>}
    </AnimatePresence>
  );
}
/** Segmented choice. The thumb is one element that slides with a transform, so it cannot be mis-measured mid-transition. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  const i = Math.max(0, options.findIndex((o) => o.v === value));
  return (
    <div className="seg" role="group" aria-label={label}>
      <span className="seg-pill" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${i * 100}%)` }} />
      {options.map((o) => <button key={o.v} type="button" aria-pressed={o.v === value} onClick={() => { haptic(); onChange(o.v); }}>{o.l}</button>)}
    </div>
  );
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return <label className="row between" style={{ minHeight: 48, gap: 16 }}><span className="grow">{label}</span><input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /></label>;
}
export function AutoText({ value, onChange, onBlur, placeholder, label, rows = 1, className = 'input' }: { value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; label: string; rows?: number; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } };
  useEffect(fit, [value]);
  return <textarea ref={ref} rows={rows} className={className} aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
}
/** Animated number: counts toward the new value so a change reads as a change. */
export function Count({ value, digits = 0 }: { value: number; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduce = useReduce();
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const from = prev.current; prev.current = value;
    if (reduce || from === value) { el.textContent = value.toFixed(digits); return; }
    const t0 = performance.now(); let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 500); const e = 1 - Math.pow(1 - k, 3); el.textContent = (from + (value - from) * e).toFixed(digits); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, digits, reduce]);
  return <span ref={ref}>{value.toFixed(digits)}</span>;
}
/** Rolling numerals: each digit slides up and the new one arrives from below. */
export function Roll({ value }: { value: number }) {
  const reduce = useReduce();
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex' }}>
      {String(value).split('').map((ch, i) => (
        <span className="roll" key={i}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={ch} initial={reduce ? { opacity: 0 } : { y: '90%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { y: '-90%', opacity: 0 }} transition={SPRING}>{ch}</motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
/** A small inline "are you sure" row, used instead of browser dialogs. */
export function Confirm({ text, yes, onYes, onNo, danger }: { text: string; yes: string; onYes: () => void; onNo: () => void; danger?: boolean }) {
  return (
    <div className="notice" role="alertdialog" aria-label={text}>
      <span className="grow" style={{ minWidth: 160 }}>{text}</span>
      <span className="row" style={{ gap: 4 }}>
        <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onYes}>{yes}</button>
        <button type="button" className="btn quiet" onClick={onNo}>Cancel</button>
      </span>
    </div>
  );
}
