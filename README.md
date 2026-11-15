# Log/Plan v2.1

A local-first app for daily planning and tracking. One codebase builds the Android app
(`com.hari.logplan`) and the laptop version (an installable web app). Data lives on the device in
IndexedDB and works offline. Optional sync goes through your own Google Drive, encrypted on the
device before upload.

Screenshots of every screen are in [`docs/screenshots`](docs/screenshots).

## What is in the app

Four tabs and a quick-capture button. Settings opens from the gear in the Today header.

| Tab | What it does |
| --- | --- |
| **Today** | 24-hour ring with one arc per block, the block list and an hour-by-hour view, to-dos with carry-over, the morning intention, habit ticks, sleep (drag the moon and sun handles, or type the times), countdowns. Swipe the date line or use the arrows to move to another day. |
| **Calendar** | A month grid with a completion ring per day and marks for meals, sleep and countdowns. Tap a day to open it in full and edit anything. One search box finds blocks, to-dos, meals and intentions on any day. **Setup** (countdowns, day templates, repeating blocks and to-dos, day-start hour, categories) is the second segment at the top. |
| **Meals** | Meals for the day with a time and a kind, favourites that add with one tap, and photos from the camera or gallery. |
| **Habits** | A tick for today, the week strip, a forgiving streak (one missed day does not end it), 4-week consistency and a year heatmap. |

**Completing things takes one tap.** Every block and to-do has its own check. You can also swipe a
row to the right, or on a laptop press `X` on a focused row (or `Space` on its title). Every
completion and every delete can be undone from the notice that appears.

Quick capture is the round button, or `N` on a laptop. Other keys: `1`–`4` change tab, `T` goes to
today, `←` `→` change day, `/` searches.

### Changed from v2.0

The Journal, Insights and Plan tabs, the weekly review, study mode, the year orbit and the "Why this
works" notes are no longer in the interface. **Nothing was deleted:** journal text, mood, tags,
weekly reviews and study topics written in v2.0 stay in the database, in backups and in sync
(`tests/upgrade.test.ts` and `e2e/upgrade.spec.ts` check this). v2.1 installs over v2.0 and keeps
all data.

### Look and motion

Near-black theme with one accent, ember amber. The accent is a single token: change `--accent` at the
top of `src/styles.css` and every tint, glow and the background follow. `docs/palette-options.png`
shows the three candidates on the real Today screen (`npm run palette` redraws it).

The background is one WebGL2 shader, a slow supernova: a core, faint filaments, thin rings and a few
drifting particles. The core brightens as the day gets done, and completing something sends a ring
out from the check you tapped. It runs at about half resolution and 30 frames a second, pauses when
the app is hidden, and falls back by itself to a still frame if the device cannot keep up, or to a
plain gradient without WebGL2. Its brightness has a hard ceiling so text stays readable over it.

### Accessibility

- Settings has **Motion** (follow phone / reduced / full), **Haptics** and **Large text**. Reduced motion replaces movement with short fades and holds the background still.
- Controls are at least 48 px, body text is 16 px, and nothing is smaller than 12 px. Layout is tested at 200% text and 400% zoom.
- Every control has a name; sheets trap focus and give it back; Escape and the Android back button close them; completions, undo and saves are announced to screen readers.
- Gestures always have a button: the check for swiping, typed times for the sleep arc, a close button for the photo viewer.
- `npm run e2e` runs axe on every screen at phone and laptop size and fails on serious or critical findings. It also measures text contrast over the brightest pixel of the background.
- Not tested: TalkBack on a real phone.

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
npm test           # unit tests (migration, upgrade from v2.0, merge, crypto, dates, habits, sync, photos, search, contrast)
npm run build      # type-check and build to dist/
npm run e2e        # browser tests at phone and laptop size (needs Google Chrome)
npm run perf       # frame timings of the main animations under 4x CPU throttling
npm run palette    # redraws docs/palette-options.png
```

`npm run e2e` uses the installed Google Chrome. To use another Chromium, set `CHROME_PATH`.

Code map: `src/lib` is plain TypeScript with tests (`migrate`, `merge`, `sync`, `crypto`, `dates`,
`habits`, `notif`, `photos`, `search`, `day`, `nova`, `hlc`, `db`). `src/ui` holds the screens. `legacy/v1` is the
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

Meal photos are downscaled to 1280 px when added and sync too, each as its own encrypted file, a few
per sync. Uploading stops once a device holds more than 500 MB of photos; Settings shows how much
space photos use. Backups (Settings → Export) include the photos. Not synced: settings.

### 4. GitHub Pages (laptop version)

**Settings → Pages → Build and deployment → Source: GitHub Actions.** The `Deploy laptop version`
workflow publishes `main`. Open the URL in Chrome or Edge and choose **Install** to get an app window.
It works offline after the first visit.

## Build the Android app

**On GitHub (no local setup):** push to `main`, `v2-rebuild` or `v2-redesign`, or run the *Test and build* workflow by
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
- **Back button:** closes a photo, a sheet or an opened calendar day, then returns to Today, then leaves the app.
- **Photos:** camera and gallery use the system picker, so the app needs no camera or storage permission.
- **Portrait only** on the phone. The laptop version is the web build.
- Built with Capacitor 8 (min Android 7.0, API 24).

## Known limits

- Sync has no server-side locking. If two devices upload the same month at the same instant, the next sync on either device repairs it (covered by a test).
- Deletes are remembered for 180 days. A device that stays offline longer than that could bring a deleted item back.
- The week starts on Monday.
- Performance figures in `docs/perf-4x-throttle.json` come from desktop Chrome with the CPU slowed 4x, not from a phone.
