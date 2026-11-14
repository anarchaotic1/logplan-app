import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });
test('installable and works offline after the first visit', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'phone', 'checked once');
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Day ring/ })).toBeVisible();
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json());
  expect(manifest).toMatchObject({ name: 'Log/Plan', display: 'standalone', theme_color: '#040A18' });
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then((r) => !!r?.active));
  await page.getByLabel('The one thing').fill('Works offline');
  await page.getByLabel('The one thing').press('Enter');
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('The one thing')).toHaveValue('Works offline');
  const fonts = await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)));
  expect(fonts.join()).toContain('Inter'); // bundled fonts, no network needed
  await context.setOffline(false);
});
