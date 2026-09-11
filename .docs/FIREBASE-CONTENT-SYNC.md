# T17.3a — Consolidated Firebase content sync

Authorized 2026-09-11: user requests Firebase database update with all questions, images and videos shared in this and related tasks. This is the data-sync preparation part of [T17.3](T17-QUESTION-MEDIA.md), separate from the concurrently running T17.2 runtime repair and reviewed release activation.

## Source of truth and scope

- Target: production alias `huroof-a3ee7`, Firestore `(default)`, native database in `me-central2`; confirm via live metadata. Never use default demo alias implicitly.
- Fresh local SQLite intake (last verified 12,752 rows), preserved 280 file-based records, original master intake/reconciliation artifacts, v19.1 6,000-question source, photo sets and 99 goal-question records.
- Related task “Find question files” has an additional 300-question Parallel B pack, now found at `C:/Users/User/Downloads/ALL_QUESTIONS(1).md`. Preserve its separate source IDs and review metadata.
- Question images: original 240, rebuilt 51, plus 60 remote-photo records requiring actual download or explicit missing status. Goal media: 198 prepared paired MP4s. Category art: verified 592 imported originals and 612 WebP derivatives with existing provenance. Distinguish source archives from runtime assets and versioned source revisions from additional logical questions.
- Existing Firestore master intake contains 18,698 historical source revisions according to prior exact verification; recheck cloud identity/manifest when authenticated. Preserve these and all existing release/pointer data.
- Include the repository's `aggregate.v3.1.jsonl` (284 candidate revisions) and v3.2 pilot question files (408 records). Preserve their workflow states and source lineage; earlier v3.1 pilot versions are historical counterparts, not extra logical questions. Exclude slots, blocked attempts and replay/test fixtures. The previous master-import receipt confirms the old cloud root's metadata/manifest was incomplete even though its question revisions were stored; do not claim that root complete without a fresh audit.

## T17.3a.1 — Reconciliation and immutable package

Owner Forge, root acceptance. Inputs above and Database review. Produce an explicit asset/document manifest, deterministic hashes, source/package/category counts, duplicate/revision dispositions and missing asset list. Use existing private intake patterns and immutable source identities. No inferred content approvals or letter eligibility. Preserve raw source fields; no invented answers or downloading unrelated private content. Source/media outputs remain ignored/private. New tooling and scoped tests only; T17 runtime source belongs to the other task.

Checks: all source IDs accounted for; exact duplicates represented once or linked with provenance; local existing rows preserved; binary hashes/MIME/decoding; every media reference resolves or has explicit unavailable status; rerun stable; document/batch limits; path/URL allowlists and no credentials in output. Exit: prepared package and tests reviewed, not a claim of cloud completion.

## T17.3a.2 — Private upload and Firestore sync

Owner Forge tooling, root cloud apply after risk Gate. Depends on package checks, fresh Firebase authentication, pinned target/bucket and effective private access checks. Upload bytes to private Storage paths with content hashes and generation preconditions, Firestore gets metadata and bindings only. Reuse or extend existing additive intake adapter; reject conflicts rather than overwrite. Create missing immutable question/asset/source documents, verify exact cloud reads and object hashes/generations, write completion manifest last. Preserve active-release pointer and existing documents. No IAM/rules/schema changes solely to make the import work.

Checks: dry-run dispositions, explicit target and scoped path allowlist, resumable interrupted batches, zero-write repeat, exact cloud read-back, existing pointer unchanged, unprivileged reads denied. Rollback uses task receipts for exact created documents/object generations only after equality checks; never whole database restore or broad deletion. User upload authorization is already granted. Billing/auth/infrastructure failures are reported with exact evidence while remaining independent preparation is completed.

## Current state and handover

Preflight 2026-09-11: Firebase CLI refresh rejected expired credentials. User asked to run `firebase login --reauth`; no production writes yet. Database review completed: [review evidence](../output/firebase-sync-20260911/DATABASE-REVIEW.md).

Initial package accounts for 20,084 source revisions across seven source groups, 14,024 distinct candidate IDs (not a verified logical-question total), and 1,698 distinct byte-backed assets. Forty-seven photo references remain unavailable after HTTP 429; exact source URLs and question associations must remain explicit. These counts are provisional until the repair package is reverified.

Root independently hashed all 1,698 available files: 455,982,568 bytes, zero SHA-256 mismatches; 597 PNG, 296 JPEG, 607 WebP and 198 MP4. This verifies local bytes only, not cloud upload or semantic correctness of the question/image pair. [Byte audit](../output/firebase-sync-20260911/root-local-byte-audit.json). A second read-only authentication attempt still failed with expired credentials.

T17.3a.1 is **in repair, not accepted**. Initial three tests and dry-run passed, but [Gate review](../output/firebase-sync-20260911/gate-review.md) reproduced eight acceptance gaps. Forge is repairing immutable package/path/byte binding, effective privacy preflight, exact-generation object verification, transactional manifest barrier, complete verification, provenance/completeness and URL hygiene. Re-review and a regenerated package are required before T17.3a.2. Cloud apply additionally requires fresh authentication and live target/privacy evidence. No approval string or local deny rules alone authorize an unchecked upload.

Second review: [Gate v2](../output/firebase-sync-20260911/gate-review-v2.md) verified repaired byte/generation/source-root checks but found remaining asset-binding/count/completeness and cloud-engine gaps. The production adapter was disabled rather than completed; authentication alone cannot unblock that snapshot. A further scoped repair restores the real adapter and addresses all v2 findings. Root independently ran the four focused tests and Node typecheck successfully; neither overrides the failed Gate. Controlled exact-photo retries recovered three additional assets, then stopped at renewed HTTP 429: the v2 package has 1,701 available assets and 44 unavailable references. No cloud mutations.

T17.2 and full gameplay activation remain owned by the existing media task and its canonical plan; this sync does not certify or activate a reviewed release.

### Authoritative continuation state — final 2026-09-11 check

**T17.3a.1 accepted for offline preparation; T17.3a.2 blocked on billing/storage infrastructure.** [Gate v4](../output/firebase-sync-20260911/gate-review-v4.md) passes the corrected code and preparation. Root passed ten focused tests, the Node typecheck and full validation of all 1,726 available assets. Final root `56645db094504fbb6dd884784010dee884d0b22293358beadfcd33563e0df3b3`: 20,084 source revisions, 1,726 asset documents, 19 unavailable photo entries. [Full report and continuation](../output/firebase-sync-20260911/FIREBASE-SYNC-REPORT.md).

Earlier authentication failures are superseded: authenticated Google SDK access works with `node --use-system-ca`. Fresh [live metadata](../output/firebase-sync-20260911/live-preflight.json) confirms the exact production project/database, `billingEnabled:false`, and zero Storage buckets. It also freshly confirms 18,698 historical question records and an absent historical completion manifest. No cloud writes occurred. User must link/enable billing before private Storage provisioning; then repeat live privacy checks before apply. No need to repeat login solely because of the earlier CLI error if this SDK credential still works.
