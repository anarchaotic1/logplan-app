import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { db, useDbForTests } from '../src/lib/db';
import { runMigration } from '../src/lib/migrate';
import { mergeRecords } from '../src/lib/merge';
import { searchRecs } from '../src/lib/search';
import type { Rec, RecType } from '../src/lib/model';
import { V2_RECORDS } from './v2-fixture';

/** v2.1 removes screens (journal, weekly review, study, insights) but must never touch their stored records.
 *  This seeds a v2.0 database with every record type, runs what the app runs at start-up, and compares. */
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
