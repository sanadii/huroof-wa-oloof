---
project: "Huroof Wa Oloof"
status: "active"
updated: "2026-09-04T13:05:00+00:00"
---

# Project Plan: Huroof Wa Oloof

## Outcome

Prepare at least 300 quality-gated Arabic game items per category in separate category files and publish only genuinely approved items to Firestore

## Project acceptance criteria

- [ ] Exactly 66 category-owned JSONL files exist, each with at least 300 unique policy-valid approved playable items (minimum 19,800).
- [ ] Headers remain separate; explanations are null unless useful and claim-level sourced; letter, difficulty, temporal, duplicate, specialist, and rights rules pass.
- [ ] AI never fabricates human, specialist, or rights approvals; approval is derived only from authenticated receipts bound to exact content/evidence/policy hashes.
- [ ] The approved aggregate is deterministic and passes 1,000 simulations against the actual corpus.
- [ ] Production publication targets only `huroof-a3ee7` / `(default)` / `me-central2`, with ADC, readable backup, exact read-back, atomic activation, and independent Gate PASS.

## Milestones

| Milestone | Outcome | Dependencies | State | Evidence |
|---|---|---|---|---|
| M1 | Harden v3.1 and create the 66 category-owned files | None | Complete | 66 files, recursive canonical serialization, schemas and tests verified |
| M2 | Audit imports and validate 24-item policy pilots | M1 | In progress | Mechanical checks pass for first pilots; independent Gate FAIL requires semantic/storage repairs |
| M3 | Generate in 24-item gated batches and obtain ≥300 approvals/category | M2 | Blocked | Authenticated human/specialist/rights reviewers required |
| M4 | Build, simulate, and independently Gate the immutable release | M3 | Planned | Pending |
| M5 | Back up, prepare, verify, activate, and verify Firestore | M4 | Blocked | ADC and production inventory/backup unavailable |

## Architecture decisions

| ID | Decision | Alternatives | Evidence and reason | Reversible? |
|---|---|---|---|---|
| ADR-001 | Use evidence-first gated waves, not bulk-first generation. | Generate all 22,176 candidates before validating the contract. | Prevents systemic ambiguity/evidence failures from multiplying across the corpus. | Yes |
| ADR-002 | Category JSONL files are authoring sources; runtime receives only a generated approved aggregate. | Upload drafts/category authoring files directly. | Existing runtime publisher is correctly fail-closed on non-approved content. | Yes |
| ADR-003 | Use only GPT-5.6 Sol/Terra/Luna. | Fable skill's external-provider coordinator. | `profile-state.json` sets authoritative `gpt-5-6`, circuit closed. | Yes |
| ADR-004 | Version exact Arabic duplicate identity separately from fuzzy review suggestions, and select at most one answer concept per match. | Treat canonical-answer reuse or fuzzy Arabic variants as duplicates. | v3.2 preserves Arabic exact boundaries while retaining reportable near-duplicate evidence and fail-closed runtime queues. | Yes |

## Active tasks

| Task ID | Milestone | Owner | State | Next action |
|---|---|---|---|---|
| question-bank-full-production | M2 | GPT-5.6 Sol root | active | Finish policy pilots and resolve independent Gate findings before scale-out. |

## Completed tasks

| Task ID | Milestone | Owner | Completed | Evidence |
|---|---|---|---|---|

## Risks and blockers

| Risk or blocker | Impact | Mitigation | Owner | State |
|---|---|---|---|---|
| Bulk templates or weak evidence | False/ambiguous 19,800-item bank | Five policy pilots, claim-level evidence, stop/revise thresholds | Forge/Research/Gate | Open |
| Full response bodies in evidence | Excess storage and publisher-content retention risk at scale | Independent Gate review; define deduplicated evidence retention before M3 | Root/Gate | Open |
| Duplicate raw evidence bodies | Repository bloat and repeated retained publisher content | Content-addressed store, 1.25 MiB/body and 10 MiB/batch limits, release firewall | Forge/Root | Mitigated technically |
| Mechanical validation misses semantic defects | False confidence despite schema PASS | Exact Gate repair list; add regressions for answer collisions, header leakage, article/punctuation behavior, and evidence budgets | Forge/Category writers/Gate | Open |
| Puzzle/charades semantics need human-sensitive checks | Ambiguous riddles or misleading performance cues pass JSON validation | Gate B exact repair list plus later human originality/dialect/playability receipts | Category writers/Human reviewers | Open |
| No authenticated review path | No item can truthfully become approved | Build fail-closed receipt contract; obtain genuine reviewers | Human owner | Blocked |
| Image and cover rights unresolved | Image categories/assets cannot publish | Immutable asset hashes and genuine rights receipts | Human rights owner | Blocked |
| ADC/project inventory/backup unavailable | Production write cannot be verified or rolled back | Authenticate, inventory, export, rehearse, then publish | Database/Flow | Blocked |
| Concurrent unrelated UI edits | Accidental overwrite | Exclude UI/routes/styles/design/tests-app from all scopes | Root | Mitigated |

## Verification strategy

- Exact 66-file resolution; filename/category ownership; canonical serialization and aggregate reconciliation.
- Schema, Arabic-letter, source/claim, expiry, receipt-authentication, difficulty, duplicate, specialist, and rights checks with adversarial tests.
- Protected legacy hashes; content tests; app/node typecheck; lint; build; gameplay tests.
- Exactly 1,000 varying deterministic simulations against the approved aggregate.
- Independent Sol Gate on the exact release hash.
- Firestore plan/prepare/verify/activate with project identity, backup, read-back hashes, and CAS pointer verification.

## Deferred work

- None recorded.
