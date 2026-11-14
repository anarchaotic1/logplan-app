import Dexie, { type Table } from 'dexie';
import type { Rec, RecType } from './model';
import { tick } from './hlc';

export interface KV { key: string; value: unknown }
export interface Photo { id: string; blob: Blob; createdAt: number }

export class LPDB extends Dexie {
  rec!: Table<Rec, string>;
  kv!: Table<KV, string>;
  photos!: Table<Photo, string>;
  constructor(name = 'logplan-v2') {
    super(name);
    this.version(1).stores({
      rec: 'id, type, [type+date], updatedAt',
      kv: 'key',
      photos: 'id',
    });
  }
}
export let db = new LPDB();
export function useDbForTests(name: string) { db = new LPDB(name); return db; }

export async function put<T extends Rec>(r: Omit<T, 'updatedAt'> & { updatedAt?: string }): Promise<T> {
  const full = { ...r, updatedAt: tick() } as T;
  await db.rec.put(full);
  await markDirty();
  return full;
}
export async function patch<T extends Rec>(id: string, changes: Partial<T>): Promise<void> {
  const cur = await db.rec.get(id);
  if (!cur) return;
  await db.rec.put({ ...cur, ...changes, updatedAt: tick() } as Rec);
  await markDirty();
}
/** Deletes leave a tombstone so the delete can sync to other devices. */
export async function remove(id: string): Promise<void> {
  const cur = await db.rec.get(id);
  if (!cur) return;
  await db.rec.put({ id: cur.id, type: cur.type, date: cur.date, updatedAt: tick(), deleted: true } as Rec);
  await markDirty();
}
export async function byType<T extends Rec>(type: RecType): Promise<T[]> {
  return (await db.rec.where('type').equals(type).toArray()).filter((r) => !r.deleted) as T[];
}
export async function byTypeDate<T extends Rec>(type: RecType, from: string, to = from): Promise<T[]> {
  return (await db.rec.where('[type+date]').between([type, from], [type, to], true, true).toArray()).filter((r) => !r.deleted) as T[];
}
export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const r = await db.kv.get(key);
  return r ? (r.value as T) : fallback;
}
export async function kvSet(key: string, value: unknown) { await db.kv.put({ key, value }); }

let dirtyListeners: (() => void)[] = [];
export function onDirty(fn: () => void) { dirtyListeners.push(fn); return () => { dirtyListeners = dirtyListeners.filter((f) => f !== fn); }; }
async function markDirty() { dirtyListeners.forEach((f) => f()); }
