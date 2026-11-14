import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { haptic } from '../lib/native';

export const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const;
export const SOFT = { type: 'spring', stiffness: 220, damping: 26 } as const;

const P: Record<string, ReactNode> = {
  today: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  journal: <><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z" /><path d="M9 9h6M9 13h4" /></>,
  habits: <path d="M12 3c3 4 4 6 2 9 1 0 3 1 3 4a5 5 0 01-10 0c0-3 3-4 3-6 0-2 1-4 2-7z" />,
  insights: <path d="M4 19V9M10 19V5M16 19v-7M21 19H3" />,
  plan: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  orbit: <><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  left: <path d="M15 18l-6-6 6-6" />, right: <path d="M9 6l6 6-6 6" />,
  bell: <><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 00-2.3-1.3L14 3h-4l-.3 2.5a7 7 0 00-2.3 1.3l-2.3-1-2 3.4 2 1.5a7 7 0 000 2.6l-2 1.5 2 3.4 2.3-1a7 7 0 002.3 1.3L10 21h4l.3-2.5a7 7 0 002.3-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  play: <path d="M7 5l12 7-12 7V5z" />, stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  cloud: <path d="M7 18a4 4 0 01-.5-8A6 6 0 0118 9.5a4.2 4.2 0 01-.5 8.5H7z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4V8z" /><circle cx="12" cy="13" r="3.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  moon: <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" />,
  food: <path d="M6 2v8a2 2 0 002 2v10M6 2v8M9 2v8M18 2c-2 1-2 4-2 6s0 4 2 4v10" />,
  book: <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM8 7h7" />,
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>;
}
export function Check({ on, onToggle, label, big }: { on: boolean; onToggle: () => void; label: string; big?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} className={`check${on ? ' on' : ''}${big ? ' big' : ''}`}
      onClick={(e) => { e.stopPropagation(); haptic(on ? 'light' : 'success'); onToggle(); }}>
      <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </button>
  );
}
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    requestAnimationFrame(() => { if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus(); });
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
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
          <div className="row between" style={{ marginBottom: 12, touchAction: 'none' }} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button')) drag.start(e); }}>
            <h2>{title}</h2>
            <button type="button" className="icon-btn bare" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
          </div>
          <div className="sheet-body">{children}</div>
        </motion.div>
      </>}
    </AnimatePresence>
  );
}
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => { haptic(); onChange(o.v); }}>
          {o.v === value && <motion.span layoutId={`seg-${label}`} className="thumb" transition={SPRING} />}
          {o.l}
        </button>
      ))}
    </div>
  );
}
/** Evidence card. Wording is kept modest on purpose: effect sizes are averages across studies, not promises. */
export function Why({ children, source }: { children: ReactNode; source: string }) {
  return <details className="why"><summary style={{ cursor: 'pointer', minHeight: 24 }}><b>Why this works</b></summary><p style={{ marginTop: 8 }}>{children}</p><p className="mono" style={{ fontSize: 11, marginTop: 8 }}>{source}</p></details>;
}
export function AutoText({ value, onChange, placeholder, label, rows = 1, className = 'input' }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; rows?: number; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } };
  useEffect(fit, [value]);
  return <textarea ref={ref} rows={rows} className={className} aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}
/** Animated number: counts toward the new value so changes read as change, not as a jump. */
export function Count({ value, digits = 0 }: { value: number; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduce = useReducedMotion();
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
