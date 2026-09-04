# v3 remediation and review foundation

This append-only review corpus imports candidates only. It does not alter v1,
v2, v2.1, runtime inventory, Firestore seeds, or release pointers.

C1: “Never count slots, seeds, blocked attempts, generated candidates, drafts, or review-ready items toward the 300+ target. Count only complete, policy-valid approved playable records; if evidence or Arabic-letter fit is weak, block the cell instead of fabricating content.”

C2: “AI may identify itself only as `ai` or `automated`; it must never invent or reuse a human reviewer name, UID, qualification, or receipt. AI may fix and pre-review content, but final approval requires the genuine authenticated human/specialist/rights receipts required by category policy.”

C3: “Do not weaken the emulator-only seed guard. Production publishing must use a separate fail-closed command, an independently verified immutable release root, explicit project and hash confirmation, resumable immutable writes, verified read-back, atomic active-pointer change, documented rollback, and fresh user authorization for the exact production release.”

The importer creates 284 source-preserving candidate revisions (280 v1 and four
v2.1). The review command emits dispositions and automated receipts only; it
cannot create human approval. This foundation has no authenticated review
adapter and every callable approval path fails with `authenticated review
adapter not configured`. Approval stays unavailable until a trusted Firebase
Auth adapter plus qualification and evidence registries are implemented.

## Academy-backed lexical cohort

The 207 candidates in `tahadani-006` and `tahadani-013` have one persisted,
claim-bound snapshot each from the Arabic Language Academy's resolved `dic-19`
entry URL. A packet records its canonical URL, retrieved-byte SHA-256, response
metadata, title, description, and the answer locator. It establishes
`evidence_ready`, not approval: a human language reviewer must still select the
intended dictionary sense where an entry has multiple senses.

Difficulty is assigned from clue content rather than record position: direct
everyday objects or organisms are **easy**, a learned relation is **medium**,
and a narrow abstract or technical sense is **hard**. Headers stay separate,
and `explanationAr` remains `null` unless a later approved, player-facing
addition is directly evidenced.
