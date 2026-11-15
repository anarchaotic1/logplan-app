/** Small pure helpers about one day's records. */
import type { Block, Sleep } from './model';
import type { ISODate } from './dates';

const planned = (b: Block) => b.title.trim().length > 0;
/** Share of planned blocks that are done; null when nothing is planned. */
export function adherence(blocks: Block[]): { value: number; n: number; done: number } | null {
  const p = blocks.filter(planned);
  const done = p.filter((b) => b.done).length;
  return p.length ? { value: done / p.length, n: p.length, done } : null;
}
export function adherenceByDay(blocks: Block[]): Map<ISODate, { value: number; n: number; done: number }> {
  const g = new Map<ISODate, Block[]>();
  for (const b of blocks.filter(planned)) g.set(b.date, [...(g.get(b.date) || []), b]);
  return new Map([...g].map(([d, bs]) => [d, adherence(bs)!]));
}

/** Sleep is drawn on an arc that runs from 18:00 to 12:00 the next day (18 hours). */
export const SLEEP_FROM = 18 * 60, SLEEP_SPAN = 18 * 60;
/** Minute of day (0..1439) to a position 0..1 on the sleep arc; times outside the window clamp to its nearer end. */
export function sleepPos(min: number): number {
  const rel = (min - SLEEP_FROM + 1440) % 1440;
  if (rel <= SLEEP_SPAN) return rel / SLEEP_SPAN;
  return rel - SLEEP_SPAN < 1440 - rel ? 1 : 0;
}
/** Position 0..1 on the sleep arc back to a minute of day, snapped to `step` minutes. */
export function sleepMin(pos: number, step = 5): number {
  const rel = Math.round((Math.max(0, Math.min(1, pos)) * SLEEP_SPAN) / step) * step;
  return (SLEEP_FROM + rel) % 1440;
}
export const sleepDur = (s: Pick<Sleep, 'bed' | 'wake'>) => (s.wake - s.bed + 1440) % 1440;
