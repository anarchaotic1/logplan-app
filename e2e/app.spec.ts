import { expect, test } from '@playwright/test';
import { isPhone, main, noDialog, pngBuffer, project, reduced, settle, shot, start, tab } from './helpers';

test('v1 data migrates, and every screen of v2.2 works', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await start(page);
  const m = main(page);

  // ---- Today ----
  await expect(m.getByRole('button', { name: /5\/9 blocks done/ })).toBeVisible();
  // The background is a still sky drawn in CSS: no canvas anywhere.
  await expect(page.locator('.sky-bg i')).toHaveCount(9);
  await expect(page.locator('canvas')).toHaveCount(0);
  const sky = m.getByRole('img', { name: /^5 of 9 blocks done, \d of \d stars lit in / });
  await expect(sky).toBeVisible();
  await expect(m.locator('.sky')).toContainText(/Sunset 17:5\d/);
  await expect(m.getByRole('button', { name: /^Moon: waxing, \d+ percent lit$/ })).toBeVisible();
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
  await expect(m.getByRole('button', { name: /6\/9 blocks done/ })).toBeVisible();
  await expect(page.locator('.toast-zone')).toContainText('Done: Study: recall practice');
  await shot(page, '02-completed-with-undo');
  // Undo restores it.
  await page.locator('.toast-zone').getByRole('button', { name: 'Undo' }).click();
  await expect(m.getByRole('button', { name: /5\/9 blocks done/ })).toBeVisible();

  // The Now card: the block that comes next, completed with one tap; the star count follows.
  const now = m.locator('.now');
  await expect(now).toHaveAccessibleName(/^(Now|Next|Overdue): /);
  const nowName = ((await now.getAttribute('aria-label')) || '').replace(/^\w+: /, '');
  await now.getByRole('button', { name: `Complete now: ${nowName}` }).click();
  await expect(m.getByRole('img', { name: /^6 of 9 blocks done, \d of \d stars lit in / })).toBeVisible();
  await noDialog(page);
  await page.locator('.toast-zone').getByRole('button', { name: 'Undo' }).click();
  await expect(m.getByRole('img', { name: /^5 of 9 blocks done/ })).toBeVisible();
  // Eclipse focus: a real timer over the block. Escape hides it (the bar stays), and focus goes back to the button.
  await now.getByRole('button', { name: /^Start a focus timer for / }).click();
  const ecl = page.getByRole('dialog', { name: /^Focus on / });
  await expect(ecl.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
  await expect(ecl.getByRole('img', { name: /The moon has covered 0 percent of the sun/ })).toBeVisible();
  await settle(page);
  await shot(page, '02b-eclipse-focus');
  await page.keyboard.press('Escape');
  await expect(ecl).toHaveCount(0);
  await expect(now.getByRole('button', { name: /^Show the focus timer for / })).toBeFocused();
  await m.getByRole('status').filter({ hasText: 'Focus ·' }).getByRole('button', { name: 'Show' }).click();
  await ecl.getByRole('button', { name: 'End focus' }).click();
  await expect(ecl).toHaveCount(0);
  await expect(m.getByRole('img', { name: /^5 of 9 blocks done/ })).toBeVisible();
  // A small surprise: seven taps on the moon.
  for (let i = 0; i < 7; i++) await m.getByRole('button', { name: /^Moon: / }).click();
  await expect(m.locator('.led')).toHaveText('HELLO');

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
  // Tapping a day raises its card; the day opens in full from there and is editable, with the same one-tap checks.
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  const card = m.getByRole('region', { name: 'Friday 13 November, summary' });
  await expect(card.getByRole('img', { name: /\d of 9 blocks done/ })).toBeVisible();
  if (!isPhone()) { await page.keyboard.press('ArrowRight'); await expect(m.getByRole('button', { name: /^Saturday 14 November, today\./ })).toBeFocused(); await page.keyboard.press('ArrowUp'); await expect(m.getByRole('button', { name: /^Saturday 7 November\./ })).toBeFocused(); }
  await settle(page);
  await shot(page, '07b-calendar-day-card');
  await card.getByRole('button', { name: 'Open this day' }).click();
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
  await expect(m).not.toContainText('kcal'); // calories are off unless asked for
  await m.getByRole('button', { name: /^Add (breakfast|lunch|dinner|snack|meal)$/ }).click();
  await m.getByLabel('What did you eat?').fill('Paneer wrap');
  await m.getByRole('group', { name: 'What was on the plate' }).getByRole('button', { name: /Protein$/ }).click();
  await m.getByRole('button', { name: 'Add meal' }).click();
  const row = m.getByRole('button', { name: /^Paneer wrap / });
  await expect(row).toHaveAccessibleName(/1 of 4 groups/);
  // The meal opens full screen: plate groups, optional macros, photos.
  await row.click();
  const meal = page.getByRole('dialog', { name: /^Paneer wrap, / });
  const plate = meal.getByRole('group', { name: 'What was on the plate' });
  await expect(plate.getByRole('button', { name: /Protein$/ })).toHaveAttribute('aria-pressed', 'true');
  await plate.getByRole('button', { name: /Veg$/ }).click();
  await expect(plate.getByRole('button', { name: /Veg$/ })).toHaveAttribute('aria-pressed', 'true');
  await meal.getByRole('button', { name: 'protein medium, 20 grams' }).click();
  await expect(meal.getByLabel('protein in grams')).toHaveValue('20');
  await meal.getByLabel('Choose photos for Paneer wrap').setInputFiles({ name: 'lunch.png', mimeType: 'image/png', buffer: await pngBuffer(page) });
  const thumb = meal.getByRole('button', { name: /Photo 1 of Paneer wrap/ });
  await expect(thumb.locator('img')).toBeVisible();
  await expect(meal.getByRole('img', { name: 'Photo of Paneer wrap' })).toBeVisible();
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
  await shot(page, '11b-meal-open');
  await thumb.click();
  const viewer = page.getByRole('dialog', { name: 'Photo of Paneer wrap' });
  await expect(viewer.getByRole('img')).toBeVisible();
  await settle(page);
  await shot(page, '12-photo-full-screen');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(meal).toBeVisible(); // Escape closed only the photo
  // Delete with undo.
  await thumb.click();
  await viewer.getByRole('button', { name: 'Delete photo' }).click();
  await expect(meal.getByRole('button', { name: /Photo 1/ })).toHaveCount(0);
  await page.locator('.toast-zone').getByRole('button', { name: 'Undo' }).click();
  await expect(meal.getByRole('button', { name: /Photo 1/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await noDialog(page);
  await expect(row).toBeFocused();
  await expect(row).toHaveAccessibleName(/2 of 4 groups ?, 1 photo/);
  // The header has two faces. Macros first, then the day as the sun's path with a dot per meal.
  await expect(m.getByRole('img', { name: 'protein: 20 of 90 grams' })).toBeVisible();
  await settle(page, 1300);
  await shot(page, '11-meals');
  await m.getByRole('button', { name: 'Flip to horizon view' }).click();
  await expect(m.getByRole('button', { name: 'Flip to macros' })).toBeVisible();
  await expect(m.getByRole('img', { name: /^Meals along the day: .*Paneer wrap at \d\d:\d\d/ })).toBeVisible();
  await expect(m.getByRole('region', { name: 'Meals along the day' })).toContainText(/Sunset 17:5\d/);
  await settle(page, 2400);
  await shot(page, '11c-meals-horizon');
  // With reduced motion nothing turns or orbits: the faces swap in place and the satellites sit still.
  const still = await m.evaluate((el) => ({ flip: getComputedStyle(el.querySelector('.flip-inner')!).transform, orbit: getComputedStyle(el.querySelector('.plate .orbit')!).animationName, star: parseFloat(getComputedStyle(document.querySelector('.sky-bg i.tw')!).animationDuration) }));
  if (reduced()) { expect(still.flip).toBe('none'); expect(still.orbit).toBe('none'); expect(still.star).toBeLessThan(0.001); }
  else { expect(still.flip).not.toBe('none'); expect(still.orbit).toBe('orbit'); }
  await m.getByRole('button', { name: 'Flip to macros' }).click();
  await expect(m.getByRole('button', { name: 'Flip to horizon view' })).toBeVisible();
  // Meals of another day.
  await m.getByRole('button', { name: 'Previous day' }).click();
  await expect(m.getByText('No meals logged for this day.')).toBeVisible();
  await m.getByRole('button', { name: 'Back to today' }).click();
  await expect(m.getByRole('button', { name: /^Dal rice / })).toBeVisible();

  // ---- Habits ----
  await tab(page, 'Habits');
  const orb = m.getByRole('group', { name: 'Habits today' });
  await expect(orb.getByRole('checkbox', { name: 'Completed today: Gym' })).toBeVisible();
  await settle(page, 1200);
  await shot(page, '13-habits');
  // Backfill a day of this week from the row.
  const gym = m.getByRole('region', { name: 'Gym' });
  const mon = gym.getByRole('checkbox', { name: 'MON' });
  const was = await mon.getAttribute('aria-checked');
  await mon.click();
  await expect(mon).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
  await mon.click();
  // The name opens the last 12 weeks.
  await gym.getByRole('button', { name: /^Gym history/ }).click();
  const info = page.getByRole('dialog', { name: 'Habit history' });
  await expect(info.getByRole('img', { name: /Done on \d+ of the last 84 days/ })).toBeVisible();
  await expect(info).toContainText('Best streak');
  await expect(info).toContainText('12-week rate');
  await settle(page);
  await shot(page, '13b-habit-history');
  await page.keyboard.press('Escape');
  await noDialog(page);
  await expect(gym.getByRole('button', { name: /^Gym history/ })).toBeFocused();
  await orb.getByRole('checkbox', { name: 'Completed today: Gym' }).click();
  await expect(orb.getByRole('checkbox', { name: 'Complete today: Gym' })).toBeVisible();

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
  await set.getByRole('button', { name: 'Full', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/rm/);
  // New in 2.2: the sky can be swapped for the plain ring, calories are off, focus length and place can be set.
  await expect(set.getByRole('switch', { name: 'Show calories' })).not.toBeChecked();
  await set.getByRole('switch', { name: 'Night sky on Today' }).uncheck();
  await expect(m.locator('.sky')).toHaveCount(0);
  await expect(m.locator('.ring-wrap')).toHaveCount(1);
  await set.getByRole('switch', { name: 'Night sky on Today' }).check();
  await expect(m.locator('.sky')).toHaveCount(1);
  await set.getByRole('button', { name: '45', exact: true }).click();
  await expect(set.getByRole('button', { name: '45', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await set.getByRole('button', { name: 'Manual' }).click();
  await set.getByLabel('Latitude').fill('52.52'); await set.getByLabel('Longitude').fill('13.4');
  await expect(m.locator('.sky')).toContainText(/Sunset 20:[34]\d/); // Berlin in November (16:15 there), shown in the device's time zone
  await set.getByRole('button', { name: 'Bengaluru' }).click();
  await expect(set).toContainText('Log/Plan 2.2.0');
  await set.getByRole('button', { name: 'Follow phone' }).click();
  await set.getByRole('switch', { name: 'Large text' }).check();
  await expect(page.locator('html')).toHaveClass(/lg/);
  await set.getByRole('switch', { name: 'Large text' }).uncheck();
  await expect(set.getByRole('switch', { name: /Haptics/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await noDialog(page);

  // A perfect day: finishing every block lights the whole constellation.
  for (let i = 0; i < 9 && !(await m.locator('.now.perfect').count()); i++) { await m.getByRole('button', { name: /^Complete now: / }).click(); await page.waitForTimeout(350); }
  await expect(m.getByRole('region', { name: 'Perfect day' })).toContainText('Constellation complete');
  await expect(m.getByRole('img', { name: /^9 of 9 blocks done, (\d) of \1 stars lit in / })).toBeVisible();
  await settle(page, 2600);
  await shot(page, '16-perfect-day');

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
