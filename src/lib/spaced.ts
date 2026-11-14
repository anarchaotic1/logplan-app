/** Spaced self-testing for Study mode: expanding intervals after a successful recall, back to one day after a failed one.
 *  Rationale: practice testing and distributed practice (see Dunlosky et al., 2013). */
import { addDays, type ISODate } from './dates';
export const LADDER = [1, 3, 7, 14, 30, 60, 120];
export function nextInterval(current: number, ok: boolean): number {
  if (!ok) return LADDER[0];
  const i = LADDER.findIndex((d) => d > current);
  return i === -1 ? LADDER[LADDER.length - 1] : LADDER[i];
}
export function review(topic: { interval: number; reviews: { date: ISODate; ok: boolean }[] }, ok: boolean, today: ISODate) {
  const interval = nextInterval(topic.interval, ok);
  return { interval, due: addDays(today, interval), reviews: [...topic.reviews, { date: today, ok }] };
}
