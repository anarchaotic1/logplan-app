import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-mono/latin-400.css';
import './styles.css';
import { App } from './App';
import { useApp } from './store';
import { runMigration } from './lib/migrate';
import { setNode } from './lib/hlc';
import { kvGet, kvSet } from './lib/db';
import { uid } from './lib/model';
import { initSync } from './syncctl';

async function boot() {
  let node = await kvGet<string>('node', '');
  if (!node) { node = uid('d').slice(0, 8); await kvSet('node', node); }
  setNode(node);
  try {
    const r = await runMigration();
    if (r.status === 'done' && !(await kvGet('migrationSeen', false))) {
      await kvSet('migrationSeen', true);
      setTimeout(() => useApp.getState().say(`Welcome to Log/Plan 2. ${r.inserted} items moved from v1; your old data is untouched.`, { label: 'Details', run: () => useApp.getState().open('settings') }), 1200);
    }
  } catch (e) { console.error('migration', e); setTimeout(() => useApp.getState().say('Could not read your v1 data. It is untouched; see Settings.'), 1200); }
  await useApp.getState().load();
  void initSync();
  // Ask the browser not to evict our storage under pressure.
  void navigator.storage?.persist?.();
}
createRoot(document.getElementById('root')!).render(<App />);
void boot();
