/** Completion effects: a shock ring in the background, a few sparks, or (with reduced motion) a still highlight. */
import { reducedNow } from './store';

type Pulse = (x: number, y: number) => void;
const subs = new Set<Pulse>();
export const onPulse = (f: Pulse) => { subs.add(f); return () => { subs.delete(f); }; };

function sparks(x: number, y: number) {
  const box = document.createElement('div');
  box.className = 'sparks'; box.setAttribute('aria-hidden', 'true');
  box.style.transform = `translate(${x}px,${y}px)`;
  const N = 12;
  for (let i = 0; i < N; i++) {
    const s = document.createElement('i');
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.5, d = 26 + Math.random() * 34;
    box.appendChild(s);
    s.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d - 6}px) scale(.2)`, opacity: 0 }],
      { duration: 520 + Math.random() * 260, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 900);
}
/** Call with the check that was tapped when something is completed. */
export function celebrate(el: Element | null | undefined) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (reducedNow()) { el.classList.remove('flash'); void (el as HTMLElement).offsetWidth; el.classList.add('flash'); return; }
  subs.forEach((f) => f(x, y));
  sparks(x, y);
}
