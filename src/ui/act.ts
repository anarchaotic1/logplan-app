/** One-tap actions shared by every list: complete with a haptic, an effect from the tapped check, a spoken result and Undo. */
import { patch, put, remove } from '../lib/db';
import type { Block, Habit, Rec, Todo } from '../lib/model';
import { haptic } from '../lib/native';
import { celebrate } from '../fx';
import { useApp } from '../store';
import { toggleHabit } from '../data';
import { isDone } from '../lib/habits';

const say = (text: string, undo: () => void) => useApp.getState().say(text, { label: 'Undo', run: undo });

export function toggleBlock(b: Block, el?: Element | null) {
  const done = !b.done, name = b.title || b.log || 'Block';
  haptic(done ? 'success' : 'light');
  void patch<Block>(b.id, { done, ...(done ? {} : { actualDur: undefined }) });
  if (done) celebrate(el);
  say(done ? `Done: ${name}` : `Not done: ${name}`, () => void patch<Block>(b.id, { done: b.done, actualDur: b.actualDur }));
}
export function toggleTodo(t: Todo, el?: Element | null) {
  const done = !t.done;
  haptic(done ? 'success' : 'light');
  void patch<Todo>(t.id, { done });
  if (done) celebrate(el);
  say(done ? `Done: ${t.text}` : `Not done: ${t.text}`, () => void patch<Todo>(t.id, { done: t.done }));
}
export function tickHabit(h: Habit, date: string, cur: number | undefined, el?: Element | null) {
  const was = isDone(h, cur);
  haptic(was ? 'light' : 'success');
  void toggleHabit(h, date, cur);
  if (!was) celebrate(el);
  useApp.getState().announce(`${h.name} ${was ? 'not done' : 'done'}`);
}
/** Delete with Undo. The record comes back exactly as it was. */
export async function removeWithUndo(r: Rec, what: string) {
  await remove(r.id);
  say(`${what} deleted.`, () => void put<Rec>(r));
}
