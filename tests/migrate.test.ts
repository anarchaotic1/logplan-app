import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { convertV1, importV1Backup, readV1, runMigration, MIGRATION_STAMP } from '../src/lib/migrate';
import { useDbForTests, kvGet, patch, kvSet } from '../src/lib/db';
import type { Block, Habit, Todo } from '../src/lib/model';
import { makeV1Dump, writeV1 } from './fixtures';

let n = 0;
beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); useDbForTests(`t${n++}`); });

describe('convertV1 (pure)', () => {
  const { recs, orphanHabitLogs, warnings } = convertV1(makeV1Dump(), '2026-11-14');
  const of = (t: string) => recs.filter((r) => r.type === t);
  it('converts each hour row that has text into a one-hour block', () => {
    // 3 weeks × 7 days × 3 rows + 3 Sunday midnight rows
    expect(of('block').length).toBe(3 * 7 * 3 + 3);
    const b = recs.find((r) => r.id === 'v1b:2026-11-09:9') as Block;
    expect(b).toMatchObject({ date: '2026-11-09', start: 540, dur: 60, title: 'Deep work 2-0', log: 'Did 80%', done: true });
    const gym = recs.find((r) => r.id === 'v1b:2026-11-09:18') as Block;
    expect(gym.remindLead).toBe(10);
    const logOnly = recs.find((r) => r.id === 'v1b:2026-11-09:21') as Block;
    expect(logOnly).toMatchObject({ title: '', log: 'Read a paper' });
  });
  it('maps the v1 "24" row to 00:00 of the next calendar day', () => {
    const b = recs.find((r) => r.id === 'v1b:2026-11-15:24') as Block;
    expect(b).toMatchObject({ date: '2026-11-16', start: 0, title: 'Lights out' });
  });
  it('keeps to-dos with time and reminder, drops blank ones, and reads the old top3 format', () => {
    expect(of('todo').length).toBe(3 * 7 * 2 + 2);
    const t = recs.find((r) => r.id === 'v1t:2026-11-09:p20b') as Todo;
    expect(t).toMatchObject({ text: 'Call bank', done: false, time: null, remindAt: 960 });
    expect((recs.find((r) => r.id === 'v1t:2026-11-09:p20a') as Todo).time).toBe(630);
    expect(recs.some((r) => r.type === 'todo' && (r as Todo).text === 'Ship v1')).toBe(true);
  });
  it('keeps habits, their logs and reminders; counts logs of deleted habits as orphans', () => {
    const gym = recs.find((r) => r.id === 'v1h:gym') as Habit;
    expect(gym).toMatchObject({ name: 'Gym', remindTime: 420, createdOn: '2026-10-27' });
    expect((recs.find((r) => r.id === 'v1h:bball') as Habit).remindTime).toBeNull();
    expect(of('habitLog').every((l: any) => l.value === 1 && l.habitId.startsWith('v1h:'))).toBe(true);
    expect(recs.some((r) => r.id === 'hl:v1h:gym:2026-11-01')).toBe(false);
    expect(orphanHabitLogs).toBe(20);
  });
  it('keeps meals, catalogue, countdowns and reflections', () => {
    expect(of('meal').length).toBe(21);
    expect(of('meal')[0]).toMatchObject({ time: 795, name: 'Dal rice', tag: 'Lunch' });
    expect(of('mealCat').length).toBe(1);
    expect(of('countdown')).toHaveLength(1);
    expect(recs.find((r) => r.id === 'wr:2026-11-02')).toMatchObject({ good: 'Morning blocks', drop: 'Late scrolling' });
  });
  it('reports unreadable records instead of failing', () => {
    expect(warnings.some((w) => w.includes('app-week:broken'))).toBe(true);
  });
  it('is deterministic', () => {
    expect(convertV1(makeV1Dump(), '2026-11-14').recs).toEqual(recs);
    expect(new Set(recs.map((r) => r.id)).size).toBe(recs.length);
    expect(recs.every((r) => r.updatedAt === MIGRATION_STAMP)).toBe(true);
  });
});

describe('runMigration (IndexedDB)', () => {
  it('does nothing and does not create the v1 database on a fresh install', async () => {
    const r = await runMigration();
    expect(r.status).toBe('none');
    expect((await indexedDB.databases()).some((d) => d.name === 'logplan-db')).toBe(false);
  });
  it('migrates, backs up without the token, and leaves v1 untouched', async () => {
    const dump = makeV1Dump();
    await writeV1(dump);
    const d = useDbForTests(`m${n++}`);
    const r = await runMigration();
    expect(r.status).toBe('done');
    expect(r.inserted).toBe(r.converted);
    expect(await d.rec.count()).toBe(r.converted);
    const backup = await kvGet<any>('v1-backup', null);
    expect(backup.app).toBe('logplan');
    expect(backup.data['app-gh-token']).toBeUndefined();
    expect(backup.data['app-week:2026-11-09']).toBe(dump['app-week:2026-11-09']);
    expect(await kvGet('remindLead', 0)).toBe(15);
    expect(await readV1()).toEqual(dump);
  });
  it('is idempotent and never overwrites edits made in v2', async () => {
    await writeV1(makeV1Dump());
    const d = useDbForTests(`m${n++}`);
    const first = await runMigration();
    await patch<Block>('v1b:2026-11-09:9', { title: 'Edited in v2' });
    await kvSet('migration', null); // force a full re-run
    const second = await runMigration();
    expect(second.inserted).toBe(0);
    expect(second.skippedExisting).toBe(first.converted);
    expect(await d.rec.count()).toBe(first.converted);
    expect(((await d.rec.get('v1b:2026-11-09:9')) as Block).title).toBe('Edited in v2');
  });
  it('resumes after an interruption that left only part of the data', async () => {
    await writeV1(makeV1Dump());
    const d = useDbForTests(`m${n++}`);
    const all = convertV1(makeV1Dump()).recs;
    await d.rec.bulkAdd(all.slice(0, 40)); // crash after 40 records, before "done" was recorded
    const r = await runMigration();
    expect(r.inserted).toBe(all.length - 40);
    expect(await d.rec.count()).toBe(all.length);
  });
  it('imports a v1 backup file (the path when v2 cannot be installed over v1), idempotently and without the token', async () => {
    const d = useDbForTests(`m${n++}`);
    const file = { app: 'logplan', version: 4, exportedAt: '2026-11-14T10:00:00Z', records: 9, data: makeV1Dump() };
    const first = await importV1Backup(file);
    expect(first.inserted).toBe(convertV1(makeV1Dump()).recs.length);
    await patch<Block>('v1b:2026-11-09:9', { title: 'Edited in v2' });
    const again = await importV1Backup(file);
    expect(again.inserted).toBe(0);
    expect(((await d.rec.get('v1b:2026-11-09:9')) as Block).title).toBe('Edited in v2');
    expect(JSON.stringify(await kvGet('v1-backup', null))).not.toContain('ghp_');
    await expect(importV1Backup({ app: 'other', data: {} })).rejects.toThrow();
    expect((await runMigration()).status).toBe('done'); // already recorded; a later launch does nothing more
  });
});
