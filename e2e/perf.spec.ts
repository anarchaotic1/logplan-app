import { expect, test, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { main, pngBuffer, start, tab } from './helpers';

/** Frame timings of the signature animations with the CPU slowed 4x (a rough stand-in for a mid-range phone).
 *  Run with: npm run perf. Results go to docs/perf-4x-throttle.json.
 *  This is desktop Chrome without a GPU, so the numbers say that the animations are cheap to compute, not how a
 *  particular phone will draw them. There is no canvas or shader any more: the background is static CSS. */
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
  test.setTimeout(240000);
  await start(page, false); // real clock: "today" is the real date, the seeded days are in the past
  const m = main(page);
  // Make a few things for today so the lists and the ring have content.
  for (const [t, title] of [['09:00', 'Deep work'], ['11:00', 'Stand-up'], ['15:00', 'Study'], ['18:00', 'Gym']] as const) {
    await page.getByRole('button', { name: 'Quick capture' }).click();
    const d = page.getByRole('dialog'); await d.getByRole('button', { name: 'Block' }).click(); await d.getByLabel('New block title').fill(title); await d.getByLabel('Start time').fill(t); await d.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(d).toHaveCount(0);
  }
  for (const t of ['Send report', 'Book dentist']) { await page.getByRole('button', { name: 'Quick capture' }).click(); const d = page.getByRole('dialog'); await d.getByLabel('New to-do').fill(t); await d.getByRole('button', { name: 'Add', exact: true }).click(); await expect(d).toHaveCount(0); }
  await tab(page, 'Meals');
  await m.getByLabel('What did you eat?').fill('Dal rice'); await m.getByRole('button', { name: 'Add meal' }).click();
  await m.getByRole('button', { name: /^Dal rice / }).click();
  const mealDlg = page.getByRole('dialog', { name: /^Dal rice, / });
  await mealDlg.getByLabel('Choose photos for Dal rice').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: await pngBuffer(page) });
  await expect(mealDlg.getByRole('button', { name: /Photo 1/ }).locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await tab(page, 'Today');
  await m.getByRole('button', { name: 'Log sleep' }).click();
  await m.evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForTimeout(7500); // let toasts leave

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const out = [];
  out.push(await measure(page, 'Open Today: stars appear, lines draw', async () => { await tab(page, 'Habits'); await page.waitForTimeout(700); await page.evaluate(() => { (window as any).__f = []; }); await tab(page, 'Today'); }, 1900));
  out.push(await measure(page, 'One-tap completion: check draws, star flares, line draws, sparks', async () => { await m.getByRole('checkbox', { name: 'Complete: Deep work', exact: true }).click(); }, 1200));
  out.push(await measure(page, 'Swipe right to complete (spring, rubber band)', async () => {
    const row = m.getByRole('button', { name: 'Edit to-do Send report' }); await row.scrollIntoViewIfNeeded();
    const r = (await row.boundingBox())!;
    await page.mouse.move(r.x + 20, r.y + r.height / 2); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(r.x + 20 + i * 22, r.y + r.height / 2); await page.waitForTimeout(30); }
    await page.mouse.up();
  }, 1100));
  await expect(m.getByRole('checkbox', { name: 'Completed: Send report' })).toBeVisible();
  await m.evaluate((el) => el.scrollTo({ top: 0 })); await page.waitForTimeout(400);
  out.push(await measure(page, 'Day change: slide with parallax', async () => { await m.getByRole('button', { name: 'Previous day' }).click(); }, 1100));
  await m.getByRole('button', { name: 'Next day' }).click(); await page.waitForTimeout(900);
  out.push(await measure(page, 'Sky to hour view (shared element)', async () => { await m.getByRole('button', { name: /Opens the hour-by-hour/ }).click(); }));
  await m.getByRole('button', { name: 'Back to the day overview' }).click(); await page.waitForTimeout(900);
  out.push(await measure(page, 'Open the block sheet', async () => { await m.getByRole('button', { name: /Edit block Gym/ }).first().click(); }, 1000));
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  out.push(await measure(page, 'Sleep arc: drag the wake handle', async () => {
    const h = m.getByRole('slider', { name: 'Wake time' }); await h.scrollIntoViewIfNeeded();
    const r = (await h.boundingBox())!; const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 14; i++) { await page.mouse.move(x + i * 3, y + i * 2.2); await page.waitForTimeout(16); }
    await page.mouse.up();
  }, 900));
  await m.evaluate((el) => el.scrollTo({ top: 0 }));
  out.push(await measure(page, 'Now card: complete, next block slides in', async () => { await m.getByRole('button', { name: /^Complete now: / }).click(); }, 1200));
  out.push(await measure(page, 'Eclipse focus opens', async () => { await m.getByRole('button', { name: /^Start a focus timer for / }).click(); }, 1500));
  await page.getByRole('dialog').getByRole('button', { name: 'End focus' }).click(); await page.waitForTimeout(600);
  out.push(await measure(page, 'Tab change to Calendar: indicator morphs, cells cascade, rings draw', async () => { await tab(page, 'Calendar'); }, 1600));
  out.push(await measure(page, 'Calendar: month change, cells cascade from the side', async () => { await m.getByRole('button', { name: 'Previous month' }).click(); }, 1500));
  out.push(await measure(page, 'Calendar: pick a day, its card rises', async () => { await m.locator('.cal-cell:not(.out)').nth(12).click(); }, 1200));
  out.push(await measure(page, 'Calendar: the card grows into the day', async () => { await m.getByRole('button', { name: /^Open (this day|today)$/ }).click(); }, 1200));
  await m.getByRole('button', { name: 'Back to the month' }).click(); await page.waitForTimeout(900);
  out.push(await measure(page, 'Tab change to Meals: rings draw, rows rise, satellites orbit', async () => { await tab(page, 'Meals'); }, 1600));
  out.push(await measure(page, 'Meals header flips to the horizon, the sun travels', async () => { await m.getByRole('button', { name: 'Flip to horizon view' }).click(); }, 2300));
  out.push(await measure(page, 'Meals header flips back, rings redraw', async () => { await m.getByRole('button', { name: 'Flip to macros' }).click(); }, 1600));
  out.push(await measure(page, 'Meal opens full screen', async () => { await m.getByRole('button', { name: /^Dal rice / }).click(); }, 1100));
  out.push(await measure(page, 'Meal photo: thumbnail grows to full screen', async () => { await page.getByRole('dialog').getByRole('button', { name: /Photo 1/ }).click(); }, 1100));
  out.push(await measure(page, 'Meal photo: drag down to dismiss', async () => {
    const r = (await page.getByRole('dialog', { name: /^Photo of/ }).getByRole('img').boundingBox())!; const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(x, y + i * 16); await page.waitForTimeout(16); }
    await page.mouse.up();
  }, 1100));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  out.push(await measure(page, 'Tab change to Habits: orbs, rows and dots appear', async () => { await tab(page, 'Habits'); }, 1500));
  out.push(await measure(page, 'Habit orb: liquid fills, ring bursts, number rolls', async () => { await m.getByRole('checkbox', { name: 'Complete today: Gym' }).click(); }, 1400));
  out.push(await measure(page, 'Habit history sheet: 12-week heatmap pops in', async () => { await m.getByRole('button', { name: /^Gym history/ }).click(); }, 1300));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  out.push(await measure(page, 'Idle Today (three stars twinkle)', async () => { await tab(page, 'Today'); await page.waitForTimeout(1500); await page.evaluate(() => { (window as any).__f = []; }); }, 2000));

  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/perf-4x-throttle.json', JSON.stringify({ note: 'Desktop Chrome, headless, no GPU, CPU throttled 4x. No canvas or shader: the background is static CSS. Not a measurement of any phone.', animations: out }, null, 2));
  console.table(out);
  for (const r of out) expect(r.medianMs, `${r.name}: median frame`).toBeLessThan(25);
});
