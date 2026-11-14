import { create } from 'zustand';
import { flushSync } from 'react-dom';
import { isoDate, logicalDay, type ISODate } from './lib/dates';
import { kvGet, kvSet } from './lib/db';

export type Tab = 'today' | 'journal' | 'habits' | 'insights' | 'plan';
export const TABS: Tab[] = ['today', 'journal', 'habits', 'insights', 'plan'];
export interface Settings { name: string; startHour: number; lock: boolean; remindLead: number; sleepTarget: number }
export const DEFAULTS: Settings = { name: '', startHour: 0, lock: false, remindLead: 10, sleepTarget: 480 };
export interface SheetState { kind: string; props?: any }
export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

interface State {
  tab: Tab; date: ISODate; sheet: SheetState | null; toast: Toast | null; settings: Settings; ready: boolean;
  setTab(t: Tab): void; setDate(d: ISODate): void; open(kind: string, props?: any): void; close(): void;
  say(text: string, action?: Toast['action']): void; setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void; load(): Promise<void>;
}
/** Runs a state change inside a view transition where the browser supports it (shared-element motion between screens). */
export function transition(fn: () => void) {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!d.startViewTransition || reduce) { fn(); return; }
  d.startViewTransition(() => flushSync(fn));
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export const useApp = create<State>((set, get) => ({
  tab: 'today', date: isoDate(new Date()), sheet: null, toast: null, settings: DEFAULTS, ready: false,
  setTab: (tab) => { if (tab !== get().tab) transition(() => set({ tab })); },
  setDate: (date) => set({ date }),
  open: (kind, props) => set({ sheet: { kind, props } }),
  close: () => set({ sheet: null }),
  say: (text, action) => {
    clearTimeout(toastTimer);
    const id = Date.now();
    set({ toast: { id, text, action } });
    toastTimer = setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, action ? 6000 : 2600);
  },
  setSetting: (k, v) => { const settings = { ...get().settings, [k]: v }; set({ settings }); void kvSet('settings', settings); },
  load: async () => {
    const saved = await kvGet<Partial<Settings>>('settings', {});
    const lead = await kvGet<number | null>('remindLead', null);
    const settings = { ...DEFAULTS, ...(lead != null ? { remindLead: lead } : {}), ...saved };
    set({ settings, date: logicalDay(new Date(), settings.startHour), ready: true });
  },
}));
