import { expect, test, type Page } from '@playwright/test';
import { seedV1 } from './seed';

export const project = () => test.info().project.name;
export const isPhone = () => project().startsWith('phone');
export const reduced = () => project().includes('reduced');
export const shot = (page: Page, name: string) => page.screenshot({ path: `docs/screenshots/${project()}/${name}.png` });
export const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
export const settle = (page: Page, ms = 900) => page.waitForTimeout(reduced() ? 250 : ms);
export const noDialog = (page: Page) => expect(page.getByRole('dialog')).toHaveCount(0);
export const main = (page: Page) => page.locator('#main');

/** Seeds a v1 database, starts the app (which migrates it), and waits for the welcome toast to leave. */
export async function start(page: Page, fixedClock = true) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await seedV1(page, fixedClock);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good afternoon');
  await expect(page.getByText('Welcome to Log/Plan 2')).toBeVisible();
  await expect(page.getByText('Welcome to Log/Plan 2')).toBeHidden({ timeout: 12000 });
  await main(page).getByRole('button', { name: 'Dismiss' }).click();
  return errors;
}
/** A small real PNG (solid colour), generated in the page so no fixture file is needed. */
export async function pngBuffer(page: Page, w = 1600, h = 1200, color = '#c06a2b'): Promise<Buffer> {
  const b64 = await page.evaluate(async ({ w, h, color }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!; g.fillStyle = color; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
    return c.toDataURL('image/png').split(',')[1];
  }, { w, h, color });
  return Buffer.from(b64, 'base64');
}
