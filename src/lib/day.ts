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

/** Meals (v2.2). Plate groups are four yes/no marks per meal; macros are optional grams. */
export const GROUPS = ['Protein', 'Veg', 'Carbs', 'Fruit or dairy'] as const;
export const GROUP_COLORS = ['var(--accent)', 'var(--green)', 'var(--blue)', 'var(--violet)'] as const;
export const mealGroups = (m: { groups?: boolean[] }): boolean[] => [0, 1, 2, 3].map((i) => !!m.groups?.[i]);
export const MACROS = ['protein', 'carbs', 'fat'] as const;
export type MacroKey = (typeof MACROS)[number];
/** Quick sizes for entering a macro without counting: small, medium, large, in grams. */
export const MACRO_PRESETS: Record<MacroKey, [number, number, number]> = { protein: [10, 20, 35], carbs: [25, 50, 80], fat: [5, 12, 20] };
export function macroTotals(meals: { macros?: { protein: number; carbs: number; fat: number } }[]) {
  const t = { protein: 0, carbs: 0, fat: 0, logged: 0 };
  for (const m of meals) if (m.macros) { t.protein += m.macros.protein || 0; t.carbs += m.macros.carbs || 0; t.fat += m.macros.fat || 0; t.logged++; }
  return t;
}
/** The block the Now card shows: the one running or coming up next, else the first unfinished one of the day. */
export function nowBlock<T extends { start: number; dur: number; done: boolean }>(list: T[], min: number | null): T | undefined {
  const open = list.filter((b) => !b.done);
  return (min != null ? open.find((b) => b.start + b.dur > min) : undefined) ?? open[0];
}
