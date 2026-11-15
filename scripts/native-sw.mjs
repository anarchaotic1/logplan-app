// The Android app carries its files inside the APK, so it must not keep an offline copy of its own.
// Replaces the browser build's service worker (dist/sw.js) with one that removes itself: when an installed copy of an
// earlier version checks for an update, it receives this file, clears its caches, unregisters, and reloads the open app.
// Run after `npm run build` and before `cap sync` (the android:sync script and CI do this).
import { writeFileSync, rmSync, existsSync } from 'node:fs';
writeFileSync('dist/sw.js', `// Log/Plan Android: removes any service worker left by an earlier version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
`);
for (const f of ['dist/registerSW.js']) if (existsSync(f)) rmSync(f);
console.log('dist/sw.js replaced by the self-removing worker');
