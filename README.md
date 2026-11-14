# Log/Plan v2

A local-first daily planner, per-day journal and habit system. One codebase builds the Android app
(`com.hari.logplan`) and the laptop version (an installable web app). Data lives on the device in
IndexedDB and works offline. Optional sync goes through your own Google Drive, encrypted on the
device before upload.

Screenshots of every screen are in [`docs/screenshots`](docs/screenshots).

## What is in the app

| Tab | What it does |
| --- | --- |
| **Today** | 24-hour ring with one arc per block, a detailed timeline, "today's one thing", up next with cues, to-dos with carry-over, a focus timer that records actual duration, countdowns. |
| **Journal** | Morning intention, sleep times, mood and energy, free writing, a rotating evening prompt (win, lesson, if-then), tags, photos, meals, full-text search, a look back at earlier entries. |
| **Habits** | A cue for every habit, daily / per-week / count targets, rest days, a forgiving streak, 4-week consistency, a modelled automaticity curve, a 26-week heatmap. |
| **Insights** | Plan adherence, most reliable hours, planned-versus-actual factor, habits that go with good days, sleep regularity, weekly activity minutes. Computed on the device; each figure shows how much data it rests on. |
| **Plan** | Week and month views, the year orbit, a guided weekly review, study topics with spaced recall, day templates, repeating blocks, countdowns. |

Quick capture (the round button, or `N` on a laptop) adds a to-do, block, journal line or habit tick.

Every research claim the app makes is in [`src/evidence.ts`](src/evidence.ts) with its source, and is
shown in Settings. The wording is modest on purpose: these are averages from studies, not promises.

## Moving from v1 to v2

Your v1 data is never modified or deleted.

**If v2 installs over v1** (same signing key), v2 reads the v1 database on first launch, keeps a
backup copy, and converts everything. Settings shows what was moved.

**If Android refuses to install v2 over v1** ("App not installed" or a signature conflict), that is
because v1 builds were signed with a different, throwaway key each time. Do this instead:

1. In v1, open **Week → Data → Export backup** and keep the file (the GitHub Gist backup also works: download `logplan-backup.json`).
2. Uninstall v1, install v2.
3. In v2, open **Settings → Import backup** and choose that file.

From v2 on, every build is signed with one fixed key, so this is the last time.

What is converted: each hour row with text becomes a one-hour block (the old "12 AM" last row becomes
00:00 of the next day), to-dos keep their time and reminder, habits keep their ticks and reminder,
plus meals, the meal catalogue, countdowns and weekly reflections. Ticks that belonged to habits you
had deleted stay in the backup only. The GitHub token is not copied, and the Gist backup is no longer used.

## Develop

Requirements: Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (migration, merge, crypto, dates, habits, sync, contrast)
npm run build      # type-check and build to dist/
npm run e2e        # browser tests at phone and laptop size (needs Google Chrome)
npm run perf       # frame timings of the main animations under 4x CPU throttling
```

`npm run e2e` uses the installed Google Chrome. To use another Chromium, set `CHROME_PATH`.

Code map: `src/lib` is plain TypeScript with tests (`migrate`, `merge`, `sync`, `crypto`, `dates`,
`habits`, `insights`, `notif`, `spaced`, `hlc`, `db`). `src/ui` holds the screens. `legacy/v1` is the
old single-file app, kept for reference.

## The four things only you can do

### 1. Signing key (once)

```bash
./scripts/make-keystore.sh          # writes ~/logplan-release.keystore and prints the next steps
```

Keep the keystore file and its password somewhere safe (not in the repo). If you lose it, future
builds cannot update the installed app.

### 2. GitHub secrets and variable

In the repository: **Settings → Secrets and variables → Actions**.

Secrets:

| Name | Value |
| --- | --- |
| `LP_KEYSTORE_BASE64` | output of `base64 -w0 ~/logplan-release.keystore` |
| `LP_KEYSTORE_PASSWORD` | the keystore password |
| `LP_KEY_ALIAS` | `logplan` |
| `LP_KEY_PASSWORD` | the same password |

Variable (Variables tab): `GOOGLE_WEB_CLIENT_ID` = the Web client ID from step 3. Client IDs are
public values, so a variable is fine.

### 3. Google Drive sync (optional; the app works fully without it)

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project. Under **APIs & Services → Library**, enable **Google Drive API**.
2. **OAuth consent screen**: External, add your own Google account under **Test users**. Add the scope `https://www.googleapis.com/auth/drive.appdata`.
3. **Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorised JavaScript origins* add your Pages URL origin (for example `https://anarchaotic1.github.io`) and `http://localhost:5173` for development. Copy the client ID: this is `GOOGLE_WEB_CLIENT_ID`.
4. **Create credentials → OAuth client ID → Android**. Package name `com.hari.logplan`, SHA-1 = the fingerprint printed by `make-keystore.sh`. Nothing to copy; it only has to exist in the same project.

For local development, copy `.env.example` to `.env` and put the Web client ID in it.

How sync works: data goes to Drive's hidden *appDataFolder* (scope `drive.appdata`, the narrowest
available; the files do not appear in your Drive and other apps cannot read them). Everything is
encrypted before upload with AES-256-GCM. The key is derived from your passphrase with
PBKDF2-HMAC-SHA256, 600,000 iterations, and a random 16-byte salt. On Android the key is kept in the
Android Keystore; in the browser it is a non-extractable key. Records merge one by one, the latest
edit wins, and deletes sync too. Files are split by month so a sync only moves what changed.

**If you forget the passphrase and lose the recovery key, the copy in Drive cannot be recovered by
anyone.** The data on your devices is not affected; you can disconnect, and set sync up again.

Not synced: journal photos (they stay on the device where you added them) and settings.

### 4. GitHub Pages (laptop version)

**Settings → Pages → Build and deployment → Source: GitHub Actions.** The `Deploy laptop version`
workflow publishes `main`. Open the URL in Chrome or Edge and choose **Install** to get an app window.
It works offline after the first visit.

## Build the Android app

**On GitHub (no local setup):** push to `main` or `v2-rebuild`, or run the *Test and build* workflow by
hand. It runs the tests, builds a signed release APK, and uploads it as the artifact
`logplan-release-apk`. The version code is `200000 + run number`, so each build is newer than the last.

**Locally:** needs JDK 21 and the Android SDK (Android Studio installs both).

```bash
# once: android/keystore.properties (git-ignored)
#   storeFile=/home/you/logplan-release.keystore
#   storePassword=…
#   keyAlias=logplan
#   keyPassword=…
npm run android:apk       # → android/app/build/outputs/apk/release/app-release.apk
```

The build refuses to make a release APK without the fixed key, because an APK signed with any other
key cannot update the installed app.

After changing the icon source in `scripts/make-assets.mjs`, run `npm run assets`.

## Android notes

- **Notifications:** Android 13+ asks for permission the first time you set a reminder. Reminders are
  scheduled 30 days ahead and topped up whenever the app opens; if the app is not opened for 30 days,
  one notice says so. On Android 12+, on-time delivery needs the "Alarms & reminders" setting; Settings
  in the app shows a button when it is off. Without it reminders still arrive, possibly a few minutes late.
- **App lock:** Settings → Privacy uses the fingerprint or the screen lock.
- **Back button:** closes an open sheet, then returns to Today, then leaves the app.
- **Portrait only** on the phone. The laptop version is the web build.
- Built with Capacitor 8 (min Android 7.0, API 24).

## Known limits

- Sync has no server-side locking. If two devices upload the same month at the same instant, the next sync on either device repairs it (covered by a test).
- Deletes are remembered for 180 days. A device that stays offline longer than that could bring a deleted item back.
- Insights are correlations in your own data, not causes.
