# Technical plan and current implementation

## Runtime boundaries

The client keeps public entry light by lazy-loading `GameRoutes`, `AuthRoutes`, and `AdminRoutes` through accessible Suspense fallback/recovery. Auth and Firebase game subscriptions use deferred loading with cleanup-safe behavior. Homepage interaction does not wait for background image or deferred Firebase chunks.

Measured fixture homepage entry is **92.12 KB gzip**. Deferred Firebase is **158.49 KB gzip** in local build and **159.45 KB gzip** in emulator build output. The latter is a build warning to watch, not evidence that it loads on entry; root production-preview confirmed no Firebase/Admin/Auth chunks after homepage entrance.

## Firebase local verification design

`src/lib/firebase/client.ts` accepts validated optional `VITE_FIREBASE_*_EMULATOR_PORT` values only when emulator mode is active, retaining prior defaults otherwise. `scripts/test-firebase-e2e.ts` creates a disposable configuration under workspace output using free isolated ports and relative Functions source, builds Functions before emulator startup, and cleans only the verified workspace temporary directory. `scripts/seed-firestore.ts` respects `FIRESTORE_EMULATOR_HOST`.

Demo-only seed compatibility fills missing legacy `modality` and `answerConceptId` exactly as the fixture reader does; it preserves original content/draft/demo flags. Runtime validation, rules, schema, and production records are unchanged.

## UI implementation

The approved C shell is route-scoped. It uses generated background WebPs without baked UI, opaque surfaces, CSS tactile board layers, finite motion, static reduced-motion fallback, and role-specific layouts. Live boards use frontal tactile presentation so overlays retain hit mapping; the canonical cell geometry and team axes are unchanged.

## Operations

Run `npm run dev`, then open `http://localhost:5173`. Do not use `127.0.0.1:5173` for this project. Vite ignores `content/question-bank-v3/staging/**` and `output/**` artifacts to avoid unrelated full reloads during development.

## Release gap

Independent Gate technical review passed; production-only Google/App Check/signing/approved-release verification remain. Functions target Node 22; the local host used Node 24 and should not be treated as release-environment parity.


