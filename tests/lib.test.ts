import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, daysBetween, dow, firstISOMonday, fmtDur, fmtMin, isoWeek, logicalDay, mondayOf, monthGrid, parseHM, snap15, weeksInISOYear } from '../src/lib/dates';
import { observe, resetHlcForTests, setNode, tick } from '../src/lib/hlc';
import { bucketOf, mergeRecords, pruneTombstones } from '../src/lib/merge';
import { decryptJSON, deriveKey, encryptJSON, keyFromRecovery, makeKeyCheck, randomBytes, verifyKey } from '../src/lib/crypto';
import { automaticityCurve, consistency, forgivingStreak, isDue } from '../src/lib/habits';
import { LADDER, nextInterval, review } from '../src/lib/spaced';
import { adherence, bestHours, habitLift, overrunFactor, sleepRegularity, adherenceByDay } from '../src/lib/insights';
import { planNotifications, HORIZON_DAYS } from '../src/lib/notif';
import type { Block, Habit, Rec, Sleep, Todo } from '../src/lib/model';

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
  it('the modelled curve reaches about 95% after 66 repetitions and dips slightly on a miss', () => {
    const start = addDays(T, -65);
    const all = Array.from({ length: 66 }, (_, i) => addDays(start, i));
    const c = automaticityCurve(habit({ createdOn: start }), logsFor(all), T);
    expect(c).toHaveLength(66);
    expect(c[65]).toBeCloseTo(0.95, 2);
    const c2 = automaticityCurve(habit({ createdOn: start }), logsFor(all.filter((_, i) => i !== 30)), T);
    expect(c2[30]).toBeLessThan(c2[29]);
    expect(c2[29] - c2[30]).toBeLessThan(0.01);
  });
});

describe('spaced review', () => {
  it('expands on success and resets on failure', () => {
    expect(nextInterval(0, true)).toBe(1);
    expect(nextInterval(1, true)).toBe(3);
    expect(nextInterval(30, true)).toBe(60);
    expect(nextInterval(120, true)).toBe(LADDER[LADDER.length - 1]);
    expect(nextInterval(60, false)).toBe(1);
    const r = review({ interval: 3, reviews: [] }, true, '2026-11-14');
    expect(r).toMatchObject({ interval: 7, due: '2026-11-21' });
    expect(r.reviews).toHaveLength(1);
  });
});

const block = (o: Partial<Block>): Block => ({ id: Math.random().toString(36), type: 'block', updatedAt: '', date: '2026-11-10', start: 540, dur: 60, title: 'x', log: '', cat: '', done: false, ...o });
describe('insights', () => {
  it('adherence counts only planned blocks', () => {
    expect(adherence([block({ done: true }), block({}), block({ title: '', log: 'note' })])).toEqual({ value: 0.5, n: 2 });
    expect(adherence([])).toBeNull();
  });
  it('best hours need a minimum sample', () => {
    const bs = [...Array(5).fill(0).map(() => block({ start: 540, done: true })), ...Array(5).fill(0).map((_, i) => block({ start: 900, done: i < 2 })), block({ start: 1200, done: true })];
    expect(bestHours(bs)).toEqual([{ hour: 9, rate: 1, n: 5 }, { hour: 15, rate: 0.4, n: 5 }]);
  });
  it('overrun factor is the median ratio and needs 5 samples', () => {
    expect(overrunFactor([block({ done: true, actualDur: 90 })])).toBeNull();
    const bs = [60, 75, 90, 90, 120].map((a) => block({ done: true, actualDur: a }));
    expect(overrunFactor(bs)).toEqual({ value: 1.5, n: 5 });
  });
  it('habit lift compares days with and without the habit', () => {
    const days = Array.from({ length: 14 }, (_, i) => addDays('2026-11-01', i));
    const bs = days.flatMap((d, i) => [block({ date: d, done: i < 7 }), block({ date: d, done: true })]);
    const lift = habitLift([habit()], { h: new Set(days.slice(0, 7)) }, adherenceByDay(bs));
    expect(lift[0]).toMatchObject({ withN: 7, withoutN: 7 });
    expect(lift[0].lift).toBeCloseTo(0.5);
    expect(habitLift([habit()], { h: new Set(days.slice(0, 3)) }, adherenceByDay(bs))).toHaveLength(0);
  });
  it('sleep regularity handles bedtimes either side of midnight', () => {
    const s = (bed: number, wake: number, i: number): Sleep => ({ id: `s${i}`, type: 'sleep', updatedAt: '', date: addDays('2026-11-01', i), bed, wake });
    const r = sleepRegularity([1430, 10, 1430, 10, 1430, 10, 1430, 10].map((b, i) => s(b, 420, i)))!;
    expect(r.n).toBe(8);
    expect(r.value.bedSd).toBeCloseTo(10);
    expect(r.value.wakeSd).toBe(0);
    expect(r.value.avgDur).toBeCloseTo(420);
    expect(sleepRegularity([s(1380, 420, 0)])).toBeNull();
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
