import { useEffect, useState } from 'react';
import { db, kvGet } from '../lib/db';
import { getMigrationReport, type MigrationReport } from '../lib/migrate';
import { decryptJSON, deriveKey, encryptJSON, randomBytes, b64, unb64, type Envelope } from '../lib/crypto';
import type { Rec } from '../lib/model';
import { mergeRecords } from '../lib/merge';
import { biometricAvailable, isNative, notifPermission, pendingCount, unlock } from '../lib/native';
import { useLive } from '../hooks';
import { useApp } from '../store';
import { connectGoogle, disconnectSync, syncConfigured, syncNow, unlockSync, useSync } from '../syncctl';
import { EVIDENCE } from '../evidence';
import { Icon } from './common';
import { isoDate } from '../lib/dates';

const TYPE_LABEL: Record<string, string> = { block: 'blocks', todo: 'to-dos', meal: 'meals', habit: 'habits', habitLog: 'habit ticks', countdown: 'countdowns', mealCat: 'saved meals', weekReview: 'weekly reviews' };
function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function saveFile(name: string, text: string) {
  if (isNative) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const res = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, url: res.uri }).catch(() => {});
  } else download(name, text);
}

function SyncSection() {
  const sync = useSync();
  const say = useApp((s) => s.say);
  const [step, setStep] = useState<'idle' | 'new' | 'existing' | 'recovery'>('idle');
  const [pass, setPass] = useState(''), [pass2, setPass2] = useState(''), [useRec, setUseRec] = useState(false);
  const [recovery, setRecovery] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); } };
  if (!syncConfigured) return <p className="small muted">Sync is not set up in this build. It needs a Google OAuth client ID (see the README, "Google Drive sync"). Everything else works without it.</p>;
  if (step === 'recovery') return <>
    <p><b>Save your recovery key now.</b> It is shown only once.</p>
    <p className="mono" style={{ wordBreak: 'break-all', fontSize: 13, background: 'rgba(255,255,255,.05)', padding: 12, borderRadius: 12 }} data-testid="recovery">{recovery}</p>
    <p className="small muted">If you forget your passphrase, this key is the only other way to open your synced data. Without either, the data in your Drive cannot be recovered by anyone. Data on this device is not affected.</p>
    <div className="row"><button type="button" className="btn grow" onClick={() => { void navigator.clipboard?.writeText(recovery); say('Recovery key copied.'); }}>Copy</button>
      <button type="button" className="btn primary grow" onClick={() => { setRecovery(''); setStep('idle'); }}>I saved it</button></div>
  </>;
  if (sync.connected) return <>
    <div className="row between"><span className="row"><span className="accent"><Icon name="cloud" /></span><span>Google Drive · encrypted</span></span><span className="small muted" role="status">{sync.busy ? 'Syncing…' : sync.lastResult || 'Connected'}</span></div>
    {sync.lastSync && <p className="small muted">Last sync {new Date(sync.lastSync).toLocaleString()}</p>}
    {sync.error && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{sync.error}</p>}
    <div className="row"><button type="button" className="btn primary grow" disabled={sync.busy} onClick={() => void syncNow()}>Sync now</button>
      <button type="button" className="btn grow" onClick={() => { if (confirm('Disconnect sync on this device? Your data stays here and in your Drive.')) void disconnectSync(); }}>Disconnect</button></div>
  </>;
  if (step === 'idle') return <>
    <p className="small muted">Sync between your phone and laptop through a hidden app folder in your own Google Drive. Everything is encrypted on this device before upload; Google cannot read it.</p>
    <button type="button" className="btn primary block" disabled={busy} onClick={() => run(async () => setStep(await connectGoogle()))}><Icon name="cloud" size={18} />{busy ? 'Connecting…' : 'Connect Google Drive'}</button>
    {err && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{err}</p>}
  </>;
  const isNew = step === 'new';
  const ok = useRec ? pass.replace(/[^0-9a-f]/gi, '').length === 64 : isNew ? pass.length >= 10 && pass === pass2 : pass.length > 0;
  return <>
    <p className="small muted">{isNew ? 'Choose a passphrase of at least 10 characters. It encrypts your data and is never sent anywhere. If you forget it and lose the recovery key, the synced copy cannot be recovered.' : 'This Drive already has Log/Plan data. Enter the passphrase you chose on your other device.'}</p>
    <label className="field"><span>{useRec ? 'Recovery key' : 'Passphrase'}</span><input className="input" type={useRec ? 'text' : 'password'} autoComplete={isNew ? 'new-password' : 'current-password'} value={pass} onChange={(e) => setPass(e.target.value)} /></label>
    {isNew && <label className="field"><span>Repeat passphrase</span><input className="input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>}
    {!isNew && <button type="button" className="chip" onClick={() => { setUseRec(!useRec); setPass(''); }}>{useRec ? 'Use passphrase instead' : 'Use recovery key instead'}</button>}
    {err && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{err}</p>}
    <button type="button" className="btn primary block" disabled={!ok || busy} onClick={() => run(async () => { const r = await unlockSync(pass, useRec); setPass(''); setPass2(''); if (isNew) { setRecovery(r); setStep('recovery'); } else setStep('idle'); })}>{busy ? 'Working…' : isNew ? 'Turn on encrypted sync' : 'Unlock and sync'}</button>
  </>;
}

export function SettingsSheet() {
  const s = useApp((x) => x.settings), set = useApp((x) => x.setSetting), say = useApp((x) => x.say);
  const [mig, setMig] = useState<MigrationReport | null>(null);
  const [bio, setBio] = useState(false), [perm, setPerm] = useState(''), [pend, setPend] = useState(0);
  const count = useLive(() => db.rec.count(), [], 0);
  useEffect(() => { void getMigrationReport().then(setMig); void biometricAvailable().then(setBio); void notifPermission(false).then(setPerm); void pendingCount().then(setPend); }, []);

  const exportAll = async (encrypt: boolean) => {
    const recs = await db.rec.toArray();
    const payload = { app: 'logplan', version: 5, exportedAt: new Date().toISOString(), records: recs.length, recs };
    const name = `logplan-backup-${isoDate(new Date())}${encrypt ? '.encrypted' : ''}.json`;
    if (!encrypt) return saveFile(name, JSON.stringify(payload));
    const pass = prompt('Passphrase for this backup file (you will need it to import):');
    if (!pass) return;
    const salt = randomBytes(16);
    const { key } = await deriveKey(pass, salt);
    await saveFile(name, JSON.stringify({ app: 'logplan', version: 5, encrypted: true, salt: b64(salt), body: await encryptJSON(key, payload, 'backup') }));
  };
  const importFile = async (f: File) => {
    try {
      let obj = JSON.parse(await f.text());
      if (obj.app !== 'logplan') throw new Error('Not a Log/Plan backup file.');
      if (obj.encrypted) { const pass = prompt('Passphrase for this backup:'); if (!pass) return; const { key } = await deriveKey(pass, unb64(obj.salt)); try { obj = await decryptJSON(key, obj.body as Envelope, 'backup'); } catch { throw new Error('Wrong passphrase, or the file is damaged.'); } }
      if (!Array.isArray(obj.recs)) throw new Error(obj.data ? 'This is a v1 backup. Install v1 data on this device first, or import it in v1.' : 'Backup contains no records.');
      const m = mergeRecords(await db.rec.toArray(), obj.recs as Rec[]);
      if (!confirm(`Import ${obj.recs.length} records from ${String(obj.exportedAt).slice(0, 10)}? ${m.toLocal.length} are new or newer than what is on this device; nothing newer here is overwritten.`)) return;
      await db.rec.bulkPut(m.toLocal);
      say(`Imported ${m.toLocal.length} records.`);
    } catch (e) { say(e instanceof Error ? e.message : 'Import failed.'); }
  };
  return <>
    <section className="col"><span className="label">You</span>
      <label className="field"><span>Name (for the greeting)</span><input className="input" value={s.name} onChange={(e) => set('name', e.target.value)} /></label>
      <div className="row">
        <label className="field grow"><span>Day starts at</span><select className="input" value={s.startHour} onChange={(e) => set('startHour', +e.target.value)}>{[0, 1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
        <label className="field grow"><span>Reminder lead (min)</span><select className="input" value={s.remindLead} onChange={(e) => set('remindLead', +e.target.value)}>{[0, 5, 10, 15, 30].map((h) => <option key={h} value={h}>{h}</option>)}</select></label>
      </div>
      <p className="small muted">Before the day-start hour, the app still treats the previous date as today.</p>
    </section>
    <section className="col"><span className="label">Sync</span><SyncSection /></section>
    <section className="col"><span className="label">Privacy</span>
      <label className="row between" style={{ minHeight: 44 }}><span><Icon name="lock" size={16} /> Lock app with fingerprint or screen lock</span>
        <input type="checkbox" checked={s.lock} disabled={!bio} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} onChange={async (e) => { const on = e.target.checked; if (await unlock(on ? 'Turn on app lock' : 'Turn off app lock')) set('lock', on); }} /></label>
      {!bio && <p className="small muted">Available in the installed Android app on a device with a screen lock.</p>}
      <p className="small muted">Mood and energy are a personal log, not a clinical tool. If you are struggling, please talk to someone you trust or a professional.</p>
    </section>
    <section className="col"><span className="label">Notifications</span>
      <p className="small muted" role="status">{isNative ? `Permission: ${perm} · ${pend} scheduled` : 'Reminders ring in the installed Android app. This browser version stores them but does not ring.'}</p>
      {isNative && perm !== 'granted' && <button type="button" className="btn" onClick={async () => setPerm(await notifPermission(true))}>Allow notifications</button>}
    </section>
    <section className="col"><span className="label">Data · {count} records on this device</span>
      <div className="row wrap"><button type="button" className="btn grow" onClick={() => void exportAll(false)}>Export backup</button><button type="button" className="btn grow" onClick={() => void exportAll(true)}>Export encrypted</button></div>
      <label className="btn block" style={{ cursor: 'pointer' }}>Import backup<input type="file" accept=".json,application/json" style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} /></label>
      {mig?.status === 'done' && <div className="why" data-testid="migration">
        <p><b>Moved from v1</b> on {mig.at?.slice(0, 10)}: {Object.entries(mig.byType).map(([k, v]) => `${v} ${TYPE_LABEL[k] || k}`).join(', ')}.{mig.orphanHabitLogs ? ` ${mig.orphanHabitLogs} ticks of deleted habits were left in the backup only.` : ''}{mig.warnings.length ? ` ${mig.warnings.length} unreadable item(s) skipped.` : ''}</p>
        <p style={{ marginTop: 6 }}>Your v1 data is untouched on this device, and a copy is kept inside v2.</p>
        <button type="button" className="chip" style={{ marginTop: 8 }} onClick={async () => { const b = await kvGet<object | null>('v1-backup', null); if (b) await saveFile('logplan-v1-backup.json', JSON.stringify(b)); }}>Save the v1 backup file</button>
      </div>}
    </section>
    <section className="col"><span className="label">Evidence behind the features</span>
      {EVIDENCE.map((e) => <details key={e.id} className="why"><summary style={{ cursor: 'pointer', minHeight: 24 }}><b>{e.feature}</b></summary><p style={{ marginTop: 8 }}>{e.claim}</p><p className="mono" style={{ fontSize: 11, marginTop: 8 }}>{e.source}</p></details>)}
      <p className="small muted">These are averages from research, not promises. Nothing here is medical advice.</p>
    </section>
    <p className="mono muted" style={{ fontSize: 11, textAlign: 'center' }}>Log/Plan 2.0.0</p>
  </>;
}
