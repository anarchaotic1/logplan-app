import { useEffect, useState } from 'react';
import { db, kvGet, type Photo } from '../lib/db';
import { getMigrationReport, importV1Backup, type MigrationReport } from '../lib/migrate';
import { decryptJSON, deriveKey, encryptJSON, randomBytes, b64, unb64, type Envelope } from '../lib/crypto';
import type { Rec } from '../lib/model';
import { mergeRecords } from '../lib/merge';
import { biometricAvailable, exactAlarms, isNative, notifPermission, pendingCount, unlock } from '../lib/native';
import { useLive } from '../hooks';
import { useApp } from '../store';
import { connectGoogle, disconnectSync, syncConfigured, syncNow, unlockSync, useSync } from '../syncctl';
import { Confirm, Icon, Seg, Switch } from './common';
import { fmtBytes, photoBytes, photoStats } from '../lib/photos';
import { isoDate } from '../lib/dates';

const buf64 = (b: ArrayBuffer) => b64(new Uint8Array(b));
const un64 = (s: string) => { const u = unb64(s); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; };
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
  const [recovery, setRecovery] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [askOff, setAskOff] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); } };
  if (!syncConfigured) return <p className="small muted">Sync is not set up in this build. It needs a Google OAuth client ID (see the README, "Google Drive sync"). Everything else works without it.</p>;
  if (step === 'recovery') return <>
    <p><b>Save your recovery key now.</b> It is shown only once.</p>
    <p className="mono" style={{ wordBreak: 'break-all', fontSize: '.875rem', background: 'rgba(255,255,255,.05)', padding: 12, borderRadius: 12 }} data-testid="recovery">{recovery}</p>
    <p className="small muted">If you forget your passphrase, this key is the only other way to open your synced data. Without either, the data in your Drive cannot be recovered by anyone. Data on this device is not affected.</p>
    <div className="row"><button type="button" className="btn grow" onClick={() => { void navigator.clipboard?.writeText(recovery); say('Recovery key copied.'); }}>Copy</button>
      <button type="button" className="btn primary grow" onClick={() => { setRecovery(''); setStep('idle'); }}>I saved it</button></div>
  </>;
  if (sync.connected) return <>
    <div className="row between"><span className="row"><span className="accent"><Icon name="cloud" /></span><span>Google Drive · encrypted</span></span><span className="small muted" role="status">{sync.busy ? 'Syncing…' : sync.lastResult || 'Connected'}</span></div>
    {sync.lastSync && <p className="small muted">Last sync {new Date(sync.lastSync).toLocaleString()}</p>}
    {sync.error && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{sync.error}</p>}
    <div className="row"><button type="button" className="btn primary grow" disabled={sync.busy} onClick={() => void syncNow()}>Sync now</button>
      <button type="button" className="btn grow" onClick={() => setAskOff(true)}>Disconnect</button></div>
    {sync.photoNote && <p className="small muted" role="status">{sync.photoNote}</p>}
    <p className="small muted">Meal photos sync too, as separate encrypted files, a few at a time.</p>
    {askOff && <Confirm text="Disconnect sync on this device? Your data stays here and in your Drive." yes="Disconnect" onYes={() => { setAskOff(false); void disconnectSync(); }} onNo={() => setAskOff(false)} />}
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
    {!isNew && <button type="button" className="chip plain" onClick={() => { setUseRec(!useRec); setPass(''); }}>{useRec ? 'Use passphrase instead' : 'Use recovery key instead'}</button>}
    {err && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{err}</p>}
    <button type="button" className="btn primary block" disabled={!ok || busy} onClick={() => run(async () => { const r = await unlockSync(pass, useRec); setPass(''); setPass2(''); if (isNew) { setRecovery(r); setStep('recovery'); } else setStep('idle'); })}>{busy ? 'Working…' : isNew ? 'Turn on encrypted sync' : 'Unlock and sync'}</button>
  </>;
}

export function SettingsSheet() {
  const s = useApp((x) => x.settings), set = useApp((x) => x.setSetting), say = useApp((x) => x.say);
  const [mig, setMig] = useState<MigrationReport | null>(null);
  const [bio, setBio] = useState(false), [perm, setPerm] = useState(''), [pend, setPend] = useState(0), [exact, setExact] = useState('unsupported');
  const [photos, setPhotos] = useState({ count: 0, bytes: 0 });
  const [encPass, setEncPass] = useState<string | null>(null);
  const [pending, setPending] = useState<{ text: string; yes: string; run: () => Promise<void> } | null>(null);
  const [locked, setLocked] = useState<{ obj: any; pass: string } | null>(null);
  const count = useLive(() => db.rec.count(), [], 0);
  useEffect(() => { void getMigrationReport().then(setMig); void biometricAvailable().then(setBio); void notifPermission(false).then(setPerm); void pendingCount().then(setPend); void exactAlarms().then(setExact); void photoStats().then(setPhotos); }, []);

  const exportAll = async (pass?: string) => {
    const recs = await db.rec.toArray();
    const pics: object[] = [];
    await db.photos.each((p) => { pics.push(p); });
    for (let i = 0; i < pics.length; i++) { const p = pics[i] as Photo; const full = p.buf || (await (await photoBytes(p))?.arrayBuffer()); pics[i] = { id: p.id, createdAt: p.createdAt, mime: p.mime || p.blob?.type || 'image/jpeg', buf: full ? buf64(full) : null, thumb: p.thumb ? buf64(p.thumb) : null }; }
    const payload = { app: 'logplan', version: 6, exportedAt: new Date().toISOString(), records: recs.length, recs, photos: pics };
    const name = `logplan-backup-${isoDate(new Date())}${pass ? '.encrypted' : ''}.json`;
    if (!pass) return saveFile(name, JSON.stringify(payload));
    const salt = randomBytes(16);
    const { key } = await deriveKey(pass, salt);
    await saveFile(name, JSON.stringify({ app: 'logplan', version: 6, encrypted: true, salt: b64(salt), body: await encryptJSON(key, payload, 'backup') }));
  };
  const importObj = async (obj: any) => {
    if (!Array.isArray(obj.recs) && obj.data) { // a backup file made by v1
      setPending({ text: `This is a v1 backup from ${String(obj.exportedAt).slice(0, 10)}. Import it? Nothing already here is overwritten.`, yes: 'Import', run: async () => { const r = await importV1Backup(obj); setMig(r); say(`Imported ${r.inserted} items from v1.`); } });
      return;
    }
    if (!Array.isArray(obj.recs)) throw new Error('Backup contains no records.');
    const m = mergeRecords(await db.rec.toArray(), obj.recs as Rec[]);
    const pics = (Array.isArray(obj.photos) ? obj.photos : []) as { id: string; createdAt: number; mime: string; buf: string | null; thumb: string | null }[];
    setPending({ text: `Import ${obj.recs.length} records${pics.length ? ` and ${pics.length} photos` : ''} from ${String(obj.exportedAt).slice(0, 10)}? ${m.toLocal.length} are new or newer than what is on this device. Nothing newer here is overwritten.`, yes: 'Import', run: async () => {
      await db.rec.bulkPut(m.toLocal);
      let added = 0;
      for (const p of pics) if (p.buf && !(await db.photos.get(p.id))) { await db.photos.put({ id: p.id, createdAt: p.createdAt, mime: p.mime, buf: un64(p.buf), thumb: p.thumb ? un64(p.thumb) : undefined }); added++; }
      void photoStats().then(setPhotos);
      say(`Imported ${m.toLocal.length} records${added ? ` and ${added} photos` : ''}.`);
    } });
  };
  const importFile = async (f: File) => {
    try {
      const obj = JSON.parse(await f.text());
      if (obj.app !== 'logplan') throw new Error('Not a Log/Plan backup file.');
      if (obj.encrypted) { setLocked({ obj, pass: '' }); return; }
      await importObj(obj);
    } catch (e) { say(e instanceof Error ? e.message : 'Import failed.'); }
  };
  const unlockFile = async () => {
    if (!locked) return;
    try {
      const { key } = await deriveKey(locked.pass, unb64(locked.obj.salt));
      let obj; try { obj = await decryptJSON(key, locked.obj.body as Envelope, 'backup'); } catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
      setLocked(null); await importObj(obj);
    } catch (e) { say(e instanceof Error ? e.message : 'Import failed.'); }
  };
  return <>
    <section className="col" aria-label="You"><h3 className="label" style={{ fontWeight: 400 }}>You</h3>
      <label className="field"><span>Name (for the greeting)</span><input className="input" autoComplete="given-name" value={s.name} onChange={(e) => set('name', e.target.value)} /></label>
    </section>
    <section className="col" aria-label="Display and touch" style={{ gap: 8 }}><h3 className="label" style={{ fontWeight: 400 }}>Display and touch</h3>
      <div className="field"><span id="rm-l">Motion</span><Seg label="Motion" value={s.motion} onChange={(v) => set('motion', v)} options={[{ v: 'system', l: 'Follow phone' }, { v: 'reduce', l: 'Reduced' }, { v: 'full', l: 'Full' }]} /></div>
      <p className="small muted">Reduced replaces movement with short fades and keeps the background still.</p>
      <Switch label="Haptics (vibration on taps)" checked={s.haptics} onChange={(v) => set('haptics', v)} />
      <Switch label="Large text" checked={s.largeText} onChange={(v) => set('largeText', v)} />
    </section>
    <section className="col" aria-label="Sky and focus" style={{ gap: 8 }}><h3 className="label" style={{ fontWeight: 400 }}>Sky and focus</h3>
      <Switch label="Night sky on Today" checked={s.sky} onChange={(v) => set('sky', v)} />
      <p className="small muted">Off shows the plain 24-hour ring instead of tonight's constellation. The count is the same.</p>
      <div className="field"><span>Sky is worked out for</span><Seg label="Place for the sky" value={s.place.mode} onChange={(v) => {
        if (v === 'default') set('place', { ...s.place, mode: 'default' });
        else if (v === 'manual') set('place', { ...s.place, mode: 'manual' });
        else if (!navigator.geolocation) say('This device does not share its location. Still using Bengaluru.');
        else navigator.geolocation.getCurrentPosition((p) => { set('place', { mode: 'device', lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }); say('Location saved on this device.'); },
          () => say('Location was not shared. Nothing changed.'), { maximumAge: 3600000, timeout: 15000 });
      }} options={[{ v: 'default', l: 'Bengaluru' }, { v: 'device', l: 'Device' }, { v: 'manual', l: 'Manual' }]} /></div>
      {s.place.mode !== 'default' && <div className="row">
        <label className="field grow"><span>Latitude</span><input className="input" type="number" inputMode="decimal" step="0.01" min={-90} max={90} readOnly={s.place.mode === 'device'} value={Number.isFinite(s.place.lat) ? s.place.lat : ''} onChange={(e) => set('place', { ...s.place, lat: Math.max(-90, Math.min(90, parseFloat(e.target.value))) })} /></label>
        <label className="field grow"><span>Longitude</span><input className="input" type="number" inputMode="decimal" step="0.01" min={-180} max={180} readOnly={s.place.mode === 'device'} value={Number.isFinite(s.place.lon) ? s.place.lon : ''} onChange={(e) => set('place', { ...s.place, lon: Math.max(-180, Math.min(180, parseFloat(e.target.value))) })} /></label>
      </div>}
      <p className="small muted">Moon, sunset and constellation are computed on this device, without the network, and are approximate. The place is rounded to about a kilometre and stays in this device's settings.</p>
      <div className="field"><span>Focus length, minutes</span><Seg label="Focus length in minutes" value={String(s.focusLen)} onChange={(v) => set('focusLen', +v)} options={[15, 25, 45, 60].map((n) => ({ v: String(n), l: String(n) }))} /></div>
    </section>
    <section className="col" aria-label="Meals" style={{ gap: 8 }}><h3 className="label" style={{ fontWeight: 400 }}>Meals</h3>
      <Switch label="Show calories" checked={s.showCalories} onChange={(v) => set('showCalories', v)} />
      <div className="row">{(['protein', 'carbs', 'fat'] as const).map((k) => (
        <label key={k} className="field grow"><span>{k} g</span><input className="input" type="number" inputMode="numeric" min={1} max={999} value={s.macroTargets[k] || ''} onChange={(e) => set('macroTargets', { ...s.macroTargets, [k]: Math.max(0, Math.min(999, Math.round(+e.target.value) || 0)) })} /></label>))}</div>
      <p className="small muted">Daily macro targets for the rings on Meals. Macros and calories are optional on every meal.</p>
    </section>
    <section className="col" aria-label="Sync"><h3 className="label" style={{ fontWeight: 400 }}>Sync</h3><SyncSection /></section>
    <section className="col" aria-label="Privacy" style={{ gap: 8 }}><h3 className="label" style={{ fontWeight: 400 }}>Privacy</h3>
      <Switch label={<span className="row" style={{ gap: 8 }}><Icon name="lock" size={18} />Lock the app with fingerprint or screen lock</span>} checked={s.lock} disabled={!bio} onChange={async (on) => { if (await unlock(on ? 'Turn on app lock' : 'Turn off app lock')) set('lock', on); }} />
      {!bio && <p className="small muted">Available in the installed Android app on a device with a screen lock.</p>}
    </section>
    <section className="col" aria-label="Notifications"><h3 className="label" style={{ fontWeight: 400 }}>Notifications</h3>
      <label className="field"><span>Remind this many minutes before a block</span><select className="input" value={s.remindLead} onChange={(e) => set('remindLead', +e.target.value)}>{[0, 5, 10, 15, 30].map((h) => <option key={h} value={h}>{h}</option>)}</select></label>
      <p className="small muted" role="status">{isNative ? `Permission: ${perm} · ${pend} scheduled` : 'Reminders ring in the installed Android app. This browser version stores them but does not ring.'}</p>
      {isNative && perm !== 'granted' && <button type="button" className="btn" onClick={async () => setPerm(await notifPermission(true))}>Allow notifications</button>}
      {isNative && exact === 'denied' && <><p className="small muted">Reminders may arrive a few minutes late because Android's "Alarms & reminders" setting is off for Log/Plan.</p>
        <button type="button" className="btn" onClick={async () => setExact(await exactAlarms(true))}>Allow on-time reminders</button></>}
    </section>
    <section className="col" aria-label="Data"><h3 className="label" style={{ fontWeight: 400 }}>Data on this device</h3>
      <p className="small muted" data-testid="storage">{count} records · {photos.count} photo{photos.count === 1 ? '' : 's'}{photos.count ? `, ${fmtBytes(photos.bytes)}` : ''}. Backups include the photos.</p>
      <div className="row wrap"><button type="button" className="btn grow" onClick={() => void exportAll()}>Export backup</button><button type="button" className="btn grow" aria-expanded={encPass != null} onClick={() => setEncPass(encPass == null ? '' : null)}>Export encrypted</button></div>
      {encPass != null && <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); if (encPass) { void exportAll(encPass); setEncPass(null); } }}>
        <label className="field grow"><span>Passphrase for this file</span><input className="input" type="password" autoComplete="new-password" value={encPass} onChange={(e) => setEncPass(e.target.value)} /></label>
        <button type="submit" className="btn primary" disabled={encPass.length < 4}>Export</button>
      </form>}
      <label className="btn block" style={{ cursor: 'pointer', position: 'relative' }}>Import backup<input type="file" accept=".json,application/json" style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} /></label>
      {locked && <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); void unlockFile(); }}>
        <label className="field grow"><span>Passphrase for this backup</span><input className="input" type="password" autoComplete="current-password" value={locked.pass} onChange={(e) => setLocked({ ...locked, pass: e.target.value })} /></label>
        <button type="submit" className="btn primary" disabled={!locked.pass}>Open</button>
      </form>}
      {pending && <Confirm text={pending.text} yes={pending.yes} onYes={() => { const p = pending; setPending(null); void p.run().catch((e) => say(e instanceof Error ? e.message : 'Import failed.')); }} onNo={() => setPending(null)} />}
      <p className="small muted">Records from earlier versions that no longer have a screen (journal pages, weekly reviews, study topics) are still stored, exported and synced.</p>
      {mig?.status === 'done' && <div className="note" data-testid="migration">
        <p><b style={{ color: 'var(--text)', fontWeight: 500 }}>Moved from v1</b> on {mig.at?.slice(0, 10)}: {Object.entries(mig.byType).map(([k, v]) => `${v} ${TYPE_LABEL[k] || k}`).join(', ')}.{mig.orphanHabitLogs ? ` ${mig.orphanHabitLogs} ticks of deleted habits were left in the backup only.` : ''}{mig.warnings.length ? ` ${mig.warnings.length} unreadable item(s) skipped.` : ''}</p>
        <p style={{ marginTop: 6 }}>Your v1 data is untouched on this device, and a copy is kept here.</p>
        <button type="button" className="chip plain" style={{ marginTop: 8 }} onClick={async () => { const b = await kvGet<object | null>('v1-backup', null); if (b) await saveFile('logplan-v1-backup.json', JSON.stringify(b)); }}>Save the v1 backup file</button>
      </div>}
    </section>
    <p className="mono muted tiny" style={{ textAlign: 'center' }}>Log/Plan {__APP_VERSION__}</p>
  </>;
}
