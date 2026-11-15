/** Meal photos. A picture is downscaled once, when it is added, and stored as JPEG bytes with a small thumbnail.
 *  Bytes live in the `photos` table; records only hold photo ids, so record sync stays small. */
import { db, type Photo } from './db';
import { uid } from './model';

export const PHOTO_MAX = 1280, THUMB_MAX = 320;
/** Size that fits inside max x max, keeping the aspect ratio and never enlarging. */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
async function encode(src: ImageBitmap, max: number, quality: number): Promise<ArrayBuffer> {
  const { w, h } = fitSize(src.width, src.height, max);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process that picture.');
  return blob.arrayBuffer();
}
/** Reads a picked or captured image, honours its EXIF rotation, and stores the downscaled copy. Returns the photo id. */
export async function addPhoto(file: Blob): Promise<string> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('That file is not a picture this device can read.'); }
  try {
    const id = uid('p');
    await db.photos.put({ id, createdAt: Date.now(), mime: 'image/jpeg', buf: await encode(bmp, PHOTO_MAX, 0.82), thumb: await encode(bmp, THUMB_MAX, 0.7) });
    return id;
  } finally { bmp.close(); }
}
const urls = new Map<string, string>();
export const photoBytes = async (p: Photo, thumb = false): Promise<Blob | null> => {
  if (thumb && p.thumb) return new Blob([p.thumb], { type: 'image/jpeg' });
  if (p.buf) return new Blob([p.buf], { type: p.mime || 'image/jpeg' });
  return p.blob || null;
};
/** Object URL for a stored photo (cached for the life of the page). */
export async function photoUrl(id: string, thumb = false): Promise<string | null> {
  const k = `${id}:${thumb ? 't' : 'f'}`;
  if (urls.has(k)) return urls.get(k)!;
  const p = await db.photos.get(id);
  const blob = p && (await photoBytes(p, thumb));
  if (!blob) return null;
  const u = URL.createObjectURL(blob); urls.set(k, u); return u;
}
export async function deletePhoto(id: string) {
  await db.photos.delete(id);
  for (const k of [`${id}:t`, `${id}:f`]) { const u = urls.get(k); if (u) { URL.revokeObjectURL(u); urls.delete(k); } }
}
export const photoSize = (p: Photo) => (p.buf?.byteLength || p.blob?.size || 0) + (p.thumb?.byteLength || 0);
export async function photoStats(): Promise<{ count: number; bytes: number }> {
  let count = 0, bytes = 0;
  await db.photos.each((p) => { count++; bytes += photoSize(p); });
  return { count, bytes };
}
export const fmtBytes = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);
