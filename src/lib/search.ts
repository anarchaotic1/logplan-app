/** Plain text search across everything the user logs by day. No ranking beyond "newest day first". */
import type { Block, Journal, Meal, Rec, Todo } from './model';
import type { ISODate } from './dates';

export interface Hit { id: string; date: ISODate; kind: 'block' | 'todo' | 'meal' | 'intention'; text: string; time?: number; done?: boolean }

export function searchRecs(recs: Rec[], query: string, limit = 60): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const match = (s: string) => { const t = s.toLowerCase(); return words.every((w) => t.includes(w)); };
  const hits: Hit[] = [];
  for (const r of recs) {
    if (r.deleted || !r.date) continue;
    if (r.type === 'block') { const b = r as Block; const text = [b.title, b.log].filter(Boolean).join(' — '); if (match(text)) hits.push({ id: b.id, date: b.date, kind: 'block', text, time: b.start, done: b.done }); }
    else if (r.type === 'todo') { const t = r as Todo; if (match(t.text)) hits.push({ id: t.id, date: t.date, kind: 'todo', text: t.text, time: t.time ?? undefined, done: t.done }); }
    else if (r.type === 'meal') { const m = r as Meal; if (match(`${m.name} ${m.tag}`)) hits.push({ id: m.id, date: m.date, kind: 'meal', text: m.name, time: m.time }); }
    else if (r.type === 'journal') { const j = r as Journal; if (j.intention && match(j.intention)) hits.push({ id: j.id, date: j.date, kind: 'intention', text: j.intention }); }
  }
  hits.sort((a, b) => (a.date === b.date ? (a.time ?? -1) - (b.time ?? -1) : a.date < b.date ? 1 : -1));
  return hits.slice(0, limit);
}
