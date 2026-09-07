# Setup and run

## Development server

For the full local multiplayer fixture experience, opt in to the local runtime in the current PowerShell session:

```powershell
$env:VITE_GAME_RUNTIME = 'local'
npm run dev
```

Open **http://localhost:5173**. This starts the local server and Vite. Do not use `127.0.0.1:5173`, which belongs to unrelated user work in this environment.

`.env.example` intentionally retains `VITE_GAME_RUNTIME=fixture` as the safe default. Set `local` only for local multiplayer work; set `firebase` only with explicit emulator/browser configuration below.

## Environment

Firebase web config values are public identifiers but real values must not be committed:

```dotenv
VITE_GAME_RUNTIME=fixture
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
