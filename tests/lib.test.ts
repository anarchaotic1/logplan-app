import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, daysBetween, dow, firstISOMonday, fmtDur, fmtMin, isoWeek, logicalDay, mondayOf, monthGrid, parseHM, snap15, weeksInISOYear } from '../src/lib/dates';
import { observe, resetHlcForTests, setNode, tick } from '../src/lib/hlc';
import { bucketOf, mergeRecords, pruneTombstones } from '../src/lib/merge';
import { decryptJSON, deriveKey, encryptJSON, keyFromRecovery, makeKeyCheck, randomBytes, verifyKey } from '../src/lib/crypto';
import { consistency, forgivingStreak, isDue } from '../src/lib/habits';
import { adherence, adherenceByDay, sleepDur, sleepMin, sleepPos } from '../src/lib/day';
import { searchRecs } from '../src/lib/search';
import { fitSize } from '../src/lib/photos';
import { planNotifications, HORIZON_DAYS } from '../src/lib/notif';
import type { Block, Habit, Rec, Todo } from '../src/lib/model';

describe('dates', () => {
  it('ISO weeks, including year boundaries', () => {
    expect(isoWeek('2026-11-14')).toEqual({ week: 46, year: 2026 });
    expect(isoWeek('2026-01-01')).toEqual({ week: 1, year: 2026 });
    expect(isoWeek('2027-01-01')).toEqual({ week: 53, year: 2026 });
    expect(isoWeek('2024-12-30')).toEqual({ week: 1, year: 2025 });
    expect(isoWeek('2021-01-03')).toEqual({ week: 53, year: 2020 });
    expect(weeksInISOYear(2026)).toBe(53);
    expect(weeksInISOYear(2025)).toBe(52);
    expect(firstISOMonday(2026)).toBe('2025-12-29');
  });
  it('day arithmetic', () => {
    expect(mondayOf('2026-11-14')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(dow('2026-11-14')).toBe(5);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(daysBetween('2026-03-01', '2026-11-14')).toBe(258);
    expect(monthGrid(2026, 10)[0]).toBe('2026-10-26');
    expect(monthGrid(2026, 10)).toHaveLength(42);
  });
  it('times and the configurable day start', () => {
    expect(fmtMin(860)).toBe('14:20');
    expect(parseHM('07:05')).toBe(425);
    expect(snap15(52)).toBe(45);
    expect(fmtDur(150)).toBe('2h 30m');
    expect(logicalDay(new Date(2026, 10, 14, 1, 30), 4)).toBe('2026-11-13');
    expect(logicalDay(new Date(2026, 10, 14, 4, 0), 4)).toBe('2026-11-14');
    expect(logicalDay(new Date(2026, 10, 14, 1, 30), 0)).toBe('2026-11-14');
  });
});

describe('hybrid logical clock', () => {
  beforeEach(() => resetHlcForTests());
  it('always increases, even when the wall clock stands still or goes backwards', () => {
    const a = tick(1000), b = tick(1000), c = tick(900);
    expect(a < b && b < c).toBe(true);
  });
  it('stamps after a seen remote stamp sort later, even on a slow device clock', () => {
    setNode('phone');
    const remote = '000000000005000:00002:laptop';
    observe(remote, 1000);
    expect(tick(1000) > remote).toBe(true);
  });
  it('ignores stamps from a device whose clock is far in the future', () => {
    observe(`${String(Date.now() + 10 * 86400000).padStart(15, '0')}:00000:x`);
    expect(Number(tick().split(':')[0])).toBeLessThan(Date.now() + 1000);
  });
});

const rec = (id: string, updatedAt: string, extra: object = {}): Rec => ({ id, type: 'todo', date: '2026-11-14', text: id, done: false, updatedAt, ...extra } as Rec);
describe('merge (two simulated devices)', () => {
  it('latest edit wins in both directions and unseen records are exchanged', () => {
    const phone = [rec('a', '5:0:p', { text: 'phone newer' }), rec('b', '1:0:p'), rec('c', '2:0:p')];
    const laptop = [rec('a', '3:0:l', { text: 'laptop older' }), rec('b', '4:0:l', { text: 'laptop newer' }), rec('d', '2:0:l')];
    const pad = (r: Rec) => ({ ...r, updatedAt: r.updatedAt.split(':').map((x, i) => (i === 0 ? x.padStart(15, '0') : x)).join(':') });
    const m = mergeRecords(phone.map(pad), laptop.map(pad));
    expect(m.merged.map((r) => [r.id, (r as Todo).text])).toEqual([['a', 'phone newer'], ['b', 'laptop newer'], ['c', 'c'], ['d', 'd']]);
    expect(m.toLocal.map((r) => r.id).sort()).toEqual(['b', 'd']);
    expect(m.toRemote.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });
  it('a delete on one device beats an older edit on the other, and a newer edit beats an older delete', () => {
    const del = rec('a', '000000000000009:00000:p', { deleted: true });
    const edit = rec('a', '000000000000005:00000:l');
    expect(mergeRecords([del], [edit]).merged[0].deleted).toBe(true);
    const later = rec('a', '000000000000012:00000:l', { text: 'revived' });
    expect(mergeRecords([del], [later]).merged[0].deleted).toBeUndefined();
  });
  it('converges: both devices end identical regardless of merge order, and re-merging changes nothing', () => {
    const A = [rec('a', '000000000000005:00000:p'), rec('b', '000000000000001:00000:p')];
    const B = [rec('a', '000000000000003:00000:l'), rec('c', '000000000000002:00000:l', { deleted: true })];
    const ab = mergeRecords(A, B).merged, ba = mergeRecords(B, A).merged;
    expect(ab).toEqual(ba);
    const again = mergeRecords(ab, ba);
    expect(again.toLocal).toHaveLength(0);
    expect(again.toRemote).toHaveLength(0);
  });
  it('buckets by month and prunes only old tombstones', () => {
    expect(bucketOf({ date: '2026-11-14' })).toBe('m-2026-11');
    expect(bucketOf({})).toBe('core');
    const now = Date.now();
    const old = rec('x', `${String(now - 200 * 86400000).padStart(15, '0')}:00000:p`, { deleted: true });
    const fresh = rec('y', `${String(now - 86400000).padStart(15, '0')}:00000:p`, { deleted: true });
    expect(pruneTombstones([old, fresh, rec('z', old.updatedAt)], now).map((r) => r.id)).toEqual(['y', 'z']);
  });
});

describe('encryption', () => {
  const salt = randomBytes(16);
  it('round-trips, and the recovery key opens the same data', async () => {
    const { key, recoveryKey } = await deriveKey('correct horse battery', salt, 1000);
    const env = await encryptJSON(key, { journal: 'private ✓' }, 'm-2026-11');
    expect(JSON.stringify(env)).not.toContain('private');
    expect(await decryptJSON(key, env, 'm-2026-11')).toEqual({ journal: 'private ✓' });
    expect(await decryptJSON(await keyFromRecovery(recoveryKey), env, 'm-2026-11')).toEqual({ journal: 'private ✓' });
  });
  it('uses a fresh nonce for every write', async () => {
    const { key } = await deriveKey('p', salt, 1000);
    const a = await encryptJSON(key, { x: 1 }, 'f'), b = await encryptJSON(key, { x: 1 }, 'f');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
  it('rejects a wrong passphrase, tampered data, and a file swapped under another name', async () => {
    const { key } = await deriveKey('right', salt, 1000);
    const wrong = (await deriveKey('wrong', salt, 1000)).key;
    const env = await encryptJSON(key, { a: 1 }, 'core');
    await expect(decryptJSON(wrong, env, 'core')).rejects.toThrow();
    const bytes = atob(env.ct).split(''); bytes[3] = String.fromCharCode(bytes[3].charCodeAt(0) ^ 1);
    await expect(decryptJSON(key, { ...env, ct: btoa(bytes.join('')) }, 'core')).rejects.toThrow();
    await expect(decryptJSON(key, env, 'm-2026-11')).rejects.toThrow();
    const check = await makeKeyCheck(key);
    expect(await verifyKey(key, check)).toBe(true);
    expect(await verifyKey(wrong, check)).toBe(false);
  });
  it('the derived key cannot be exported', async () => {
    const { key } = await deriveKey('p', salt, 1000);
    expect(key.extractable).toBe(false);
  });
});

const habit = (o: Partial<Habit> = {}): Habit => ({ id: 'h', type: 'habit', updatedAt: '', name: 'Gym', cue: '', target: { kind: 'daily' }, restDays: [], createdOn: '2026-10-01', order: 0, ...o });
const logsFor = (days: string[]) => Object.fromEntries(days.map((d) => [d, 1]));
describe('habits', () => {
  const T = '2026-11-14';
  it('one missed day does not reset the streak; two in a row do', () => {
    const days = [0, 1, 2, 4, 5, 6].map((i) => addDays(T, -i)); // missed T-3
    expect(forgivingStreak(habit(), logsFor(days), T)).toBe(6);
    const two = [0, 1, 2, 5, 6].map((i) => addDays(T, -i)); // missed T-3 and T-4
    expect(forgivingStreak(habit(), logsFor(two), T)).toBe(3);
  });
  it('today not done yet is not a miss, and rest days are skipped', () => {
    expect(forgivingStreak(habit(), logsFor([addDays(T, -1), addDays(T, -2)]), T)).toBe(2);
    const h = habit({ restDays: [6] }); // Sunday off; T is Saturday, T-6 is Sunday
    expect(isDue(h, '2026-11-08')).toBe(false);
    expect(forgivingStreak(h, logsFor([0, 1, 2, 3, 4, 5, 7, 8].map((i) => addDays(T, -i))), T)).toBe(8);
  });
  it('weekly targets count weeks that met the target', () => {
    const h = habit({ target: { kind: 'weekly', perWeek: 3 } });
    const l = logsFor(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-02', '2026-11-04', '2026-11-06', '2026-10-27']);
    expect(forgivingStreak(h, l, T)).toBe(2);
    expect(consistency(h, l, T, 21)).toBeCloseTo(7 / 9);
  });
  it('count habits need the full count', () => {
    const h = habit({ target: { kind: 'count', count: 8 } });
    expect(forgivingStreak(h, { [T]: 8, [addDays(T, -1)]: 5, [addDays(T, -2)]: 8 }, T)).toBe(2);
  });
  it('consistency is done ÷ due and ignores an open today', () => {
    expect(consistency(habit(), logsFor([1, 2, 3].map((i) => addDays(T, -i))), T, 7)).toBeCloseTo(3 / 6);
    expect(consistency(habit({ createdOn: T }), {}, T)).toBeNull();
  });
});

const block = (o: Partial<Block>): Block => ({ id: Math.random().toString(36), type: 'block', updatedAt: '', date: '2026-11-10', start: 540, dur: 60, title: 'x', log: '', cat: '', done: false, ...o });
describe('day helpers', () => {
  it('adherence counts only planned blocks', () => {
    expect(adherence([block({ done: true }), block({}), block({ title: '', log: 'note' })])).toEqual({ value: 0.5, n: 2, done: 1 });
    expect(adherence([])).toBeNull();
    const by = adherenceByDay([block({ date: '2026-11-01', done: true }), block({ date: '2026-11-02' })]);
    expect(by.get('2026-11-01')!.value).toBe(1);
    expect(by.get('2026-11-02')!.done).toBe(0);
  });
  it('sleep arc maps 18:00..12:00 to 0..1 and back, across midnight', () => {
    expect(sleepPos(18 * 60)).toBe(0);
    expect(sleepPos(12 * 60)).toBe(1);
    expect(sleepPos(3 * 60)).toBeCloseTo(0.5);
    expect(sleepMin(0.5)).toBe(180);
    expect(sleepMin(sleepPos(23 * 60 + 35))).toBe(23 * 60 + 35);
    expect(sleepMin(sleepPos(6 * 60 + 50))).toBe(6 * 60 + 50);
    expect(sleepPos(13 * 60)).toBe(1); // just past the window: clamps to the wake end
    expect(sleepPos(17 * 60)).toBe(0); // just before it: clamps to the bed end
    expect(sleepDur({ bed: 23 * 60 + 30, wake: 7 * 60 })).toBe(450);
    expect(sleepDur({ bed: 60, wake: 8 * 60 })).toBe(420);
  });
  it('photo downscale keeps the aspect ratio and never enlarges', () => {
    expect(fitSize(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 });
    expect(fitSize(3000, 4000, 1280)).toEqual({ w: 960, h: 1280 });
    expect(fitSize(800, 600, 1280)).toEqual({ w: 800, h: 600 });
  });
});

describe('search', () => {
  const recs: Rec[] = [
    block({ id: 'b1', date: '2026-11-10', title: 'Deep work: RTL review', log: 'closed 3 comments' }),
    block({ id: 'b2', date: '2026-11-12', title: 'Gym', start: 1080 }),
    { id: 't1', type: 'todo', updatedAt: '', date: '2026-11-12', text: 'Review timing report', done: true },
    { id: 'm1', type: 'meal', updatedAt: '', date: '2026-11-11', time: 780, name: 'Dal rice', tag: 'Lunch' },
    { id: 'journal:2026-11-09', type: 'journal', updatedAt: '', date: '2026-11-09', intention: 'Finish the review calmly', text: 'private review notes', win: '', lesson: '', ifThen: '', tags: [], photos: [] },
    { id: 'gone', type: 'todo', updatedAt: '', date: '2026-11-12', deleted: true } as Rec,
  ];
  it('finds blocks, to-dos, meals and morning intentions, newest day first', () => {
    expect(searchRecs(recs, 'review').map((h) => h.id)).toEqual(['t1', 'b1', 'journal:2026-11-09']);
    expect(searchRecs(recs, 'dal')[0]).toMatchObject({ kind: 'meal', date: '2026-11-11' });
    expect(searchRecs(recs, 'lunch')).toHaveLength(1);
  });
  it('needs every word, ignores case, deleted records and removed journal fields', () => {
    expect(searchRecs(recs, 'RTL comments').map((h) => h.id)).toEqual(['b1']);
    expect(searchRecs(recs, 'rtl gym')).toHaveLength(0);
    expect(searchRecs(recs, 'private')).toHaveLength(0);
    expect(searchRecs(recs, '   ')).toHaveLength(0);
  });
});

describe('notification planner', () => {
  const now = new Date(2026, 10, 14, 14, 20), today = '2026-11-14';
  const todo = (o: Partial<Todo>): Todo => ({ id: 't', type: 'todo', updatedAt: '', date: today, text: 'Call bank', done: false, ...o });
  it('schedules future block and to-do reminders only', () => {
    const p = planNotifications({ now, today, habits: [], doneToday: {}, todos: [todo({ remindAt: 960 }), todo({ id: 't2', remindAt: 600 }), todo({ id: 't3', remindAt: 1000, done: true })],
      blocks: [block({ id: 'b', date: today, start: 900, remindLead: 10, title: 'Study' }), block({ id: 'b2', date: today, start: 900 })] });
    expect(p.map((n) => n.key)).toEqual(['block:b', 'todo:t']);
    expect(p[0].at).toEqual(new Date(2026, 10, 14, 14, 50));
  });
  it('habit reminders skip today when already done, skip rest days, and end with a top-up notice', () => {
    const h = habit({ remindTime: 18 * 60, restDays: [6] });
    const p = planNotifications({ now, today, habits: [h], doneToday: { h: 1 }, todos: [], blocks: [] });
    const habits = p.filter((n) => n.key.startsWith('habit:'));
    expect(habits[0].key).toBe('habit:h:2026-11-16'); // today done, tomorrow is Sunday (rest)
    expect(habits.length).toBe(HORIZON_DAYS - 1 - 5); // minus today, minus five Sundays
    expect(p[p.length - 1].key).toBe('topup');
    expect(new Set(p.map((n) => n.id)).size).toBe(p.length);
    const open = planNotifications({ now, today, habits: [h], doneToday: {}, todos: [], blocks: [] });
    expect(open[0].key).toBe('habit:h:2026-11-14');
  });
});

import { macroTotals as mT, mealGroups as mG, nowBlock as nB } from '../src/lib/day';
import { bestStreak as bS, forgivingStreak as fS, rate as hRate } from '../src/lib/habits';
import { DEFAULTS as SET } from '../src/store';
describe('v2.2 meals, Now card, streaks, settings', () => {
  it('a meal from before v2.2 has no plate groups lit, and partial data is read safely', () => {
    expect(mG({})).toEqual([false, false, false, false]);
    expect(mG({ groups: [true] })).toEqual([true, false, false, false]);
    expect(mG({ groups: [false, true, false, true, true] })).toEqual([false, true, false, true]);
  });
  it('macro totals add only meals that have macros', () => {
    expect(mT([{}, { macros: { protein: 20, carbs: 50, fat: 12 } }, { macros: { protein: 10, carbs: 25, fat: 5 } }])).toEqual({ protein: 30, carbs: 75, fat: 17, logged: 2 });
    expect(mT([{}, {}]).logged).toBe(0);
  });
  it('calories are hidden, the sky is on, and the place is Bengaluru unless the user changes it', () => {
    expect(SET.showCalories).toBe(false); expect(SET.sky).toBe(true); expect(SET.place.mode).toBe('default'); expect(SET.focusLen).toBe(25);
    expect(SET.macroTargets).toEqual({ protein: 90, carbs: 260, fat: 70 });
  });
  it('the Now card shows the running or next block, then the first unfinished one, then nothing', () => {
    const b = (start: number, done = false) => ({ start, dur: 60, done });
    const list = [b(360, true), b(540), b(660), b(900)];
    expect(nB(list, 570)).toBe(list[1]);   // running
    expect(nB(list, 620)).toBe(list[2]);   // next to start
    expect(nB(list, 1300)).toBe(list[1]);  // everything is in the past: the first one still open
    expect(nB([b(360, true)], 400)).toBeUndefined();
    expect(nB(list, null)).toBe(list[1]);
  });
  it('an unfinished today does not break the streak that ended yesterday', () => {
    const h = { id: 'h', type: 'habit', name: 'Gym', cue: '', target: { kind: 'daily' }, restDays: [], createdOn: '2026-11-01', order: 0, updatedAt: '' } as never;
    const logs = { '2026-11-12': 1, '2026-11-13': 1, '2026-11-14': 1 };
    expect(fS(h, logs, '2026-11-15')).toBe(3);
    expect(fS(h, { ...logs, '2026-11-15': 1 }, '2026-11-15')).toBe(4);
  });
  it('best streak is the longest run ever, and the 12-week rate is done over due', () => {
    const h = { id: 'h', type: 'habit', name: 'Gym', cue: '', target: { kind: 'daily' }, restDays: [], createdOn: '2026-11-01', order: 0, updatedAt: '' } as never;
    const logs: Record<string, number> = {};
    for (const d of [1, 2, 3, 4, 5, 9, 10]) logs[`2026-11-${String(d).padStart(2, '0')}`] = 1;
    expect(bS(h, logs, '2026-11-15')).toBe(5);
    expect(fS(h, logs, '2026-11-15')).toBe(0);
    expect(hRate(h, logs, '2026-11-14')).toBeCloseTo(7 / 13); // the 14th is still open, so it is not counted as a miss
  });
});
