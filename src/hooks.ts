import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { logicalDay, nowMin } from './lib/dates';
import { useApp } from './store';

/** Subscribes to a Dexie query and re-renders when the underlying rows change. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setV, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}
/** Current logical day and minute of day; ticks on the minute and when the app returns to the foreground. */
export function useNow() {
  const startHour = useApp((s) => s.settings.startHour);
  const calc = () => { const d = new Date(); return { today: logicalDay(d, startHour), min: nowMin(d) }; };
  const [now, setNow] = useState(calc);
  useEffect(() => {
    const tickNow = () => setNow(calc());
    tickNow();
    let t: ReturnType<typeof setTimeout>;
    const arm = () => { t = setTimeout(() => { tickNow(); arm(); }, 60000 - (Date.now() % 60000) + 50); };
    arm();
    const vis = () => { if (!document.hidden) tickNow(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHour]);
  return now;
}
export function useDebounced<T extends (...a: any[]) => void>(fn: T, ms = 400): T {
  const ref = useRef(fn); ref.current = fn;
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return useRef(((...a: any[]) => { clearTimeout(t.current); t.current = setTimeout(() => ref.current(...a), ms); }) as T).current;
}
export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, [q]);
  return m;
}
/** Whether movement should be replaced by short fades (in-app setting first, then the system setting). */
export function useReduce(): boolean {
  const m = useApp((s) => s.settings.motion);
  const sys = useMedia('(prefers-reduced-motion: reduce)');
  return m === 'reduce' || (m === 'system' && sys);
}
