/** All writes go through here so screens stay declarative. */
import { addDays, dow, type ISODate } from './lib/dates';
import { byType, byTypeDate, db, kvGet, kvSet, patch, put, remove } from './lib/db';
import { uid, type Block, type Habit, type HabitLog, type Journal, type Meal, type Recurring, type Sleep, type Template, type Todo } from './lib/model';
import { isDone } from './lib/habits';

export const emptyJournal = (date: ISODate): Journal => ({ id: `journal:${date}`, type: 'journal', date, updatedAt: '', intention: '', text: '', win: '', lesson: '', ifThen: '', mood: null, energy: null, tags: [], photos: [] });

export function addBlock(date: ISODate, start: number, dur = 60, extra: Partial<Block> = {}) {
  return put<Block>({ id: uid('b'), type: 'block', date, start, dur, title: '', log: '', cat: '', done: false, remindLead: null, ...extra });
}
export function addTodo(date: ISODate, text: string, extra: Partial<Todo> = {}) {
  return put<Todo>({ id: uid('t'), type: 'todo', date, text, done: false, time: null, remindAt: null, ...extra });
}
export async function setMain(date: ISODate, text: string) {
  const cur = (await byTypeDate<Todo>('todo', date)).find((t) => t.main);
  if (cur) return patch<Todo>(cur.id, { text });
  return addTodo(date, text, { main: true });
}
export async function saveJournal(date: ISODate, changes: Partial<Journal>) {
  const cur = ((await db.rec.get(`journal:${date}`)) as Journal | undefined);
  const base = cur && !cur.deleted ? cur : emptyJournal(date);
  const { id: _i, type: _t, date: _d, updatedAt: _u, deleted: _x, ...rest } = changes as Journal;
  void _i; void _t; void _d; void _u; void _x;
  await put<Journal>({ ...base, ...rest, deleted: undefined });
}
export async function setHabitLog(habit: Habit, date: ISODate, value: number) {
  await put<HabitLog>({ id: `hl:${habit.id}:${date}`, type: 'habitLog', date, habitId: habit.id, value });
}
export async function toggleHabit(habit: Habit, date: ISODate, current: number | undefined) {
  const target = habit.target.kind === 'count' ? habit.target.count || 1 : 1;
  await setHabitLog(habit, date, isDone(habit, current) ? 0 : target);
}
export function addHabit(h: Partial<Habit> & { name: string }, today: ISODate, order: number) {
  return put<Habit>({ id: uid('h'), type: 'habit', cue: '', target: { kind: 'daily' }, restDays: [], remindTime: null, createdOn: today, order, ...h });
}
export async function saveSleep(date: ISODate, bed: number, wake: number) {
  await put<Sleep>({ id: `sleep:${date}`, type: 'sleep', date, bed, wake });
}
export const tagFor = (m: number) => (m < 660 ? 'Breakfast' : m < 960 ? 'Lunch' : m < 1260 ? 'Dinner' : 'Snack');
export function addMeal(date: ISODate, time: number, name: string, tag = tagFor(time), extra: Partial<Meal> = {}) {
  return put<Meal>({ id: uid('m'), type: 'meal', date, time, name, tag, ...extra });
}
/** Photo removal is two-step so it can be undone: the id leaves the meal now, the bytes go at the next sync or app start. */
export async function detachPhoto(meal: Meal, photoId: string) {
  await patch<Meal>(meal.id, { photos: (meal.photos || []).filter((p) => p !== photoId) });
  await kvSet('photoTrash', [...new Set([...(await kvGet<string[]>('photoTrash', [])), photoId])]);
}
export async function attachPhoto(mealId: string, photoId: string) {
  const m = (await db.rec.get(mealId)) as Meal | undefined;
  if (!m || m.deleted) return;
  await patch<Meal>(mealId, { photos: [...new Set([...(m.photos || []), photoId])] });
  await kvSet('photoTrash', (await kvGet<string[]>('photoTrash', [])).filter((p) => p !== photoId));
}
/** Yesterday's unfinished to-dos, unless the user already handled the prompt today. */
export async function carryCandidates(today: ISODate): Promise<Todo[]> {
  if ((await kvGet<string>('carryHandled', '')) === today) return [];
  return (await byTypeDate<Todo>('todo', addDays(today, -1))).filter((t) => !t.done && t.text.trim());
}
export async function carryOver(today: ISODate, todos: Todo[]) {
  for (const t of todos) await put<Todo>({ ...t, id: `co:${t.id}:${today}`, date: today, done: false, carriedFrom: t.date, remindAt: null });
  await kvSet('carryHandled', today);
}
export const dismissCarry = (today: ISODate) => kvSet('carryHandled', today);

/** Creates today's and future instances of recurring items. Ids are derived from rule and date, so two devices
 *  (or two runs) never create duplicates, and an instance the user deleted stays deleted (its tombstone exists). */
export async function ensureRecurring(date: ISODate) {
  const rules = (await byType<Recurring>('recurring')).filter((r) => r.days.includes(dow(date)) && date >= r.from);
  for (const r of rules) {
    const id = `rc:${r.id}:${date}`;
    if (await db.rec.get(id)) continue;
    if (r.kind === 'block') await put<Block>({ id, type: 'block', date, start: r.start ?? 540, dur: r.dur ?? 60, title: r.title, log: '', cat: r.cat || '', done: false, remindLead: null, cue: r.cue });
    else await put<Todo>({ id, type: 'todo', date, text: r.title, done: false, time: r.start ?? null, remindAt: null });
  }
}
export async function applyTemplate(t: Template, date: ISODate) {
  for (const b of t.blocks) await addBlock(date, b.start, b.dur, { title: b.title, cat: b.cat, cue: b.cue });
}
export async function saveDayAsTemplate(name: string, date: ISODate) {
  const blocks = (await byTypeDate<Block>('block', date)).filter((b) => b.title.trim()).sort((a, b) => a.start - b.start);
  await put<Template>({ id: uid('tp'), type: 'template', name, blocks: blocks.map((b) => ({ start: b.start, dur: b.dur, title: b.title, cat: b.cat, cue: b.cue })) });
  return blocks.length;
}

export interface Focus { blockId: string; startedAt: number; len?: number }
export const getFocus = () => kvGet<Focus | null>('focus', null);
export async function startFocus(blockId: string, len?: number) { await kvSet('focus', { blockId, startedAt: Date.now(), len }); }
export async function stopFocus(markDone: boolean) {
  const f = await getFocus();
  if (!f) return;
  const min = Math.max(1, Math.round((Date.now() - f.startedAt) / 60000));
  if (markDone) await patch<Block>(f.blockId, { done: true, actualDur: min });
  await kvSet('focus', null);
}
export { patch, put, remove, uid };
