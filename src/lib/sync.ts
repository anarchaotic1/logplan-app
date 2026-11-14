/** Encrypted, local-first sync. The remote is a dumb file store (Google Drive appDataFolder in production,
 *  an in-memory map in tests). Layout: one small `manifest.json` plus one encrypted file per month of dated
 *  records (`m-2026-11.json`) and one for undated records (`core.json`). A sync only downloads the files
 *  whose stamp changed, merges per record (latest HLC stamp wins, deletes are tombstones), and uploads
 *  only files that gained something. Running it again changes nothing; two devices converge. */
import type { LPDB } from './db';
import type { Rec } from './model';
import { bucketOf, mergeRecords, pruneTombstones } from './merge';
import { b64, decryptJSON, encryptJSON, KDF_ITERATIONS, makeKeyCheck, randomBytes, unb64, verifyKey, type Envelope } from './crypto';
import { observe } from './hlc';

export interface RemoteStore {
  list(): Promise<string[]>;
  read(name: string): Promise<string | null>;
  write(name: string, body: string): Promise<void>;
}
export interface Manifest {
  v: 1; app: 'logplan';
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  keyCheck: Envelope;
  buckets: Record<string, { stamp: string; count: number }>;
}
export interface SyncState { buckets: Record<string, { remote: string; local: string }>; lastSync?: string }
export interface SyncResult { pulled: number; pushed: number; filesRead: number; filesWritten: number }
export class WrongKeyError extends Error { constructor() { super('That passphrase does not match the data in your Drive.'); } }

const MANIFEST = 'manifest.json';
const fileOf = (bucket: string) => `${bucket}.json`;
/** Local change detector: any local write raises the newest HLC stamp; inserts with old stamps change the count. */
const localMark = (recs: Rec[]) => `${recs.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), '')}|${recs.length}`;
/** Remote change detector: a fresh random revision per upload. (The newest record stamp is not enough: an upload
 *  that adds an older record leaves it unchanged, and another device would miss the change.) */
const newRev = () => b64(randomBytes(9));

export async function readManifest(remote: RemoteStore): Promise<Manifest | null> {
  const raw = await remote.read(MANIFEST);
  if (!raw) return null;
  const m = JSON.parse(raw) as Manifest;
  if (m.app !== 'logplan' || m.v !== 1) throw new Error('The sync folder holds data in an unknown format.');
  return m;
}
/** First device: creates the manifest with a fresh salt. Returns the salt to derive the key with. */
export function newSalt(): string { return b64(randomBytes(16)); }
export const saltBytes = (m: Pick<Manifest, 'kdf'>) => unb64(m.kdf.salt);

export async function syncOnce(db: LPDB, remote: RemoteStore, key: CryptoKey, salt: string, state: SyncState = { buckets: {} }): Promise<{ result: SyncResult; state: SyncState }> {
  let manifest = await readManifest(remote);
  if (manifest) { if (!(await verifyKey(key, manifest.keyCheck))) throw new WrongKeyError(); }
  else manifest = { v: 1, app: 'logplan', kdf: { name: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt }, keyCheck: await makeKeyCheck(key), buckets: {} };

  const local = new Map<string, Rec[]>();
  await db.rec.each((r) => { const b = bucketOf(r); (local.get(b) || local.set(b, []).get(b)!).push(r); });
  const names = new Set([...local.keys(), ...Object.keys(manifest.buckets)]);
  const result: SyncResult = { pulled: 0, pushed: 0, filesRead: 0, filesWritten: 0 };
  const next: SyncState = { buckets: { ...state.buckets } };
  let manifestDirty = !(await remote.read(MANIFEST));

  for (const name of [...names].sort()) {
    const mine = local.get(name) || [];
    const localStamp = localMark(mine);
    const remoteStamp = manifest.buckets[name]?.stamp || '';
    const seen = state.buckets[name];
    if (seen && seen.local === localStamp && seen.remote === remoteStamp) continue; // nothing changed on either side
    let theirs: Rec[] = [];
    if (remoteStamp) {
      const raw = await remote.read(fileOf(name));
      if (raw) { theirs = (await decryptJSON<{ recs: Rec[] }>(key, JSON.parse(raw) as Envelope, name)).recs; result.filesRead++; }
    }
    const m = mergeRecords(mine, theirs);
    if (m.toLocal.length) {
      m.toLocal.forEach((r) => observe(r.updatedAt));
      await db.rec.bulkPut(m.toLocal);
      result.pulled += m.toLocal.length;
    }
    const merged = pruneTombstones(m.merged);
    if (merged.length < m.merged.length) {
      const keep = new Set(merged.map((r) => r.id));
      await db.rec.bulkDelete(m.merged.filter((r) => !keep.has(r.id)).map((r) => r.id)); // expired tombstones
    }
    if (m.toRemote.length || (!remoteStamp && merged.length)) {
      await remote.write(fileOf(name), JSON.stringify(await encryptJSON(key, { recs: merged }, name)));
      manifest.buckets[name] = { stamp: newRev(), count: merged.length };
      manifestDirty = true;
      result.pushed += m.toRemote.length; result.filesWritten++;
    }
    next.buckets[name] = { remote: manifest.buckets[name]?.stamp || '', local: localMark(merged) };
  }
  if (manifestDirty) await remote.write(MANIFEST, JSON.stringify(manifest));
  next.lastSync = new Date().toISOString();
  return { result, state: next };
}

export class MemoryStore implements RemoteStore {
  files = new Map<string, string>(); reads = 0; writes = 0;
  async list() { return [...this.files.keys()]; }
  async read(name: string) { this.reads++; return this.files.get(name) ?? null; }
  async write(name: string, body: string) { this.writes++; this.files.set(name, body); }
}

/** Google Drive appDataFolder: a hidden per-app folder the user cannot browse and other apps cannot read. */
export class DriveStore implements RemoteStore {
  private ids = new Map<string, string>();
  private listed = false;
  constructor(private token: () => Promise<string>) {}
  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await this.token()}` } });
    if (res.status === 401) throw new Error('Google sign-in expired. Sign in again.');
    if (!res.ok && res.status !== 404) throw new Error(`Google Drive error ${res.status}`);
    return res;
  }
  async list() {
    this.ids.clear();
    let page = '';
    do {
      const res = await this.call(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name)${page ? `&pageToken=${page}` : ''}`);
      const j = (await res.json()) as { nextPageToken?: string; files: { id: string; name: string }[] };
      for (const f of j.files) if (!this.ids.has(f.name)) this.ids.set(f.name, f.id);
      page = j.nextPageToken || '';
    } while (page);
    this.listed = true;
    return [...this.ids.keys()];
  }
  async read(name: string) {
    if (!this.listed) await this.list();
    const id = this.ids.get(name);
    if (!id) return null;
    const res = await this.call(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    return res.status === 404 ? null : res.text();
  }
  async write(name: string, body: string) {
    if (!this.listed) await this.list();
    const id = this.ids.get(name);
    if (id) { await this.call(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }); return; }
    const boundary = `lp${Date.now()}`;
    const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' });
    const multi = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const res = await this.call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multi });
    this.ids.set(name, ((await res.json()) as { id: string }).id);
  }
}
