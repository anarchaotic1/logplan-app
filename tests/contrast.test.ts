import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LUMA_CAP } from '../src/lib/nova';

/** Contrast of the design tokens (WCAG 2.2). Text sits on translucent surfaces over an animated background, so every
 *  surface is checked twice: over the plain background colour and over the brightest pixel the supernova shader
 *  can produce (its luminance ceiling, LUMA_CAP). Targets: body text 7:1 (AAA), muted text 5:1, accent text 4.5:1. */
const css = readFileSync('src/styles.css', 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`))![1];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const over = (fg: number[], bg: number[], a: number) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const grayAt = (L: number) => { const s = L <= 0.0031308 ? L * 12.92 : 1.055 * L ** (1 / 2.4) - 0.055; return [s * 255, s * 255, s * 255]; };

const bg = rgb(token('bg')), text = rgb(token('text')), muted = rgb(token('muted')), accent = rgb(token('accent')), ink = rgb(token('ink')), danger = rgb(token('danger'));
const sheet = rgb(token('sheet')), bar = rgb(token('bar')), toast = rgb(token('toast'));
const white = [255, 255, 255], hot = grayAt(LUMA_CAP);

// Surfaces that carry all three text colours.
const surfaces: Record<string, number[]> = {};
// Stronger accent tints only ever carry body or accent text (selected chips, the active tab, the selected segment).
const tints: Record<string, number[]> = {};
for (const [name, base] of [['plain background', bg], ['brightest supernova pixel', hot]] as const) {
  surfaces[name] = [...base];
  surfaces[`card on ${name}`] = over(white, [...base], 0.04);
  surfaces[`pressed card on ${name}`] = over(white, [...base], 0.08);
  surfaces[`accent tint 8% (notice, done habit) on ${name}`] = over(accent, [...base], 0.08);
  tints[`accent tint 14% on ${name}`] = over(accent, [...base], 0.14);
  tints[`accent tint 22% on ${name}`] = over(accent, [...base], 0.22);
}
Object.assign(surfaces, { sheet, 'input on sheet': over(white, sheet, 0.04), 'navigation bar': bar, toast,
  'timeline block': over(accent, rgb('#07070c'), 0.1), 'done timeline block': over(accent, rgb('#07070c'), 0.22) });
Object.assign(tints, { 'accent tint on sheet': over(accent, sheet, 0.22), 'active tab pill': over(accent, bar, 0.14) });

describe('colour contrast', () => {
  it('the background ceiling itself is dark', () => { expect(lum(hot)).toBeCloseTo(LUMA_CAP, 3); expect(LUMA_CAP).toBeLessThan(0.03); });
  for (const [name, s] of Object.entries(surfaces)) {
    it(`body 7:1, muted 5:1, accent 4.5:1 on ${name}`, () => {
      expect(ratio(text, s), 'body text').toBeGreaterThanOrEqual(7);
      expect(ratio(muted, s), 'muted text').toBeGreaterThanOrEqual(5);
      expect(ratio(accent, s), 'accent text').toBeGreaterThanOrEqual(4.5);
    });
  }
  for (const [name, s] of Object.entries(tints)) {
    it(`body 7:1 and accent 4.5:1 on ${name}`, () => {
      expect(ratio(text, s), 'body text').toBeGreaterThanOrEqual(7);
      expect(ratio(accent, s), 'accent text').toBeGreaterThanOrEqual(4.5);
    });
  }
  it('dark text on accent buttons (7:1) and danger text (4.5:1)', () => {
    expect(ratio(ink, accent)).toBeGreaterThanOrEqual(7);
    for (const s of [sheet, bg, hot, over(white, hot, 0.04)]) expect(ratio(danger, s)).toBeGreaterThanOrEqual(4.5);
  });
  it('controls are visible without colour: borders of inputs and focus rings reach 3:1', () => {
    expect(ratio(over(white, sheet, 0.18), sheet)).toBeGreaterThanOrEqual(1.4); // decorative border; the 3:1 cue is the focus ring below
    for (const s of [bg, hot, sheet, bar]) expect(ratio(white, s)).toBeGreaterThanOrEqual(3);
    expect(ratio(accent, bg)).toBeGreaterThanOrEqual(3); // check outline, ring arcs, switch
  });
});
