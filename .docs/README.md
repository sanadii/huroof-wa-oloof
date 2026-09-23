# تحدي الخلية — documentation index

## Production media and combined categories — 2026-09-12

M07 is Done: production has **25,763 questions across 96 supported categories**, with image and goal-video playback verified. Five unsupported acting-game categories remain held. See the [completed T17 milestone](T17-QUESTION-MEDIA.md#m07-final-live-acceptance--done), [all category counts](../docs/CATEGORY-PLAYABILITY-2026-09-12.md), and [verified handover](HANDOVER.md#production-media-and-combined-categories--2026-09-12) for deployment, checks and limitations. Earlier dated status below remains historical.


Visual review accepted (2026-09-11): the user replied “OK continue, do it all” to the rendered integration review. [Current checklist](IMPLEMENTATION-PLAN.md#design-integration-follow-up--2026-09-11) tracks the final bounded loading/error and copy polish. This supersedes older pending-acceptance status below.

Local v19 import (2026-09-11): all 600 questions from the user's `ALL_QUESTIONS.md` are saved as drafts across 20 categories. SQLite now holds 7,193 question rows; all 6,593 prior rows, including the photo-question set, were preserved. Read-back, integrity and duplicate-free rerun passed. [Import report and backup evidence](../output/v19-db-import-20260911/IMPORT-REPORT.md).

Current visual review (2026-09-11): homepage refinement and board-choice placement are implemented and technically checked. [Follow-up checklist](IMPLEMENTATION-PLAN.md#design-integration-follow-up--2026-09-11) and [handover](HANDOVER.md#current-visual-integration-review--2026-09-11) distinguish completed implementation from pending human visual acceptance.

Local photo-question follow-up (2026-09-11): the rebuilt category 011 set is saved in the local SQLite intake database as 60 new drafts, with 51 verified photo associations and 9 missing-photo records. All 6,533 prior SQLite rows were preserved; the new total is 6,593. [Import, backup and verification report](../output/rebuilt-photo-db-import-20260911/DB-IMPORT-REPORT.md). This does not activate image gameplay or change production.

Current test runtime (2026-09-09): T16.7 is complete. The app at127.0.0.1:8787 now uses the imported SQLite bank for explicit local test games:6213 usable questions/58 categories,600 staged unsupported records. Both Huroof and Categories reached imported questions and passed root flow checks. [Runtime report](../output/master-import-20260909/RUNTIME-TEST-REPORT.md), [launch instructions](SETUP-AND-RUN.md). Normal approvals and stored content remain unchanged.

Current task completed (2026-09-09): [T-16 local master-bundle import](T16-MASTER-IMPORT.md), [final report](../output/master-import-20260909/IMPORT-REPORT.md). All6540 incoming rows accounted; stored6813/approved0,240 images verified, repeated apply/check zero new rows. Root accepted after technical Gate and independent live/browser checks. This local request does not modify production intake or reopen completed polish/branding work.

Current branding follow-up (2026-09-09): user-directed rename to **تحدي الخلية** and category-only, text-free app background are implemented and locally verified. See [asset and prompt](../design/cell-challenge-background.md) and [current handoff](HANDOVER.md#brand-and-background-follow-up--2026-09-09). Earlier identity statements below are historical and superseded by this explicit request; immutable design receipts remain unchanged.

Current execution checkpoint (2026-09-09 Kuwait): T-14.1 baseline and all T-15.1–6 app polish/category-game milestones are accepted. Both modes complete local and Firebase matches/rematches; final technical Gate PASS closes the depleted-content preflight and held-control findings. Start with the [walkthrough](../output/T15-WALKTHROUGH.md), [execution evidence](T15-EXECUTION.md) and [final Gate report](../output/t15.6-gate-review.md). Final human visual feedback is unrecorded; production deployment remains separate. Dated planning-only statements below are historical.

Completed host feature (2026-09-08): [T-12 truthful host player connection status](IMPLEMENTATION-PLAN.md#t-12--truthful-host-player-connection-status-2026-09-08), [M-11](MILESTONES.md#m-11--truthful-host-player-connection-status-2026-09-08), [handover](HANDOVER.md#current-authorized-work--t-12--2026-09-08). Root accepted with technical Gate PASS; the broader Firebase game-flow timeout is recorded separately. Accepted T-11 entry/display refinements remain preserved. T-12 does not deploy to production or change historical design receipts; see the separate T-13 intake authority below.

The product is an Arabic multiplayer letter-and-question game. The human-selected visual direction is **مدار الحروف**: a cobalt architectural studio using real DOM controls, an authentic 25-cell board, and role-safe game projections. The product name remains **استوديو الحروف**.

## Current status — 5 September 2026

The C direction has been implemented across public, game, account/auth, and guarded admin surfaces under the user's authorization to expand the approved homepage treatment. Independent Gate technical review passed. This is not a deployment approval.

- Immutable selection and rollout-authority records: [0006](../design/evidence/history/0006-spatial-studio-homepage-direction.md) and [0007](../design/evidence/history/0007-spatial-studio-whole-app-rollout.md).
- Local evidence covers unit, content, Functions, rules, fixture smoke, Firebase E2E, emulator-admin workflow, accessibility, and responsive route review.
- Production Google authentication, App Check/signing, and an approved production release remain guarded or unavailable locally.

## Read in this order

### Product, inventory, and design

- [PROJECT-BRIEF.md](PROJECT-BRIEF.md) — product and design authority.
- [APP-INVENTORY.md](APP-INVENTORY.md) — exact route and capability inventory.
- [FEATURES.md](FEATURES.md) — supported feature status.
- [DESIGN-PLAN.md](DESIGN-PLAN.md) — selected C direction and immutable evidence.
- [DECISIONS.md](DECISIONS.md) — durable technical and design decisions.

### Implementation and current state

- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — canonical task, owner, dependency, and acceptance mapping.
- [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md) — runtime, chunking, emulator design.
- [DATABASE-REVIEW.md](DATABASE-REVIEW.md) — entity, index, transaction, recovery, and auth review.
- [PAGE-REVIEWS.md](PAGE-REVIEWS.md) — findings and rendered-route evidence.
- [MILESTONES.md](MILESTONES.md) — delivery and Gate status.
- [PROGRESS.md](PROGRESS.md) — concise current checkpoint.
- [CHANGELOG.md](CHANGELOG.md) — mutable change summary.

### Run, QA, and release handoff

- [SETUP-AND-RUN.md](SETUP-AND-RUN.md) — local, fixture, and emulator commands.
- [QA-CHECKLIST.md](QA-CHECKLIST.md) — verification evidence and limits.
- [DEPLOYMENT.md](DEPLOYMENT.md) — canonical release/migration/rollback guidance.
- [HANDOVER.md](HANDOVER.md) — source delta and release follow-up.

Current bundle intake: [T-13 production question intake](IMPLEMENTATION-PLAN.md#t-13--complete-bundle-intake-to-production-firestore-2026-09-08). User authorized production import; gameplay activation remains separate.

Current release-readiness execution (2026-09-09): [T-14](IMPLEMENTATION-PLAN.md#t-14--playable-content-image-delivery-and-deployment-readiness-2026-09-08), [milestone sequence](MILESTONES.md#t-14-release-readiness-sequence-2026-09-08), [current handover](HANDOVER.md#t-14-execution-authorization--2026-09-09). T-14.1 and T-14.2 are accepted locally; T-14.3 source reconciliation and coverage reporting are in progress. User publication approval is recorded. Scope decision D-14.1 and review/infrastructure prerequisites remain explicit; see [live deployment evidence](DEPLOYMENT.md).

Latest app review and polish plan (2026-09-08): [source/rendered findings](APP-POLISH-REVIEW.md), [T-15 category game and polish](IMPLEMENTATION-PLAN.md#t-15--category-game-flow-and-whole-app-polish-2026-09-08), [six milestones](MILESTONES.md#t-15-polish-sequence-2026-09-08), [handover](HANDOVER.md#t-15-review-and-planning-handover-2026-09-08). Astra medium planning is complete; implementation is planned. T-14 remains the separate baseline/content/release authority.

T-15 execution is now authorized start to end. Supporting authorities: [game rules](GAME-KIND-CONTRACT.md), [runtime review constraints](T15-RUNTIME-REVIEW.md), [visual reference lock](T15-VISUAL-REFERENCES.md), [execution evidence](T15-EXECUTION.md). These extend the canonical T-15 tasks; they do not replace the milestone sequence or mark pending work complete.

Current category mapping request (2026-09-09): user authorized mapping all supplied categories after confirming the source inventory extends through100. Continue [T-14.3 mapping completion](IMPLEMENTATION-PLAN.md#t-143-mapping-completion--authorized-2026-09-09). Fresh production reads confirm sampled private imports and no active gameplay release. Preserve available-only setup; mapping does not confer review or activation.

T-14.3 source-mapping subtask accepted on2026-09-09: [all100 category mappings and revision counts](../tmp/bundle-import-20260908/t14.3-mapping-reconciliation-v1-summary.md). Full T-14.3 curation/release work remains open; mapping alone does not change playable setup availability.

Local DB game connection accepted2026-09-09: [startup instructions](SETUP-AND-RUN.md), [handover](HANDOVER.md#local-database-game-connection-accepted--2026-09-09). Preview5199 now uses verified Firestore import questions through local authority8797:1184text questions/29categories, explicit draft testing. This supersedes the earlier8fixture-only local setup checkpoint, not production release status.

Latest publication2026-09-09: [GitHub/Vercel evidence and remaining online prerequisites](DEPLOYMENT.md#publication-completed--2026-09-09), [current handover](HANDOVER.md#github-and-vercel-publication--2026-09-09). Public preview is explicitly limited; current full local database test app remains on8787 under [T16](T16-MASTER-IMPORT.md).

Current authorized media work (2026-09-11): [T-17 goal video and image gameplay](T17-QUESTION-MEDIA.md) defines three ordered milestones, protected shared reveal, local imports and online rollout.

Current authorized Firebase data consolidation: [T17.3a content sync](FIREBASE-CONTENT-SYNC.md), including related-task source recovery and private media upload; gameplay rollout remains T17.
