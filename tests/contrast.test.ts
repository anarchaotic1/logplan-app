import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** WCAG contrast of the design tokens, including text on translucent surfaces (blended over the background). */
const css = readFileSync('src/styles.css', 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`))![1];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const over = (fg: number[], bg: number[], a: number) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const bg = rgb(token('bg')), text = rgb(token('text')), muted = rgb(token('muted')), accent = rgb(token('accent')), ink = rgb(token('accent-ink')), danger = rgb(token('danger')), sheet = rgb(token('sheet'));
const white = [255, 255, 255];
const surfaces: Record<string, number[]> = {
  background: bg, card: over(white, bg, 0.05), 'pressed card': over(white, bg, 0.09), sheet, 'input on sheet': over(white, sheet, 0.04),
  'accent-tinted card': over(accent, bg, 0.14), 'done block': over(accent, bg, 0.22), nav: [9, 16, 34], toast: rgb('#12203f'),
};
describe('colour contrast (WCAG AA, 4.5:1 for text)', () => {
  for (const [name, s] of Object.entries(surfaces)) {
    it(`body, muted and accent text on ${name}`, () => {
      expect(ratio(text, s)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(muted, s)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(accent, s)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('dark text on accent buttons, danger text, placeholder text', () => {
    expect(ratio(ink, accent)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(danger, sheet)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(danger, bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb('#7f8fae'), surfaces['input on sheet'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb('#7f8fae'), surfaces.card)).toBeGreaterThanOrEqual(4.5);
  });
});
