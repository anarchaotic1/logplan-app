import { expect, test } from '@playwright/test';
import { isPhone, main, noDialog, pngBuffer, project, reduced, settle, shot, start, tab } from './helpers';

test('v1 data migrates, and every screen of v2.1 works', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await start(page);
  const m = main(page);

  // ---- Today ----
  await expect(m.getByRole('button', { name: /14:20 5\/9 blocks done/ })).toBeVisible();
  // No GPU here: software WebGL can be slow enough that the app falls back to a still frame, which is the designed behaviour.
  await expect(page.locator('[data-nova]')).toHaveAttribute('data-nova', reduced() ? 'still' : /^(live|still)$/);
  await expect(page.locator('html')).toHaveClass(reduced() ? /rm/ : /^(?!.*rm)/);
  await settle(page, 1600);
  await shot(page, '01-today');

  // One-tap completion: exactly one tap on the visible check, and nothing opens.
  const blocks = m.getByRole('region', { name: 'Blocks' });
  const study = blocks.getByRole('checkbox', { name: 'Complete: Study: recall practice' }).first();
  await expect(study).toHaveAttribute('aria-checked', 'false');
  const box = (await study.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
  await study.click();
  await expect(blocks.getByRole('checkbox', { name: 'Completed: Study: recall practice' }).first()).toHaveAttribute('aria-checked', 'true');
  await noDialog(page);
  await expect(m.getByRole('button', { name: /14:20 6\/9 blocks done/ })).toBeVisible();
  await expect(page.locator('.toast-zone')).toContainText('Done: Study: recall practice');
  await shot(page, '02-completed-with-undo');
  // Undo restores it.
  await page.locator('.toast-zone').getByRole('button', { name: 'Undo' }).click();
  await expect(m.getByRole('button', { name: /14:20 5\/9 blocks done/ })).toBeVisible();

  // To-dos: one tap as well.
  const todos = m.getByRole('region', { name: 'To-dos' });
  await todos.getByRole('checkbox', { name: 'Complete: Book dentist' }).click();
  await expect(todos.getByRole('checkbox', { name: 'Completed: Book dentist' })).toBeVisible();
  await noDialog(page);

  // Swipe right to complete (touch gesture; the check is the alternative). Not offered with reduced motion.
  if (isPhone() && !reduced()) {
    const row = todos.getByRole('button', { name: 'Edit to-do Renew library card' });
    const r = (await row.boundingBox())!;
    await page.mouse.move(r.x + 20, r.y + r.height / 2); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(r.x + 20 + i * 22, r.y + r.height / 2); await page.waitForTimeout(30); }
    await page.mouse.up();
    await expect(todos.getByRole('checkbox', { name: 'Completed: Renew library card' })).toBeVisible();
    await noDialog(page);
  }
  // Keyboard on the laptop: X (or Space) on the focused row completes it; Enter opens it for editing.
  if (!isPhone()) {
    await blocks.getByRole('button', { name: /Edit block Gym/ }).focus();
    await page.keyboard.press('x');
    await expect(blocks.getByRole('checkbox', { name: 'Completed: Gym' })).toBeVisible();
    await page.keyboard.press(' ');
    await expect(blocks.getByRole('checkbox', { name: 'Complete: Gym' })).toBeVisible();
    await noDialog(page);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Block' })).toBeVisible();
    await page.keyboard.press('Escape');
    await noDialog(page);
  }

  // Morning intention saves as you type and survives leaving the day.
  await m.getByRole('textbox', { name: 'Morning intention' }).fill('Ship the review calmly');
  await page.waitForTimeout(800);
  // Past days: one step with the arrow (or a swipe on the date).
  await m.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday 13 November');
  await expect(m.getByRole('textbox', { name: 'Morning intention' })).toHaveValue('');
  await settle(page);
  await shot(page, '03-yesterday');
  await m.getByRole('button', { name: 'Back to today' }).click();
  await expect(m.getByRole('textbox', { name: 'Morning intention' })).toHaveValue('Ship the review calmly');

  // Sleep: log, then adjust with the typed field and with the keyboard slider.
  await m.getByRole('button', { name: 'Log sleep' }).click();
  const sleep = m.getByRole('region', { name: 'Sleep' });
  await expect(sleep).toContainText('8h');
  await sleep.getByLabel('Bedtime').last().fill('23:30');
  await expect(sleep).toContainText('7h 30m');
  await sleep.getByRole('slider', { name: 'Wake time' }).focus();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await expect(sleep).toContainText('7h 20m');
  await expect(sleep.getByLabel('Woke up')).toHaveValue('06:50');
  await expect(page.locator('.sr[role=status]')).toContainText('Sleep saved: 7h 20m');
  await sleep.scrollIntoViewIfNeeded(); await settle(page);
  await shot(page, '04-sleep-and-habits');
  // Habit for today from the Today page.
  await m.getByRole('checkbox', { name: /^Gym ?, not done/ }).click();
  await expect(m.getByRole('checkbox', { name: /^Gym ?, done/ })).toBeVisible();

  // Hour view: every block has its own check there too.
  await m.evaluate((el) => el.scrollTo({ top: 0 }));
  await m.getByRole('button', { name: /blocks done\. Opens/ }).click();
  await expect(page.getByRole('heading', { name: 'Hour view' })).toBeVisible();
  await settle(page);
  await shot(page, '05-hour-view');
  await m.getByRole('checkbox', { name: 'Complete: Read' }).click();
  await expect(m.getByRole('checkbox', { name: 'Completed: Read' })).toBeVisible();
  await noDialog(page);
  await m.getByRole('button', { name: 'Back to the day overview' }).click();

  // Block sheet for editing.
  await blocks.getByRole('button', { name: /Edit block Gym/ }).click();
  await expect(page.getByRole('dialog', { name: 'Block' })).toBeVisible();
  await settle(page);
  await shot(page, '06-block-sheet');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // ---- Calendar ----
  await tab(page, 'Calendar');
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
  const cell = m.getByRole('button', { name: /^Friday 13 November\./ });
  await expect(cell).toHaveAccessibleName(/\d of 9 blocks done/);
  await expect(m.getByRole('button', { name: /^Saturday 14 November, today\..*meals logged, sleep logged/ })).toBeVisible();
  await expect(m.getByRole('button', { name: /^Thursday 19 November\..*countdown: IELTS exam/ })).toBeVisible();
  await settle(page, 1300);
  await shot(page, '07-calendar');
  // A past day opens in full and is editable there, with the same one-tap checks.
  await cell.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday 13 November');
  await settle(page);
  await shot(page, '08-calendar-day');
  const past = m.getByRole('region', { name: 'To-dos' });
  await past.getByRole('checkbox', { name: 'Complete: Email professor' }).click();
  await expect(past.getByRole('checkbox', { name: 'Completed: Email professor' })).toBeVisible();
  await m.getByRole('button', { name: 'Back to the month' }).click();
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
  // Search across all days, then jump to the day.
  await m.getByRole('searchbox', { name: 'Search all days' }).fill('dal rice');
  await expect(m.getByRole('region', { name: 'Search results' })).toContainText('Meal');
  await m.getByRole('searchbox').fill('rtl review');
  await expect(m.getByRole('status')).toContainText('60+ results');
  await settle(page);
  await shot(page, '09-search');
  await m.getByRole('region', { name: 'Search results' }).getByRole('button').nth(6).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/ (November|October)$/);
  await m.getByRole('button', { name: 'Back to the month' }).click();
  // Month navigation.
  await m.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await m.getByRole('button', { name: 'This month' }).click();
  // Setup lives here.
  await m.getByRole('button', { name: 'Setup' }).click();
  await expect(m.getByRole('button', { name: /Edit countdown IELTS exam/ })).toBeVisible();
  await m.getByRole('textbox', { name: /Name for a template/ }).fill('Standard day');
  await m.getByRole('region', { name: 'Day templates' }).getByRole('button', { name: 'Save' }).click();
  await expect(m.getByText(/Standard day/).first()).toBeVisible();
  await m.getByRole('textbox', { name: 'New category' }).fill('Errands');
  await m.getByRole('region', { name: 'Day and categories' }).getByRole('button', { name: 'Add' }).click();
  await expect(m.getByRole('button', { name: 'Remove category Errands' })).toBeVisible();
  await settle(page);
  await shot(page, '10-setup');
  await m.getByRole('button', { name: 'Month', exact: true }).click();

  // ---- Meals, with a photo ----
  await tab(page, 'Meals');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Meals');
  await m.getByLabel('What did you eat?').fill('Paneer wrap');
  await m.getByRole('button', { name: 'Add meal' }).click();
  const meal = m.getByRole('region', { name: /^Paneer wrap/ });
  await expect(meal).toBeVisible();
  await meal.getByLabel('Choose photos for Paneer wrap').setInputFiles({ name: 'lunch.png', mimeType: 'image/png', buffer: await pngBuffer(page) });
  const thumb = meal.getByRole('button', { name: /Photo 1 of Paneer wrap/ });
  await expect(thumb.locator('img')).toBeVisible();
  // Stored downscaled (1600x1200 in, at most 1280 on the long side) with a thumbnail.
  const stored = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => { const r = indexedDB.open('logplan-v2'); r.onsuccess = () => res(r.result); });
    const all: any[] = await new Promise((res) => { const r = db.transaction('photos').objectStore('photos').getAll(); r.onsuccess = () => res(r.result); });
    const bmp = await createImageBitmap(new Blob([all[0].buf], { type: 'image/jpeg' })), t = await createImageBitmap(new Blob([all[0].thumb], { type: 'image/jpeg' }));
    return { n: all.length, w: bmp.width, h: bmp.height, tw: t.width, bytes: all[0].buf.byteLength };
  });
  expect(stored).toMatchObject({ n: 1, w: 1280, h: 960, tw: 320 });
  expect(stored.bytes).toBeLessThan(400000);
  await settle(page);
  await shot(page, '11-meals');
  await thumb.click();
  const viewer = page.getByRole('dialog', { name: 'Photo of Paneer wrap' });
  await expect(viewer.getByRole('img')).toBeVisible();
  await settle(page);
  await shot(page, '12-photo-full-screen');
  await page.keyboard.press('Escape');
  await noDialog(page);
  // Delete with undo.
  await thumb.click();
  await viewer.getByRole('button', { name: 'Delete photo' }).click();
  await expect(meal.getByRole('button', { name: /Photo 1/ })).toHaveCount(0);
  await page.locator('.toast-zone').getByRole('button', { name: 'Undo' }).click();
  await expect(meal.getByRole('button', { name: /Photo 1/ })).toBeVisible();
  // Meals of another day.
  await m.getByRole('button', { name: 'Previous day' }).click();
  await expect(m.getByText('No meals logged for this day.')).toBeVisible();
  await m.getByRole('button', { name: 'Back to today' }).click();
  await expect(m.getByRole('region', { name: /^Dal rice/ })).toBeVisible();

  // ---- Habits ----
  await tab(page, 'Habits');
  const gym = m.getByRole('region', { name: 'Gym' });
  await expect(gym.getByRole('checkbox', { name: 'Completed today: Gym' })).toBeVisible();
  await gym.getByRole('button', { name: /^Gym details/ }).click();
  await expect(gym.getByRole('img', { name: /last 53 weeks: done on \d+ days/ })).toBeVisible();
  await expect(gym).toContainText('done, last 4 weeks');
  await settle(page);
  await shot(page, '13-habits');
  await gym.getByRole('checkbox', { name: 'Completed today: Gym' }).click();
  await expect(gym.getByRole('checkbox', { name: 'Complete today: Gym' })).toBeVisible();

  // ---- Quick capture ----
  await tab(page, 'Today');
  await page.getByRole('button', { name: 'Quick capture' }).click();
  const cap = page.getByRole('dialog', { name: 'Quick capture' });
  await cap.getByLabel('New to-do').fill('Captured in two taps');
  await settle(page);
  await shot(page, '14-quick-capture');
  await cap.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(m.getByRole('button', { name: 'Edit to-do Captured in two taps' })).toBeVisible();
  await page.getByRole('button', { name: 'Quick capture' }).click();
  await cap.getByRole('button', { name: 'Meal' }).click();
  await cap.getByRole('button', { name: 'Dal rice' }).click();
  await expect(page.locator('.toast-zone')).toContainText('Meal added to today');

  // ---- Settings ----
  await m.getByRole('button', { name: 'Settings' }).click();
  const set = page.getByRole('dialog', { name: 'Settings' });
  await expect(set.getByTestId('migration')).toContainText('Moved from v1');
  await expect(set.getByTestId('storage')).toContainText('1 photo');
  await expect(set).not.toContainText('Evidence');
  await settle(page);
  await shot(page, '15-settings');
  // The in-app motion setting overrides the system.
  await set.getByRole('button', { name: 'Reduced' }).click();
  await expect(page.locator('html')).toHaveClass(/rm/);
  await expect(page.locator('[data-nova]')).toHaveAttribute('data-nova', 'still');
  await set.getByRole('button', { name: 'Full', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/rm/);
  await expect(page.locator('[data-nova]')).toHaveAttribute('data-nova', /^(live|still)$/) // it tries live again; without a GPU it may fall back straight away;
  await set.getByRole('button', { name: 'Follow phone' }).click();
  await set.getByRole('switch', { name: 'Large text' }).check();
  await expect(page.locator('html')).toHaveClass(/lg/);
  await set.getByRole('switch', { name: 'Large text' }).uncheck();
  await expect(set.getByRole('switch', { name: /Haptics/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await noDialog(page);

  // Removed screens are gone; their tabs are not offered.
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('button')).toHaveCount(project() === 'laptop' ? 5 : 4);
  for (const gone of ['Journal', 'Insights', 'Plan']) await expect(nav.getByRole('button', { name: gone })).toHaveCount(0);
  await expect(page.getByText('Why this works')).toHaveCount(0);

  // The v1 database is still there, untouched; the token was not copied.
  const v1 = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => { const r = indexedDB.open('logplan-db'); r.onsuccess = () => res(r.result); });
    const keys: string[] = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => res(r.result as string[]); });
    const v2: IDBDatabase = await new Promise((res) => { const r = indexedDB.open('logplan-v2'); r.onsuccess = () => res(r.result); });
    const backup: any = await new Promise((res) => { const r = v2.transaction('kv').objectStore('kv').get('v1-backup'); r.onsuccess = () => res(r.result); });
    return { keys: keys.length, tokenInBackup: JSON.stringify(backup).includes('ghp_') };
  });
  expect(v1.keys).toBe(17);
  expect(v1.tokenInBackup).toBe(false);
  expect(errors).toEqual([]);
});
