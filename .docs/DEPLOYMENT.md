# Deployment and rollback plan

## Authority and current state

No deployment, production call, schema migration, rule deployment, or production data mutation is authorized or performed. Independent Gate technical review passed; local evidence is listed in [QA-CHECKLIST.md](QA-CHECKLIST.md). It is not production release evidence.

## Canonical release path

The canonical source is [scripts/firestore-release-publisher.ts](../scripts/firestore-release-publisher.ts). Every production operation requires its parsed mandatory flags; bare npm scripts are deliberately not runnable release commands. The source enforces project/database/location, immutable release/hash/trust-root identity, and operation-specific CAS/receipt flags.

The ordered process is:

1. Build/validate candidate content and create a source-grounded `plan` with its required trust-root flags.
2. `prepare` immutable release documents with required project/database/location/release/hash/trust-root flags.
3. `verify` the exact prepared documents and barrier receipt with the same identity flags.
4. `activate` only with the verified receipt, expected active-release CAS value, non-secret operation reference, and required identity flags.
5. `audit` the activated release with required identity flags.

Do not run these production-capable operations from this task without explicit release authorization and approved credentials.

## Migration order and compatibility

There is **no database migration in this change**. Deploy compatible code/configuration first, verify production identity/App Check/signing and release prerequisites, then run canonical prepare/verify/activate. Demo-only seed compatibility is not a production backfill and does not relax Functions validation. Existing rule/index files are unchanged; future rule/index requirements need separately reviewed Firebase deployment before new queries depend on them.

## Rollback

`rollback-none` is a real guarded rollback to **no active release**, not a no-op. It is permitted only for the verified sole immutable release root, requires the same identity/operation-reference flags, uses a transaction that CAS-checks `runtime/activeRelease`, deletes that pointer, and creates an immutable `rollbackReceipts/...` record. Rollback to an earlier verified release uses the publisher's audited restore path. Neither path deletes release roots, room/event history, or audit history.

## Production prerequisites

1. Production Google login, App Check/signing, and authorized principal checks.
2. Approved production release and environment-specific CI verification.
3. Node/runtime parity: Functions target Node 22 while local host evidence used Node 24.
4. Assessment/remediation of Gate’s seven moderate transitive `uuid` audit findings.
5. A reviewed deployment window and rollback/recovery owner.
