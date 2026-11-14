import { expect, test, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { seedV1 } from './seed';

/** Frame timings of the signature animations with the CPU slowed 4x (a stand-in for a mid-range phone).
 *  Run with: npx playwright test perf --project=phone. Results are written to docs/perf-4x-throttle.json. */

async function measure(page: Page, name: string, action: () => Promise<void>, ms = 1200) {
  await page.evaluate(() => { const w = window as any; w.__f = []; let last = performance.now(); w.__run = true; const tick = (t: number) => { w.__f.push(t - last); last = t; if (w.__run) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await action();
  await page.waitForTimeout(ms);
  const frames: number[] = await page.evaluate(() => { const w = window as any; w.__run = false; return w.__f.slice(2); });
  const s = [...frames].sort((a, b) => a - b);
  const q = (p: number) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
  return { name, frames: frames.length, medianMs: q(0.5), p95Ms: q(0.95), worstMs: +s[s.length - 1].toFixed(1), over33ms: frames.filter((f) => f > 33.4).length, avgFps: +(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)).toFixed(1) };
}
test('signature animations under 4x CPU throttling', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'measured once, at phone size');
  test.setTimeout(120000);
  await seedV1(page, false);
  const cdp = await page.context().newCDPSession(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Day ring/ })).toBeVisible();
  if (await page.getByRole('button', { name: 'Dismiss' }).count()) await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.waitForTimeout(7000); // let the welcome toast leave
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const nav = page.getByRole('navigation', { name: 'Sections' });
  const out = [];
  out.push(await measure(page, 'Open Today: ring sweep', async () => { await nav.getByRole('button', { name: /^Habits/ }).click(); await page.waitForTimeout(500); await page.evaluate(() => { (window as any).__f = []; }); await nav.getByRole('button', { name: /^Today/ }).click(); }, 1800));
  out.push(await measure(page, 'Ring to timeline (shared-element zoom)', async () => { await page.getByRole('button', { name: /Day ring/ }).click(); }));
  out.push(await measure(page, 'Complete a block (check draws, block brightens)', async () => { await page.getByRole('checkbox', { name: 'Mark Gym done' }).click(); }, 900));
  out.push(await measure(page, 'Open block sheet', async () => { await page.getByRole('button', { name: /^Gym/ }).click(); }, 900));
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Back to day overview' }).click(); await page.waitForTimeout(800);
  out.push(await measure(page, 'Tab switch: Today to Habits', async () => { await nav.getByRole('button', { name: /^Habits/ }).click(); }));
  out.push(await measure(page, 'Habit detail expand (curve draws)', async () => { await page.getByRole('region', { name: 'Gym' }).getByRole('button', { name: /^Gym/ }).click(); }));
  out.push(await measure(page, 'Heatmap ripple', async () => { await page.getByRole('region', { name: 'Gym' }).locator('.heat i').nth(150).click(); }));
  out.push(await measure(page, 'Tab switch: Habits to Insights (bars and line draw)', async () => { await nav.getByRole('button', { name: /^Insights/ }).click(); }));
  await nav.getByRole('button', { name: /^Plan/ }).click(); await page.waitForTimeout(900);
  out.push(await measure(page, 'Open year orbit (53 nodes)', async () => { await page.getByRole('button', { name: 'Open year orbit' }).click(); }, 1500));
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: /weekly review/i }).click(); await page.waitForTimeout(600);
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Next' }).click(); await page.waitForTimeout(400); }
  out.push(await measure(page, 'Weekly review ceremony', async () => { await page.getByRole('button', { name: 'Finish review' }).click(); }, 2400));
  out.push(await measure(page, 'Idle Today screen (ambient stars only)', async () => { await nav.getByRole('button', { name: /^Today/ }).click(); await page.waitForTimeout(1500); await page.evaluate(() => { (window as any).__f = []; }); }, 2000));
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/perf-4x-throttle.json', JSON.stringify(out, null, 2));
  console.table(out);
  for (const r of out) expect(r.medianMs, `${r.name}: median frame`).toBeLessThan(25);
});
