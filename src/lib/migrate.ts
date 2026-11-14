/** v1 → v2 migration.
 *  v1 kept everything in IndexedDB database `logplan-db`, object store `kv`, as JSON strings.
 *  Rules: never modify or delete the v1 database; keep a JSON backup of it inside v2;
 *  deterministic record ids so running twice (or resuming after a crash) changes nothing;
 *  never overwrite a record that already exists in v2 (the user's newer edits win). */
import { addDays, isoDate, mondayOf, parseHM, type ISODate } from './dates';
import type { Rec } from './model';
import { db, kvGet, kvSet } from './db';

export type V1Dump = Record<string, string>;
/** Stamp older than any real edit, so every later edit or synced record wins over migrated data. */
export const MIGRATION_STAMP = '000000000000001:00000:v1';

export interface MigrationReport {
  status: 'none' | 'done';
  at?: string;
  v1Keys: number;
  converted: number;
  inserted: number;
  skippedExisting: number;
  byType: Record<string, number>;
  orphanHabitLogs: number;
  warnings: string[];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^\d{1,2}:\d{2}$/;
const hm = (s: unknown): number | null => (typeof s === 'string' && HM_RE.test(s) ? parseHM(s) : null);
const str = (s: unknown): string => (typeof s === 'string' ? s : '');

export function convertV1(dump: V1Dump, today: ISODate = isoDate(new Date())): { recs: Rec[]; orphanHabitLogs: number; warnings: string[] } {
  const recs: Rec[] = [];
  const warnings: string[] = [];
  const base = { updatedAt: MIGRATION_STAMP };
  const parse = (k: string): any => { try { return JSON.parse(dump[k]); } catch { warnings.push(`Could not parse ${k}`); return null; } };

  for (const key of Object.keys(dump).filter((k) => k.startsWith('app-week:')).sort()) {
    const wd = parse(key);
    if (!wd || typeof wd.days !== 'object' || !wd.days) continue;
    for (const iso of Object.keys(wd.days)) {
      if (!ISO_RE.test(iso)) { warnings.push(`Skipped day with bad date "${iso}" in ${key}`); continue; }
      const day = wd.days[iso] || {};
      for (const h of Object.keys(day.hours || {})) {
        const cell = day.hours[h] || {};
        const plan = str(cell.plan).trim(), log = str(cell.log).trim();
        if (!plan && !log) continue;
        const hour = Number(h);
        if (!Number.isFinite(hour) || hour < 0 || hour > 24) { warnings.push(`Skipped hour "${h}" on ${iso}`); continue; }
        // v1's last row "24" meant 12 AM at the end of the day, i.e. 00:00 of the next calendar date.
        const date = hour === 24 ? addDays(iso, 1) : iso;
        recs.push({ ...base, id: `v1b:${iso}:${hour}`, type: 'block', date, start: (hour % 24) * 60, dur: 60, title: plan, log,
          cat: '', done: !!cell.done, remindLead: cell.remind && typeof cell.remind.lead === 'number' ? cell.remind.lead : null });
      }
      const pris: any[] = Array.isArray(day.priorities) ? day.priorities
        : Array.isArray(day.top3) ? day.top3.map((t: unknown, i: number) => ({ id: `top${i}`, text: t })) : [];
      pris.forEach((p, i) => {
        const text = str(p && p.text).trim();
        if (!text) return;
        recs.push({ ...base, id: `v1t:${iso}:${str(p.id) || i}`, type: 'todo', date: iso, text, done: !!p.done,
          time: hm(p.time), remindAt: p.remind ? hm(p.remind.time) : null });
      });
      (Array.isArray(day.meals) ? day.meals : []).forEach((m: any, i: number) => {
        const name = str(m && m.name).trim();
        if (!name) return;
        recs.push({ ...base, id: `v1m:${iso}:${str(m.id) || i}`, type: 'meal', date: iso, time: hm(m.time) ?? 720, name, tag: str(m.tag) || 'Meal' });
      });
    }
    const r = wd.reflection || {};
    if (str(r.good).trim() || str(r.drop).trim()) {
      const monday = mondayOf(key.slice('app-week:'.length));
      recs.push({ ...base, id: `wr:${monday}`, type: 'weekReview', date: monday, good: str(r.good), drop: str(r.drop), obstacle: '', plan: '' });
    }
  }

  let orphanHabitLogs = 0;
  if (dump['app-habits']) {
    const hd = parse('app-habits');
    const habits: any[] = hd && Array.isArray(hd.habits) ? hd.habits : [];
    const log: Record<string, Record<string, unknown>> = hd && hd.log && typeof hd.log === 'object' ? hd.log : {};
    const ids = new Set(habits.map((h) => str(h.id)));
    const first: Record<string, ISODate> = {};
    for (const iso of Object.keys(log).sort()) {
      if (!ISO_RE.test(iso)) continue;
      for (const hid of Object.keys(log[iso] || {})) {
        if (!log[iso][hid]) continue;
        if (!ids.has(hid)) { orphanHabitLogs++; continue; }
        if (!first[hid]) first[hid] = iso;
        recs.push({ ...base, id: `hl:v1h:${hid}:${iso}`, type: 'habitLog', date: iso, habitId: `v1h:${hid}`, value: 1 });
      }
    }
    habits.forEach((h, i) => {
      const name = str(h.name).trim();
      if (!name || !str(h.id)) return;
      recs.push({ ...base, id: `v1h:${h.id}`, type: 'habit', name, cue: '', target: { kind: 'daily' }, restDays: [],
        remindTime: h.reminder && h.reminder.enabled ? hm(h.reminder.time) : null, createdOn: first[h.id] || today, order: i });
    });
  }
  if (dump['app-countdowns']) {
    const cd = parse('app-countdowns');
    (Array.isArray(cd) ? cd : []).forEach((c: any, i: number) => {
      if (!str(c.label).trim() || !ISO_RE.test(str(c.date))) return;
      recs.push({ ...base, id: `v1c:${str(c.id) || i}`, type: 'countdown', label: str(c.label).trim(), target: c.date });
    });
  }
  if (dump['app-meal-catalog']) {
    const mc = parse('app-meal-catalog');
    (Array.isArray(mc) ? mc : []).forEach((m: any, i: number) => {
      if (!str(m.name).trim()) return;
      recs.push({ ...base, id: `v1mc:${str(m.id) || i}`, type: 'mealCat', name: str(m.name).trim(), tag: str(m.tag) || 'Meal' });
    });
  }
  return { recs, orphanHabitLogs, warnings };
}

/** Reads the whole v1 key-value store without creating or changing it. Returns null if v1 was never installed here. */
export function readV1(idb: IDBFactory = indexedDB): Promise<V1Dump | null> {
  return new Promise((resolve) => {
    let fresh = false;
    const rq = idb.open('logplan-db');
    rq.onupgradeneeded = () => { fresh = true; rq.transaction?.abort(); }; // database did not exist: abort so we do not create it
    rq.onerror = () => resolve(null);
    rq.onblocked = () => resolve(null);
    rq.onsuccess = () => {
      const d = rq.result;
      if (fresh || !d.objectStoreNames.contains('kv')) { d.close(); resolve(null); return; }
      const out: V1Dump = {};
      const tx = d.transaction('kv', 'readonly');
      const cur = tx.objectStore('kv').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) { if (typeof c.key === 'string' && typeof c.value === 'string') out[c.key] = c.value; c.continue(); }
      };
      tx.oncomplete = () => { d.close(); resolve(out); };
      tx.onerror = () => { d.close(); resolve(null); };
    };
  });
}

export async function getMigrationReport(): Promise<MigrationReport | null> {
  return kvGet<MigrationReport | null>('migration', null);
}

/** Inserts converted v1 records that are not present yet. Shared by the on-device migration and by importing a v1 backup file. */
async function insertV1(safe: V1Dump): Promise<Omit<MigrationReport, 'status' | 'at' | 'v1Keys'>> {
  const { recs, orphanHabitLogs, warnings } = convertV1(safe);
  const existing = new Set(await db.rec.where('id').anyOf(recs.map((r) => r.id)).primaryKeys());
  const missing = recs.filter((r) => !existing.has(r.id));
  for (let i = 0; i < missing.length; i += 500) await db.rec.bulkAdd(missing.slice(i, i + 500));
  const lead = Number(safe['app-remind-lead']);
  if (Number.isFinite(lead) && lead >= 0 && (await kvGet<number | null>('remindLead', null)) == null) await kvSet('remindLead', lead);
  const byType: Record<string, number> = {};
  for (const r of recs) byType[r.type] = (byType[r.type] || 0) + 1;
  return { converted: recs.length, inserted: missing.length, skippedExisting: recs.length - missing.length, byType, orphanHabitLogs, warnings };
}
const withoutSecrets = (dump: V1Dump): V1Dump => Object.fromEntries(Object.entries(dump).filter(([k, v]) => k.startsWith('app-') && k !== 'app-gh-token' && typeof v === 'string'));

/** Imports a backup file made by v1 ("Export backup" or the GitHub Gist backup): `{ app: 'logplan', data: { 'app-week:…': '…' } }`.
 *  This is the path for moving to v2 when the new APK cannot be installed over v1 (v1 builds were signed with throwaway keys). */
export async function importV1Backup(file: { app?: string; data?: unknown }): Promise<MigrationReport> {
  if (file.app !== 'logplan' || !file.data || typeof file.data !== 'object') throw new Error('Not a Log/Plan v1 backup file.');
  const safe = withoutSecrets(file.data as V1Dump);
  if (!Object.keys(safe).length) throw new Error('The backup contains no records.');
  if (!(await kvGet('v1-backup', null))) await kvSet('v1-backup', { app: 'logplan', version: 4, exportedAt: new Date().toISOString(), records: Object.keys(safe).length, data: safe });
  const report: MigrationReport = { status: 'done', at: new Date().toISOString(), v1Keys: Object.keys(safe).length, ...(await insertV1(safe)) };
  await kvSet('migration', report);
  return report;
}

/** Safe to call on every launch. */
export async function runMigration(idb: IDBFactory = indexedDB): Promise<MigrationReport> {
  const prev = await getMigrationReport();
  if (prev && prev.status === 'done') return prev;
  const dump = await readV1(idb);
  const appKeys = dump ? Object.keys(dump).filter((k) => k.startsWith('app-')) : [];
  if (!dump || appKeys.length === 0) {
    return { status: 'none', v1Keys: 0, converted: 0, inserted: 0, skippedExisting: 0, byType: {}, orphanHabitLogs: 0, warnings: [] }; // not stored: v1 data that appears later is still picked up
  }
  // 1. Backup first. The GitHub token is a secret and is deliberately not copied.
  const safe = withoutSecrets(dump);
  if (!(await kvGet('v1-backup', null))) {
    await kvSet('v1-backup', { app: 'logplan', version: 4, exportedAt: new Date().toISOString(), records: Object.keys(safe).length, data: safe });
  }
  // 2. Convert and insert only what is missing.
  const report: MigrationReport = { status: 'done', at: new Date().toISOString(), v1Keys: appKeys.length, ...(await insertV1(safe)) };
  await kvSet('migration', report); // 3. Mark done last, so a crash before this point simply resumes.
  return report;
}
