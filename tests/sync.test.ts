import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { LPDB } from '../src/lib/db';
import { deriveKey } from '../src/lib/crypto';
import { MemoryStore, newSalt, readManifest, saltBytes, syncOnce, syncPhotos, PHOTO_SYNC_CAP, WrongKeyError, type SyncState } from '../src/lib/sync';
import type { Journal, Meal, Rec, Todo } from '../src/lib/model';

const T0 = Date.now() - 100000; // recent, so tombstones are within their retention window
const stamp = (ms: number, node: string) => `${String(T0 + ms).padStart(15, '0')}:00000:${node}`;
const todo = (id: string, text: string, ms: number, node: string, date = '2026-11-14', extra: object = {}): Rec => ({ id, type: 'todo', date, text, done: false, updatedAt: stamp(ms, node), ...extra } as Todo);

let n = 0, phone: LPDB, laptop: LPDB, drive: MemoryStore, key: CryptoKey, salt: string;
let ps: SyncState, ls: SyncState;
const syncPhone = async () => { const r = await syncOnce(phone, drive, key, salt, ps); ps = r.state; return r.result; };
const syncLaptop = async () => { const r = await syncOnce(laptop, drive, key, salt, ls); ls = r.state; return r.result; };
const all = async (d: LPDB) => (await d.rec.toArray()).sort((a, b) => (a.id < b.id ? -1 : 1));

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  phone = new LPDB(`phone${n}`); laptop = new LPDB(`laptop${n++}`); drive = new MemoryStore();
  salt = newSalt(); ps = { buckets: {} }; ls = { buckets: {} };
  key = (await deriveKey('passphrase', saltBytes({ kdf: { name: 'PBKDF2-SHA256', iterations: 1000, salt } }), 1000)).key;
});

describe('encrypted sync between a phone and a laptop', () => {
  it('first sync uploads; the second device downloads everything', async () => {
    await phone.rec.bulkPut([todo('a', 'buy milk', 10, 'p'), todo('b', 'old month', 5, 'p', '2026-10-02'),
      { id: 'journal:2026-11-14', type: 'journal', date: '2026-11-14', updatedAt: stamp(11, 'p'), intention: '', text: 'very private thought', win: '', lesson: '', ifThen: '', tags: [], photos: [] } as Journal]);
    const r1 = await syncPhone();
    expect(r1).toMatchObject({ pushed: 3, pulled: 0, filesWritten: 2 });
    expect([...drive.files.keys()].sort()).toEqual(['m-2026-10.json', 'm-2026-11.json', 'manifest.json']);
    const r2 = await syncLaptop();
    expect(r2).toMatchObject({ pulled: 3, pushed: 0, filesWritten: 0 });
    expect(await all(laptop)).toEqual(await all(phone));
  });
  it('nothing readable leaves the device', async () => {
    await phone.rec.bulkPut([todo('a', 'call the bank about the loan', 10, 'p'), { id: 'journal:2026-11-14', type: 'journal', date: '2026-11-14', updatedAt: stamp(11, 'p'), intention: '', text: 'very private thought', win: '', lesson: '', ifThen: '', tags: ['secret-tag'], photos: [] } as Journal]);
    await syncPhone();
    const blob = [...drive.files.values()].join('\n');
    for (const s of ['private', 'bank', 'loan', 'secret-tag', 'journal:', 'passphrase']) expect(blob).not.toContain(s);
    expect((await readManifest(drive))!.kdf.iterations).toBe(600000);
  });
  it('edits on both sides merge per record, latest wins, and both devices converge', async () => {
    await phone.rec.bulkPut([todo('a', 'v1', 10, 'p'), todo('b', 'v1', 10, 'p')]);
    await syncPhone(); await syncLaptop();
    await phone.rec.put(todo('a', 'phone edit', 20, 'p'));
    await laptop.rec.put(todo('a', 'laptop edit (later)', 30, 'l'));
    await laptop.rec.put(todo('c', 'laptop only', 25, 'l'));
    await phone.rec.put(todo('b', 'phone edit of b', 40, 'p'));
    await syncPhone(); await syncLaptop(); await syncPhone();
    const p = await all(phone);
    expect(p).toEqual(await all(laptop));
    expect(p.map((r) => (r as Todo).text)).toEqual(['laptop edit (later)', 'phone edit of b', 'laptop only']);
  });
  it('a delete on one device removes the record on the other and is not resurrected', async () => {
    await phone.rec.put(todo('a', 'to delete', 10, 'p'));
    await syncPhone(); await syncLaptop();
    await laptop.rec.put({ id: 'a', type: 'todo', date: '2026-11-14', updatedAt: stamp(50, 'l'), deleted: true } as Rec);
    await syncLaptop(); await syncPhone(); await syncLaptop();
    expect((await phone.rec.get('a'))!.deleted).toBe(true);
    expect((await laptop.rec.get('a'))!.deleted).toBe(true);
  });
  it('drops tombstones older than the retention window from the file and the device', async () => {
    const old = `${String(Date.now() - 200 * 86400000).padStart(15, '0')}:00000:p`;
    await phone.rec.bulkPut([{ id: 'gone', type: 'todo', date: '2026-11-14', updatedAt: old, deleted: true } as Rec, todo('a', 'keep', 10, 'p')]);
    await syncPhone(); await syncLaptop();
    expect(await phone.rec.get('gone')).toBeUndefined();
    expect((await all(laptop)).map((r) => r.id)).toEqual(['a']);
  });
  it('is idempotent and only touches files that changed', async () => {
    await phone.rec.bulkPut([todo('a', 'nov', 10, 'p'), todo('b', 'oct', 5, 'p', '2026-10-02'), todo('c', 'sep', 5, 'p', '2026-09-02')]);
    await syncPhone(); await syncLaptop();
    drive.reads = 0; drive.writes = 0;
    expect(await syncPhone()).toEqual({ pulled: 0, pushed: 0, filesRead: 0, filesWritten: 0 });
    expect(drive.writes).toBe(0);
    await laptop.rec.put(todo('d', 'new in nov', 60, 'l'));
    drive.reads = 0; drive.writes = 0;
    const r = await syncLaptop();
    expect(r).toMatchObject({ pushed: 1, filesRead: 1, filesWritten: 1 });
    expect(drive.writes).toBe(2); // the November file and the manifest
    const r2 = await syncPhone();
    expect(r2).toMatchObject({ pulled: 1, filesRead: 1, filesWritten: 0 });
  });
  it('recovers when two devices upload the same file at the same time', async () => {
    await phone.rec.put(todo('a', 'base', 10, 'p'));
    await syncPhone(); await syncLaptop();
    await phone.rec.put(todo('p1', 'from phone', 20, 'p'));
    await laptop.rec.put(todo('l1', 'from laptop', 21, 'l'));
    const before = new Map(drive.files);
    await syncPhone();
    const phoneFile = drive.files.get('m-2026-11.json')!;
    drive.files = new Map(before); // the laptop read the old state, then overwrote the phone's upload
    await syncLaptop();
    expect(drive.files.get('m-2026-11.json')).not.toBe(phoneFile);
    await syncPhone(); await syncLaptop();
    expect((await all(phone)).map((r) => r.id)).toEqual(['a', 'l1', 'p1']);
    expect(await all(laptop)).toEqual(await all(phone));
  });
  it('refuses a wrong passphrase without changing anything', async () => {
    await phone.rec.put(todo('a', 'x', 10, 'p'));
    await syncPhone();
    const wrong = (await deriveKey('not it', saltBytes((await readManifest(drive))!), 1000)).key;
    await laptop.rec.put(todo('z', 'local', 5, 'l'));
    const files = new Map(drive.files);
    await expect(syncOnce(laptop, drive, wrong, salt)).rejects.toBeInstanceOf(WrongKeyError);
    expect(drive.files).toEqual(files);
    expect(await laptop.rec.count()).toBe(1);
  });
});

describe('photo sync (encrypted files next to the records)', () => {
  const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill).buffer as ArrayBuffer;
  const meal = (photos: string[], ms: number, node = 'p'): Rec => ({ id: 'm1', type: 'meal', date: '2026-11-14', time: 780, name: 'Dal rice', tag: 'Lunch', photos, updatedAt: stamp(ms, node) } as Meal);
  const both = async () => { await syncPhone(); await syncPhotos(phone, drive, key); await syncLaptop(); await syncPhotos(laptop, drive, key); };

  it('a photo added on the phone arrives on the laptop, byte for byte, and is unreadable in the store', async () => {
    await phone.rec.put(meal(['px'], 10));
    await phone.photos.put({ id: 'px', createdAt: Date.now(), mime: 'image/jpeg', buf: bytes(200000, 7), thumb: bytes(900, 9) });
    await both();
    const got = (await laptop.photos.get('px'))!;
    expect(new Uint8Array(got.buf!).length).toBe(200000);
    expect(new Uint8Array(got.buf!)[1234]).toBe(7);
    expect(new Uint8Array(got.thumb!)[10]).toBe(9);
    expect(drive.files.get('p-px.json')).not.toContain('image/jpeg');
    const again = await syncPhotos(laptop, drive, key);
    expect(again).toMatchObject({ up: 0, down: 0, removed: 0, waiting: 0 });
  });
  it('works in batches and reports what is still waiting', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `p${i}`);
    await phone.rec.put(meal(ids, 10));
    for (const id of ids) await phone.photos.put({ id, createdAt: Date.now(), buf: bytes(100, 1) });
    await syncPhone();
    expect(await syncPhotos(phone, drive, key, 2)).toMatchObject({ up: 2, waiting: 3 });
    expect(await syncPhotos(phone, drive, key, 2)).toMatchObject({ up: 2, waiting: 1 });
    expect(await syncPhotos(phone, drive, key, 2)).toMatchObject({ up: 1, waiting: 0 });
  });
  it('removing a photo deletes the remote file; the other device drops its copy after the grace period', async () => {
    await phone.rec.put(meal(['px'], 10));
    await phone.photos.put({ id: 'px', createdAt: Date.now() - 2 * 86400000, buf: bytes(100, 1) });
    await both();
    await phone.rec.put(meal([], 20));
    await phone.kv.put({ key: 'photoTrash', value: ['px'] });
    await syncPhone();
    expect(await syncPhotos(phone, drive, key)).toMatchObject({ removed: 1 });
    expect(drive.files.has('p-px.json')).toBe(false);
    expect(await phone.photos.get('px')).toBeUndefined();
    await syncLaptop(); await syncPhotos(laptop, drive, key);
    expect(await laptop.photos.get('px')).toBeUndefined();
  });
  it('an undone removal keeps the photo, and a fresh unreferenced photo is not dropped', async () => {
    await phone.rec.put(meal(['px'], 10));
    await phone.photos.put({ id: 'px', createdAt: Date.now(), buf: bytes(100, 1) });
    await phone.photos.put({ id: 'fresh', createdAt: Date.now(), buf: bytes(100, 1) });
    await phone.kv.put({ key: 'photoTrash', value: ['px'] }); // removed, then undone: the meal still lists it
    await syncPhone(); await syncPhotos(phone, drive, key);
    expect(drive.files.has('p-px.json')).toBe(true);
    expect(await phone.photos.get('px')).toBeDefined();
    expect(await phone.photos.get('fresh')).toBeDefined();
  });
  it('stops uploading above the storage cap and says so', async () => {
    expect(PHOTO_SYNC_CAP).toBeGreaterThan(100e6);
    await phone.rec.put(meal(['px'], 10));
    await phone.photos.put({ id: 'px', createdAt: Date.now(), buf: bytes(100, 1) });
    await phone.photos.put({ id: 'huge', createdAt: Date.now(), buf: { byteLength: PHOTO_SYNC_CAP + 1 } as ArrayBuffer });
    await syncPhone();
    expect(await syncPhotos(phone, drive, key)).toMatchObject({ up: 0, capped: true, waiting: 1 });
    expect(drive.files.has('p-px.json')).toBe(false);
  });
});
