# T40 — Filter categories by question type (2026-09-24)

Start here: [Index](README.md) · [Implementation plan](IMPLEMENTATION-PLAN.md) · [Milestones](MILESTONES.md) · [Handover](HANDOVER.md)

## Scope and evidence

The user requests a filter for categories containing questions, images, video, audio or other types. The linked TV display has no category selector; the existing selector is on host setup. Unless the user directs otherwise, put the filter beside its existing topic/search controls. The filter is for **browsing categories**, not for limiting the question pool after room creation. A category can match several types. Existing selection, playable-category rules, challenge flags and room creation remain authoritative.

The Firebase `getApprovedReleaseCatalog` currently projects only category labels and readiness from immutable metadata; local `questionInventory` also lacks type counts. Category-board selection already includes ordinary image and video questions (`question-selector.ts` excludes only charades), so gameplay selection does not need widening. The runtime has no audio question contract. The active release's catalog rows are immutable, and catalog discovery cannot scan all questions on every request. Preserve [DESIGN-DNA](../DESIGN-DNA.md) and existing RTL setup controls.

## Decisions and boundaries

- T40.D1: classify the **question-side** stimulus: text, image, video, interactive challenge, acting/other. Answer-only media and category cover artwork do not determine question type. Audio remains visibly unavailable until supported content exists; never infer it from music category names.
- T40.D2: create a separate server-owned, release-bound aggregate index. It carries release ID, root SHA-256, classifier version, category IDs and nonnegative counts, but no question text, answer, media identifier or grading data. Do not change immutable release children or grant clients direct Firestore reads.
- T40.D3: count only reconciled immutable approved questions. Reject duplicates, missing categories, unexpected modalities, total mismatches or pointer changes during publication. A missing/stale index leaves normal catalog browsing working while type controls report unavailable.
- T40.D4: the filter intersects search, topic and selected-only browsing. Hiding selected cards does not deselect them. Reset returns to all. Counts on pills are category counts, not question counts.
- T40.D5: rollout is additive. A sidecar can be ignored by older readers; a new release without it cannot inherit old counts. Removing reader/UI behavior is the rollback; do not rewrite active questions or downgrade rooms.

## Tasks, owners and acceptance

| Task | Owner / dependencies | Outcome and acceptance |
| --- | --- | --- |
| T40.1 Contract and boundary | Root; current release, publisher, privacy and visual contracts | Record exact sidecar namespace, classifier, size bound, rollback and database/security review before persistence. Status: Done; Database conditional GO and Security GO after exact-field fix. |
| T40.2 Deterministic index | Forge; T40.1 | Offline/reviewable aggregate over an exact immutable release. Idempotent create-only publication, exact readback, pointer/root race guard, complete category and question reconciliation. No private question payload in the index. |
| T40.3 Catalog and local parity | Forge; T40.2 | Backend projects allowlisted counts only when release identity matches; old catalog remains usable without index. Local inventory derives counts from its normalized playable source with the same classifier. |
| T40.4 Host filter UI | Root; T40.3 contract | Arabic accessible type controls, accurate enabled/zero/unavailable states, intersections, reset, retained selection, mobile/RTL and keyboard states. Explain that the filter finds categories, while a match may still mix question types. |
| T40.4a Admin category filter | Root; T40.3 contract | Add the same question-type choices to the published-category index. Match against the active release's aggregate index, traverse all authorized category pages before filtering, and leave the ordinary list visible when metadata is missing or stale. |
| T40.5 Integrated release | Root; T40.2–4; material Gate | Focused and build checks, signed-in desktop/mobile readback, fresh active-release index verification, compatible backend and client deployment, production readback. Human pacing review remains separate. |

## Verification and rollback

Test classification of text, prompt image/video, answer-only media, challenge, acting, malformed content and absent audio. Test deterministic reruns, exact category/question totals, stale release identity, duplicate/conflicting writes, truncated metadata, privacy allowlist and no per-request question scan. Exercise filter intersection, empty/zero states, selection retention, reset, release switch and local/Firebase parity. Run app/Node/Functions typechecks, focused tests and production builds, then independent release Gate.

Read-only preparation may inspect the active release. Before any production write, record the exact target, expected impact, recovery and verified active pointer. Sidecar rollback leaves its immutable record in place and stops projecting it; no active-release pointer move is needed.

The reviewed T38 sidecar is 123,282 UTF-8 bytes, below the 900 KiB publication cap. Its immutable key excludes classifier version: a future correction for the same release/root requires disabling this reader or activating a successor release, never overwriting the sidecar. The publisher now rejects extra fields, verifies root approved/category counts in the transaction, and rejects a changed pointer. The UI/browser projection remains inert until a valid sidecar is present.

## Forge implementation evidence — T40.2 / T40.3

Status: **Implementation complete — ready for review.**

- Added `releaseQuestionTypeIndexes/{sha256(releaseId + NUL + releaseRootSha256)}` as the separate immutable metadata namespace. The sidecar has only release binding, schema/classifier versions, category IDs, six nonnegative type counts, aggregate counts, digest and `immutable`; it contains no question or media payload.
- `scripts/question-type-release-index.ts` builds the index from an exact release plan or a streaming, SHA-256-bound successor-children capture. Publication requires the production adapter's transaction to re-read `runtime/activeRelease`, the immutable root and the target sidecar together before a create-only write, then performs exact readback. No production sidecar was written in this task.
- Read-only active-release evidence: the verified T38 B2 successor capture reconciled `115,597` questions and `530` categories against root `e4cdc1b1a885be932875c78ec56b89e34e1f85e6f2cae3f320922b8062a8b9bc`; aggregate counts are text `108,749`, image `4,549`, video `299`, audio `0`, interactive `2,000`, other `0`; index digest `c8cd00ca1003caf7466aa6247ad8f1c130b6fa3bc5e1b0d4cda4d2457083d35c`.
- Catalog projection verifies the sidecar digest, release/root identity, exact sorted category set and total. It reads the sidecar outside the five-minute catalog-readiness cache, so a valid new sidecar is available on the next catalog request. Missing, stale or malformed sidecars retain the ordinary catalog without type counts.
- Local Firestore/SQLite inventory uses the same question-side classifier. Prompt images/videos, interactive definitions and charades are distinguished; answer-only media is ignored; unsupported, conflicting or ambiguous prompt media fails the index instead of being mislabeled. Audio remains a complete zero-count key.

Checks: `npm run typecheck`; `npm run functions:build`; `npx tsx --test tests/question-type-release-index.test.ts`; focused ESLint; read-only stream verification of T38 B2 `SUCCESSOR-CHILDREN.jsonl` with its reviewed SHA-256 and 121,496-child count.

## Root integration and release checkpoint — 2026-09-24

T40.2/T40.3 are root-accepted after code review, a mixed-case ordering repair, exact-field validation and 900 KiB preflight. T40.4 host setup filter is implemented; signed-in desktop/mobile use with real metadata remains unverified. Independent Gate PASS followed five index tests, 17 focused UI tests, app/Node typecheck, Functions build, client build, lint, `git diff --check`, and the Firestore Rules emulator denial test with Android Studio OpenJDK 21. The type filter finds categories with the selected question-side stimulus; it does not constrain gameplay question selection. Audio has zero approved questions and is disabled.

T40.5 remains open for production. The exact reviewed index is `output/t40-question-type-20260924/INDEX.json`, digest `c8cd00ca1003caf7466aa6247ad8f1c130b6fa3bc5e1b0d4cda4d2457083d35c`, bound to active-release candidate `t38b2-calculations-6a73e1c8757035264bf256adad3b146f` and root `e4cdc1b1a885be932875c78ec56b89e34e1f85e6f2cae3f320922b8062a8b9bc`. No production write was made. The Admin SDK has no Application Default Credentials in this isolated workspace; automatic approval review rejected adapting the Firebase CLI refresh token into an ADC file. A standard authorized ADC and a fresh pointer/root read are required before the create-only write. The transaction and callable recheck identity and counts. No active-release or question content mutation is part of T40.5.

Implementation branch `codex/question-type-category-filter-20260924` is published in [PR #11](https://github.com/sanadii/huroof-wa-oloof/pull/11). Its Vercel Preview check passed and deployment `huroof-wa-oloof-60rc5f2ow-sanad-general.vercel.app` is Ready. The PR remains unmerged; production backend/frontend and sidecar are unchanged. Complete T40.5 in order: standard ADC plus fresh identity/readback, compatible catalog Function deployment, create-only sidecar write and exact catalog readback, then production client promotion and signed-in desktop/mobile acceptance.

T40.4a follow-up: the admin published-category index now has a question-type selector using the same release-bound count projection. It requests remaining authorized category pages before filtering, so a matching category beyond the first 50 remains discoverable. Missing or stale count metadata disables the selector with an explanation and preserves the unfiltered list. The focused admin route suite passes 30 tests, and the app production build succeeds. Signed-in visual readback and T40.5 production publication remain open.

Review-only capture command (it emits JSON to stdout and cannot publish): `npm run prepare:question-type-index -- --children D:/projects/huroof_wa_oloof/output/t38-15000-20260924/b2/SUCCESSOR-CHILDREN.jsonl --release-id t38b2-calculations-6a73e1c8757035264bf256adad3b146f --root-sha256 e4cdc1b1a885be932875c78ec56b89e34e1f85e6f2cae3f320922b8062a8b9bc --approved-count 115597 --category-count 530 --children-sha256 20f2eef114b630b8802e842c29bbfddb5c47eaaa752b006baddee902183dc574 --children-count 121496`.
