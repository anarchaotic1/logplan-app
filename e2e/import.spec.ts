import { expect, test } from '@playwright/test';

/** The real upgrade path when v2 cannot be installed over v1: export a backup in v1, import it in v2. */
test('imports a v1 backup file through Settings', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'checked once');
  const hours: Record<string, object> = {};
  for (let h = 5; h <= 24; h++) hours[h] = { plan: h === 9 ? 'Deep work' : '', log: '', done: h === 9 };
  const backup = { app: 'logplan', version: 4, exportedAt: '2026-11-13T18:00:00.000Z', records: 2, data: {
    'app-week:2026-11-09': JSON.stringify({ days: { '2026-11-14': { priorities: [{ id: 'p1', text: 'Imported to-do', done: false }], hours, meals: [] } }, reflection: { good: '', drop: '' } }),
    'app-habits': JSON.stringify({ habits: [{ id: 'gym', name: 'Gym' }], log: { '2026-11-13': { gym: true } } }),
    'app-gh-token': 'ghp_SHOULD_NOT_BE_KEPT',
  } };
  await page.clock.setFixedTime(new Date(2026, 10, 14, 14, 20));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'logplan-backup-2026-11-13.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  // The app asks in the page (no browser dialog), and imports only after "Import" is pressed.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.toast-zone')).toContainText('Imported 4 items from v1');
  await expect(page.getByTestId('migration')).toContainText('1 blocks');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#main').getByRole('button', { name: /1\/1 blocks done/ })).toBeVisible();
  await expect(page.locator('#main').getByRole('button', { name: 'Edit to-do Imported to-do' })).toBeVisible();
  // The old token never enters v2.
  const kept = await page.evaluate(async () => { const db: IDBDatabase = await new Promise((res) => { const r = indexedDB.open('logplan-v2'); r.onsuccess = () => res(r.result); });
    const all: any[] = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => res(r.result); }); return JSON.stringify(all); });
  expect(kept).not.toContain('ghp_');
});
