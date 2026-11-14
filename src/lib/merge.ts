/** Per-record merge for sync: the record with the later HLC stamp wins; deletes are tombstones and merge the same way. */
import type { Rec } from './model';

export interface MergeResult { merged: Rec[]; toLocal: Rec[]; toRemote: Rec[] }

export function newer(a: Rec, b: Rec): Rec {
  if (a.updatedAt === b.updatedAt) return a.deleted ? a : b.deleted ? b : a; // identical stamp: prefer the delete, else stable
  return a.updatedAt > b.updatedAt ? a : b;
}
export function mergeRecords(local: Rec[], remote: Rec[]): MergeResult {
  const L = new Map(local.map((r) => [r.id, r]));
  const R = new Map(remote.map((r) => [r.id, r]));
  const merged: Rec[] = [], toLocal: Rec[] = [], toRemote: Rec[] = [];
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id);
    if (l && !r) { merged.push(l); toRemote.push(l); }
    else if (r && !l) { merged.push(r); toLocal.push(r); }
    else if (l && r) {
      const w = newer(l, r);
      merged.push(w);
      if (w === r && r.updatedAt !== l.updatedAt) toLocal.push(r);
      if (w === l && r.updatedAt !== l.updatedAt) toRemote.push(l);
    }
  }
  merged.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { merged, toLocal, toRemote };
}
/** Which Drive file a record lives in: dated records go in per-month files, the rest in one "core" file. */
export function bucketOf(r: Pick<Rec, 'date'>): string {
  return r.date ? `m-${r.date.slice(0, 7)}` : 'core';
}
/** Tombstones older than this can be dropped once every device has synced past them. */
export const TOMBSTONE_TTL_MS = 180 * 86400000;
export function pruneTombstones(recs: Rec[], now = Date.now()): Rec[] {
  return recs.filter((r) => !r.deleted || now - Number(r.updatedAt.split(':')[0]) < TOMBSTONE_TTL_MS);
}
