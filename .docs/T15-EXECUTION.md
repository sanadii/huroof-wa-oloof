# T-15 execution evidence

This is the evidence checklist for [canonical T-15](IMPLEMENTATION-PLAN.md#t-15--category-game-flow-and-whole-app-polish-2026-09-08), not a replacement plan. Root owns final acceptance. Each Forge milestone may update only its assigned section and evidence. A checked box requires current source and a named verification result.

## T-15.1 / M-POLISH-01 — contract and baseline

- [x] User authorized all six milestones; root adopted D-15 defaults in GAME-KIND-CONTRACT.md.
- [x] Shared dependencies traced through Graphify and actual source.
- [x] Approved visual direction retained; T15-VISUAL-REFERENCES.md records bounded reference research.
- [x] Database/persistence constraints disposition recorded in T15-RUNTIME-REVIEW.md.
- [x] Security/validation/replay constraints recorded in T15-RUNTIME-REVIEW.md for the implementation handoff.
- [x] T-14.1 baseline accepted with actual Firebase4/4 flow evidence and root adapter regression2/2.

State: Done — root accepted 2026-09-08. T-14.1 UI88, game33, Functions28 and Firebase4 passing; root source/adapter check2 passing. Hidden-band visual assertion remains T-15.4/6.

## T-15.2 / M-POLISH-02 — authority

- [x] Distinct gameKind; legacy default and unsupported combinations validated on both authorities.
- [x] Exactly 25 category cells with stable coordinate identity and deterministic category/occurrence labels.
- [x] Selected categories, unique concepts, startup capacity and release pinning enforced.
- [x] First incorrect judgment preserves the opponent opportunity and unchanged question/cell.
- [x] Opponent incorrect, opponent timeout and no-buzz timeout reach terminal failure.
- [x] Continue and legacy retry/return cannot reopen a disclosed question.
- [x] Category changes to another eligible selection; numbered Huroof letter changes while number stays fixed.
- [x] Consumed questions/concepts remain monotonic through rounds, correction and reconnect.
- [x] Concurrent/replayed/stale intents cannot double consume, rotate, allocate or score; malformed intents rejected.
- [x] Exhaustion hold has a real end/new-match recovery and no fabricated winner.
- [x] Public projections never include private queues, reserved content or answer metadata outside permitted lifecycle.
- [x] Local/Functions event parity and Firebase persistence verified; existing Huroof and modality behavior covered.

State: Done — root accepted 2026-09-09 Kuwait. Implementer checks: local42, Functions30, UI88, typecheck/build. Root captured definitive Firebase6/6 in1.7m with exit0 ([full log](../output/t15.2-firebase-root.log)); independently verified join/capacity and counter/number/round-reservation/policy probes. Root added the missing local held-cell projection ID and its focused regression passed1/1. [Root review and acceptance](../output/t15.2-root-review.md). Full visual/multi-role category rollout remains T-15.3–6.

## T-15.3 / M-POLISH-03 — setup, entry and waiting room

- [x] Kind, scope and valid settings survive setup/create/reconnect/rematch.
- [x] Code/name/deep-link entry and validation recover with retained intent and accessible focus.
- [x] Two independent players join, ready and appear truthfully to host; manual/online/unknown remain distinct.
- [x] Compact code/share, two rosters, discoverable Start and readiness blocker.
- [x] 320/390px and desktop screenshots, keyboard/touch and accessibility evidence.

State: Done — root accepted 2026-09-09 Kuwait after live phone category creation, desktop composition, copy and repaired QR open/generate/dismiss verification. UI92, focused host-lobby15, typecheck/build, local both-kind two-player flow and Firebase6/6 pass. Evidence: [T-15.3 verification](../output/t15.3-verification.md), [root review](../output/t15.3-root-review.md), [Firebase 6/6 log](../output/t15.3-firebase.log), [entry/setup/lobby captures](../output/playwright/), [interaction result](../output/t15.3-interaction.json), [font fallback result](../output/t15.3-font-fallback.json). Human aesthetic approval is not inferred.

## T-15.4 / M-POLISH-04 — gameplay surfaces and motion

- [x] Category names and occurrence numbers readable in cells, with full accessible names.
- [x] Canonical hit geometry, team axes and score placement survive responsive layout and zoom.
- [x] Host phase/answer/Continue, player buzzer/opponent instructions and audience waiting copy match authority.
- [x] Audience visibility preference, stale/offline/reconnect, correction and exhaustion states verified.
- [x] Finite state-driven animation; reduced-motion static; no reconnect celebration replay or delayed buzzer.
- [x] 1280×720/1920×1080 display and mobile/tablet host/player evidence.

State: Done — root accepted 2026-09-09 Kuwait after rendered/source review and live category create/start/prepare/no-answer/Continue, native phone modal/Escape/focus and25-cell arrow traversal. [Root review](../output/t15.4-root-review.md), [verification](../output/t15.4-verification.md); UI103, game42, typecheck/build, local dual-kind multi-role flow and role axe passing. Root independently reran board/modal/reconnect27/27 and scanned category host question/modal without serious/critical axe findings. Two known mixed-content lint errors and legacy inventory visual assertion remain explicitly assigned T-15.6. Image combinations require T-14.2; human aesthetic acceptance is not inferred.

## T-15.5 / M-POLISH-05 — admin

- [x] Arabic meaningful inventory/status labels and dedicated resource columns/details.
- [x] Loaded-page filter scope, result counts, pagination and clear reset/retry controls.
- [x] Category picker, field validation, grouped sources and editable review-change reason.
- [x] Save conflict, unsaved navigation, pending, empty, forbidden and error recovery preserve work.
- [x] Viewer/editor/reviewer controls reflect capabilities; publication/review readiness remains truthful.
- [x] Authenticated emulator workflow, responsive and accessibility evidence.

State: Done — root accepted 2026-09-09 03:52 Kuwait after final source/rendered review and independent admin14/14 plus full app/node typecheck. [Root review](../output/t15.5-root-review.md), [final root test log](../output/t15.5-root-admin-tests-final.log). The final repair uses a keyed question editor plus loaded-record gate, a shared save/validate/review mutation guard, dirty-review/validate prevention, and global dirty-state disposal after confirmed exit. It also adds loaded-page question status/category/modality selectors whose free-text search includes visible Arabic labels; category title fallbacks, date labels, and an explicit empty-category recovery keep operator state truthful. No schema, role, rules, grant, production, or publication-policy changes.

Evidence: `npx vitest run tests/app/admin-routes.test.tsx` passed 14/14 (deferred qA→qB success/failure load gates, pending review lock, dirty validate/review no-call, confirmed exit cleanup, Arabic filter selectors, and empty metadata recovery); scoped ESLint passed; `npm run test:ui` previously passed 109/109; `npm run build` passed after the final changes; `git diff --check` passed with no diff errors. The [authenticated history run](../output/t15-admin-history-proof-final.log) passed after a real emulator Google popup and guarded bootstrap: callable save → stable UUID URL → saved Back → Forward → repeated dirty cancel/accept cycles. Its guarded emulator-only category fixture records [006/007 metadata](../output/t15-admin-category-fixture.mts) with server timestamps so the real callable pager can render the category picker. The [390px toolbar check](../output/t15-admin-toolbar-check.log) passed (390/390 no overflow, three 44px selectors, 74px labels, Axe serious/critical 0) with [render capture](../output/playwright/t15-admin-questions-filters-final-390.png). Existing authenticated desktop overview, saved-reopen and conflict captures remain at `output/playwright/t15-admin-*-final-*.png`.

## T-15.6 / M-POLISH-06 — integrated acceptance

- [x] Independent host + two player + audience contexts complete both game kinds locally and in Firebase emulator.
- [x] Trace includes correct, initial/opponent wrong, no answer, replacement, pause/resume and reconnect.
- [x] Correction, later rounds, two-consecutive and three-total victory rules, results and rematch verified.
- [x] Adverse race/replay/insufficient-pool/legacy-room traces verified.
- [x] Typecheck, lint, visual structure scan, content/UI/game tests and app build pass.
- [x] Functions build/tests, required Firebase/rules, visual and accessibility checks pass.
- [x] Root integrated source/rendered review and material technical Gate complete.
- [x] User-facing live walkthrough/screenshots presented; final human visual feedback remains unrecorded and is not inferred.

State: Done — root accepted 2026-09-09 Kuwait. Final technical Gate PASS closes F1/F2; root reviewed the current held-room capture and integrated evidence. The walkthrough is presented at `output/T15-WALKTHROUGH.md`; final human visual feedback remains unrecorded and is not inferred. Production/media release prerequisites remain separately governed by T-14.

### Early integrated-check evidence — 2026-09-09 Kuwait
Root ran `npm run test:content`:69/69 passed, exit0 ([log](../output/t15-content-root.log)). `npm run scan:visual` failed, exit1 ([log](../output/t15-visual-scan-root.log)): stale flat-gameplay gradient assertion and token findings. T-15.6 must reconcile obsolete assertions against approved0007 and resolve actual styling drift while retaining meaningful structural checks. No full integrated acceptance inferred; final changed-source checks remain required.
Root `npm run test:firebase-rules` initially failed before startup because Java was absent from PATH ([initial log](../output/t15-rules-root.log)). Command-local JAVA_HOME/Path using installed Android Studio JBR resolved the environment prerequisite; Firestore and Storage suites completed and emulator script exited0 ([passing log](../output/t15-rules-root-jbr.log)). Test-emulator shutdown and default ports free verified. Expected permission-denied output is from negative authorization assertions. No source/rules changes made; final acceptance must confirm these files remain unchanged or rerun affected checks.
Root full `npm run typecheck` (app and node/tooling projects) exited0 during T-15.4 final repairs; log output/t15-typecheck-root.log. Final changed-source verification remains required after remaining milestones.

Root early whole-match probe — 2026-09-09 Kuwait: existing local smoke has stale setup/end heading and alternative-action selectors. Temporary artifact probes (not checked-in test changes) assert actual lifecycle and current correct-answer button. Both Huroof and categories complete two rounds with host/audience MATCH_COMPLETE, then fail rematch-to-polished-lobby: new room renders host shell because previous room state appears to drive activeLobbyDestination. Logs: output/t15-root-local-match-final.log, output/t15-root-category-match-2.log; stable snapshot output/t15-root-rematch-error-context.md. Assigned explicit T15.6 fix and both-runtime regression in acceptance handoff; no whole-match/rematch completion claim.

Root post-repair full local browser proof — 2026-09-09 03:57 Kuwait: temporary source-served Vite5188 proxied to existing task authority8787. `npx playwright test -c .agent-runtime/playwright-root-live.config.ts` returned exit0:2/2 in14.5s (output/t15-root-rematch-live.log). Independent host/two-player/audience contexts complete two rounds for Huroof and categories, assert host/audience MATCH_COMPLETE and winner, then actual same-settings new-room polished lobby. Root source modifications:none; temporary probes retain initial stale-selector adaptations described above. This closes the reproduced local rematch flow failure. Final checked-in suites, Firebase counterpart, payload/adverse/matrix checks and Gate remain. Root Vite5188 stopped intentionally after proof; benign WebSocket resets occurred as browser contexts closed, not test failures.

Root Firebase integration finding — 2026-09-09: Full browser evidence exposed a material terminal Continue mismatch. `functions/src/index.ts` replaces/clears the failed cell at lines521–566/909, but `functions/src/game.ts` forwards RETRY_CELL into the legacy reducer and opens QUESTION_READING. The accepted contract requires CELL_SELECTION, cleared question and no active timer, as local service already enforces by mapping both failed-cell aliases to RETURN_CELL. Assigned to the active Forge writer; tests must retain the contract assertion. Earlier Functions30/30 did not cover this integration path and are not proof that this defect is absent. T15.6 remains in progress.

Root current UI verification — 2026-09-09 04:21 Kuwait: `npm run test:ui` passes111/111 across15 files, exit0 (`output/t15.6-root-ui.log`). Root inspected the new Firebase non-charades terminal branch: both RETRY_CELL and RETURN_CELL dispatch RETURN_CELL, clear activeQuestion/timer/buzzWinner, while the callable retains atomic cell replacement. Focused Functions regression is reported passing by Forge; full Firebase browser rerun remains pending. This closes source-level review of the specific repair, not final T15.6 acceptance.

Root Firebase rerun evidence — 2026-09-09: inspected `output/t15.6-firebase-browser-complete-passing.log`, which ends7/7 passed(2.2m), Script exited successfully(code0), followed by emulator shutdown. Both real four-context Huroof/category matches complete two rounds, MATCH_COMPLETE/results/new-room rematch. The restored terminal-return and private-projection assertions pass. The Firebase continuation defect is closed against this run; scanner hardening, checked-in local smoke and final rendered/technical gate remain open. Fresh UI111/111 proof remains linked above.

Root visual-scan repair review — 2026-09-09: inspected scanner restoration of CSS-gradient rejection, exact-path/fixed-pair QR exemption and removal of arbitrary custom-property stripping. New semantic palette/shadow declarations now live in canonical `design/tokens.css`; source uses existing radius tokens. Independently ran `npx tsx --test tests/scan-visual-contract.test.ts`:4/4 pass, exit0. Broad-bypass finding from `output/t15.6-scanner-root-review.md` is closed structurally. Requested wiring these regression tests into the checked-in verification command; no aesthetic approval is implied.

Root local-smoke acceptance correction — 2026-09-09: rejected replacement of polished-lobby rematch assertion with generic host LOBBY/host-heading assertion. The latter masks the previously fixed stale-room defect. Root verified `dist/index.html`03:49:59 predates `src/routes/GameRoutes.tsx`03:54:11; local8787 serves that stale dist. Assigned restore of lobby assertion and current local build/source-live rerun. `output/t15.6-local-complete-matches-rerun.log`2/2 is NOT accepted rematch evidence because it asserted the wrong surface. Earlier independent current-source2/2 `output/t15-root-rematch-live.log` remains valid. T15.6 remains open pending corrected checked-in test/build evidence.

Root accepted corrected local browser evidence — 2026-09-09: verified restored exact polished-lobby assertion in checked-in `tests/e2e/smoke.spec.ts` and current-source build log. `output/t15.6-local-complete-matches-current-dist.log` passes2/2(12.2s) for both modes; each finishes two rounds, results and new-room waiting lobby. This supersedes the stale-dist/incorrect-assertion rerun above. Build succeeds with the existing >500kB chunk warning, not a build error. Final rendered/a11y matrix and technical Gate remain open.

### Forge final implementation evidence — 2026-09-09 Kuwait

`npm run test:e2e:firebase` exited0 with7/7 in2.2m (`output/t15.6-firebase-browser-complete-passing.log`): real isolated Firebase Auth/Firestore/Functions/Storage browser workflows cover both Huroof and categories with host, two players and audience. They include private-projection assertions, simultaneous buzz/reload, correction, no-buzz replacement, first/opponent wrong replacement, pause/resume, complete two-round result and same-settings polished rematch. The non-charades retry/return contract is also covered by the current Functions suite.

The rebuilt checked-in local browser suite passes2/2 (`output/t15.6-local-complete-matches-current-dist.log`); the earlier stale-dist failure/incorrect assertion is retained above as superseded evidence. `npm run functions:test` passes30/30 (`output/t15.6-functions-test-final.log`), and JBR-backed `npm run test:firebase-rules` exits0 (`output/t15.6-firebase-rules-final.log`); expected Firestore permission-denied output is from negative authorization assertions.

`npm run verify` exits0 (`output/t15.6-verify-final.log`): typecheck, lint, structural visual scan, scanner regression4/4, content69/69, UI111/111, game42/42 and app build all pass. The build retains the existing Rollup >500kB chunk warning only. The scanner regression now has the checked-in `test:visual-contract` script and is included in `verify`; it rejects raw gradients, non-QR palette pairs and custom-property palette escapes while allowing only the exact QR encoding call and approved tokenized SVG stops.

Current local rendered evidence passes2/2 (`output/t15.6-visual-current-dist-complete-rerun.log`) and the expanded Axe matrix passes4/4 (`output/t15.6-a11y-current-dist-expanded.log`). The explicit capture inventory, viewport/state basis and authenticated-admin evidence distinction are recorded in `output/t15.6-visual-current-manifest.md`. Existing authenticated demo-emulator admin evidence remains `output/t15-admin-preview-final.log`, `output/t15-admin-history-proof-final.log` and `output/t15-admin-toolbar-check.log`; it is explicitly demo-only and does not imply production approval.

Root technical Gate return — 2026-09-09: Gate FAIL F1 in `output/t15.6-gate-review.md`. Independent extracted-callback proof reproduces unauthorized/stale/illegal-phase depletion writes before reducer guards; no emulator or source mutations by Gate. T15.6 is reopened for bounded F1 repair, not Done. Same Forge writer assigned shared full preflight before content preparation plus exhausted-content negative callable regressions and applicable Functions/Firebase checks. Prior unrelated visual/UI/local proofs remain valid. Gate re-review required after repair. Walkthrough presented at `output/T15-WALKTHROUGH.md`; final human aesthetic feedback remains unrecorded. Root also corrected setup documentation to the actual8787 local authority serving dist, with rebuild instructions and separate free Vite port.

Root held-screen review F2 — 2026-09-09: `output/t15.6-content-hold-capture-final.log` proves end-without-winner recovery and no overflow at390/1280; root viewed phone capture. However enabled Pause/correction/audience-visibility mutations remain in held host UI although authority permits End only. Assigned same Forge writer a bounded follow-on guard/regression after F1, preserving read-only history and display access. Final held-screen capture must supersede this initial view. This is an existing hold contract gap, not an authorization to add new features.

Root F1 repair checkpoint — 2026-09-09: inspected callable preflight placement before content allocation and established `error()` mapping. Verified `output/t15.6-firebase-f1-preflight-rerun.log` ends8/8 passed(2.3m), script exit0 and cleanup. It adds depleted-content unauthorized/stale/illegal-state no-mutation coverage; Functions now31/31. Same Gate resumed for focused F1 re-review. F2 held-host controls still under implementation; no final acceptance yet.

Forge F1/F2 ready-for-review evidence — 2026-09-09: `functions/src/game.ts` now shares reducer authority checks with `preflightContentPreparation`, invoked by `functions/src/index.ts` after actor/hash receipt replay and before every reservation/content-selection path. The preflight rejects closed, held, stale, inactive, wrong-role, illegal-lifecycle and owned-cell requests before a depletion exception can write state; `error()` maps its failures to the established callable codes. `functions/src/game.test.ts` adds the pure preflight matrix and `tests/e2e/firebase.spec.ts` snapshots canonical room, events, actor receipts and all projections for player/audience/inactive/stale/illegal-phase/closed/owned-cell/illegal-next-round/continuation/already-held depleted requests. `npm run test:e2e:firebase` passed8/8 in2.3m with script exit0 and clean emulator shutdown (`output/t15.6-firebase-f1-preflight-rerun.log`); it asserts stale uses `functions/aborted`. `npm --prefix functions test` passed31/31, full `npm run typecheck` and scoped ESLint passed.

F2 makes a held host truthfully end-only while retaining read-only audit and display access: pause is absent, the audience visibility mutation is disabled with an Arabic recovery reason, and the correction trigger opens audit-only content with no correction form. Focused route/host UI tests pass21/21 (`tests/app/gameplay-state-surfaces.test.tsx` and `tests/app/host-lobby.test.tsx`), production build passed with only the existing >500kB chunk warning (`output/t15.6-f2-build.log`), and `git diff --check` passed. The rebuilt isolated host capture at `output/t15.6-content-hold-f2-final.log` passes at390×844 and1280×720; it verifies no overflow, the legal end action, unavailable pause/audience/correction mutations, `.host-page[data-state=MATCH_COMPLETE]`, and persisted no-winner semantics. Captures are `output/playwright/t15.6-content-hold/{content-hold,end-without-winner}-{390x844,1280x720}.png`. Prior obsolete-heading and first-run Firebase timeout traces remain preserved as superseded evidence.

Root final acceptance — 2026-09-09 Kuwait: all T15 milestones Done. Independently inspected final Gate PASS and current390px hold capture, confirming unavailable mutations removed/disabled, read-only audit preserved and legal End retained. Final Gate independently checked Functions31/31 and held-stateUI4/4; Firebase8/8 and actual hold/results evidence accepted. Walkthrough links verified and presented. No outstanding technical finding in assigned scope; human aesthetic feedback remains unrecorded and production release remains separate. Canonical index/milestones/handover/plan updated; mixed source work preserved without staging, committing or pushing.
