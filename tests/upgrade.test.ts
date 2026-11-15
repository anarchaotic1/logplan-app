import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { db, useDbForTests } from '../src/lib/db';
import { runMigration } from '../src/lib/migrate';
import { mergeRecords } from '../src/lib/merge';
import { searchRecs } from '../src/lib/search';
import type { Rec, RecType } from '../src/lib/model';

/** v2.1 removes screens (journal, weekly review, study, insights) but must never touch their stored records.
 *  This seeds a v2.0 database with every record type, runs what the app runs at start-up, and compares. */
const S = '001794650000000:00000:phone';
export const V2_RECORDS: Rec[] = [
  { id: 'b1', type: 'block', updatedAt: S, date: '2026-11-13', start: 540, dur: 90, title: 'RTL review', log: 'done', cat: 'Work', done: true, actualDur: 100, remindLead: 10, cue: 'After stand-up' },
  { id: 't1', type: 'todo', updatedAt: S, date: '2026-11-13', text: 'Book dentist', done: false, time: 600, remindAt: 590, main: true, when: 'at desk', carriedFrom: '2026-11-12' },
  { id: 'journal:2026-11-13', type: 'journal', updatedAt: S, date: '2026-11-13', intention: 'One calm block', text: 'Free writing', win: 'Shipped', lesson: 'Start earlier', ifThen: 'If tired, then walk', mood: 4, energy: 3, tags: ['work'], photos: ['pj'] },
  { id: 'h1', type: 'habit', updatedAt: S, name: 'Gym', cue: 'After work', target: { kind: 'weekly', perWeek: 3 }, restDays: [6], remindTime: 1065, activityMin: 45, createdOn: '2026-09-01', order: 0 },
  { id: 'hl:h1:2026-11-13', type: 'habitLog', updatedAt: S, date: '2026-11-13', habitId: 'h1', value: 1 },
  { id: 'm1', type: 'meal', updatedAt: S, date: '2026-11-13', time: 785, name: 'Dal rice', tag: 'Lunch' },
  { id: 'mc1', type: 'mealCat', updatedAt: S, name: 'Dal rice', tag: 'Lunch' },
  { id: 'c1', type: 'countdown', updatedAt: S, label: 'IELTS exam', target: '2026-11-19' },
  { id: 'wr:2026-11-09', type: 'weekReview', updatedAt: S, date: '2026-11-09', good: 'Mornings', drop: 'Late phone', obstacle: 'Meetings', plan: 'If a meeting runs over, then move the block', done: true },
  { id: 'sleep:2026-11-13', type: 'sleep', updatedAt: S, date: '2026-11-13', bed: 1410, wake: 415 },
  { id: 'tp1', type: 'template', updatedAt: S, name: 'Standard day', blocks: [{ start: 540, dur: 60, title: 'Deep work', cat: 'Work', cue: 'At desk' }] },
  { id: 'rc1', type: 'recurring', updatedAt: S, kind: 'block', title: 'Gym', start: 1080, dur: 60, cat: 'Health', days: [0, 2, 4], from: '2030-01-01' },
  { id: 'topic1', type: 'topic', updatedAt: S, title: 'CMOS inverter delay', notes: 'Why does it scale?', interval: 7, due: '2026-11-20', reviews: [{ date: '2026-11-13', ok: true }] },
  { id: 'gone', type: 'todo', updatedAt: S, date: '2026-11-12', deleted: true } as Rec,
];
const ALL_TYPES: RecType[] = ['block', 'todo', 'journal', 'habit', 'habitLog', 'meal', 'mealCat', 'countdown', 'weekReview', 'sleep', 'template', 'recurring', 'topic'];
const sorted = (r: Rec[]) => [...r].sort((a, b) => (a.id < b.id ? -1 : 1));

let n = 0;
beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); useDbForTests(`upgrade${n++}`); });

describe('upgrading in place from v2.0 to v2.1', () => {
  it('the fixture covers every record type', () => {
    expect(new Set(V2_RECORDS.map((r) => r.type))).toEqual(new Set(ALL_TYPES));
  });
  it('start-up leaves every stored record exactly as it was, including those whose screens were removed', async () => {
    await db.rec.bulkPut(V2_RECORDS);
    await db.photos.put({ id: 'pj', createdAt: 1, blob: new Blob(['x']) });
    await db.kv.put({ key: 'settings', value: { name: 'Hari', startHour: 4, lock: true, remindLead: 15, sleepTarget: 450 } });
    const r = await runMigration(); // no v1 database on this device: nothing to do
    expect(r.status).toBe('none');
    expect(sorted(await db.rec.toArray())).toEqual(sorted(V2_RECORDS));
    expect(await db.photos.count()).toBe(1);
    expect((await db.kv.get('settings'))!.value).toMatchObject({ name: 'Hari', startHour: 4, lock: true });
  });
  it('sync merge and search leave the old fields alone', () => {
    const m = mergeRecords(V2_RECORDS, V2_RECORDS);
    expect(sorted(m.merged)).toEqual(sorted(V2_RECORDS));
    expect(m.toLocal).toHaveLength(0);
    expect(searchRecs(V2_RECORDS, 'calm')[0]).toMatchObject({ kind: 'intention', date: '2026-11-13' });
  });
});
