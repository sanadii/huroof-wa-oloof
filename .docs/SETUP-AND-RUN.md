# Setup and run

## Development server

For the full local multiplayer fixture experience, opt in to the local runtime in the current PowerShell session:

```powershell
$env:VITE_GAME_RUNTIME = 'local'
npm run dev
```

The current task-owned preview is **http://127.0.0.1:8787**, with the imported SQLite bank enabled for explicitly labelled local test games. Open `/host/new` to test Huroof or Categories, or `/local-import-review` to inspect all intake records. It serves the built app and multiplayer traffic together. To recreate it after stopping the existing task process:

```powershell
$env:VITE_GAME_RUNTIME = 'local'
npm run build
$env:PORT = '8787'
$env:GAME_HOST = '127.0.0.1'
$env:LOCAL_DB_QUESTION_SOURCE = 'sqlite-import'
$env:GAME_DB_PATH = Join-Path $env:TEMP 'huroof-wa-oloof-local-game.sqlite'
npm run start:local
```

Confirm port ownership before launching; do not start a second server on an occupied port. Rebuild after source changes because this preview serves `dist`. For source-live development, run the authority separately and bind Vite to a verified free port such as `npx vite --host 127.0.0.1 --port 5188 --strictPort`. Do not use port 5173 in this environment: it belongs to unrelated user work, and hostname spelling does not establish ownership.

As of 2026-09-11, this local test source reads 7,193 imported SQLite rows plus 280 preserved file records: 6,813 usable text/identity questions and 660 held records. All 87 stored categories appear in the catalog; 78 are ready for category games and 9 are held-only. Inventory and new-room requests refresh SQLite automatically. It changes no approvals. With no Huroof categories selected, setup uses an imported scope with verified letter coverage; for a quick Categories test select `huroof-068` and `huroof-069`. Existing rooms retain their source snapshot during in-process refresh; create a new room after a server restart. To return to the old file-only demo source, remove `LOCAL_DB_QUESTION_SOURCE` and restart the owned authority.

### T17 media update — 2026-09-11

The current SQLite-backed app at **http://127.0.0.1:8787** includes 88 catalog categories, all 99 `goals-2026` questions and 291 verified PNG/JPEG image bindings. These counts supersede the earlier media-held inventory above; separate imports can increase the text totals. Select **من سجل الهدف؟** for goal videos or **خمن الصورة** for verified photos. The host's **إظهار الإجابة** action reveals the answer and switches both host/display to the clear clip. Goal questions are category-mode only. Huroof recommendations now use the actual classic selector, including concept reserves.

Keep the ignored `content/question-media/` packages on the server: the database stores references rather than file bytes. Missing media stays unavailable. Original clips remain under the ignored `resources/100-best-goals-2026-clips/` directory. [T17 plan and verification](T17-QUESTION-MEDIA.md) records media preparation and rollback. Production Firebase/Vercel activation remains separate and is not provided by a static preview.

### Local private-import demo source (two terminals)

This read-only local demo source is opt-in. It reads only the pinned private Firestore import through the server's Firebase CLI credentials, keeps question content server-side, and never activates a production release. Use the following two terminals together; `8797` avoids the existing authority on `8787`.

```powershell
# Terminal 1 — local authority and bounded, read-only Firestore source
$env:LOCAL_DB_QUESTION_SOURCE = 'firestore-import'
$env:LOCAL_DB_TRUSTED_ORIGINS = 'http://127.0.0.1:5199'
$env:PORT = '8797'
$env:GAME_HOST = '127.0.0.1'
npm run start:local
```

```powershell
# Terminal 2 — browser development server, proxied only to Terminal 1
$env:VITE_GAME_RUNTIME = 'local'
$env:LOCAL_DB_QUESTION_SOURCE = 'firestore-import'
$env:LOCAL_GAME_SERVER_PORT = '8797'
npx vite --host 127.0.0.1 --port 5199 --strictPort
```

Open `http://127.0.0.1:5199`. The setup page labels this inventory as imported demo content; leave demo mode enabled. If the server cannot verify its pinned records, it fails to start rather than falling back to fixtures.

### Joining from phones on the same network

Keep the normal local command for one-computer work. To let players scan a host QR code on the same LAN, start a separate local session with an address that their phones can reach:

```powershell
$env:VITE_GAME_RUNTIME = 'local'
$env:VITE_ALLOW_LAN = 'true'
$env:VITE_PUBLIC_JOIN_ORIGIN = 'http://192.168.1.10:5173'
npm run dev
```

Replace the example address with the host computer's actual LAN address. The QR panel refuses `localhost` because it is not reachable from a phone. The browser still proxies game traffic to the loopback-only local authority; direct remote calls to every `/api/admin` path are rejected before proxying. Do not enable LAN listening on an untrusted network.

`.env.example` intentionally retains `VITE_GAME_RUNTIME=fixture` as the safe default. Set `local` only for local multiplayer work; set `firebase` only with explicit emulator/browser configuration below.

## Environment

Firebase web config values are public identifiers but real values must not be committed:

```dotenv
VITE_GAME_RUNTIME=fixture
VITE_PUBLIC_JOIN_ORIGIN=
VITE_ALLOW_LAN=false
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_FUNCTIONS_REGION=me-central2
VITE_FIREBASE_APP_CHECK_SITE_KEY=
VITE_USE_FIREBASE_EMULATORS=false
```

For Firebase **emulators only**, use `VITE_GAME_RUNTIME=firebase` and `VITE_USE_FIREBASE_EMULATORS=true`. Optional overrides are read only in emulator mode and preserve normal defaults if blank:

```dotenv
VITE_FIREBASE_AUTH_EMULATOR_PORT=
VITE_FIREBASE_FIRESTORE_EMULATOR_PORT=
VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT=
VITE_FIREBASE_STORAGE_EMULATOR_PORT=
```

Use explicit demo project `demo-huroof-wa-oloof` for emulator work; never rely on a default alias or production project.

## Checks

```powershell
npm run typecheck
npm run lint
npm run test:ui
npm run test:game
npm run functions:test
npm run test:content
npm run scan:visual
npm run build
npm run test:firebase-rules
npm run test:e2e:firebase
```

The Firebase E2E harness builds Functions, creates a disposable config under `output/firebase-e2e-*`, uses isolated ports (Auth 19099, Firestore 18080, Functions 15001, Storage 19199, hub 14400, logging 14500), and cleans only that verified workspace output directory. It needs Java; this machine used Android Studio JBR Java 21. Do not run it while another user owns an emulator session.

Vite ignores artifact-only `content/question-bank-v3/staging/**` and `output/**` to avoid unrelated HMR reloads. Keep generated evidence and emulator output out of application source.
