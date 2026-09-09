# Deployment and rollback plan

## Authority and current state

Current authority (2026-09-09): the user authorized the bundle import and explicitly approved publication/activation with “i validate, do it now.” Production intake has performed and verified 38,950 private source/provenance writes, including 18,698 question revisions. This is not a playable release. No runtime activation or service deployment has occurred. See [T-14 execution authorization](HANDOVER.md#t-14-execution-authorization--2026-09-09) and [the import receipt](../tmp/bundle-import-20260908/production-resume-20260909.receipt.json).

Local/emulator gameplay verification is accepted under T-15; actual bundle image integration is in progress under T-14.2. The latest live infrastructure check found billing disabled and the Cloud Functions API disabled. Publication approval is recorded; it does not supply missing infrastructure or invent signed reviewer identities. Local evidence is not production release evidence.

## Canonical release path

The canonical source is [scripts/firestore-release-publisher.ts](../scripts/firestore-release-publisher.ts). Every production operation requires its parsed mandatory flags; bare npm scripts are deliberately not runnable release commands. The source enforces project/database/location, immutable release/hash/trust-root identity, and operation-specific CAS/receipt flags.

The ordered process is:

1. Build/validate candidate content and create a source-grounded `plan` with its required trust-root flags.
2. `prepare` immutable release documents with required project/database/location/release/hash/trust-root flags.
3. `verify` the exact prepared documents and barrier receipt with the same identity flags.
4. `activate` only with the verified receipt, expected active-release CAS value, non-secret operation reference, and required identity flags.
5. `audit` the activated release with required identity flags.

The user's release authorization is already recorded. Run these operations only after the exact release passes verification and infrastructure prerequisites are met; do not request the same authorization again.

## Migration order and compatibility

There is **no database migration in this change**. Deploy compatible code/configuration first, verify production identity/App Check/signing and release prerequisites, then run canonical prepare/verify/activate. Demo-only seed compatibility is not a production backfill and does not relax Functions validation. Existing rule/index files are unchanged; future rule/index requirements need separately reviewed Firebase deployment before new queries depend on them.

## Rollback

`rollback-none` is a real guarded rollback to **no active release**, not a no-op. It is permitted only for the verified sole immutable release root, requires the same identity/operation-reference flags, uses a transaction that CAS-checks `runtime/activeRelease`, deletes that pointer, and creates an immutable `rollbackReceipts/...` record. Rollback to an earlier verified release uses the publisher's audited restore path. Neither path deletes release roots, room/event history, or audit history.

## Production prerequisites

Read-only checkpoint, 2026-09-09: Firebase Web app `Huroof wa Oloof Web` is ACTIVE; Hosting site `huroof-a3ee7` exists at `https://huroof-a3ee7.web.app`; anonymous Auth is enabled and authorized domains include localhost and both default Firebase domains. The App Check services listing returned HTTP 200 without service entries; that is not evidence that a browser provider or enforcement is configured. Production preflight/Hosting guard tests passed 3/3. Billing and Functions remain the blockers recorded above. No configuration was changed by these checks.

Live HTTPS checkpoint on the same date: both `/` and `/host/new` returned HTTP 404 with title `Site Not Found` and no script assets. A registered Hosting site is not a deployed application. The local SPA rewrite tests do not establish live availability.

Authorized infrastructure preparation, 2026-09-09 11:01 UTC: root enabled `cloudfunctions.googleapis.com` through Service Usage. The operation completed with state ENABLED; the regional Functions list now returns HTTP200 with zero deployed functions. Receipts: `tmp/bundle-import-20260908/functions-api-enable-20260909.json` and `functions-api-enable-completed-20260909.json`. This supersedes the earlier API-disabled finding only. Billing was not changed, no function was deployed, and no question release was activated. The API can be disabled again if preparation is abandoned while it remains unused; no data deletion is required.

Prepared `.env.production.prepared` from the verified production Web app's public SDK configuration. This file is ignored by git and is not a Vite automatic environment filename; existing local/test settings remain intact. App Check site key and verified release ID/root SHA remain blank intentionally. Do not promote it to an active build environment until those prerequisites and Node22 are available.

1. Production Google login, App Check/signing, and authorized principal checks.
2. Approved production release and environment-specific CI verification.
3. Node/runtime parity: Functions target Node 22 while local host evidence used Node 24.
4. Assessment/remediation of Gate’s seven moderate transitive `uuid` audit findings.
5. A reviewed deployment window and rollback/recovery owner.

## Category mapping review prerequisite — 2026-09-09

Read-only Database review during T-14.3 identified an existing release integration mismatch: `scripts/build-firestore-release.ts` emits `catalogCategories/{id}`, whereas `functions/src/index.ts` reads `categories/{id}` for trusted category labels. Before releasing expanded mappings, align label lookup with an immutable release-bound catalog and test a non-demo category-room creation against the actual built release. This is a deferred release prerequisite, not a change to the current mapping scope; no production documents or active pointer were modified.

## GitHub and Vercel publication — 2026-09-09

User request: “send to github and vercel.” This authorizes publishing the completed app source and a Vercel deployment. Public source packaging must exclude private intake, original question media, SQLite files, backups, archives, local receipts, and secrets.

Execution under existing T-14 release authority: Forge prepares an explicit file allowlist and isolated clean build; root reviews the staged diff and Gate checks the exact release package before push/deploy. Acceptance requires a clean-source build, no private payload in Git/Vercel upload, a verified GitHub commit, and HTTP/browser checks of the deployed frontend. Rollback is Vercel promotion of the previous production deployment; no database mutation belongs to this publication step.

Current hosting evidence: Vercel project huroof-wa-oloof (sanad-general) has no environment variables and is a Vite static frontend. Local SQLite and persistent room state cannot be carried into a static deployment. Default fixture mode remains a frontend preview; publishing it must not be reported as deploying the imported question database or online multiplayer. Full Firebase gameplay remains subject to the production prerequisites above. Status: packaging in progress; no push or deployment yet.

Full online gameplay preparation is explicitly authorized by the user in this release turn. Fresh read-only checks at2026-09-09T16:56Z confirm billingEnabled=false, regional Functions count0, and runtime/activeRelease absent. App Check configuration endpoints are readable, but returned metadata does not establish a usable browser key binding; the prepared build has no site key. Receipts are local-only under output/release-20260909. User has been asked to complete billing setup; source packaging and frontend verification continue independently. Existing genuine review/trust requirements and immutable catalog binding remain required for activation, with no automatic promotion of local drafts.

### Remaining online activation sequence

1. User completes Firebase billing for huroof-a3ee7; re-read billing status before deployment.
2. Configure/verify the web App Check provider for the final Vercel domain and supply the public site key through deployment environment configuration. Keep provider secrets out of source/chat and preserve callable enforcement.
3. Complete T-14.3/4 genuine content review and immutable release preparation. The local master import contains drafts, not an approved production release.
4. Resolve and test the existing catalog lookup against the exact immutable release; do not replace it with an unbound mutable label collection.
5. Run production preflight and Functions checks under Node22, deploy compatible backend/rules, then use the canonical prepare/verify/activate/audit sequence for the verified release.
6. Build Vercel with Firebase runtime and static-preview disabled only after live auth/AppCheck/callable and room-flow checks pass. Verify Huroof and category play across host/player/display clients before production promotion.

The independently publishable frontend uses an explicit static-preview flag and disables room creation/joining when no backend is deployed. Local runtime8787 remains running and unchanged by isolated deployment builds.

Online Auth preparation completed2026-09-09T17:05Z: verified Vercel ownership/production alias, added only huroof-wa-oloof.vercel.app to Firebase Auth authorizedDomains, preserved the three existing entries, and read back the exact expected list. Security boundary review found no concrete concern with this additive exact-domain change. Local receipt: output/release-20260909/auth-domain-preparation.json. Rollback removes only the added domain from a fresh list. No sign-in provider, App Check enforcement, billing, game data or release pointer changed.
