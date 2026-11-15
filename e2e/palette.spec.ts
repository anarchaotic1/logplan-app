import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { main, start } from './helpers';

/** Renders the real Today screen with three candidate accents and saves them side by side to docs/palette-options.png.
 *  Run with: npm run palette. The accent is one CSS token (--accent in src/styles.css); this sets it before the app starts. */
const OPTIONS = [
  { name: 'Ember amber', hex: '#FFB35C' },
  { name: 'Rose coral', hex: '#FF8F7E' },
  { name: 'Violet pink', hex: '#DDA2F2' },
];
test('accent candidates on the real Today screen', async ({ browser }) => {
  test.skip(test.info().project.name !== 'phone', 'rendered once, at phone size');
  test.setTimeout(180000);
  const shots: string[] = [];
  for (const o of OPTIONS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.addInitScript((hex) => { (window as any).__LP_BG = 'still'; const set = () => document.documentElement?.style.setProperty('--accent', hex); set(); new MutationObserver(set).observe(document, { childList: true }); document.addEventListener('DOMContentLoaded', set); }, o.hex);
    await start(page);
    await main(page).evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(1500);
    shots.push((await page.screenshot()).toString('base64'));
    if (o === OPTIONS[OPTIONS.length - 1]) {
      const png = await page.evaluate(async ({ shots, options }) => {
        const imgs = await Promise.all(shots.map((b) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b}`; })));
        const W = imgs[0].width, H = imgs[0].height, gap = 40, top = 120;
        const c = document.createElement('canvas'); c.width = W * 3 + gap * 4; c.height = H + top + gap;
        const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
        imgs.forEach((im, i) => { const x = gap + i * (W + gap); g.drawImage(im, x, top);
          g.fillStyle = options[i].hex; g.beginPath(); g.arc(x + 28, 62, 22, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#F4F1EE'; g.font = '600 40px sans-serif'; g.fillText(`${options[i].name}  ${options[i].hex}`, x + 66, 76); });
        return c.toDataURL('image/png').split(',')[1];
      }, { shots, options: OPTIONS });
      writeFileSync('docs/palette-options.png', Buffer.from(png, 'base64'));
    }
    await ctx.close();
  }
});
