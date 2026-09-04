# Firebase project binding and local development

The Firebase CLI default alias remains the isolated demo project, `demo-huroof-wa-oloof`; the explicit `demo` alias maps to the same project. The existing production project is available only as the explicit `production` alias, `huroof-a3ee7`, and its environment is tagged Production. Any future cloud CLI read must pass `--project huroof-a3ee7` explicitly. The registered Firebase Web App is `Huroof wa Oloof Web` (`1:245740172770:web:fb993688f23b46a2a935bb`); its local SDK configuration is present in ignored `.env.local`. The default `fixture` browser setting preserves the local Node room service for ordinary development; Firebase is an explicit emulator-only runtime selection and is not deployed to Spark.

## Production project record

The production Firestore database is `(default)`, Standard edition / Native mode, ready in `me-central2`. Anonymous Firebase Authentication is enabled and the repository `firestore.rules` are published. Two single-field collection-group index exemptions are configured: `events.revision` ascending and `intentReceipts.createdAt` descending. Scheduled backups and point-in-time recovery are unavailable on Spark. Callable Functions are configured to use `me-central2` but remain undeployed because the Firebase Console requires a paid upgrade.

Firebase MCP is registered globally with a pinned `firebase-tools@15.29.0` command, scoped to this repository, and a read-only tool allowlist: environment, project, app inventory, SDK configuration, security-rule inspection, and Firestore collection queries. It cannot create apps, deploy, alter rules, or write Firestore. Authenticate separately through the Firebase MCP OAuth flow before using it; the first approved use should be limited to project/app inventory and configuration inspection. Do not use an implicit project for a future cloud read; use the Firebase CLI with `--project huroof-a3ee7`.

## Emulator isolation

Every emulator command must explicitly target `demo-huroof-wa-oloof`; never rely on the Firebase CLI default alias. The browser does not attach to emulators merely because a `demo-*` project id is present: set `VITE_USE_FIREBASE_EMULATORS=true` explicitly when an intentionally configured browser client is later approved.

## Local commands

```powershell
npm install
npm run build:firestore-release:dry-run
npm run seed:firestore:dry-run
npx firebase emulators:start --project demo-huroof-wa-oloof
# In a second terminal after the emulator starts:
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:GCLOUD_PROJECT='demo-huroof-wa-oloof'
npm run seed:firestore -- --demo
# This npm script itself passes --project demo-huroof-wa-oloof to emulators:exec.
npm run test:firestore-rules

npm run functions:build
npm run functions:test
npm run test:e2e:firebase
```

## Firebase room runtime (emulator only)

Set `VITE_GAME_RUNTIME=firebase` only with an intentionally configured Firebase Web SDK and `VITE_USE_FIREBASE_EMULATORS=true`. The client signs in anonymously before every callable and listens only to its role-safe Firestore projection. `createRoom`, `joinRoom`, `joinAudience`, `submitGameIntent`, and `syncRoomDeadline` are callable Functions; browser clients never write canonical rooms.

The only supported seed is guarded and cannot target production:

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:GCLOUD_PROJECT='demo-huroof-wa-oloof'
npm run seed:firestore -- --demo
```

It creates `demo-unreviewed-drafts-v1` from explicit draft questions, marks every record `demoUnreviewed`, requires at least 25 distinct letters, and pins that immutable fixture only in the demo emulator. It does not call or alter the approved-release publisher. Production Functions enforce App Check (`VITE_FIREBASE_APP_CHECK_SITE_KEY` is required by the client configuration); the emulator remains intentionally testable without it. Run deadline reconciliation from an authenticated room client with `syncRoomDeadline` when a countdown ends.

`npm run test:e2e:firebase` is the guarded full-stack harness: it discovers Java from `JAVA_HOME` first and then Android Studio JBR, starts only Auth/Firestore/Functions emulators for `demo-huroof-wa-oloof`, builds Functions, seeds the unreviewed demo fixture, starts Vite with explicit demo Firebase variables, and runs the dedicated Playwright room flow. It never targets a cloud project.

`build:firestore-release` and `seed:firestore` intentionally reject the current production-shaped bank because it has zero approved questions. `--demo` only permits an explicitly labelled empty emulator fixture plan. Dry runs do not import or initialize the Admin SDK. Any real seed also requires `FIRESTORE_EMULATOR_HOST` and a `demo-*` project id. Release, catalog, question, and inventory paths are preflighted and created once; only `runtime/activeRelease` is set after every immutable create succeeds.

## Production release publication (blocked while approved count is zero)

Production publication accepts only `content/questions/approved/questions.jsonl`. It canonicalizes keys recursively, sorts records by ID, verifies the generated manifest count/hash, and derives the full immutable release ID from the approved-content SHA-256. The offline plan command requires no credentials and never imports or initializes the Admin SDK:

```powershell
npm run firestore:production:plan
```

Refresh the release manifest with an explicit strict `asOf` date before planning; dated facts expire against that value, and production plans bind it into the immutable release evidence:

```powershell
npm run validate:questions -- --as-of YYYY-MM-DD
```

Do not run prepare while the plan reports zero approved questions. After an approved release exists, use Application Default Credentials (for example, an unprinted `GOOGLE_APPLICATION_CREDENTIALS` path) and copy the plan's release ID and SHA-256 exactly:

```powershell
npm run firestore:production:prepare -- --project huroof-a3ee7 --database '(default)' --location me-central2 --release-id <full-release-id> --approved-sha256 <approved-sha256>
npm run firestore:production:verify -- --project huroof-a3ee7 --database '(default)' --location me-central2 --release-id <full-release-id> --approved-sha256 <approved-sha256>
npm run firestore:production:activate -- --project huroof-a3ee7 --database '(default)' --location me-central2 --release-id <full-release-id> --approved-sha256 <approved-sha256> --expected-active-release none --operation-reference <approved-change-reference>
```

Prepare creates or exactly verifies only immutable catalog/release documents (including `catalogCategories/{categoryId}`) and a non-secret publication receipt; it never moves `runtime/activeRelease`. Verify is read-only. Activate is a separate compare-and-swap transaction that verifies the release root and receipt, creates an immutable activation receipt, then moves the active pointer. To roll back, activate a previously verified immutable release with the current pointer as `--expected-active-release`; never delete or mutate a release. Each command rejects emulator targets and requires the exact production project, database, location, release ID, and approved SHA-256. Firebase CLI login is not used by the Admin SDK; the prepare/verify/activate commands require Application Default Credentials and independently verify the resolved project and Firestore metadata before operating.

## Schema and access

See [ADR-002](../design/ADR-002-firebase-firestore.md) for the full schema tree. Clients can only get safe room projections. All canonical rooms, codes, members, events, receipts, categories, release content, and active-release documents are Admin-only. Callable Functions are the sole runtime/game-state writer; the guarded publisher is the sole production release writer.

## Production is a separate operation

Do not deploy Functions or seed production data from this baseline. A human must first approve a Functions-capable billing plan, configure App Check, retention/audit and backup policy, monitoring/budgeting, and approve the immutable release and rollback procedure. Callable Functions default to `me-central2`; `VITE_GAME_RUNTIME=firebase` is permitted only against the named demo emulators until that production approval exists. The regional defaults do not deploy a backend.
