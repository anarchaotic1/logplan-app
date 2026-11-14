/** App-side sync controller: Google sign-in, key storage, and when to sync. */
import { create } from 'zustand';
import { db, kvGet, kvSet, onDirty } from './lib/db';
import { deriveKey, keyFromRecovery, unb64, verifyKey } from './lib/crypto';
import { DriveStore, newSalt, readManifest, syncOnce, WrongKeyError, type SyncState } from './lib/sync';
import { isNative, secure } from './lib/native';

export const WEB_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const syncConfigured = !!WEB_CLIENT_ID;

interface S { connected: boolean; busy: boolean; error: string; lastSync: string; lastResult: string; set(p: Partial<S>): void }
export const useSync = create<S>((set) => ({ connected: false, busy: false, error: '', lastSync: '', lastResult: '', set: (p) => set(p) }));

let token = '', tokenAt = 0;
async function webToken(interactive: boolean): Promise<string> {
  const w = window as any;
  if (!w.google?.accounts?.oauth2) await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = () => res(); s.onerror = () => rej(new Error('Could not reach Google. Check your connection.')); document.head.appendChild(s); });
  return new Promise((res, rej) => {
    const client = w.google.accounts.oauth2.initTokenClient({ client_id: WEB_CLIENT_ID, scope: SCOPE, callback: (r: any) => (r.access_token ? res(r.access_token) : rej(new Error(r.error_description || 'Google sign-in was cancelled.'))), error_callback: (e: any) => rej(new Error(e?.message || 'Google sign-in was cancelled.')) });
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}
async function nativeToken(): Promise<string> {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  await SocialLogin.initialize({ google: { webClientId: WEB_CLIENT_ID } });
  const r = await SocialLogin.login({ provider: 'google', options: { scopes: [SCOPE] } });
  const t = (r.result as { accessToken?: { token?: string } | null }).accessToken?.token;
  if (!t) throw new Error('Google did not return access to Drive. Try again.');
  return t;
}
export async function getToken(interactive = false): Promise<string> {
  if (token && Date.now() - tokenAt < 45 * 60000 && !interactive) return token;
  token = isNative ? await nativeToken() : await webToken(interactive);
  tokenAt = Date.now();
  return token;
}
const drive = () => new DriveStore(() => getToken());

async function loadKey(): Promise<CryptoKey | null> {
  if (isNative) { const hex = await secure.get('lp-sync-key'); return hex ? keyFromRecovery(hex) : null; }
  return kvGet<CryptoKey | null>('syncKey', null); // non-extractable CryptoKey, stored by structured clone
}
async function storeKey(key: CryptoKey, recovery: string) {
  if (isNative) await secure.set('lp-sync-key', recovery); else await kvSet('syncKey', key);
}

/** Step 1: sign in and report whether this Drive already holds Log/Plan data. */
export async function connectGoogle(): Promise<'new' | 'existing'> {
  await getToken(true);
  return (await readManifest(drive())) ? 'existing' : 'new';
}
/** Step 2: derive the key from the passphrase (or accept a recovery key), verify it, store it, and run the first sync. Returns the recovery key for a new setup. */
export async function unlockSync(secret: string, isRecoveryKey = false): Promise<string> {
  const d = drive();
  const manifest = await readManifest(d);
  const salt = manifest ? manifest.kdf.salt : newSalt();
  let key: CryptoKey, recovery: string;
  if (isRecoveryKey) { key = await keyFromRecovery(secret); recovery = secret.replace(/[^0-9a-f]/gi, ''); }
  else { const r = await deriveKey(secret, unb64(salt), manifest?.kdf.iterations); key = r.key; recovery = r.recoveryKey; }
  if (manifest && !(await verifyKey(key, manifest.keyCheck))) throw new WrongKeyError();
  await storeKey(key, recovery);
  await kvSet('sync', { salt, state: { buckets: {} } });
  useSync.getState().set({ connected: true, error: '' });
  await syncNow();
  return recovery;
}
export async function disconnectSync() {
  if (isNative) await secure.remove('lp-sync-key'); else await kvSet('syncKey', null);
  await kvSet('sync', null);
  token = '';
  useSync.getState().set({ connected: false, lastSync: '', lastResult: '', error: '' });
}
let running: Promise<void> | null = null;
export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const st = useSync.getState();
    const saved = await kvGet<{ salt: string; state: SyncState } | null>('sync', null);
    const key = await loadKey();
    if (!saved || !key) return;
    st.set({ busy: true, error: '' });
    try {
      const { result, state } = await syncOnce(db, drive(), key, saved.salt, saved.state);
      await kvSet('sync', { salt: saved.salt, state });
      st.set({ lastSync: state.lastSync || '', lastResult: result.pulled || result.pushed ? `${result.pushed} sent, ${result.pulled} received` : 'Up to date' });
    } catch (e) { st.set({ error: e instanceof Error ? e.message : 'Sync failed.' }); }
    finally { st.set({ busy: false }); }
  })().finally(() => { running = null; });
  return running;
}
/** Called once at startup: restores state and syncs in the background on changes, on return to the app, and when back online. */
export async function initSync() {
  if (!syncConfigured) return;
  const saved = await kvGet<{ salt: string; state: SyncState } | null>('sync', null);
  if (saved && (await loadKey())) useSync.getState().set({ connected: true, lastSync: saved.state.lastSync || '' });
  let t: ReturnType<typeof setTimeout>;
  const soon = (ms: number) => { clearTimeout(t); t = setTimeout(() => { if (navigator.onLine && useSync.getState().connected) void syncNow(); }, ms); };
  onDirty(() => soon(20000));
  window.addEventListener('online', () => soon(2000));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(3000); });
  soon(4000);
}
