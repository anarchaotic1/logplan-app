/** Small on-device astronomy for the night-sky theme. Pure functions, no network.
 *  Accuracy: moon phase from the mean lunation (within about a day), sunrise and sunset from the sunrise equation
 *  (within a few minutes at ordinary latitudes), constellation positions from one centre point each (approximate). */
const RAD = Math.PI / 180;
const SYNODIC = 29.530588853, NEW_MOON_JD = 2451550.1; // new moon of 6 January 2000
export const DEFAULT_PLACE = { lat: 12.97, lon: 77.59, name: 'Bengaluru' };
export interface Place { lat: number; lon: number }

export const julian = (d: Date) => d.getTime() / 86400000 + 2440587.5;
const fromJulian = (jd: number) => new Date((jd - 2440587.5) * 86400000);
const norm = (deg: number) => ((deg % 360) + 360) % 360;

export interface Moon { age: number; phase: number; lit: number; waxing: boolean; name: string }
/** Moon age in days, phase 0..1 (0 new, 0.5 full), lit share 0..1 and a short name. */
export function moon(d: Date): Moon {
  const age = (((julian(d) - NEW_MOON_JD) % SYNODIC) + SYNODIC) % SYNODIC;
  const phase = age / SYNODIC, lit = (1 - Math.cos(2 * Math.PI * phase)) / 2, waxing = phase < 0.5;
  const name = lit < 0.03 ? 'New' : lit > 0.97 ? 'Full' : waxing ? 'Waxing' : 'Waning';
  return { age, phase, lit, waxing, name };
}

/** Sunrise and sunset for the local calendar day of `d` at a place; null where the sun does not rise or set that day. */
export function sunTimes(d: Date, p: Place): { rise: Date; set: Date; noon: Date } | null {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const n = Math.round(julian(local) - 2451545 + 0.0008 + p.lon / 360);
  const js = n - p.lon / 360;
  const M = norm(357.5291 + 0.98560028 * js);
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lam = norm(M + C + 180 + 102.9372);
  const transit = 2451545 + js + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lam * RAD);
  const sinDec = Math.sin(lam * RAD) * Math.sin(23.44 * RAD), cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(p.lat * RAD) * sinDec) / (Math.cos(p.lat * RAD) * cosDec);
  if (!Number.isFinite(cosW) || cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / RAD;
  return { rise: fromJulian(transit - w / 360), set: fromJulian(transit + w / 360), noon: fromJulian(transit) };
}

/** Local sidereal time in degrees. */
export const sidereal = (d: Date, lon: number) => norm(280.46061837 + 360.98564736629 * (julian(d) - 2451545) + lon);
/** Altitude in degrees of a point (right ascension in hours, declination in degrees). */
export function altitude(d: Date, p: Place, ra: number, dec: number): number {
  const H = (sidereal(d, p.lon) - ra * 15) * RAD;
  return Math.asin(Math.sin(p.lat * RAD) * Math.sin(dec * RAD) + Math.cos(p.lat * RAD) * Math.cos(dec * RAD) * Math.cos(H)) / RAD;
}

export interface Constellation { id: string; name: string; ra: number; dec: number; stars: [string, number, number][]; edges: [number, number][] }
/** Star positions are a drawing (x 0..1, y 0..1), in the order they light up. */
export const CONSTELLATIONS: Constellation[] = [
  { id: 'orion', name: 'Orion', ra: 5.5, dec: 0,
    stars: [['Meissa', .5, .04], ['Betelgeuse', .2, .22], ['Bellatrix', .78, .24], ['Alnitak', .38, .55], ['Alnilam', .5, .52], ['Mintaka', .62, .49], ['Hatysa', .5, .72], ['Saiph', .27, .95], ['Rigel', .76, .93]],
    edges: [[0, 1], [0, 2], [1, 3], [2, 5], [3, 4], [4, 5], [4, 6], [3, 7], [5, 8]] },
  { id: 'cassiopeia', name: 'Cassiopeia', ra: 1, dec: 60,
    stars: [['Caph', .04, .7], ['Schedar', .28, .2], ['Navi', .5, .62], ['Ruchbah', .74, .14], ['Segin', .96, .56]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { id: 'pegasus', name: 'Pegasus', ra: 22.7, dec: 20,
    stars: [['Markab', .56, .78], ['Scheat', .52, .22], ['Alpheratz', .92, .16], ['Algenib', .95, .8], ['Homam', .34, .86], ['Biham', .16, .7], ['Matar', .3, .2], ['Enif', .04, .5]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5], [1, 6], [5, 7]] },
  { id: 'taurus', name: 'Taurus', ra: 4.7, dec: 19,
    stars: [['Aldebaran', .52, .62], ['Ain', .5, .4], ['Hyadum', .64, .58], ['Elnath', .12, .08], ['Tianguan', .06, .5], ['Alcyone', .86, .2], ['Lambda', .92, .86]],
    edges: [[0, 2], [1, 2], [1, 3], [0, 4], [1, 5], [2, 6]] },
  { id: 'ursa-major', name: 'Ursa Major', ra: 11.3, dec: 50,
    stars: [['Alkaid', .04, .2], ['Mizar', .24, .12], ['Alioth', .4, .22], ['Megrez', .56, .34], ['Phecda', .62, .7], ['Merak', .92, .76], ['Dubhe', .96, .3]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
  { id: 'leo', name: 'Leo', ra: 10.7, dec: 15,
    stars: [['Regulus', .72, .9], ['Eta', .7, .6], ['Algieba', .6, .42], ['Adhafera', .68, .22], ['Rasalas', .86, .08], ['Zosma', .26, .4], ['Chertan', .28, .68], ['Denebola', .04, .62]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 7], [7, 6], [6, 0]] },
  { id: 'lyra', name: 'Lyra', ra: 18.85, dec: 36,
    stars: [['Vega', .3, .06], ['Zeta', .5, .3], ['Delta', .76, .36], ['Sulafat', .62, .92], ['Sheliak', .36, .86]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] },
  { id: 'cygnus', name: 'Cygnus', ra: 20.6, dec: 42,
    stars: [['Deneb', .5, .04], ['Sadr', .5, .36], ['Albireo', .5, .96], ['Aljanah', .16, .52], ['Fawaris', .82, .26], ['Eta', .5, .68]],
    edges: [[0, 1], [1, 5], [5, 2], [1, 3], [1, 4]] },
];

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export interface Tonight { c: Constellation; caption: string; alt: number }
/** The bundled constellation that stands highest at 21:00 local time on the day of `d`, with a caption for it. */
export function tonight(d: Date, p: Place = DEFAULT_PLACE): Tonight {
  try {
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21);
    let best = CONSTELLATIONS[0], alt = -Infinity;
    for (const c of CONSTELLATIONS) { const a = altitude(at, p, c.ra, c.dec); if (a > alt) { alt = a; best = c; } }
    if (!Number.isFinite(alt)) throw new Error('no altitude');
    // Hours from 21:00 until the centre crosses the meridian (sidereal rate), then the rise time if it rises tonight.
    const H = ((sidereal(at, p.lon) - best.ra * 15 + 540) % 360) - 180; // degrees west of the meridian at 21:00
    const transit = new Date(at.getTime() - (H / 15) * 3590170);
    const cosH0 = -Math.tan(p.lat * RAD) * Math.tan(best.dec * RAD);
    let caption = `${best.name} · overhead ${hm(transit)}`;
    if (cosH0 > -1 && cosH0 < 1) {
      const rise = new Date(transit.getTime() - (Math.acos(cosH0) / RAD / 15) * 3590170);
      const evening = new Date(at.getTime() - 4 * 3600000);
      if (rise > evening && rise.getTime() <= at.getTime() + 3 * 3600000) caption = `${best.name} · rises ${hm(rise)}`;
    }
    return { c: best, caption, alt };
  } catch { return { c: CONSTELLATIONS[0], caption: CONSTELLATIONS[0].name, alt: 0 }; }
}

/** How many of S stars are lit when `done` of `n` blocks are done: star k is lit when done/n >= k/S. */
export function starsLit(done: number, n: number, S: number): number {
  if (n <= 0 || done <= 0) return 0;
  return Math.min(S, Math.floor((Math.min(done, n) * S) / n + 1e-9));
}

/** Annual meteor showers (rough peak windows, month is 1-based). */
const SHOWERS: [string, number, number, number][] = [['Quadrantids', 1, 1, 5], ['Perseids', 8, 9, 14], ['Leonids', 11, 15, 19], ['Geminids', 12, 11, 15]];
export function shower(d: Date): string | null {
  const m = d.getMonth() + 1, day = d.getDate();
  return SHOWERS.find((s) => s[1] === m && day >= s[2] && day <= s[3])?.[0] ?? null;
}
/** Position 0..1 of a time on the day arc used by the Meals horizon (06:00 to 22:00). */
export const ARC_FROM = 360, ARC_SPAN = 960;
export const arcPos = (min: number) => Math.max(0, Math.min(1, (min - ARC_FROM) / ARC_SPAN));
/** Point on the horizon arc (a quadratic curve from left to right) for a position 0..1. */
export function arcPoint(t: number, w = 342, top = -24, base = 96, pad = 24): { x: number; y: number } {
  const q = (a: number, b: number, c: number) => (1 - t) * (1 - t) * a + 2 * t * (1 - t) * b + t * t * c;
  return { x: q(pad, w / 2, w - pad), y: q(base, top, base) };
}
