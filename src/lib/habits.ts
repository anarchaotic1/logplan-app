/** Habit maths. Grounded in Lally et al. (2010): repetition in a stable context builds automaticity along a
 *  flattening curve, and one missed day barely matters while repeated inconsistency does. */
import { addDays, daysBetween, dow, mondayOf, type ISODate } from './dates';
import type { Habit } from './model';

export type LogMap = Record<ISODate, number>; // date → value (>0 means done / count)

export function isDue(h: Pick<Habit, 'restDays' | 'createdOn'>, date: ISODate): boolean {
  return !h.restDays.includes(dow(date)) && date >= h.createdOn;
}
export function isDone(h: Pick<Habit, 'target'>, value: number | undefined): boolean {
  if (!value) return false;
  return h.target.kind === 'count' ? value >= (h.target.count || 1) : value > 0;
}
/** Forgiving streak for daily and count habits: counts completed due days going back from today.
 *  A single missed due day does not end it; two missed due days in a row do. Rest days are skipped.
 *  If today is not done yet it is not counted as a miss. */
export function forgivingStreak(h: Habit, logs: LogMap, today: ISODate): number {
  if (h.target.kind === 'weekly') return weeklyStreak(h, logs, today);
  let streak = 0, misses = 0, d = today;
  if (!isDone(h, logs[d])) d = addDays(d, -1);
  for (let guard = 0; guard < 3700 && d >= h.createdOn; guard++, d = addDays(d, -1)) {
    if (!isDue(h, d)) continue;
    if (isDone(h, logs[d])) { streak++; misses = 0; }
    else if (++misses >= 2) break;
  }
  return streak;
}
export function weekCount(logs: LogMap, monday: ISODate): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if (logs[addDays(monday, i)] > 0) n++;
  return n;
}
/** Weekly habits ("3 times a week"): number of consecutive weeks that met the target. The current week counts once met, and is never a miss while still in progress. */
export function weeklyStreak(h: Habit, logs: LogMap, today: ISODate): number {
  const need = h.target.perWeek || 1;
  let wk = mondayOf(today), streak = 0;
  if (weekCount(logs, wk) >= need) streak++;
  wk = addDays(wk, -7);
  while (wk >= mondayOf(h.createdOn) && weekCount(logs, wk) >= need) { streak++; wk = addDays(wk, -7); }
  return streak;
}
/** Share of opportunities taken over the last `window` days (0..1), or null with no opportunities yet. */
export function consistency(h: Habit, logs: LogMap, today: ISODate, window = 28): number | null {
  const from = addDays(today, -(window - 1)) < h.createdOn ? h.createdOn : addDays(today, -(window - 1));
  if (h.target.kind === 'weekly') {
    let done = 0, need = 0;
    const per = h.target.perWeek || 1, thisWeek = mondayOf(today);
    let wk = mondayOf(from);
    if (wk < from) wk = addDays(wk, 7); // only weeks that start inside the window
    for (; wk <= today; wk = addDays(wk, 7)) {
      const c = Math.min(weekCount(logs, wk), per);
      if (wk === thisWeek && c < per) continue; // week still in progress: not a miss yet
      need += per; done += c;
    }
    return need ? done / need : null;
  }
  let due = 0, done = 0;
  for (let d = from; d <= today; d = addDays(d, 1)) {
    if (!isDue(h, d)) continue;
    if (d === today && !isDone(h, logs[d])) continue; // today still open
    due++; if (isDone(h, logs[d])) done++;
  }
  return due ? done / due : null;
}
/** Modelled automaticity (0..1) per day since the habit started. This is an illustration of the curve shape
 *  reported by Lally et al., not a measurement of the user: each repetition closes 4.4% of the remaining gap
 *  (which reaches 95% after 66 repetitions, the study's median), and each missed due day costs about 0.7%
 *  (the study saw roughly 0.29 points on a 42-point scale). */
export const REP_GAIN = 1 - Math.pow(0.05, 1 / 66);
export const MISS_LOSS = 0.29 / 42;
export function automaticityCurve(h: Habit, logs: LogMap, today: ISODate): number[] {
  const out: number[] = [];
  let a = 0;
  const n = Math.min(daysBetween(h.createdOn, today), 400);
  for (let i = 0; i <= n; i++) {
    const d = addDays(h.createdOn, i);
    if (logs[d] > 0) a += (1 - a) * REP_GAIN;
    else if (isDue(h, d) && d !== today && h.target.kind !== 'weekly') a *= 1 - MISS_LOSS;
    out.push(a);
  }
  return out;
}
