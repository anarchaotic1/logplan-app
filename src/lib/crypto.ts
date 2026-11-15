/** End-to-end encryption for everything that leaves the device.
 *  Key derivation: PBKDF2-HMAC-SHA256, 600,000 iterations (OWASP 2023 guidance), 16-byte random salt per account.
 *  Cipher: AES-256-GCM, fresh 12-byte random nonce per file write; the file name is bound in as additional data
 *  so an encrypted file cannot be swapped for another one without detection.
 *  The derived key is non-extractable. The "recovery key" is the raw key the user may export once, at setup. */
export const KDF_ITERATIONS = 600_000;
const enc = new TextEncoder(), dec = new TextDecoder();

/** Base64 in chunks, so large buffers (photos) do not overflow the argument limit. */
export const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function rawFromPassphrase(passphrase: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, 256);
}
export function importKey(raw: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations = KDF_ITERATIONS): Promise<{ key: CryptoKey; recoveryKey: string }> {
  const raw = await rawFromPassphrase(passphrase, salt, iterations);
  return { key: await importKey(raw), recoveryKey: formatRecoveryKey(new Uint8Array(raw)) };
}
export function formatRecoveryKey(raw: Uint8Array): string {
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
  return hex.match(/.{1,8}/g)!.join('-');
}
export function keyFromRecovery(recovery: string): Promise<CryptoKey> {
  const hex = recovery.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 64) throw new Error('Recovery key must be 64 hex characters.');
  return importKey(Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16)));
}
export interface Envelope { v: 1; alg: 'A256GCM'; iv: string; ct: string }

export async function encryptJSON(key: CryptoKey, data: unknown, name: string): Promise<Envelope> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(name) }, key, enc.encode(JSON.stringify(data)));
  return { v: 1, alg: 'A256GCM', iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
/** Throws if the key is wrong or the file was altered. */
export async function decryptJSON<T>(key: CryptoKey, env: Envelope, name: string): Promise<T> {
  if (env.v !== 1 || env.alg !== 'A256GCM') throw new Error('Unsupported file format.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) as BufferSource, additionalData: enc.encode(name) }, key, unb64(env.ct) as BufferSource);
  return JSON.parse(dec.decode(pt)) as T;
}
/** A small known value encrypted with the key, stored in the manifest, to tell "wrong passphrase" from "corrupt data". */
export const KEY_CHECK_NAME = 'key-check';
export const makeKeyCheck = (key: CryptoKey) => encryptJSON(key, { ok: true }, KEY_CHECK_NAME);
export async function verifyKey(key: CryptoKey, check: Envelope): Promise<boolean> {
  try { return (await decryptJSON<{ ok: boolean }>(key, check, KEY_CHECK_NAME)).ok === true; } catch { return false; }
}
