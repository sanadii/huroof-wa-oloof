# Milestones

## M-7 — Host lobby management (authorized 2026-09-07)

Entry: existing host/lobby runtimes and approved 0007 design. Task: [T-08](IMPLEMENTATION-PLAN.md#t-08--host-lobby-management-2026-09-07). Owner: Forge, root acceptance. State: Complete — root accepted local multiplayer and responsive evidence 2026-09-07. Exit: task acceptance/checks, local multiplayer and Firebase persistence evidence, integrated root review. Independent of pending production M-6; no deployment authorization.

| Milestone | Owner | State | Evidence / remaining work |
| --- | --- | --- | --- |
| M-1 Inventory and baseline | Forge | Complete | 17 documentation files, route inventory, graph limitations, baseline checks, historical evidence. |
| M-2 Homepage C selection/review | Root/user | Complete | 0006 selected C; 0007 authorizes expansion of the approved homepage treatment after live review. |
| M-3 Whole-app C implementation | Forge | Complete | Public/setup/lobby, role/results, rules/errors, account/auth, and guarded admin preserve actual behavior. |
| M-4 Local functional verification | Root / Forge | Complete | Rules, fixture smoke, Firebase E2E, emulator-admin flow, accessibility and responsive route evidence. |
| M-5 Independent Gate | Gate | Complete | Technical PASS after post-fix build/scan/board/admin-only/Firebase/rules/smoke checks. |
| M-6 Production readiness | Release owner | Pending | Production Google/App Check/signing/approved release, Node parity, and dependency audit follow-up. |

M-5 is a technical Gate PASS, not deployment authorization or a production-verification claim.
# M-8 — QR joining and live team management (2026-09-08)

Authorized by user; depends on completed M-7/T-08. Assigned task: [T-09](IMPLEMENTATION-PLAN.md#t-09--qr-joining-and-host-player-moves-2026-09-08). Entry: existing join path and host-only assignment. Exit: QR and accessible drag/drop verified, matching local/Firebase safe-state guards tested, independent Gate and root acceptance. Done — root accepted 2026-09-08; browser and Gate evidence linked in T-09. No production deployment.

## M-9 — Compact host controls and consistent team cards (2026-09-08)

**Authorization/state:** user authorized proper planning followed by implementation; Done — root accepted 2026-09-08. Assigned canonical task: [T-10](IMPLEMENTATION-PLAN.md#t-10--compact-host-controls-and-consistent-team-cards-2026-09-08), including its verbatim visual contract and D-10.1–3 decisions. Owner: Forge implementation/checks, root acceptance.

**Entry:** M-7/T-08 accepted; read current T-09/M-8 source, binding DESIGN-DNA/0007 and mixed git baseline. T-09 is implementation-complete/review-pending and is a source dependency, not an accepted release dependency. Its remaining security/Gate/LAN checks remain separate and cannot be closed by M-9.

**Order/deliverables:** T-10.1 baseline and component/cascade map → T-10.2 shared capsules and score hierarchy → T-10.3 compact phase/supporting-control composition → T-10.4 focused tests/build/browser/screenshots → T-10.5 root integrated acceptance. All references resolve within T-10; no new design selection or backend change is part of this milestone.

**Exit:** AC-10.1–9 evidence recorded in T-10, implementer “Implementation complete — ready for review”, root load-bearing browser/diff review, and root Done status. Optional AI visual review remains advisory. No current consequential unresolved design blocks execution; any new backend/security/geometry scope requires root decision before expansion. Production M-6 stays pending and deployment remains unauthorized.

M-9 completion: T-10.1–5 and AC-10.1–9 verified; source checks and final real multiplayer/responsive evidence linked in T-10. T-09/M-8 was separately accepted; earlier pending dependency notes are historical. Production M-6 remains pending.

## M-10 — Required join names and manual players (2026-09-08)

Authorized follow-up; Done — root accepted with technical Gate PASS 2026-09-08. Assigned [T-11](IMPLEMENTATION-PLAN.md#t-11--required-join-names-and-host-created-manual-players-2026-09-08). Entry: current T-10/T-09 source and accepted technical status, preserving dated lobby human-review limitation; database/security review of additive separate roster and identity boundaries. Sequence: T-11.1 review → T-11.2 local/contracts → T-11.3 Firebase parity/persistence → T-11.4 UI → T-11.5 automated/emulator/browser evidence → T-11.6 Gate/root acceptance. Exit: AC-11.1–8 met, real Firebase persistence verified, manual entries never treated as auth members, integrated root acceptance. No production M-6/deployment authorization. Root owns decisions/status; Forge owns implementation/checks. Visual contract and rollback are canonical in T-11.

M-10 entry update: database/storage and security review prerequisites report no blocker; implementation may proceed under T-11. Remaining T-11.1 work is Forge's baseline/harness inspection.

M-10 completion: T-11.1–6 and required feature checks complete. Root and Gate acceptance plus final Firebase/local evidence are recorded in T-11. Broader UI category-recovery failure remains outside this feature; production M-6 remains pending.

## M-11 — Truthful host player connection status (2026-09-08)

Authorized user follow-up; Done — root accepted with technical Gate PASS. Assigned [T-12](IMPLEMENTATION-PLAN.md#t-12--truthful-host-player-connection-status-2026-09-08). T-12.1–6 completed with private lease authority reviews, local socket presence, Firebase leases/callables, independent status UI and actual multitab/expiry/reconnect evidence. Root verified mobile layouts, host offline, display capability preservation and clock skew. AC-12.7 retains the explicitly reported broader Firebase game-flow 90-second timeout; the presence-specific checks passed. No RTDB/rules expansion or T-12 production deployment.


## M-BUNDLE-01 — Production source-question intake (2026-09-08)

Authorized by user: import all questions from the supplied bundle to production Firestore huroof-a3ee7. Assigned tasks: T-13.1–T-13.4 in IMPLEMENTATION-PLAN.md. Entry: completed CLI login, verified production metadata and deployed blanket-deny rules. Database advisory disposition supports isolated, immutable source intake. Dependencies: parser reconciliation and focused tests precede integrated Gate; Gate precedes writes; exact full readback precedes root Done. Exit: immutable bundle manifest and all expected question/provenance records verified; active-release state unchanged. Scope excludes gameplay approval/activation. Status: in progress.

M-BUNDLE-01 execution: all source questions and blueprints stored/verified; full provenance+manifest incomplete due confirmed production write quota. Not Done. See T-13 production execution evidence.


## T-14 release-readiness sequence (2026-09-08)

Canonical task detail: IMPLEMENTATION-PLAN.md T-14. Planning authorized by user's request to make games playable/deploy-ready and subsequent request for the planning phase. Source intake remains M-BUNDLE-01, not duplicated here.

| Milestone | Tasks | Entry dependencies | Exit evidence | State |
| --- | --- | --- | --- | --- |
| M-READY-01 | T-14.1 | Baseline audit; no billing dependency | UI failures resolved; deep links; explicit production build; real Firebase full game passes | Done — accepted baseline |
| M-READY-02 | T-14.2 | M-READY-01; D-14.5/8 media/visual contract |240 accounted real assets; authorized current-question media; image E2E/security/Gate | Done — root accepted, scoped local Gate PASS 2026-09-09 |
| M-READY-03 | T-14.3 | D-14.1/2/3; M-READY-02 media mapping | deterministic source reconciliation; category/mode coverage; explicit held rows | In progress — reconciliation artifacts verified; scope/curation holds remain |
| M-READY-04 | T-14.4 | M-READY-03; real reviewer/trust D-14.4 | genuine receipts; canonical approved corpus; zero required findings; release dry-run | Planned; human/trust dependencies |
| M-READY-05 | T-14.5 | M-READY-01/02; sufficient quota/billing; M-READY-04 for release uploads | intake manifest, media hashes, verified release, production config evidence | Planned; quota-blocked |
| M-READY-06 | T-14.6 | M-READY-01–05; exact verified release | full host/player/audience classic/image/charades tests; independent Gate; rollback; exact deployment evidence if rolled out | Planned |

No dependency points forward except optional independent infrastructure preflight explicitly described in T-14.5. No milestone is Done based on planned acceptance or a passing fixture build. Root updates final status; Forge may update assigned task evidence only.

## T-15 polish sequence (2026-09-08)

Start here: [review](APP-POLISH-REVIEW.md), [canonical tasks and decisions](IMPLEMENTATION-PLAN.md#t-15--category-game-flow-and-whole-app-polish-2026-09-08), [handover](HANDOVER.md#t-15-review-and-planning-handover-2026-09-08). Review/planning delivered; no implementation milestone is Done. Root owns final status; Forge owns one assigned milestone at a time.

| Milestone | Task / deliverable | Entry dependencies | Exit evidence | State |
| --- | --- | --- | --- | --- |
| M-POLISH-01 | T-15.1 rules, baseline and compatible domain contract | Current review; resolve D-15.1–7; consume T-14.1 baseline before runtime execution | Legal-event/timeout/role matrix, compatibility and persistence review, baseline evidence | Planned |
| M-POLISH-02 | T-15.2 category boards and terminal-failure replacement | T-15.1; T-14.1 | Local/Functions parity, fresh questions, exactly-once rotation, pool exhaustion and legacy-room checks | Planned |
| M-POLISH-03 | T-15.3 setup, entry and waiting room | T-15.2; approved 0007; preserve T-12 | Two-player entry/readiness, coverage guidance, mobile/keyboard evidence | Done — root accepted; T15-EXECUTION evidence |
| M-POLISH-04 | T-15.4 host/player/display and motion | T-15.2–3; T-14.2 only for image combinations | Readable category cells, safe projections, failure/continue flow, reduced motion, TV/mobile evidence | Done — root accepted; T15-EXECUTION evidence |
| M-POLISH-05 | T-15.5 admin workflow polish | T-15.1; T-15.2 for category readiness | Authenticated admin filtering/edit/conflict/recovery and responsive evidence | Done |
| M-POLISH-06 | T-15.6 integrated game-flow acceptance | T-15.2–5; T-14.1; T-14.2 for images | Full multi-role local/Firebase flows, required checks, root/material technical Gate, human walkthrough evidence | Done — root accepted; final Gate PASS; walkthrough presented |

Execution order is 01 → 02 → 03 → 04 → 05 → 06 with one writer; 05 has fewer technical prerequisites but is sequenced to avoid shared-file conflicts. No forward dependency or production release is implied. New visual direction is excluded; use the approved C contract. T-14 baseline/media/release milestones retain their independent status and blockers.

T-15 authorization update: user requested full start-to-end implementation and flow verification. M-POLISH-01 is in progress; M-POLISH-02–06 are authorized sequentially with their existing prerequisites. Root accepted D-15 defaults in GAME-KIND-CONTRACT.md. The planning-only statements above are historical, not an implementation block.
T-15 execution checkpoint: M-READY-01/T-14.1 and M-POLISH-01/T-15.1 accepted by root 2026-09-08. M-POLISH-02/T-15.2 in progress; later milestones remain authorized/pending. Hidden-band visual assertion remains T-15.4/6.

T-15 checkpoint — 2026-09-09 Kuwait: M-POLISH-02/T-15.2 accepted after root repairs and definitive Firebase6/6 exit0; [root evidence](../output/t15.2-root-review.md). M-POLISH-03/T-15.3 is the next authorized active milestone. Remaining milestones stay pending.

## M-IMPORT-01 / T-16 — Local master-bundle reconciliation

T16.7 follow-up complete: the user-authorized local SQLite test runtime now exposes6213 supported records/58 categories; both game kinds independently verified against imported content. Stored data/approvals unchanged. [Runtime evidence](../output/master-import-20260909/RUNTIME-TEST-REPORT.md).
Done — root accepted2026-09-09. Dependencies and tasks T16.1–6 satisfied: validated input, verified backup,6540 outcomes, preserved baseline,240 loaded private media, live import/readback and zero-new-row rerun; technical Gate PASS. [T16-MASTER-IMPORT.md](T16-MASTER-IMPORT.md), [final evidence](../output/master-import-20260909/IMPORT-REPORT.md). No dependency on production T-13/T-14 completion.

## T-17 media sequence — 2026-09-11
[M-MEDIA-01 / T17.1 -> M-MEDIA-02 / T17.2 -> M-MEDIA-03 / T17.3](T17-QUESTION-MEDIA.md). T17.1 and T17.2 are Done. T17.3 implementation/preparation is accepted with final Gate PASS; online rollout remains blocked by external authentication and reviewed-release prerequisites. Ordered dependencies, verification evidence and exact continuation are in the canonical task detail.

## T17.3a — Consolidated Firebase content sync — 2026-09-11
Authorized source reconciliation/private upload follow-up under T17.3. [Execution contract](FIREBASE-CONTENT-SYNC.md). T17.3a.1 offline preparation accepted after Database review, ten focused tests, full asset validation, typecheck and Gate v4. T17.3a.2 cloud upload blocked: fresh SDK authentication works with Windows system CA, but production billing is disabled and no Storage bucket exists. Nineteen photo entries remain rate-limited. No cloud mutation occurred; [report and exact continuation](../output/firebase-sync-20260911/FIREBASE-SYNC-REPORT.md).
