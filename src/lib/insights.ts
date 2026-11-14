/** On-device insights. Plain deterministic statistics; each result carries the amount of data it rests on,
 *  and nothing is reported below a minimum sample. These are correlations in the user's own data, not causes. */
import type { Block, Habit, Sleep } from './model';
import type { ISODate } from './dates';

export interface Stat<T> { value: T; n: number }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const planned = (b: Block) => b.title.trim().length > 0;

export function adherence(blocks: Block[]): Stat<number> | null {
  const p = blocks.filter(planned);
  return p.length ? { value: p.filter((b) => b.done).length / p.length, n: p.length } : null;
}
export function adherenceByDay(blocks: Block[]): Map<ISODate, number> {
  const g = new Map<ISODate, Block[]>();
  for (const b of blocks.filter(planned)) g.set(b.date, [...(g.get(b.date) || []), b]);
  return new Map([...g].map(([d, bs]) => [d, bs.filter((b) => b.done).length / bs.length]));
}
export const MIN_PER_HOUR = 5;
/** Completion rate by hour of day, for hours with at least MIN_PER_HOUR planned blocks. Best first. */
export function bestHours(blocks: Block[]): { hour: number; rate: number; n: number }[] {
  const by: Record<number, { d: number; n: number }> = {};
  for (const b of blocks.filter(planned)) { const h = Math.floor(b.start / 60); (by[h] ||= { d: 0, n: 0 }).n++; if (b.done) by[h].d++; }
  return Object.entries(by).filter(([, v]) => v.n >= MIN_PER_HOUR).map(([h, v]) => ({ hour: +h, rate: v.d / v.n, n: v.n })).sort((a, b) => b.rate - a.rate || b.n - a.n);
}
export const MIN_OVERRUN = 5;
/** Median of actual ÷ planned duration. 1.3 means tasks typically take 30% longer than planned (the planning fallacy, measured on yourself). */
export function overrunFactor(blocks: Block[]): Stat<number> | null {
  const r = blocks.filter((b) => b.done && b.actualDur && b.dur > 0).map((b) => b.actualDur! / b.dur);
  return r.length >= MIN_OVERRUN ? { value: median(r), n: r.length } : null;
}
export const MIN_DAYS_EACH = 7;
/** Difference in mean daily adherence between days a habit was done and days it was not. */
export function habitLift(habits: Habit[], habitDays: Record<string, Set<ISODate>>, dayAdh: Map<ISODate, number>): { habit: Habit; lift: number; withN: number; withoutN: number }[] {
  const out = [];
  for (const h of habits) {
    const w: number[] = [], wo: number[] = [];
    for (const [d, a] of dayAdh) { if (d < h.createdOn) continue; (habitDays[h.id]?.has(d) ? w : wo).push(a); }
    if (w.length >= MIN_DAYS_EACH && wo.length >= MIN_DAYS_EACH) out.push({ habit: h, lift: mean(w) - mean(wo), withN: w.length, withoutN: wo.length });
  }
  return out.sort((a, b) => b.lift - a.lift);
}
export const MIN_SLEEP = 7;
/** Standard deviation (minutes) of bedtime and wake time. Bedtimes after midnight are treated as late, not early. */
export function sleepRegularity(sleeps: Sleep[]): Stat<{ bedSd: number; wakeSd: number; avgDur: number }> | null {
  if (sleeps.length < MIN_SLEEP) return null;
  const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
  const bed = sleeps.map((s) => (s.bed < 720 ? s.bed + 1440 : s.bed));
  const dur = sleeps.map((s, i) => ((s.wake + 1440) - bed[i] + 1440) % 1440);
  return { value: { bedSd: sd(bed), wakeSd: sd(sleeps.map((s) => s.wake)), avgDur: mean(dur) }, n: sleeps.length };
}
