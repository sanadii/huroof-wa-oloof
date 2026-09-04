# Question-bank v2.1 authoring extension

This is a separately validated, append-only authoring catalog. It is not a
replacement for v1 or v2.0. The legacy runtime resolver returns 62 categories;
the authoring resolver returns those 62 plus these four proposed categories:
`huroof-001` علوم وفضاء, `huroof-002` جغرافيا وطبيعة, `huroof-003` أدب ولغة
عربية, and `huroof-004` الكويت والخليج: تاريخ وثقافة.

C1: “Preserve the existing 62-category Tahadani catalog byte-for-byte and in its current order. Do not change any `tahadani-*` ID, `legacyIndex`, cover path/hash, import receipt, asset manifest, pinned v1 hash, or v1 question record. Add original categories only through a separately validated append-only extension catalog.”

C2: “A planned slot is not a question, a structural fixture is not a real draft, a draft is not approved content, and a proposed category cover is not a publishable asset. Report each count and state separately; emit no approval, reviewer identity, readiness, or runtime eligibility that was not produced by the required evidence-bound human workflow.”

C3: “Do not promote or release any new item until full schemas, canonical policy lookup, source freshness, content-bound receipts, image/media verification, full-record release hashing, catalog discovery, duplicate recall/performance, and genuinely varying seeded simulations all pass their negative and positive tests.”

C4: “The only proposed additions in this change are `huroof-001` علوم وفضاء, `huroof-002` جغرافيا وطبيعة, `huroof-003` أدب ولغة عربية, and `huroof-004` الكويت والخليج: تاريخ وثقافة. They remain `proposed` and `authoring_only` until an explicit later human activation decision.”

C5: “Create 112 real sourced drafts now—28 per new category, one per supported Arabic letter—and retain 336 slots per category only as backlog capacity. If a defensible category-letter item cannot be sourced, record a blocked attempt and stop short; never fill the quota with an invented, ambiguous, duplicated, or off-scope question.”

`npm run validate:authoring` regenerates only v2.1 planned/derived artifacts.
`tsx scripts/authoring-v2.1.ts validate --as-of 2026-09-03 --check` is a
read-only validation mode and does not rewrite protected inputs or artifacts.

At the current checked evidence level, four page-specific, hash-bound drafts
are materialized (one per proposed category). The other 108 category-letter
targets are explicit `blocked_source` attempts, not invented drafts; the
validation report records the shortfall.
