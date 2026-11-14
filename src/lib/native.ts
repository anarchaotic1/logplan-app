/** Bridges to the Android shell. Every function is a safe no-op in the browser. */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App as CapApp } from '@capacitor/app';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { PlannedNotif } from './notif';

export const isNative = Capacitor.isNativePlatform();

export function haptic(kind: 'light' | 'medium' | 'success' = 'light') {
  if (!isNative) return;
  if (kind === 'success') void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  else void Haptics.impact({ style: kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
}
export async function notifPermission(request: boolean): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (!isNative) return 'unsupported';
  try {
    let s = await LocalNotifications.checkPermissions();
    if (s.display !== 'granted' && request) s = await LocalNotifications.requestPermissions();
    return s.display === 'granted' ? 'granted' : s.display === 'denied' ? 'denied' : 'prompt';
  } catch { return 'unsupported'; }
}
/** Replaces everything pending with the planned list. Uses inexact alarms (no special permission needed). */
export async function applyNotifications(planned: PlannedNotif[]): Promise<number> {
  if (!isNative) return 0;
  if ((await notifPermission(false)) !== 'granted') return 0;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (planned.length) await LocalNotifications.schedule({ notifications: planned.map((n) => ({ id: n.id, title: n.title, body: n.body, schedule: { at: n.at, allowWhileIdle: true } })) });
  return planned.length;
}
/** Android 12+: exact alarms are a user setting. Without it reminders still fire, but may be late by several minutes. */
export async function exactAlarms(change = false): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!isNative) return 'unsupported';
  try {
    const r = change ? await LocalNotifications.changeExactNotificationSetting() : await LocalNotifications.checkExactNotificationSetting();
    return r.exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch { return 'unsupported'; }
}
export async function pendingCount(): Promise<number> {
  if (!isNative) return 0;
  try { return (await LocalNotifications.getPending()).notifications.length; } catch { return 0; }
}
export async function biometricAvailable(): Promise<boolean> {
  if (!isNative) return false;
  try { const r = await BiometricAuth.checkBiometry(); return r.isAvailable || r.deviceIsSecure; } catch { return false; }
}
export async function unlock(reason = 'Unlock Log/Plan'): Promise<boolean> {
  if (!isNative) return true;
  try { await BiometricAuth.authenticate({ reason, allowDeviceCredential: true, androidTitle: 'Log/Plan', androidSubtitle: reason, cancelTitle: 'Cancel' }); return true; }
  catch { return false; }
}
/** Android Keystore-backed storage on the device; in the browser the plugin falls back to localStorage,
 *  so the web build does not use it for key material (see sync.ts). */
export const secure = {
  get: async (k: string): Promise<string | null> => { try { const v = await SecureStorage.get(k); return typeof v === 'string' ? v : null; } catch { return null; } },
  set: async (k: string, v: string) => { await SecureStorage.set(k, v); },
  remove: async (k: string) => { try { await SecureStorage.remove(k); } catch { /* not set */ } },
};
export function onBack(handler: () => boolean) {
  if (!isNative) return () => {};
  const h = CapApp.addListener('backButton', () => { if (!handler()) void CapApp.minimizeApp(); });
  return () => { void h.then((x) => x.remove()); };
}
export function onResume(fn: () => void) {
  if (!isNative) return () => {};
  const h = CapApp.addListener('resume', fn);
  return () => { void h.then((x) => x.remove()); };
}
