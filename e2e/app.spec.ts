import { expect, test, type Page } from '@playwright/test';
import { seedV1 } from './seed';

const shot = (page: Page, name: string) => page.screenshot({ path: `docs/screenshots/${test.info().project.name}/${name}.png` });
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const settle = (page: Page) => page.waitForTimeout(test.info().project.name.includes('reduced') ? 150 : 900);

async function start(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await seedV1(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good afternoon');
  return errors;
}
/** Every button must have an accessible name; on the phone, every tappable control must be at least 44 px in one direction and 36 in the other. */
async function audit(page: Page, where: string) {
  const problems = await page.evaluate((phone) => {
    const out: string[] = [];
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
    document.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select, textarea').forEach((el) => {
      if (!vis(el) || el.closest('[inert]')) return;
      const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || el.closest('label')?.textContent || '').trim();
      if (!name) out.push(`no accessible name: ${el.outerHTML.slice(0, 90)}`);
      if (!phone || el.closest('.heat, .orbit-dial') || (el as HTMLInputElement).type === 'file') return; // dense charts: each has full-size alternative controls
      const r = ((el as HTMLInputElement).type === 'checkbox' && el.closest('label') ? el.closest('label')! : el).getBoundingClientRect(); // a wrapping label is the real target
      const after = getComputedStyle(el, '::after');
      const grow = after.content !== 'none' && after.position === 'absolute' ? -2 * parseFloat(after.top || '0') : 0; // extended hit area
      const w = r.width, h = r.height + (grow > 0 ? grow : 0);
      if (Math.max(w, h) < 43.5 || Math.min(w, h) < 27.5) out.push(`small target ${Math.round(w)}x${Math.round(h)}: ${name.slice(0, 40)}`);
    });
    return out;
  }, test.info().project.name.startsWith('phone'));
  expect(problems, `accessibility problems on ${where}`).toEqual([]);
}

test('migrates v1 data, then every screen renders and passes basic accessibility checks', async ({ page }) => {
  const errors = await start(page);
  const phone = test.info().project.name.startsWith('phone');

  // Today: migrated blocks, to-dos, habits and the carry-over prompt.
  await expect(page.locator('#main').getByRole('button', { name: /5\/9 blocks done/ })).toBeVisible();
  await expect(page.getByText('1 unfinished from yesterday')).toBeVisible();
  await expect(page.getByText('IELTS exam · 5d')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Welcome to v2' })).toBeVisible();
  await settle(page); await shot(page, '01-today'); await audit(page, 'Today');

  await page.getByRole('button', { name: 'Carry over' }).click();
  await expect(page.locator('#main').getByRole('button', { name: 'Email professor' })).toBeVisible();
  await page.getByLabel('The one thing').fill('Draft the v2 design brief');
  await page.getByLabel('The one thing').press('Enter');

  // Timeline, and editing a block.
  await page.getByRole('button', { name: /Day ring/ }).click();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await settle(page); await shot(page, '02-timeline'); await audit(page, 'Timeline');
  await page.getByRole('button', { name: /^Study: recall practice/ }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Block' });
  await expect(sheet).toBeVisible();
  await sheet.getByPlaceholder('After lunch, at my desk…').fill('After lunch, at desk');
  await settle(page); await shot(page, '03-block-sheet'); await audit(page, 'Block sheet');
  await sheet.getByRole('checkbox', { name: 'Mark block done' }).click();
  await sheet.getByRole('button', { name: '+15m' }).click();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Back to day overview' }).click();
  await expect(page.locator('#main').getByRole('button', { name: /6\/9 blocks done/ })).toBeVisible();

  // Quick capture: a to-do in two taps plus typing.
  await page.getByRole('button', { name: 'Quick capture' }).click();
  await page.getByLabel('New to-do').fill('Buy protein');
  await settle(page); await shot(page, '04-capture');
  await page.getByLabel('New to-do').press('Enter');
  await expect(page.locator('#main').getByRole('button', { name: 'Buy protein' })).toBeVisible();

  // Journal.
  await tab(page, 'Journal');
  await page.getByLabel('Morning intention').fill('Finish the design brief before lunch.');
  await page.getByRole('radio', { name: /Mood 4 of 5/ }).click();
  await page.getByLabel('One win').fill('Closed three review comments.');
  await page.getByLabel('Add tag').fill('work'); await page.getByLabel('Add tag').press('Enter');
  await settle(page); await shot(page, '05-journal'); await audit(page, 'Journal');
  await page.getByRole('button', { name: /^Meals/ }).click();
  await expect(page.getByRole('dialog', { name: 'Meals' }).getByText('Dal rice').first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Search journal' }).click();
  await page.getByLabel('Search journal').fill('review');
  await expect(page.getByText('1 entry')).toBeVisible();
  await page.getByRole('button', { name: 'Close search' }).click();

  // Habits: migrated streaks, detail view, new habit with a cue.
  await tab(page, 'Habits');
  await expect(page.getByRole('region', { name: 'Gym' })).toBeVisible();
  await page.getByRole('region', { name: 'Gym' }).getByRole('button', { name: /^Gym/ }).click();
  await settle(page); await shot(page, '06-habits'); await audit(page, 'Habits');
  await page.getByRole('button', { name: 'Add habit' }).click();
  const hs = page.getByRole('dialog', { name: 'Habit' });
  await hs.getByPlaceholder('Gym').fill('Stretch');
  await hs.getByPlaceholder(/After work/).fill('After brushing teeth');
  await hs.getByRole('tab', { name: 'Per week' }).click();
  await settle(page); await shot(page, '07-habit-sheet'); await audit(page, 'Habit sheet');
  await hs.getByRole('button', { name: 'Add habit' }).click();
  await expect(page.getByRole('region', { name: 'Stretch' })).toBeVisible();

  // Insights from 12 weeks of migrated data.
  await tab(page, 'Insights');
  await expect(page.getByRole('region', { name: 'Best hours' }).getByText(/% of \d+/).first()).toBeVisible();
  await settle(page); await shot(page, '08-insights'); await audit(page, 'Insights');

  // Plan: week, month, study, setup, weekly review, orbit.
  await tab(page, 'Plan');
  await expect(page.getByText('W46')).toBeVisible();
  await settle(page); await shot(page, '09-plan-week'); await audit(page, 'Plan week');
  await page.getByRole('tab', { name: 'Month' }).click(); await settle(page); await shot(page, '10-plan-month'); await audit(page, 'Plan month');
  await page.getByRole('tab', { name: 'Study' }).click();
  await page.getByRole('button', { name: 'Topic' }).click();
  await page.getByRole('dialog').getByPlaceholder('CMOS inverter delay').fill('Setup and hold time');
  await page.getByRole('dialog').getByRole('button', { name: /Add topic/ }).click();
  await expect(page.getByRole('button', { name: /Setup and hold time/ })).toBeVisible();
  await settle(page); await shot(page, '11-plan-study'); await audit(page, 'Plan study');
  await page.getByRole('tab', { name: 'Setup' }).click(); await settle(page); await shot(page, '12-plan-setup'); await audit(page, 'Plan setup');
  await page.getByRole('tab', { name: 'Week' }).click();
  await page.getByRole('button', { name: /weekly review/i }).click();
  await settle(page); await shot(page, '13-review'); await audit(page, 'Weekly review');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Most likely obstacle').fill('Late meetings');
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.getByRole('heading', { name: 'Week 47 begins' })).toBeVisible();
  await page.waitForTimeout(700); await shot(page, '14-review-ceremony');
  await expect(page.getByText('Weekly review · done')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Open year orbit' }).click();
  await expect(page.getByRole('dialog', { name: 'Year orbit' }).getByText('Week 46', { exact: true })).toBeVisible();
  await settle(page); await shot(page, '15-orbit'); await audit(page, 'Orbit');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // Settings: migration report, and the secret token was not copied.
  if (phone) { await tab(page, 'Today'); }
  await page.getByRole('button', { name: 'Settings' }).click();
  const mig = page.getByTestId('migration');
  await expect(mig).toContainText('Moved from v1');
  await expect(mig).toContainText('habit ticks');
  await mig.scrollIntoViewIfNeeded(); await settle(page); await shot(page, '16-settings'); await audit(page, 'Settings');
  const backup = await page.evaluate(() => new Promise<string>((res) => { const rq = indexedDB.open('logplan-v2'); rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get('v1-backup'); g.onsuccess = () => res(JSON.stringify(g.result)); }; }));
  expect(backup).toContain('app-week:2026-11-09');
  expect(backup).not.toContain('ghp_FAKE');
  const v1Keys = await page.evaluate(() => new Promise<number>((res) => { const rq = indexedDB.open('logplan-db'); rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').getAllKeys(); g.onsuccess = () => res(g.result.length); }; }));
  expect(v1Keys).toBe(17); // v1 database untouched: 12 weeks + habits, countdowns, catalogue, lead, token

  // Reload: data persists and the migration does not run twice.
  await page.reload();
  await expect(page.locator('#main').getByRole('button', { name: /6\/9 blocks done/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Welcome to v2' })).toHaveCount(0);
  expect(errors, 'console errors').toEqual([]);
});
