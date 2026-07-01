# Log/Plan — Android build

This is a Capacitor wrapper around `www/index.html` — the app itself is unchanged,
this just gives it a native Android shell so it can be installed as a `.apk`
outside the browser, with real on-device storage (IndexedDB) that has nothing
to do with Claude or claude.ai.

## Option A — Build it yourself locally (you've done this before with ClassOrbit)

Requirements: Node.js, Android Studio (for the SDK), Java 17+.

```bash
npm install
npx cap add android
npx cap sync android
```

Then either:
- Open in Android Studio: `npx cap open android` → Build > Build Bundle(s)/APK(s) > Build APK(s)
- Or from the CLI: `cd android && ./gradlew assembleDebug`

The installable file lands at:
`android/app/build/outputs/apk/debug/app-debug.apk`

Copy that to your phone (USB, Drive, email, whatever) and open it. You'll need
**Settings → Install unknown apps** enabled for whichever app you use to open the file
— standard Android requirement for anything outside the Play Store, not specific to this app.

This is a **debug build** — no signing keystore needed, which is the easy path for personal use.
If you ever want to publish it or need a signed release build, that's a separate step
(`assembleRelease` + a keystore) — say the word if you get there and I'll walk you through it.

## Option B — Build it with zero local setup, via GitHub Actions

If you don't want to touch Android Studio at all:

1. Push this folder to a new GitHub repo (public or private, either works).
2. GitHub will automatically run `.github/workflows/build-apk.yml` on push to `main`
   (or trigger it manually from the Actions tab → "Build Android APK" → "Run workflow").
3. When it finishes (~3-5 min), open the workflow run → **Artifacts** → download `logplan-debug-apk`.
4. Unzip it — that's your `app-debug.apk`. Transfer to your phone and install as above.

This path builds on GitHub's servers, so it works even if your machine has no
Android SDK installed at all.

## What's already configured for Android

- **Portrait lock** — applied automatically by the GitHub Actions workflow;
  if building locally, add `android:screenOrientation="portrait"` to the
  `<activity>` tag in `android/app/src/main/AndroidManifest.xml` after `cap add android`.
- **Status bar color** — matches the app's light/dark theme (`capacitor.config.json`).
- **Hardware back button** — first press returns to the Today tab if you're elsewhere,
  second press minimizes the app (standard Android behavior, not an exit-crash).
- **App icon / splash screen** — not set yet, so it'll use Capacitor's default.
  To use your own: drop a 1024×1024 PNG at `assets/icon.png`, then run
  `npx @capacitor/assets generate --android` before syncing.

## Data & memory

All data (plan/log entries, meals, habits, countdowns, theme) is stored in
IndexedDB inside the app's own storage — private to this app, persists across
restarts, survives app updates, and has zero dependency on Claude or the internet.
It does **not** sync across devices; it's local to whichever phone has the app installed.
