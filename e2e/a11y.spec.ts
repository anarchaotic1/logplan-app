import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, main, pngBuffer, project, reduced, settle, start, tab } from './helpers';
import { LUMA_CAP } from '../src/lib/nova';

/** Accessibility checks on every screen: axe (WCAG 2.2 A and AA rules; serious and critical findings fail),
 *  48 px touch targets, 12 px minimum text, visible focus, focus trapping, reflow at 200% text and at 400% zoom,
 *  and text contrast against the brightest pixel the background can produce. */
async function axe(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${where}: ${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}
async function targetsAndText(page: Page, where: string) {
  const problems = await page.evaluate((phone) => {
    const out: string[] = [];
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
    document.querySelectorAll('button, a[href], [role=button], [role=checkbox], [role=slider], input:not([type=hidden]), select, textarea').forEach((el) => {
      if (!vis(el) || el.closest('[inert]')) return;
      const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || el.closest('label')?.textContent || '').trim();
      if (!name) out.push(`no accessible name: ${el.outerHTML.slice(0, 90)}`);
      if (!phone) return;
      const inLabel = (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'file';
      const r = (inLabel && el.closest('label') ? el.closest('label')! : el).getBoundingClientRect(); // a wrapping label is the real target
      const after = getComputedStyle(el, '::after');
      const grow = after.content !== 'none' && after.position === 'absolute' ? -2 * parseFloat(after.top || '0') : 0; // extended hit area
      const w = r.width, h = r.height + (grow > 0 ? grow : 0);
      if (Math.min(w, h) < 47.5) out.push(`small target ${Math.round(w)}x${Math.round(h)}: ${name.slice(0, 40)}`);
    });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<string>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement!; const t = (n.textContent || '').trim();
      if (!t || !vis(p) || p.closest('[aria-hidden=true], .sr, svg')) continue;
      const fs = parseFloat(getComputedStyle(p).fontSize);
      if (fs < 11.95 && !seen.has(t)) { seen.add(t); out.push(`text under 12 px (${fs}): ${t.slice(0, 30)}`); }
    }
    for (const t of document.querySelectorAll('svg text')) if (vis(t) && parseFloat(getComputedStyle(t).fontSize) * (t.closest('svg')!.getBoundingClientRect().width / (t.closest('svg') as SVGSVGElement).viewBox.baseVal.width || 1) < 9.5) out.push(`tiny svg text: ${t.textContent}`);
    if (document.querySelectorAll('h1').length !== 1 && !document.querySelector('[role=dialog]')) out.push(`expected one h1, found ${document.querySelectorAll('h1').length}`);
    if (!document.querySelector('main')) out.push('no main landmark');
    return out;
  }, isPhone());
  return problems.map((p) => `${where}: ${p}`);
}
/** Problems are collected across all screens and reported together. */
let found: string[] = [];
const check = async (page: Page, where: string) => { await settle(page, 700); found.push(...(await axe(page, where)), ...(await targetsAndText(page, where))); };

test('every screen passes axe, target-size, text-size and structure checks', async ({ page }) => {
  test.skip(reduced(), 'same markup as the phone project');
  test.setTimeout(180000);
  found = [];
  await start(page);
  const m = main(page);
  await check(page, 'Today');
  await m.getByRole('button', { name: 'Log sleep' }).click();
  await expect(m.getByRole('slider', { name: 'Bedtime' })).toBeVisible();
  await m.getByRole('slider', { name: 'Bedtime' }).scrollIntoViewIfNeeded();
  await check(page, 'Today, lower half with the sleep arc');
  await m.evaluate((el) => el.scrollTo({ top: 0 }));
  await m.getByRole('button', { name: /blocks done\. Opens/ }).click();
  await check(page, 'Hour view');
  await m.getByRole('button', { name: /Edit block Gym/ }).click();
  await check(page, 'Block sheet');
  await page.keyboard.press('Escape');
  await m.getByRole('button', { name: 'Back to the day overview' }).click();
  await m.getByRole('button', { name: 'Edit to-do Book dentist' }).click();
  await check(page, 'To-do sheet');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quick capture' }).click();
  await check(page, 'Quick capture');
  await page.getByRole('dialog').getByRole('button', { name: 'Habit' }).click();
  await check(page, 'Quick capture, habits');
  await page.keyboard.press('Escape');

  await tab(page, 'Calendar');
  await check(page, 'Calendar month');
  await m.getByRole('searchbox').fill('gym');
  await expect(m.getByRole('region', { name: 'Search results' })).toBeVisible();
  await check(page, 'Search results');
  await m.getByRole('button', { name: 'Clear search' }).click();
  await m.getByRole('button', { name: /^Friday 13 November\./ }).click();
  await check(page, 'Calendar day');
  await m.getByRole('button', { name: 'Back to the month' }).click();
  await m.getByRole('button', { name: 'Setup' }).click();
  await m.getByRole('textbox', { name: /Name for a template/ }).fill('Standard day');
  await m.getByRole('region', { name: 'Day templates' }).getByRole('button', { name: 'Save' }).click();
  await check(page, 'Setup');
  await m.getByRole('region', { name: 'Countdowns' }).getByRole('button', { name: 'Add' }).click();
  await check(page, 'Countdown sheet');
  await page.keyboard.press('Escape');

  await tab(page, 'Meals');
  const meal = m.getByRole('region', { name: /^Dal rice/ });
  await meal.getByLabel('Choose photos for Dal rice').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: await pngBuffer(page, 800, 600) });
  await expect(meal.getByRole('button', { name: /Photo 1/ }).locator('img')).toBeVisible();
  await check(page, 'Meals');
  await meal.getByRole('button', { name: /Photo 1/ }).click();
  await check(page, 'Photo viewer');
  await page.keyboard.press('Escape');

  await tab(page, 'Habits');
  await m.getByRole('button', { name: /^Gym details/ }).click();
  await check(page, 'Habits');
  await page.getByRole('button', { name: 'Add habit' }).click();
  await check(page, 'Habit sheet');
  await page.keyboard.press('Escape');

  await tab(page, 'Today');
  await m.getByRole('button', { name: 'Settings' }).click();
  await check(page, 'Settings');
  await page.getByRole('dialog').getByRole('button', { name: 'Export encrypted' }).scrollIntoViewIfNeeded();
  await check(page, 'Settings, data section');
  expect(found).toEqual([]);
});

test('keyboard: visible focus, sheets trap focus and give it back, Escape closes', async ({ page }) => {
  test.skip(project() !== 'laptop', 'keyboard use is checked at laptop size');
  await start(page);
  // Start from the top of the page (a click sets where Tab continues from; start() clicked inside the main pane).
  await page.locator('nav.side > div').first().click();
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const el = document.activeElement!; const cs = getComputedStyle(el); return { tag: el.tagName, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor }; });
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(ring.color).toBe('rgb(255, 255, 255)');
  // Focus order follows the page: sidebar first, then the main content.
  const order: string[] = [];
  for (let i = 0; i < 9; i++) { order.push(await page.evaluate(() => (document.activeElement?.closest('nav, main, aside') as HTMLElement | null)?.tagName || '?')); await page.keyboard.press('Tab'); }
  expect(order.join(' ')).toMatch(/^(NAV )+(MAIN ?)+$/);
  // N opens quick capture; Tab never leaves the dialog; Escape closes and focus returns.
  const fab = page.getByRole('button', { name: 'Quick capture' });
  await fab.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Quick capture' });
  await expect(dlg).toBeVisible();
  for (let i = 0; i < 14; i++) { await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(fab).toBeFocused();
  // Shortcuts.
  await page.keyboard.press('2');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar');
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').blur();
  await page.keyboard.press('t');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good afternoon');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday 13 November');
});

test('layout survives 200% text and 400% zoom without sideways scrolling or clipped controls', async ({ page }) => {
  test.skip(project() !== 'phone', 'checked at phone size');
  test.setTimeout(120000);
  await start(page);
  const m = main(page);
  const overflow = () => page.evaluate(() => {
    const out: string[] = [];
    const mainEl = document.querySelector('main')!;
    if (mainEl.scrollWidth > mainEl.clientWidth + 1) out.push(`main scrolls sideways by ${mainEl.scrollWidth - mainEl.clientWidth}px`);
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page scrolls sideways');
    const scope = document.querySelector('[role=dialog]') || document.body;
    scope.querySelectorAll('button, input, select, textarea, h1, h2, .tab').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || el.closest('.heat-scroll, [inert]') || (el as HTMLInputElement).type === 'file') return;
      if (r.right > innerWidth + 1 || r.left < -1) out.push(`off screen: ${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)} (${Math.round(r.left)}..${Math.round(r.right)})`);
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'hidden' && !el.classList.contains('clip') && !el.querySelector('.clip')) out.push(`clipped: ${(el.textContent || '').trim().slice(0, 30)}`);
    });
    return out;
  });
  const visit = async (label: string) => {
    for (const t of ['Today', 'Calendar', 'Meals', 'Habits']) { await tab(page, t); await settle(page, 500); expect(await overflow(), `${label}: ${t}`).toEqual([]); }
    await tab(page, 'Calendar'); await m.getByRole('button', { name: 'Setup' }).click(); await settle(page, 400);
    expect(await overflow(), `${label}: Setup`).toEqual([]);
    await m.getByRole('button', { name: 'Month', exact: true }).click();
    await tab(page, 'Today');
    await m.getByRole('button', { name: /Edit block Gym/ }).click(); await settle(page, 500);
    expect(await overflow(), `${label}: block sheet`).toEqual([]);
    await page.keyboard.press('Escape');
    await m.getByRole('button', { name: 'Settings' }).click(); await settle(page, 500);
    expect(await overflow(), `${label}: settings`).toEqual([]);
    await page.keyboard.press('Escape'); await settle(page, 400);
  };
  // System font scaling to 200% (Android applies it to the WebView's text).
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await visit('200% text');
  await page.screenshot({ path: `docs/screenshots/${project()}/20-text-200-percent.png` });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  // 400% zoom of a 1280 px window is a 320 px wide viewport.
  await page.setViewportSize({ width: 320, height: 640 });
  await visit('320 px wide (400% zoom)');
  await page.screenshot({ path: `docs/screenshots/${project()}/21-zoom-400-percent.png` });
});

test('text keeps its contrast over the brightest pixel of the background, including during a completion ring', async ({ page }) => {
  test.skip(reduced(), 'the still frame is the same shader output');
  await start(page);
  const m = main(page);
  // Sample the background alone (content hidden) while idle, then right after a completion (ring and flash).
  const maxLuma = async () => {
    const shotB64 = (await page.screenshot()).toString('base64');
    return page.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      let max = 0;
      for (let i = 0; i < d.length; i += 4) { const L = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); if (L > max) max = L; }
      return max;
    }, shotB64);
  };
  const tokens = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { text: cs.getPropertyValue('--text').trim(), muted: cs.getPropertyValue('--muted').trim(), accent: cs.getPropertyValue('--accent').trim() }; });
  await page.addStyleTag({ content: '.shell, .toast-zone, .sparks, .cursor-dot, .cursor-ring { visibility: hidden !important }' });
  const idle = await maxLuma();
  const samples = [idle];
  for (let i = 0; i < 3; i++) { await page.evaluate(() => { (document.querySelector('.check') as HTMLElement).click(); }); await page.waitForTimeout(120 + i * 140); samples.push(await maxLuma()); }
  const worst = Math.max(...samples);
  expect(await m.count()).toBe(1);
  expect(worst, 'brightest background pixel (relative luminance)').toBeLessThanOrEqual(LUMA_CAP + 0.004);
  const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (fg: string) => (lum(fg) + 0.05) / (worst + 0.05);
  test.info().annotations.push({ type: 'contrast', description: `brightest background pixel L=${worst.toFixed(4)} (idle ${idle.toFixed(4)}); text ${ratio(tokens.text).toFixed(2)}:1, muted ${ratio(tokens.muted).toFixed(2)}:1, accent ${ratio(tokens.accent).toFixed(2)}:1` });
  console.log(`[${project()}] brightest background pixel L=${worst.toFixed(4)} (idle ${idle.toFixed(4)}); text ${ratio(tokens.text).toFixed(2)}:1, muted ${ratio(tokens.muted).toFixed(2)}:1, accent ${ratio(tokens.accent).toFixed(2)}:1`);
  expect(ratio(tokens.text)).toBeGreaterThanOrEqual(7);
  expect(ratio(tokens.muted)).toBeGreaterThanOrEqual(5);
  expect(ratio(tokens.accent)).toBeGreaterThanOrEqual(4.5);
});
