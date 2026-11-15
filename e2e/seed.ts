import type { Page } from '@playwright/test';
/** Writes a realistic v1 database (the exact shapes v1 stored) into the browser before the app starts,
 *  so every end-to-end run also exercises the real v1 → v2 migration. "Now" is fixed at Sat 14 Nov 2026, 14:20. */
export const NOW = new Date(2026, 10, 14, 14, 20);
export async function seedV1(page: Page, fixedClock = true) {
  if (fixedClock) await page.clock.setFixedTime(NOW); // only the date is fixed; timers and animation frames run in real time
  await page.goto('/icon.svg'); // same origin, app not running yet
  await page.evaluate(() => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const add = (s: string, n: number) => { const [y, m, d] = s.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
    const empty = () => { const hours: any = {}; for (let h = 5; h <= 24; h++) hours[h] = { plan: '', log: '', done: false }; return { priorities: [] as any[], hours, meals: [] as any[] }; };
    const dump: Record<string, string> = {};
    const plans: [number, string][] = [[7, 'Morning run'], [9, 'Deep work: RTL review'], [10, 'Deep work: RTL review'], [11, 'Standup + mail'], [13, 'Lunch walk'], [15, 'Study: recall practice'], [16, 'Study: recall practice'], [18, 'Gym'], [21, 'Read']];
    for (let w = 11; w >= 0; w--) {
      const mon = add('2026-11-09', -7 * w);
      const days: any = {};
      for (let i = 0; i < 7; i++) {
        const d = add(mon, i), day = empty();
        const past = d < '2026-11-14', today = d === '2026-11-14';
        if (d <= '2026-11-15') plans.forEach(([h, plan], k) => {
          const done = past ? (k * 7 + i * 3 + w) % 10 < (h < 12 ? 9 : 6) : today ? h < 14 : false;
          day.hours[h] = { plan, log: done && h === 9 ? 'Closed 3 review comments' : '', done };
        });
        if (today) { day.priorities = [{ id: 'p1', text: 'Send timing report', done: true, time: '10:30' }, { id: 'p2', text: 'Book dentist', done: false, time: null }, { id: 'p3', text: 'Renew library card', done: false, time: null, remind: { time: '17:00' } }]; day.meals = [{ id: 'm-1', time: '08:10', name: 'Oats and egg', tag: 'Breakfast' }, { id: 'm-2', time: '13:05', name: 'Dal rice', tag: 'Lunch' }]; }
        if (d === '2026-11-13') day.priorities = [{ id: 'y1', text: 'Email professor', done: false }, { id: 'y2', text: 'Pay electricity bill', done: true }];
        days[d] = day;
      }
      dump[`app-week:${mon}`] = JSON.stringify({ days, reflection: w === 1 ? { good: 'Morning deep-work blocks', drop: 'Phone after 11pm' } : { good: '', drop: '' } });
    }
    const log: any = {};
    for (let i = 0; i < 70; i++) { const d = add('2026-11-14', -i); log[d] = { gym: i % 7 !== 3 && i % 11 !== 5 && i !== 0, read: i % 3 !== 1, lights: i % 6 !== 4 && i !== 0 }; }
    dump['app-habits'] = JSON.stringify({ habits: [{ id: 'gym', name: 'Gym', reminder: { enabled: true, time: '17:45' } }, { id: 'read', name: 'Read' }, { id: 'lights', name: 'Lights out' }], log });
    dump['app-countdowns'] = JSON.stringify([{ id: 'c1', label: 'IELTS exam', date: '2026-11-19' }, { id: 'c2', label: 'Application deadline', date: '2027-01-15' }]);
    dump['app-meal-catalog'] = JSON.stringify([{ id: 'mc1', name: 'Dal rice', tag: 'Lunch' }]);
    dump['app-remind-lead'] = '15';
    dump['app-gh-token'] = 'ghp_FAKE_TOKEN_FOR_TEST';
    return new Promise<void>((res) => {
      const rq = indexedDB.open('logplan-db', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); for (const k in dump) tx.objectStore('kv').put(dump[k], k); tx.oncomplete = () => { rq.result.close(); res(); }; };
    });
  });
}
