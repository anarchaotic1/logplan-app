/** Builds a realistic v1 database, using the exact shapes v1 wrote (see legacy/v1/index.html). */
import { addDays, mondayOf } from '../src/lib/dates';

export function emptyDayV1() {
  const hours: Record<string, { plan: string; log: string; done: boolean; remind?: { lead: number } | null }> = {};
  for (let h = 5; h <= 24; h++) hours[h] = { plan: '', log: '', done: false };
  return { priorities: [] as any[], hours, meals: [] as any[] };
}
export function makeV1Dump(): Record<string, string> {
  const dump: Record<string, string> = {};
  const mondays = ['2026-10-26', '2026-11-02', '2026-11-09'];
  mondays.forEach((mon, wi) => {
    const days: Record<string, ReturnType<typeof emptyDayV1>> = {};
    for (let i = 0; i < 7; i++) {
      const iso = addDays(mon, i);
      const d = emptyDayV1();
      d.hours[9] = { plan: `Deep work ${wi}-${i}`, log: 'Did 80%', done: i % 2 === 0 };
      d.hours[18] = { plan: 'Gym', log: '', done: true, remind: { lead: 10 } };
      d.hours[21] = { plan: '', log: 'Read a paper', done: false };
      if (i === 6) d.hours[24] = { plan: 'Lights out', log: '', done: true };
      d.priorities = [
        { id: `p${wi}${i}a`, text: 'Send report', done: true, time: '10:30' },
        { id: `p${wi}${i}b`, text: 'Call bank', done: false, time: null, remind: { time: '16:00' } },
        { id: `p${wi}${i}c`, text: '   ', done: false },
      ];
      d.meals = [{ id: `${wi}${i}-ab12`, time: '13:15', name: 'Dal rice', tag: 'Lunch' }];
      days[iso] = d;
    }
    dump[`app-week:${mon}`] = JSON.stringify({ days, reflection: wi === 1 ? { good: 'Morning blocks', drop: 'Late scrolling' } : { good: '', drop: '' } });
  });
  // An old-format week from before "priorities" existed.
  const old = emptyDayV1() as any; delete old.priorities; old.top3 = ['Ship v1', '', 'Rest'];
  dump['app-week:2026-10-19'] = JSON.stringify({ days: { '2026-10-19': old } });
  dump['app-week:broken'] = '{not json';
  const log: Record<string, Record<string, boolean>> = {};
  for (let i = 0; i < 20; i++) log[addDays('2026-10-26', i)] = { gym: i % 3 !== 0, bball: i % 7 === 5, deleted1: true };
  log['2026-11-01'].gym = false;
  dump['app-habits'] = JSON.stringify({ habits: [{ id: 'gym', name: 'Gym', reminder: { enabled: true, time: '07:00' } }, { id: 'bball', name: 'Basketball', reminder: { enabled: false, time: '18:00' } }], log });
  dump['app-countdowns'] = JSON.stringify([{ id: 'c1', label: 'IELTS exam', date: '2027-01-15' }, { id: 'c2', label: '', date: '2027-01-01' }]);
  dump['app-meal-catalog'] = JSON.stringify([{ id: 'm1', name: 'Dal rice', tag: 'Lunch' }]);
  dump['app-theme-pref'] = 'dark';
  dump['app-remind-lead'] = '15';
  dump['app-gh-token'] = 'ghp_SECRET_SHOULD_NOT_BE_COPIED';
  dump['app-gh-gist'] = 'abc123';
  return dump;
}
export function writeV1(dump: Record<string, string>): Promise<void> {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('logplan-db', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => {
      const tx = rq.result.transaction('kv', 'readwrite');
      for (const [k, v] of Object.entries(dump)) tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => { rq.result.close(); res(); };
    };
  });
}
export { mondayOf };
