## Doha deployment verified — 2026-09-11 15:56 UTC

All nine authorized room callables are ACTIVE in me-central1 on Node.js 22. Fresh Google API readback returned exactly those nine functions and no admin endpoints. Each callable rejected an empty unauthenticated request with HTTP 401 UNAUTHENTICATED. Firestore remains me-central2. These are infrastructure and negative-boundary checks, not authenticated gameplay acceptance.

Source commit 089ee2d9 changes six region defaults/preflight/test paths. Backend tests: 38/38; production preflight: 4/4; provider tests: 3/3; typecheck and Functions build passed. Gate accepted the exact compiled package, including the derived package-only gcp-build empty-string setting for Google's documented prebuilt deployment. Final package manifest SHA256: 251515399da413d82600dd1af9980d24bd34ec68f6dfbe1075661efd664d735d.

runtime/activeRelease still returns 404. No question approvals, database writes, rules changes or live browser runtime switch were performed. Vercel remains the previously verified static preview. Remaining work: genuine reviewed release publication, live App Check attestation, and host/player gameplay acceptance. Do not report room creation as operational yet. Evidence: output/firebase-activation-20260911/live-verification.json and BUILDPACK-GATE-REPORT.md. Rollback: retain fixture runtime; revert the six source paths if required, and separately review any removal of the newly deployed endpoints before doing so.

# Deployment and rollback plan

## Doha room-service deployment authorization — 2026-09-11

User replied “OK” to processing room requests in Doha (me-central1) while retaining Firestore in Dammam (me-central2), including the stated cross-region latency/cost implications. Regional decision is resolved; no further region approval is required for this scope.

Scope remains only the nine reviewed room callables. Client/preflight now target Doha and reject the former Dammam Functions region. A manual endpoint check passed with the environment override, but Firebase CLI discovery did not retain that shell variable and retried Dammam. Therefore the backend defaults are being made explicitly Doha before repackaging. No deployed endpoints were created by either failed Dammam attempt. Database/rules/Auth/release approval remain unchanged.

Status: rebuilding and verifying explicit Doha package; deployment and live endpoint checks pending. Production stays static preview until genuine reviewed release and authenticated App Check gameplay acceptance. Evidence continues under output/firebase-activation-20260911/.


## Blaze activation and App Check preparation — 2026-09-11

User confirmed Blaze setup; fresh Cloud Billing API check verifies billingEnabled=true. The previous billing blocker is resolved. App Check Enterprise now has a SCORE key restricted to huroof-wa-oloof.vercel.app, one-hour token TTL and 0.5 minimum score. Exact key/provider read-back passed. No debug bypass, all-domain key, IAM/rules/data change or question approval was applied.

Provider source commit `debcf883`: explicit Enterprise/v3 selection, invalid-value rejection, required live key, fixture/emulator preservation and initialization before gameplay services. Six source/test paths reviewed; 3 provider tests, 3 production-preflight tests, typecheck, lint and build pass. Root reproduced provider tests; Gate PASS. Actual browser attestation is still pending a live client deployment.

Initial nine-callable backend package passed Gate (10 runtime/lock files, manifest SHA2562750ff7b504838a1508dda5a5ee8d0bbfe0a83e53634c2df8dc60cfdc2ccbfad). Firebase enabled its required build/run APIs but deployment failed before creating Functions: me-central2 upload URL returned403 LOCATION_POLICY_VIOLATED, with Google directing regional access requests to sales. A repeat diagnostic confirmed Dammam403 and Doha/me-central1200. No room Functions were deployed by the failed attempt.

Root requested a user decision before switching game request processing to Doha while retaining the existing Dammam database. No region change or runtime switch has been applied. Production remains the previously verified 52/83-category static preview. The active question release is still absent; genuine content review/publication and live host/player checks remain required after infrastructure setup.

Evidence: output/firebase-activation-20260911/ (appcheck-prestate/configured receipts, backend/provider Gate reports, region-access-check.json). Rollback before live client use restores only the task-created provider/key state with concurrency checks. Do not delete source questions, change billing, weaken rules or synthesize approval receipts. API enablement may remain; never disable shared services without checking use.


## Hide unavailable categories and question-count report — 2026-09-11

User requests categories with insufficient questions omitted from selection and a Markdown generation backlog with counts for all categories. This supersedes the earlier disabled-card presentation, not the complete underlying inventory. Local/preview Huroof uses existing positive letter-question coverage; category mode uses existing distinct-concept eligibility. Approved Firebase catalogs use their per-mode playable flags. Filtering precedes search/topics/counts and prunes stale selections. Existing design, static-preview restriction and server-side final validation remain.

Fresh metadata-only local inventory matches the checked-in projection exactly: 88 categories, 12,603 usable references, 429 held references; 52 Huroof-visible and 83 category-mode-visible. [All category counts and generation backlog](../docs/CATEGORY-QUESTION-COUNTS.md) retains all 88 rows, identifies 36 zero-Huroof and five category-mode-unavailable categories, and distinguishes held records from distinct usable questions. No question bodies, approval/database changes or backend activation.

Verification/release status: Done — source accepted, pushed and production promoted. Implementation commit451aee1d96633520f11597c37c08ddc92e846085. Root reproduced11 focused tests; Forge24 setup tests and builds pass; Gate4 independent tests and reduced-tree build pass. Existing React act warnings and >500kB bundle advisory remain. Exact810-file upload manifest45ade74b8db1776864268afc835549beb3c0fdd748ad7767cc97d980619102a0. Production deploymentdpl_4uk1GFcH63gbaknWHXTjGstjMe3a. Candidate/public browser checks:52Huroof,83category-mode,Flags hidden only inHuroof,held cards omitted,deep-link cleanup/search verified. Public main bundle /assets/index-C_cGngEn.js matches reviewed candidate/local SHA25612f6b63598f0c1e5a153791c5d03ce0ccec6b9efe46260a94d89bdc66ac7444b. Retain VITE_STATIC_PREVIEW=true and VITE_GAME_RUNTIME=fixture. Rollback: promote dpl_2kkkGnRsUawu7WLpQgi3oDXfD2oo; revert only this bounded source delta. Evidence directory: output/category-question-report-20260911.


## Live rooms and full-question review authorization — 2026-09-11

User explicitly requests live rooms/gameplay and approval of all questions. This authorizes completing the existing T-14.4–6/T17.3 production sequence, with actual approval provenance and validation; it does not establish that every record is correct or erase unsupported/missing-media findings. No invented reviewer identities, signatures or factual-review receipts. Preserve existing intake/history and the current 88-category preview while prerequisites remain incomplete.

Fresh read-only evidence: `output/live-game-release-20260911/preflight.json` at 14:21 UTC confirms billing disabled, zero Functions and absent active release. Anonymous Auth is enabled and the public Vercel domain is authorized. App Check HTTP 200 default config responses alone do not prove a registered usable provider/site key; that remains to be verified. The user was asked to enable Blaze in their account; independent preparation continues.

Implementation now adds authenticated/App Check metadata-only approved catalog discovery, selector-derived per-mode readiness, immutable release identity pinning and authoritative selected-scope validation at creation. Firebase setup uses the approved release instead of forcing demo. Root verified all 38 compiled Functions tests (including private media fixtures) and five Firebase setup tests; Forge app/Functions builds, typecheck, seven adapter tests and 23 local setup tests pass. Final source Gate PASS for the exact twelve code/test paths; root reproduced six Firebase UI tests after the final homepage fix and the final static build. Source manifest SHA256 d97c53f0dcaca941238f46485f87f54ba9c9842b34ae3d62b79ab3920b88684d. Source implementation commit: `419b28f0` on `codex/app-update-2026-09-07`. No backend activation, active pointer or approval writes have been made. Production remains the verified static preview; code readiness is not live service readiness.

Content audit: 12,752 SQLite rows remain draft; 20,084 reconciled source revisions represent 14,024 candidate IDs, not that many distinct approved questions. Recovered 15 missing exact-original photos; prepared package v2 has 1,741 hash/MIME-verified assets, four unresolved remote photo entries and eight overlapping unresolved source references. Nine rebuilt-question records separately lack supplied images. Private package remains prepared-only; no status was changed to approved. Actual authenticated review/attestations and an immutable active release remain required. Evidence: output/live-game-release-20260911/IMPLEMENTATION-EVIDENCE.md and CONTENT-READINESS.md.

App Check Enterprise preparation plan was reviewed, but no service/key/provider mutation was applied. It must be paired with the correct client provider and actual attestation checks before activation. Billing, provider setup, approved release publication and real multi-client gameplay verification remain open. Existing T-14.4–6 acceptance and rollback govern the next actions.


## Full category catalog correction — 2026-09-11

Authorized follow-up: production shows only eight fixture categories; user requests all available categories implemented, pushed and deployed. Read-only local inventory confirms 88 categories, 83 locally eligible. Scope is a metadata-only public catalog and consistent homepage/setup discovery; no question payload, database mutation, backend activation or redesign. Preserve existing preview restrictions and distinguish local content availability from live playability.

Execution: Forge implements and tests in the prior clean isolated release clone; root reviews the delta and verifies exact inventory coverage; Gate reviews public payload and preview guards; root pushes the bounded fix, deploys with `VITE_STATIC_PREVIEW=true` and `VITE_GAME_RUNTIME=fixture`, verifies the candidate and promotes. Acceptance: all 88 inventory IDs represented once, both homepage and setup can discover categories beyond the original eight, unavailable states remain accurate, filters and category links work, artwork loads, and public production confirms the full count. Rollback: promote prior deployment `dpl_3QoqdRZT9iRPCzQoYJWwF9PEk72x`; revert only task-owned commits if necessary. Status: **Done — verified and promoted 2026-09-11.**

Release source commit: `66765eb0f3918fe4a7df698453e2f8a045c73811`, pushed to `codex/app-update-2026-09-07`. Production deployment: `dpl_2kkkGnRsUawu7WLpQgi3oDXfD2oo`, serving https://huroof-wa-oloof.vercel.app. Candidate and public production browser checks confirm 88 category images loaded, zero broken images, all-topic count 88, five held entries disabled, working search, and a retained deep-linked category outside the old eight. Homepage exposes all categories through its 88-category expansion control.

Verification: exact metadata projection 88/83/5; app typecheck, changed-file ESLint, static build, 27 focused tests reproduced by root, and four independent Gate checks passed. Gate rebuilt the 809-file reduced upload and verified its manifest `3f10a57245e1aa07cfc9b36974d2b9a5dc681ed690424a5fd7093c56972de259`. Public main bundle `/assets/index-D3t6TePY.js` matches local/candidate SHA256 `ed05e9f20ee42af76482713cf1ce97606e0ed559ff0115e79606372a31c295d3`. Evidence: `output/category-catalog-release-20260911/IMPLEMENTATION-EVIDENCE.md`, `GATE-REPORT.md`, `ROOT-BROWSER-CHECK.md`, manifests and candidate verification. Existing React act warnings, Vite chunk advisory, and unrelated request/tough-cookie type mismatch under standalone script checking remain; scoped script checking with skipLibCheck passes.

Refresh after future inventory changes: obtain the metadata-only local inventory using the existing authenticated/origin-checked local API, then run `npm run refresh:public-category-inventory -- --input <metadata.json> --write`; verify with `--check`, test and redeploy the reviewed catalog. The exporter explicitly selects public metadata fields and rejects duplicate IDs/invalid fields. Do not pass question payloads or publish the local input receipt. Source integration preserved concurrent work; no backend activation or database writes occurred.

## GitHub and Vercel production update — 2026-09-11

User authorization: “Update GitHub and vercel production.” This authorizes publishing the current completed application changes and updating the existing Vercel production project. Root coordinates under the existing GitHub/Vercel publication contract below; Forge prepares an isolated source snapshot and explicit file allowlist, then Gate reviews the exact package before root push/deployment.

Scope: completed application, category artwork, accepted T17 runtime support, matching tests and release documentation. Inspect changed files and dependencies before selection. Exclude private question bodies, databases, source-media originals, import receipts, credentials and unaccepted in-progress Firebase consolidation tooling. Preserve all concurrent working-tree changes. No mass question approval, database migration or Firebase release activation is implied by this frontend publication.

Sequence and acceptance: verify remote branch/project/environment identity; capture immutable selected-file hashes; build/typecheck/test isolated Git source and the reduced Vercel upload; pass the release Gate including private-payload checks; publish intentional asset/implementation/documentation commits; deploy a production candidate with delayed domain assignment when supported; check HTTP/browser/deep links and matching build; promote and verify production alias. Retain the currently configured runtime unless live backend/release prerequisites support an explicit change. Record the exact runtime and any limitations without describing a static frontend as an online database deployment.

Rollback: restore the verified previous Vercel production deployment by promotion/rollback. Revert only task-owned Git commits if needed; never reset the mixed workspace or restore a whole database. Root owns final acceptance and updates this section with evidence. Status: **Done — verified and promoted 2026-09-11.**

Publication evidence: GitHub branch `codex/app-update-2026-09-07` was updated with asset commit `2a350696`, implementation commit `b14a62d8`, and release-source commit `7cc0cd48ac54cfbce52a545b704c01793ed4f48c`. Vercel project `prj_LlhlcNrvjFJnmPkIFPzc2mkzu6Ni` production deployment `dpl_3QoqdRZT9iRPCzQoYJWwF9PEk72x` is READY and promoted at https://huroof-wa-oloof.vercel.app. The immutable deployment URL remains protected by Vercel authentication; authenticated CLI candidate checks succeeded without changing protection. The main public alias resolves to this deployment and serves the verified build.

Acceptance evidence: 677 selected source files and 808 upload files were independently rehashed without mismatch; Gate private-data/credential scan passed. Typecheck, source/reduced-upload/Functions builds, 80 focused checks and two independent preview tests passed. All 762 independent build outputs match. Candidate and public production main bundle SHA256 is `71ef0861abbee7ec74b3e8ff755870698fccc72eeca99953dc98a6151684dfaf`. Public `/` and `/host/new` return HTTP 200. Browser verification confirmed the new homepage, eight loaded category images with zero broken images, disabled join/create controls, and blocked `/local-import-review`.

Runtime limitation: Production uses `VITE_STATIC_PREVIEW=true` and `VITE_GAME_RUNTIME=fixture`, explicitly saved to Production settings and supplied at build. It displays the eight fixture categories; the local database and its full category/question inventory were not published. Fresh read-only Firebase checks found billing disabled, zero deployed Functions and no active release. Broader private-media integration tests require deliberately excluded private registries; those tests could not run in the public snapshot. Existing bundle-size advisory remains. No database, Firebase activation or private source upload occurred.

Rollback target: `dpl_8VHpcpYTk2H2AoaZNqmvWRowWmgB`. Detailed local evidence: `output/release-production-20260911/PACKAGING-REPORT.md`, `GATE-REPORT.md`, final source/upload manifests, `production-after.json`, and candidate/production bundle copies. Original mixed workspace was preserved; publication used an isolated clone. The following documentation-only receipt commit does not change deployed application bytes.

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

### Publication completed — 2026-09-09

Safe Git delta published on codex/app-update-2026-09-07: assets07cc407a, implementationc22e647a, documentation96ad511f. Remote branch readback matched96ad511f9fabbbcb29e38b3d8eb8a919c7c7cacc. Existing public historical content was preserved; no new private master-import questions/media/database/archive payload was published.

Vercel Preview READY: https://huroof-wa-oloof-ql23s3kp6-sanad-general.vercel.app (deployment dpl_Wo8EbmZQxuGpXtqnDceCxvdmEFMw). Explicit build flags VITE_STATIC_PREVIEW=true and VITE_GAME_RUNTIME=fixture; matching branch-specific Preview environment variables registered. Production alias was not promoted. Preview protection remains enabled.

Verification: clean Git and stripped195-file Vercel source builds/typechecks pass;31focusedUI checks; independent Gate2/2; Node22.23.2 Functions compile; production-only audit0. Root browser verified both setup kinds and direct room/admin/import-review guards with zero API/callable requests. Protected live HTTP homepage/deep-link/mainJS200; deployed mainJS SHA2565742314062cd74a219647d177116979d73de237789af923be473d4d603bbfb20 matches the browser-tested candidate. Vercel adds its standard preview feedback script to HTML. Existing large-vendor-chunk warning remains. Full online gameplay remains blocked by the activation sequence above; this publication does not change draft approvals or enable a backend.

Local evidence: output/release-20260909/packaging-report.md and gate-release-package.md. Local database-backed app remains available on127.0.0.1:8787. Next authorized action: after user billing setup, recheck Firebase billing and complete App Check, immutable catalog binding and genuine reviewed-release preparation before deployment/activation.
