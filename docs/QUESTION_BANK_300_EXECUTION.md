# Question Bank 300-per-Category Execution Ledger

Status: `DRAFT_PLAN_REVIEW`
Checkpoint revision: `1`
Started: `2026-09-04T15:24:13+03:00`

## Objective

Create at least 300 policy-valid Arabic questions for every category exposed by the app, store each category in its own canonical file, obtain real review receipts, build an immutable release, and publish and verify it in Firestore project `huroof-a3ee7`, database `(default)`, location `me-central2`.

## Current verified baseline

- The production catalog contains 62 categories.
- The v3.2 policy registry contains 66 policy entries and must be reconciled with the app catalog before authoring scope is frozen.
- The legacy bank contains 280 drafts and zero approved questions.
- The v3.2 pilot contains 408 candidates across 17 categories: 384 `ready_for_human` and 24 `evidence_ready`.
- The v3.2 report currently contains 408 errors and 50 warnings.
- The approved production JSONL contains zero records.
- The production Firestore console currently displays an empty database.
- Firebase MCP/CLI and local ADC are not authenticated/configured for production writes.

## Non-negotiable constraints

- Do not copy Tahadani's 12,400 legacy questions as production questions.
- Do not fabricate human, specialist, media-rights, or release approvals.
- Do not publish drafts, candidates, charades into classic mode, or records with blocking findings.
- Every accepted answer must satisfy Arabic starting-letter policy where the modality requires a target letter.
- Every factual claim needs a source/evidence binding and temporal policy where applicable.
- Every category must have a separate canonical question artifact and deterministic count/hash.
- Shared schemas, manifests, registries, and release outputs are coordinator-owned and edited serially.
- Production publication must use `plan -> prepare -> verify -> activate`; prepare must not change the active pointer.
- Rollback changes only the active pointer to a previously verified immutable release through compare-and-swap.

## Draft acceptance matrix

| Criterion | Required evidence | Current state |
|---|---|---|
| Category scope frozen | Catalog/policy reconciliation and reviewed plan | Pending |
| 300+ per category | Canonical per-category counts, no slots/filler | 0 categories complete |
| Arabic quality | Human Arabic review receipts | 0 receipts |
| Factual correctness | Evidence packets and source checks | Partial pilots only |
| Duplicate safety | Zero errors and zero unresolved review findings | 408 errors, 50 warnings |
| Letter/board readiness | Per-category and combined-pack simulations | Pending |
| Media/rights | Asset hashes, alt text, rights receipts | Pending for image modes |
| Runtime eligibility | Approved canonical export | 0 records |
| Firebase readiness | Non-empty offline plan and authenticated ADC | Blocked |
| Production completeness | Exact ID-set/count/hash readback and active pointer audit | Not started |

## Ownership

- Root coordinator: ledger, shared contracts, integration, evidence reconciliation, and final Firebase authorization boundary.
- Architect: read-only execution contract and pre-mortem (`/root/all_categories_architect`).
- Plan critic: pending architect result.
- Writers: pending approved plan; at most three concurrent, with non-overlapping category/artifact ownership.
- Independent Gate: required after integration and again for the exact production release tuple.

## Evidence log

- `npm run validate:questions -- --as-of 2026-09-04`: 280 questions inspected, 0 approved, 0 errors, 0 warnings.
- `npm run firestore:production:plan`: correctly refused a zero-approved release before cloud access.
- `npm run validate:pilots:v3.2`: 408 questions, 418 evidence packets, 408 errors, 50 warnings.
- Firebase Console read: project `huroof-a3ee7`, `(default)`, `me-central2`, empty database.

## Baseline hashes

- `content/categories/categories.json`: `073b37a65baabf1996a014c097378e3d62f18b348f08d1cb16c4c47d93e0c727`
- `content/question-bank-v3/v3.2/category-policies.v3.2.json`: `6e390d5cb3d66345b71cff338ea9d65780497c084b50520be3afeb8aa619058c`
- `content/question-bank-v3/v3.2/reports/validation.v3.2.json`: `b6c573c36ed5430ee88b7e6a1977f89efc070bbc18d730b13ce42643df87d9ae`
- `content/questions/approved/questions.jsonl`: `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`
- `content/questions/reports/release-manifest.json`: `af8144a40e29b48f9e7481a578836d3bb82d017132b0e5dd00a4d5e91c636160`

## Failures and blockers

- Production upload is blocked by zero approved content, missing authenticated review receipts, validator failures, and absent ADC.
- The canonical release path cannot yet accept a non-empty v3.2 payload without resolving the v1/v3.2 schema conflict.
- This workspace is not Git-backed, so provenance must be bound to immutable artifact hashes rather than a commit.

## Next action

Receive the Architect contract, integrate it into this ledger, and submit the plan to an independent Plan Critic before assigning writer scopes.
