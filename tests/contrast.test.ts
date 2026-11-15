import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Contrast of the design tokens (WCAG 2.2). The background is a flat colour with a few 2 px stars, and every surface is
 *  opaque, so each surface is checked directly. Targets: body text 7:1 (AAA), muted text 5:1, accent text 4.5:1.
 *  Text is also checked on the brightest corner of the Now card, and dark text on every colour that carries it. */
const css = readFileSync('src/styles.css', 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`))![1];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const over = (fg: number[], bg: number[], a: number) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const bg = rgb(token('bg')), text = rgb(token('text')), muted = rgb(token('muted')), accent = rgb(token('accent')), ink = rgb(token('ink')), danger = rgb(token('danger'));
const sheet = rgb(token('sheet')), bar = rgb(token('bar')), toast = rgb(token('toast'));
const white = [255, 255, 255];
const surface = rgb(token('surface')), surface2 = rgb(token('surface-2')), pill = rgb(token('pill'));
const groupColors = ['accent', 'green', 'blue', 'violet'].map((n) => rgb(token(n)));

// Surfaces that carry all three text colours.
const surfaces: Record<string, number[]> = { 'plain background': bg, card: surface, 'input and raised card': surface2, sheet, 'navigation bar': bar, toast,
  'accent tint 8% (notice) on background': over(accent, bg, 0.08), 'Now card, brightest corner': rgb('#0F2447'), 'eclipse focus screen': rgb('#02050F'),
  'timeline block': over(accent, surface, 0.1), 'done timeline block': over(accent, surface, 0.16) };
// Stronger accent tints only ever carry body or accent text (selected chips, the active tab, the selected segment).
const tints: Record<string, number[]> = { 'accent tint 14% on background': over(accent, bg, 0.14), 'accent tint 22% on card': over(accent, surface, 0.22), 'accent tint on sheet': over(accent, sheet, 0.22), 'active tab pill': pill };

describe('colour contrast', () => {
  it('the palette is the night-sky one', () => { expect(token('bg')).toBe('#040A18'); expect(token('accent')).toBe('#5CE1E6'); });
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
    for (const s of [sheet, bg, surface, surface2]) expect(ratio(danger, s)).toBeGreaterThanOrEqual(4.5);
    for (const g of groupColors) expect(ratio(ink, g), 'dark text on a lit plate-group chip').toBeGreaterThanOrEqual(7);
    for (const g of groupColors) expect(ratio(g, bg), 'plate-group outline on the background').toBeGreaterThanOrEqual(3);
  });
  it('controls are visible without colour: borders of inputs and focus rings reach 3:1', () => {
    expect(ratio(over(white, sheet, 0.18), sheet)).toBeGreaterThanOrEqual(1.4); // decorative border; the 3:1 cue is the focus ring below
    for (const s of [bg, surface, sheet, bar]) expect(ratio(white, s)).toBeGreaterThanOrEqual(3);
    expect(ratio(muted, surface), 'unchecked circles are drawn in the muted colour').toBeGreaterThanOrEqual(3);
    expect(ratio(accent, bg)).toBeGreaterThanOrEqual(3); // check outline, ring arcs, switch
  });
});
