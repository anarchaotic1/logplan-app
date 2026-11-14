/** Pure notification planner: turns records into the list of notifications that should be pending.
 *  The native layer cancels what is pending and schedules this list. Only looks ahead a bounded window,
 *  so it never scans history (v1 re-read every stored week on every edit). */
import { addDays, fmtMin, parseISO, type ISODate } from './dates';
import type { Block, Habit, Todo } from './model';
import { isDone, isDue } from './habits';

export interface PlannedNotif { key: string; id: number; title: string; body: string; at: Date }
export const HORIZON_DAYS = 30;
export const MAX_PENDING = 400; // Android caps pending alarms per app (about 500 on some devices)

export function nid(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 2000000000) || 1; }
const at = (date: ISODate, min: number) => { const d = parseISO(date); d.setMinutes(min); return d; };

export function planNotifications(input: { now: Date; today: ISODate; habits: Habit[]; doneToday: Record<string, number>; blocks: Block[]; todos: Todo[] }): PlannedNotif[] {
  const { now, today } = input;
  const out: PlannedNotif[] = [];
  const add = (key: string, title: string, body: string, when: Date) => { if (when > now) out.push({ key, id: nid(key), title, body, at: when }); };
  for (const b of input.blocks) {
    if (b.deleted || b.done || b.remindLead == null) continue;
    add(`block:${b.id}`, `${fmtMin(b.start)} · ${b.title || 'Planned block'}`, b.cue || 'Starting soon.', at(b.date, b.start - b.remindLead));
  }
  for (const t of input.todos) {
    if (t.deleted || t.done || t.remindAt == null) continue;
    add(`todo:${t.id}`, 'To-do', t.text.slice(0, 120), at(t.date, t.remindAt));
  }
  for (const h of input.habits) {
    if (h.deleted || h.archived || h.remindTime == null) continue;
    for (let off = 0; off < HORIZON_DAYS; off++) {
      const d = addDays(today, off);
      if (!isDue(h, d)) continue;
      if (off === 0 && isDone(h, input.doneToday[h.id])) continue;
      add(`habit:${h.id}:${d}`, h.name, h.cue ? `${h.cue}` : `Time for ${h.name}.`, at(d, h.remindTime));
    }
  }
  out.sort((a, b) => +a.at - +b.at);
  const kept = out.slice(0, MAX_PENDING - 1);
  // Dated reminders run out if the app is never opened; say so once instead of going silent (a v1 defect).
  if (input.habits.some((h) => !h.deleted && !h.archived && h.remindTime != null)) {
    const end = at(addDays(today, HORIZON_DAYS), 9 * 60);
    kept.push({ key: 'topup', id: nid('topup'), title: 'Log/Plan', body: 'Open the app to keep your habit reminders running.', at: end });
  }
  return kept;
}
