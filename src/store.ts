import { create } from 'zustand';
import { flushSync } from 'react-dom';
import { isoDate, logicalDay, type ISODate } from './lib/dates';
import { kvGet, kvSet } from './lib/db';
import { CATS } from './lib/model';
import { setHaptics } from './lib/native';

export type Tab = 'today' | 'calendar' | 'meals' | 'habits';
export const TABS: Tab[] = ['today', 'calendar', 'meals', 'habits'];
export interface Settings {
  name: string; startHour: number; lock: boolean; remindLead: number; sleepTarget: number;
  /** 'system' follows the phone's "remove animations" setting; the other two override it. */
  motion: 'system' | 'reduce' | 'full'; haptics: boolean; largeText: boolean; cats: string[];
}
export const DEFAULTS: Settings = { name: '', startHour: 0, lock: false, remindLead: 10, sleepTarget: 480, motion: 'system', haptics: true, largeText: false, cats: [...CATS] };
export interface SheetState { kind: string; props?: any }
export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

interface State {
  tab: Tab; date: ISODate; dir: number; calDay: ISODate | null; calMonth: ISODate; viewer: { mealId: string; photoId: string } | null;
  sheet: SheetState | null; toast: Toast | null; live: string; settings: Settings; ready: boolean;
  setTab(t: Tab): void; setDate(d: ISODate): void; setCalDay(d: ISODate | null): void; open(kind: string, props?: any): void; close(): void;
  say(text: string, action?: Toast['action']): void; announce(text: string): void;
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void; load(): Promise<void>;
}
/** True when movement should be replaced by short fades: the in-app setting wins, otherwise the system setting. */
export function reducedNow(): boolean {
  const m = useApp.getState().settings.motion;
  return m === 'reduce' || (m === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
/** Runs a state change inside a view transition where the browser supports it (shared-element motion between screens). */
export function transition(fn: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!d.startViewTransition || reducedNow()) { fn(); return; }
  d.startViewTransition(() => flushSync(fn));
}
const monthOf = (d: ISODate) => `${d.slice(0, 7)}-01`;
let opener: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export const useApp = create<State>((set, get) => ({
  tab: 'today', date: isoDate(new Date()), dir: 0, calDay: null, calMonth: monthOf(isoDate(new Date())), viewer: null,
  sheet: null, toast: null, live: '', settings: DEFAULTS, ready: false,
  setTab: (tab) => { if (tab !== get().tab) transition(() => set({ tab })); },
  setDate: (date) => set({ date, dir: date > get().date ? 1 : date < get().date ? -1 : 0 }),
  setCalDay: (calDay) => set(calDay ? { calDay, dir: calDay > (get().calDay || calDay) ? 1 : calDay < (get().calDay || calDay) ? -1 : 0, calMonth: monthOf(calDay) } : { calDay }),
  // The control that opened a sheet gets focus back when the sheet closes (it may be hidden while the sheet is up).
  open: (kind, props) => { if (!get().sheet) opener = document.activeElement as HTMLElement | null; set({ sheet: { kind, props } }); },
  close: () => { set({ sheet: null }); const el = opener; opener = null; requestAnimationFrame(() => { if (el?.isConnected && !get().sheet) el.focus({ preventScroll: true }); }); },
  say: (text, action) => {
    clearTimeout(toastTimer);
    const id = Date.now();
    set({ toast: { id, text, action } });
    toastTimer = setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, action ? 7000 : 3000);
  },
  // Screen readers only announce a change, so the same sentence twice in a row gets an invisible suffix.
  announce: (text) => set({ live: text === get().live ? `${text} ` : text }),
  setSetting: (k, v) => { const settings = { ...get().settings, [k]: v }; set({ settings }); setHaptics(settings.haptics); void kvSet('settings', settings); },
  load: async () => {
    const saved = await kvGet<Partial<Settings>>('settings', {});
    const lead = await kvGet<number | null>('remindLead', null);
    const settings = { ...DEFAULTS, ...(lead != null ? { remindLead: lead } : {}), ...saved };
    setHaptics(settings.haptics);
    const date = logicalDay(new Date(), settings.startHour);
    set({ settings, date, calMonth: monthOf(date), ready: true });
  },
}));
