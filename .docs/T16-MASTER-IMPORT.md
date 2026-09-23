# T-16 / M-IMPORT-01 — validated master bundle local reconciliation

Status: Done — root accepted 2026-09-09 after technical Gate PASS, live application, independent preservation/accounting and browser/media verification. This is separate from historical production T-13 intake and completed T-15 polish. [Final report](../output/master-import-20260909/IMPORT-REPORT.md).

## Authority and baseline

### Authorized follow-up T16.7 — test imported content in the app

User now requests ensuring the content works in the app and running it for testing. The completed import/readback evidence above remains valid. Root confirmed on follow-up that the default game still uses only the280-record demo file. Extend the existing local imported-source runtime contract to the actual SQLite intake, using an explicit local draft/test source and the existing safe game selector/projections. This supersedes the earlier exclusion of imported content from **local explicit test games only**, never approval/publication gates.

- Owner: Forge sole implementation writer; root acceptance and live browser/game verification. Reuse the existing local imported-source snapshot/inventory/setup mechanism, adding a SQLite reader rather than querying remote Firestore or reimporting data.
- Scope: read existing SQLite imported rows and preserved legacy baseline; normalize supported trivia/identity without fabricating prompts, category IDs or letters; deduplicate source identity and answer concepts; report held/unsupported records honestly. Retain every source record in review. Preserve stored approvals, raw source and media. No schema/data migration or mass approval.
- Runtime: pinned question-source snapshot per room; fail closed on mismatch; actual metadata-only inventory for setup; both Huroof and Categories reach a question from the imported bank. Explicit test notice and sensible supported defaults; keep current room/role authorization and answer secrecy. Normal approved play remains unchanged. Unsupported600 source modes remain staged/reviewable, not silently coerced into text play.
- Visual contract: reuse approved current app tokens/layouts. Only update truthful source/test copy and inventory-driven availability; no new visual direction.
- Checks: source mapping/deduplication/held modes and malformed data; snapshot compatibility; both game kinds select real imported questions; no answer leak in setup/audience; relevant service/setup checks, typecheck/build. Root verifies live inventory and real browser flow. Start the verified local server on8787 with this explicit local SQLite test source and open the home/setup page.
- Rollback: disable the new local source and restart the verified server with the prior configuration; do not change or delete stored data. Preserve unrelated work. Status: Done — root accepted after independent live/import/browser checks and portable fixture tests. [Final runtime evidence](../output/master-import-20260909/RUNTIME-TEST-REPORT.md). The previous import-only handover below is historical; current source is explicitly enabled for local testing.

- Input ZIP: `huroof_master_everything_including_images.zip`, SHA256 `e9202fdcfd1b544f70564484eb2a2080df07a0ab8d9e06e9c51ab94c76ddc287`.
- Read START_HERE, CODEX_IMPORT_INSTRUCTIONS, import/SCHEMA and qa/COUNTS. Only import/questions.jsonl is a record stream. Categories, SOURCE_ID_MAP and DUPLICATE_REVIEW are supporting metadata; archival scripts/backups/design briefs/duplicate representations are never import sources.
- Bundle extracted under output/master-import-20260909/bundle/huroof_master_all_saved for validation. Included validator passed all6540 IDs,67 populated/100 defined categories,240 PNGs,640 checksums; log output/master-import-20260909/validator.log.
- Actual live preview:127.0.0.1:8787, PID31808. Selected process environment and open-file handle confirm default local SQLite `C:/Users/User/AppData/Local/Temp/huroof-wa-oloof-local-game.sqlite`; no Firestore-source mode. API returns280 file-backed drafts across8 categories; approved JSONL empty. SQLite local_admin_drafts0, rooms160, events/snapshots2030 at baseline.
- Verified online SQLite backup plus question/category files: output/master-import-20260909/baseline-backup-manifest.json and backup-before/. Database integrity check passed. No database mutation before backup.

## Decision and impact

Use existing local_admin_drafts JSON records; no DDL/schema, Firestore/Storage mutation, release-pointer change, approval grant or gameplay JSONL change. Existing game question selection excludes this local draft store; retain that gate. Incoming storage and playable inventory are different measures.

Exact existing ID/provenance matches win, then conservative category-qualified content/answer/media matching; never bare Q001, generic image instruction or generic charades instruction. Preserve complete original source object and trusted existing human-edited/approved data. Ambiguous identity or changed content is staged, never overwritten. Root preliminary exact category/prompt/answer comparison found7 matches; importer must prove its final counts independently.

Store representable trivia/identity as draft/Needs Review; retain unknown or invalid letter eligibility explicitly, never infer letters. Charades/image/puzzle/image_puzzle/lineup are review-stage records with preserved source mode and reason; do not coerce into classic or fabricate charades questions. Staging may occupy the existing JSON draft store with explicit stagingState; distinguish physical inserted rows from terminal source outcomes. Conflicting same-ID records must remain untouched; use an explicit ledger/staging artifact for the incoming revision.

All240 incoming media files match the existing private v18 registry. Verify exact source SHA and registry SHA/path, retain rights/attribution, and associate incoming rows. Do not overwrite registry or expose private intake via public/dist assets. Review-only media delivery must have bounded server-side lookup/path/hash checks.

The current /questions route redirects to Firebase-admin; do not restore an authentication bypass. Provide a separately labelled local-only, read-only import review surface with pagination/category/outcome search and explicit answer reveal. It must read the actual local store/ledger and use loopback/same-origin restrictions; imported drafts never become game questions. Use existing visual tokens and simple existing controls, no new design direction. Preserve all unrelated dirty work.

## Tasks and ownership

- T16.1 Root: validated input, actual source audit and verified backup (complete).
- T16.2 Forge: inspect actual source/schema/media; implement deterministic CLI plan/apply/check with explicit target, transactional or resumable application, per-ID ledger and category/package outcome summaries. Recheck expected baseline/input hashes before write, preserve original run report on rerun. No live write until root has reviewed concrete dry-run and required technical Gate.
- T16.3 Forge: local-only paginated review/media wiring and imported read-only protection at existing local mutation endpoint. No Firebase admin bypass; existing ordinary local drafts remain editable. Do not change gameplay pools or approval gates.
- T16.4 Root/Gate: inspect integrated importer/negative tests/dry-run and privacy/path boundaries; authorize already-requested concrete local application internally when safe.
- T16.5 Forge: apply to verified backed-up target, capture per-batch/readback proof, all6540 outcomes; rerun apply/check proving zero new rows and preserved data. Verify all240 image bytes/loads and representative modes/answer reveal. Record before/after stored/draft/approved/playable/category counts, net changes, staged/conflict reasons.
- T16.6 Root: independent readback/idempotency sample and final acceptance/report; user-facing category accounting files and backup/rollback locations.

## Acceptance and checks

Every6540 incoming ID has exactly one terminal outcome inserted/already_present/updated/staged/rejected with reason, category and source package. Sum agrees with source; stored rows independently audited. Baseline questions, edits, approvals, media and analytics unchanged. Second import creates zero duplicates; identity disagreement stages without replacement. Include regressions for repeated Q001 in different categories, same-ID edited/approved rows, image/charades common prompts, category-qualified match, rerun, partial failure/rollback, unsafe media path/hash, and protected local review access. Run scoped importer/server/UI tests, typecheck/lint/build where affected, actual browser review/media checks. No approval-count inflation or whole-DB production claim.

## Rollback and limits

Before writes, preserve current SQLite backup and file hashes. Prefer transaction rollback on failure. Later rollback must remove only exact import-owned unchanged rows or restore the verified backup with the task authority stopped, after checking for subsequent user work; never overwrite intervening edits blindly. Existing gameplay files/media registry remain untouched. Keep original run ledger and rerun report separate. A preview restart may be required for new routes; verify process identity and use the same database, preserving rooms. No unrelated process termination.

## Handover

T16.1–6 complete and root accepted. The local preview is healthy at127.0.0.1:8787; browse `/local-import-review`. Stored6813, approved0, normal playable0; the explicit280-record demo pool remains unchanged. No implementation work remains within this import request. Future approval/content-mode work requires its own scope. [Final report and evidence](../output/master-import-20260909/IMPORT-REPORT.md). Elapsed approximately70 minutes against1–3h; token telemetry unavailable.

## Forge execution evidence — T16.2–3 (2026-09-09)

Implementation complete — ready for review at the dry-run checkpoint; no live preview database write has occurred.

- `scripts/master-import.ts` requires an explicit SQLite target, validates the immutable JSONL/ZIP identities, `SOURCE_ID_MAP.tsv`, all 240 private registry binaries and paths, and the verified backup/question-file hashes before an apply. It uses a SQLite transaction, preserves a separate required run-ledger path for apply/check, and stores original source/provenance, media association, unsupported-mode staging, letter eligibility, and duplicate-review flags in the existing JSON draft records. It independently reports `5933 inserted`, `600 staged`, and `7 already_present` across all `6540` source IDs on the verified backup; the 100 duplicate-review groups cover 200 retained source records.
- The seven existing matches are category-qualified `tahadani-045` content matches only: `Q013/Q025/Q043/Q047/Q055/Q057/Q061` → `draft-018/028/238/098/008/118/268`. No bare legacy `Q001` matching is used.
- The local-only `/local-import-review` surface and API remain separate from Firebase admin. The API requires loopback socket, loopback Host, and configured same-origin request; answer details are explicit, and private media is bound by ledger ID + SHA-256 + registry path/hash. Imported `readOnly` rows reject the normal local POST mutation path while ordinary local drafts remain writable.
- Verified commands: `npm run test:master-import`, `npm run test:local-import-review`, `npx vitest run tests/app/local-import-review.test.tsx`, `npm run typecheck`, `npm run lint -- --quiet`, and `npm run build`. Dry-run ledger: `output/master-import-20260909/dry-run-ledger-v2.json`.

## Forge repair evidence — Gate re-review ready (2026-09-09)

Implementation complete — ready for review. No live preview database was written or restarted.

- The importer now requires a non-overwriting target manifest made by `import:master:bind-target`. It binds the exact target path, verified backup manifest/hash, original `local_admin_drafts` digest, and draft/approved question-file hashes; it rejects backup artifacts, wrong targets and changed question/local-draft baselines. Dry-run and check open SQLite read-only. Apply obtains `BEGIN IMMEDIATE` before baseline validation and classification, accepts only the complete supported idempotent state, and leaves unrelated rooms outside the question baseline.
- A full-identity SHA-256 staging key covers source ID, package, category, source record ID and content hash. Generated staging IDs resolve preoccupation deterministically. Source-ID-map reconciliation, duplicate-review flags (100 groups/200 records), original source/provenance, and all 240 private registry bindings remain in each record/ledger. Gameplay approved count is computed from the approved file pool only.
- Apply writes an exclusive prepared source-outcome ledger while the transaction is locked and before any INSERT. Only after commit does it write a separate completion receipt; `recover` verifies the complete idempotent database state before producing a missing receipt. An unavailable prepared-ledger path rolls back before mutation. Reports identify ZIP and metadata verification as prior bundle evidence rather than falsely claiming an in-CLI ZIP rehash.
- Legacy admin list/detail now require the same loopback Host/socket/same-origin read boundary, set private/no-store/nosniff headers, and exclude all `importSource` records. Ordinary local drafts keep their existing write path, while imported rows remain write-protected.
- Local import review accepts real same-origin browser GET/image requests without `Origin` only when `Sec-Fetch-Site: same-origin`, and rejects hostile origin/host. It requires an apply ledger plus completion receipt, joins every source outcome to current SQLite/file storage with present/missing/mismatched/preserved-existing state, reads current counts, exposes original and preserved current text distinctly, and provides 40-row next/previous pagination that resets on filters. Media requires present imported storage plus registry/path/hash validation.
- Focused checks passed: `npm run test:master-import` (6), `npm run test:local-import-review` (4), `npx vitest run tests/app/local-import-review.test.tsx` (1), `npm run typecheck`, `npm run lint -- --quiet`, and `npm run build` (existing Vite >500 kB chunk warning only). Disposable target `output/master-import-20260909/disposable-browser-repair-5b439a08083041bfbc53551cc21a5ffd/` applied 5933 inserted + 600 staged + 7 present / 6533 SQLite rows; a separate rerun produced 6540 already_present / zero new rows. Browser proof `browser-proof.json` shows `/local-import-review`, page 41–80 of 6540, explicit answer reveal, and same-origin private media 200/70916 bytes.

### Gate repair addendum — canonical binding and recovery

- `bind-target` now requires the backup manifest `sqlitePath` to be the exact target path and compares the target `local_admin_drafts` snapshot against the verified backup SQLite snapshot. This deliberately permits room/event changes while rejecting a different question-store baseline. Disposable tests construct an independent copied backup SQLite, question files and manifest whose `sqlitePath` is the disposable target; they never bind a disposable target to the live baseline manifest.
- The expected complete idempotent source set is derived at decision time from the immutable input plus baseline file/ordinary rows, rather than a hardcoded physical-row count. Recovery requires exact report target DB and target manifest equality and compares every source identity/storage ID against a fresh idempotent check before writing the recovered receipt.
- Additional focused checks: canonical wrong-target bind, changed question baseline, partial state, missing receipt, wrong-target recovery and successful bound recovery.

## Forge T16.5 live implementation evidence — 2026-09-09

Implementation complete — ready for root final acceptance/readback.

- Built the current client and bound `C:/Users/User/AppData/Local/Temp/huroof-wa-oloof-local-game.sqlite` to `output/master-import-20260909/live-target-manifest.json`, whose baseline local draft snapshot is 0 and whose target/backup/question hashes match the verified manifest.
- First live apply ledger: `output/master-import-20260909/master-import-apply-ledger.json` plus `.completion.json`: 6540 terminal source outcomes = 5933 inserted + 600 staged + 7 already_present; current totals stored6813/sqlite6533/drafts6813/approved0/normalApprovedGameplayPool0/categories67; 240 registry matches and 100 duplicate groups/200 records retained.
- Separate rerun apply ledger and completion: `master-import-rerun-apply-ledger.json`: 6540 already_present, zero new records. Separate read-only check: `master-import-check-ledger.json`: 6540 already_present with unchanged 6813/6533 totals.
- The previously verified preview PID31808 was absent and port8787 unbound at the required restart check, so no process was terminated. Started a new default local SQLite/no-Firestore server on 127.0.0.1:8787 (PID64140). Verified `/health` 200 and same-origin `GET /api/local-import-review` 200 with current 6813/6533 counts. Root independently confirmed file/catalog and room/event/snapshot preservation after the live apply.

## Forge T16.7 runtime bridge evidence — 2026-09-09

Implementation complete — ready for root live browser/game verification.

- Added `server/local-sqlite-import-question-source.ts`, a read-only `LOCAL_DB_QUESTION_SOURCE=sqlite-import` source. It combines the 6533 SQLite intake rows with the preserved 280-file baseline as one logical test store, accepts only supported trivia/identity or existing classic records with nonempty normalized prompt/answer/accepted answers, and never infers letter eligibility. Huroof letters require explicit eligible valid Arabic source letters matching the normalized answer. All staged rows are held, including any future staged supported-mode conflict.
- Runtime concepts are global normalized-answer hashes, while logical duplicate question records are held. The inventory reports 6213 usable test records and 600 held source records with truthful mode reasons (300 charades, 120 image, 60 puzzle, 60 image-puzzle, 60 lineup). It has 58 category-game-eligible categories. Recommended imported Huroof scope is `tahadani-004`, `tahadani-015`, `tahadani-036`; Categories test scope is `huroof-068`, `huroof-069`.
- Source snapshots remain room-pinned and fail closed through the existing source contract; normal approved mode remains file-backed. Imported test content requires demo mode. `LOCAL_DB_TRUSTED_ORIGINS` now includes same-origin 8787 defaults for either local imported-source mode. `.env.example` documents explicit local-only activation.
- Verified: SQLite-source/service tests 2/2 now run entirely against a deterministic temporary SQLite plus JSONL fixture (no live database or ignored output dependency). They cover supported explicit-letter intake, unknown/false eligibility remaining non-Huroof, staged supported conflict, unsupported and malformed holds, global shared-answer concepts, source snapshot change detection, and Huroof/Categories pinned-room fail-closed restoration. Setup route tests 20/20 (existing React act warnings only); typecheck; lint; and `VITE_GAME_RUNTIME=local` build (existing >500 kB chunk warning only). Hostile-origin inventory reads were rejected (400 with no ACAO). Restarted only verified PID34968 as hidden PID16276 with explicit actual DB and sqlite-import mode; `/api/question-inventory` returns the counts above on `http://127.0.0.1:8787/host/new`.
