/** Hybrid logical clock. Produces sortable strings so "latest edit wins" survives device clock drift:
 *  a device whose wall clock is behind still produces stamps later than anything it has already seen. */
let lastMs = 0;
let counter = 0;
let node = 'local';

export function setNode(id: string) { node = id; }

function fmt(ms: number, c: number, n: string): string {
  return `${String(ms).padStart(15, '0')}:${String(c).padStart(5, '0')}:${n}`;
}
export function parseHlc(s: string): { ms: number; c: number; node: string } {
  const [ms, c, ...n] = s.split(':');
  return { ms: Number(ms), c: Number(c), node: n.join(':') };
}
export function tick(wall = Date.now()): string {
  if (wall > lastMs) { lastMs = wall; counter = 0; } else { counter++; }
  return fmt(lastMs, counter, node);
}
/** Call when a remote stamp is seen so later local stamps sort after it. */
export function observe(remote: string, wall = Date.now()) {
  const r = parseHlc(remote);
  // Ignore absurd future stamps (> 1 day ahead) so one broken device cannot poison the clock.
  if (r.ms > wall + 86400000) return;
  if (r.ms > lastMs) { lastMs = r.ms; counter = r.c; }
  else if (r.ms === lastMs && r.c > counter) counter = r.c;
}
export function resetHlcForTests() { lastMs = 0; counter = 0; node = 'local'; }
