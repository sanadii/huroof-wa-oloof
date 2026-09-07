# استوديو الحروف — documentation index

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
