import { expect, test, type Page } from '@playwright/test';
import { main, tab } from './helpers';
import { NOW } from './seed';
import { V2_RECORDS } from '../tests/v2-fixture';

/** Installing v2.2 over v2.0 or v2.1 (the amber build): the same database is opened by the new code. Nothing may be lost or altered,
 *  including journal pages, weekly reviews and study topics, which no longer have a screen. */
const readAll = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((res) => { const r = indexedDB.open('logplan-v2'); r.onsuccess = () => res(r.result); });
  const recs: any[] = await new Promise((res) => { const r = db.transaction('rec').objectStore('rec').getAll(); r.onsuccess = () => res(r.result); });
  db.close();
  return recs.sort((a, b) => (a.id < b.id ? -1 : 1));
});
const sorted = <T extends { id: string }>(r: T[]) => [...r].sort((a, b) => (a.id < b.id ? -1 : 1));

test('a v2.0 or v2.1 database opens in v2.2 with every record intact, and edits touch only what was edited', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'checked once');
  await page.clock.setFixedTime(NOW);
  await page.goto('/'); // creates the empty database with the real schema
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good afternoon');
  await page.evaluate(async (recs) => {
    const db: IDBDatabase = await new Promise((res) => { const r = indexedDB.open('logplan-v2'); r.onsuccess = () => res(r.result); });
    await new Promise<void>((res) => { const tx = db.transaction(['rec', 'kv', 'photos'], 'readwrite'); for (const r of recs) tx.objectStore('rec').put(r);
      tx.objectStore('kv').put({ key: 'settings', value: { name: 'Hari', startHour: 0, lock: false, remindLead: 15, sleepTarget: 450, motion: 'full', haptics: false, largeText: false, cats: ['Deep work', 'Admin'] } }); // v2.1 settings: none of the 2.2 ones yet
      tx.objectStore('kv').put({ key: 'focus', value: null }); tx.objectStore('kv').put({ key: 'carryHandled', value: '2026-11-14' });
      tx.objectStore('photos').put({ id: 'pj', createdAt: 1, blob: new Blob(['x'], { type: 'image/jpeg' }) });
      tx.oncomplete = () => { db.close(); res(); }; });
  }, V2_RECORDS as any[]);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Good afternoon, Hari');
  const m = main(page);
  // Walk through the app the way a first launch after the update would.
  await m.getByRole('button', { name: 'Previous day' }).click();
  await expect(m.getByRole('textbox', { name: 'Morning intention' })).toHaveValue('One calm block');
  await expect(m.getByRole('checkbox', { name: 'Completed: RTL review' })).toBeVisible();
  await expect(m.getByRole('region', { name: 'Sleep' })).toContainText('7h 25m');
  for (const t of ['Calendar', 'Meals', 'Habits', 'Today']) { await tab(page, t); await page.waitForTimeout(400); }
  await m.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('storage')).toContainText(`${V2_RECORDS.length} records · 1 photo`);
  await page.keyboard.press('Escape');
  expect(await readAll(page)).toEqual(sorted(V2_RECORDS));

  // Editing the morning intention keeps the rest of that journal page (free text, mood, tags, photos).
  // (The app is still on 13 November: changing tabs keeps the day being looked at.)
  await expect(m.getByRole('textbox', { name: 'Morning intention' })).toHaveValue('One calm block');
  await m.getByRole('textbox', { name: 'Morning intention' }).fill('One calm block, then gym');
  await m.getByRole('checkbox', { name: /^Gym ?, done/ }).click(); // un-tick: the stored habit log changes, nothing else
  await page.waitForTimeout(900);
  const after = await readAll(page);
  const before = sorted(V2_RECORDS) as any[];
  const j = after.find((r) => r.id === 'journal:2026-11-13');
  expect(j).toMatchObject({ intention: 'One calm block, then gym', text: 'Free writing', win: 'Shipped', lesson: 'Start earlier', ifThen: 'If tired, then walk', mood: 4, energy: 3, tags: ['work'], photos: ['pj'] });
  const changed = after.filter((r) => JSON.stringify(r) !== JSON.stringify(before.find((b) => b.id === r.id))).map((r) => r.id).sort();
  expect(changed).toEqual(['hl:h1:2026-11-13', 'journal:2026-11-13']);
  // A meal logged before 2.2 has no plate groups or macros: it shows as such, and marking a group changes only that meal.
  await tab(page, 'Meals');
  await expect(m).not.toContainText('kcal');
  const row = m.getByRole('button', { name: /^Dal rice Lunch 13:05 0 of 4 groups/ });
  await row.click();
  await page.getByRole('dialog').getByRole('group', { name: 'What was on the plate' }).getByRole('button', { name: /Carbs$/ }).click();
  await page.keyboard.press('Escape');
  await expect(m.getByRole('button', { name: /^Dal rice Lunch 13:05 1 of 4 groups/ })).toBeVisible();
  const after2 = await readAll(page);
  const changed2 = after2.filter((r) => JSON.stringify(r) !== JSON.stringify(before.find((b) => b.id === r.id))).map((r) => r.id).sort();
  expect(changed2).toEqual(['hl:h1:2026-11-13', 'journal:2026-11-13', 'm1']);
  const { updatedAt: _u, groups, ...restMeal } = after2.find((r) => r.id === 'm1'); void _u;
  const { updatedAt: _v, ...oldMeal } = before.find((r) => r.id === 'm1'); void _v;
  expect(groups).toEqual([false, false, true, false]);
  expect(restMeal).toEqual(oldMeal);
  expect(after2).toHaveLength(V2_RECORDS.length); // nothing added, nothing removed (hidden journal, review and study records included)
  // Old settings were kept and the new ones got their defaults: the sky is on, calories are off.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Good afternoon, Hari');
  await expect(main(page).locator('.sky')).toHaveCount(1);
  const st = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => { const r = indexedDB.open('logplan-v2'); r.onsuccess = () => res(r.result); });
    const v: any = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get('settings'); r.onsuccess = () => res(r.result); }); db.close(); return v.value;
  });
  expect(st).toMatchObject({ name: 'Hari', remindLead: 15, sleepTarget: 450, motion: 'full', haptics: false, cats: ['Deep work', 'Admin'] });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog').getByRole('switch', { name: 'Night sky on Today' })).toBeChecked();
  await expect(page.getByRole('dialog').getByRole('switch', { name: 'Show calories' })).not.toBeChecked();
  await expect(page.getByRole('dialog').getByRole('switch', { name: /Haptics/ })).not.toBeChecked();
});
