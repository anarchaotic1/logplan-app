import { describe, expect, it } from 'vitest';
import { altitude, arcPoint, arcPos, CONSTELLATIONS, DEFAULT_PLACE, moon, shower, starsLit, sunTimes, tonight } from '../src/lib/sky';

const utc = (s: string) => new Date(s);
const istMin = (d: Date) => { const m = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; return m; };

describe('moon', () => {
  it('is new near 9 Nov 2026 and full near 24 Nov 2026 (within about a day)', () => {
    const n = moon(utc('2026-11-09T07:00:00Z')), f = moon(utc('2026-11-24T15:00:00Z'));
    expect(Math.min(n.age, 29.53 - n.age)).toBeLessThan(1.2);
    expect(n.lit).toBeLessThan(0.05);
    expect(Math.abs(f.age - 14.77)).toBeLessThan(1.2);
    expect(f.lit).toBeGreaterThan(0.95);
  });
  it('waxes after new and wanes after full', () => {
    expect(moon(utc('2026-11-15T12:00:00Z')).waxing).toBe(true);
    expect(moon(utc('2026-11-15T12:00:00Z')).name).toBe('Waxing');
    expect(moon(utc('2026-11-29T12:00:00Z')).waxing).toBe(false);
  });
  it('known new moon of 21 Jan 2023 and full moon of 25 Dec 2023', () => {
    expect(moon(utc('2023-01-21T20:53:00Z')).lit).toBeLessThan(0.03);
    expect(moon(utc('2023-12-27T00:33:00Z')).lit).toBeGreaterThan(0.97);
  });
});
describe('sun', () => {
  it('Bengaluru on 15 Nov 2026: sunrise about 06:17, sunset about 17:51 IST (within 5 minutes)', () => {
    const t = sunTimes(utc('2026-11-15T06:30:00Z'), DEFAULT_PLACE)!;
    expect(Math.abs(istMin(t.rise) - (6 * 60 + 17))).toBeLessThanOrEqual(5);
    expect(Math.abs(istMin(t.set) - (17 * 60 + 51))).toBeLessThanOrEqual(5);
  });
  it('Bengaluru at the June solstice: sunset about 18:47 IST', () => {
    const t = sunTimes(utc('2026-06-21T06:30:00Z'), DEFAULT_PLACE)!;
    expect(Math.abs(istMin(t.set) - (18 * 60 + 47))).toBeLessThanOrEqual(5);
  });
  it('returns null instead of failing where the sun does not set (polar summer) or rise (polar winter)', () => {
    expect(sunTimes(utc('2026-06-21T12:00:00Z'), { lat: 78, lon: 15 })).toBeNull();
    expect(sunTimes(utc('2026-12-21T12:00:00Z'), { lat: 78, lon: 15 })).toBeNull();
    expect(() => tonight(utc('2026-06-21T12:00:00Z'), { lat: 89.9, lon: 0 })).not.toThrow();
    expect(() => tonight(utc('2026-06-21T12:00:00Z'), { lat: -90, lon: 0 })).not.toThrow();
  });
});
describe('tonight', () => {
  it('is deterministic for a date and place, and picks a real bundled constellation', () => {
    const a = tonight(utc('2026-11-15T10:00:00Z')), b = tonight(utc('2026-11-15T14:00:00Z'));
    expect(a.c.id).toBe(b.c.id);
    expect(CONSTELLATIONS.map((c) => c.id)).toContain(a.c.id);
    expect(a.caption).toMatch(/· (overhead|rises) \d\d:\d\d$/);
  });
  it('the pick is the highest of the bundle at 21:00 local', () => {
    const d = utc('2026-02-10T10:00:00Z'), at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21), t = tonight(d);
    for (const c of CONSTELLATIONS) expect(altitude(at, DEFAULT_PLACE, c.ra, c.dec)).toBeLessThanOrEqual(t.alt + 1e-9);
  });
  it('changes over the year', () => {
    const ids = new Set([1, 3, 5, 7, 9, 11].map((m) => tonight(new Date(2026, m, 15, 12)).c.id));
    expect(ids.size).toBeGreaterThanOrEqual(3);
  });
  it('every constellation is drawable: stars inside the box, edges point at real stars', () => {
    for (const c of CONSTELLATIONS) {
      for (const [, x, y] of c.stars) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); }
      for (const [a, b] of c.edges) { expect(c.stars[a]).toBeDefined(); expect(c.stars[b]).toBeDefined(); }
    }
  });
});
describe('blocks to stars', () => {
  it('no blocks or nothing done lights nothing', () => { expect(starsLit(0, 0, 9)).toBe(0); expect(starsLit(0, 5, 9)).toBe(0); expect(starsLit(3, 0, 9)).toBe(0); });
  it('as many blocks as stars: one star per block', () => { for (let d = 0; d <= 9; d++) expect(starsLit(d, 9, 9)).toBe(d); });
  it('fewer blocks than stars: each block lights several, all lit only when all are done', () => {
    expect(starsLit(1, 3, 9)).toBe(3); expect(starsLit(2, 3, 9)).toBe(6); expect(starsLit(3, 3, 9)).toBe(9); expect(starsLit(1, 2, 5)).toBe(2); expect(starsLit(2, 2, 5)).toBe(5);
  });
  it('more blocks than stars: a star needs several blocks, the last one needs all of them', () => {
    expect(starsLit(1, 18, 9)).toBe(0); expect(starsLit(2, 18, 9)).toBe(1); expect(starsLit(17, 18, 9)).toBe(8); expect(starsLit(18, 18, 9)).toBe(9);
    expect(starsLit(11, 12, 5)).toBe(4); expect(starsLit(12, 12, 5)).toBe(5);
  });
  it('never exceeds the star count and never goes down as more is done', () => {
    for (const S of [5, 6, 7, 8, 9]) for (let n = 1; n <= 20; n++) { let prev = 0; for (let d = 0; d <= n; d++) { const k = starsLit(d, n, S); expect(k).toBeGreaterThanOrEqual(prev); expect(k).toBeLessThanOrEqual(S); prev = k; } expect(prev).toBe(S); }
  });
});
describe('showers and the day arc', () => {
  it('knows the Leonids window', () => { expect(shower(new Date(2026, 10, 15))).toBe('Leonids'); expect(shower(new Date(2026, 10, 25))).toBeNull(); expect(shower(new Date(2026, 11, 13))).toBe('Geminids'); });
  it('maps 06:00 to the left end, 22:00 to the right end, and clamps', () => {
    expect(arcPos(360)).toBe(0); expect(arcPos(1320)).toBe(1); expect(arcPos(100)).toBe(0); expect(arcPos(1400)).toBe(1); expect(arcPos(840)).toBeCloseTo(0.5);
    expect(arcPoint(0)).toEqual({ x: 24, y: 96 }); expect(arcPoint(1)).toEqual({ x: 318, y: 96 }); expect(arcPoint(0.5).y).toBeCloseTo(36);
  });
});
