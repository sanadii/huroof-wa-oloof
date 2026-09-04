# ADR-002 — Firebase / Firestore authoritative room runtime

Status: **proposed; free-tier cloud foundation provisioned, fixture runtime**  
Date: 2026-09-03

## Decision

Firebase Authentication, callable Cloud Functions, and Firestore will implement the production side of ADR-001. The Vite application remains fixture-first. Firebase is enabled only by explicit environment configuration, and client SDKs cannot write canonical game or content data.

## Provisioning record

The selected Firebase project is `huroof-a3ee7`, tagged Production. Its `(default)` Firestore database is Standard edition / Native mode in `me-central2`; Anonymous Auth is enabled, the repository Firestore rules are published, and the required single-field collection-group indexes are configured. The registered Web App is `Huroof wa Oloof Web`, and its public SDK configuration is present locally.

The project remains on Spark. Spark blocks Callable Functions deployment and scheduled backups / point-in-time recovery, so Functions are undeployed and the Vite runtime remains `fixture`. No production content has been seeded: the approved-question bank still contains zero approved questions. These facts provision the free-tier cloud foundation only; they do not activate the backend runtime, authorize billing, or approve deployment or seeding.

## Schema

```
catalogCategories/{categoryId}                  immutable category wrapper entries
releases/{releaseId}                            immutable release metadata/hash
releases/{releaseId}/questions/{questionId}     canonical approved question (Admin only)
releases/{releaseId}/inventory/{categoryId}     count metadata (Admin only)
runtime/activeRelease                           active immutable release pointer (Admin only)
releases/{releaseId}/publicationReceipts/{id}   immutable verified publication receipt (Admin only)
activationReceipts/{id}                         immutable activation audit receipt (Admin only)
roomCodes/{NORMALIZED_8_CHAR_CODE}              room lookup (Admin only)
rooms/{roomId}                                  canonical room/revision (Admin only)
rooms/{roomId}/members/{uid}                    canonical membership (Admin only)
rooms/{roomId}/events/{revision}                canonical ordered audit event (Admin only)
rooms/{roomId}/intentReceipts/{uid_intentId}    canonical idempotency receipt (Admin only)
rooms/{roomId}/projections/audience             safe read projection
rooms/{roomId}/projections/player_{uid}         safe self read projection
rooms/{roomId}/projections/host                 safe host read projection
```

Player and audience projection documents are explicit allow-lists assembled by the server; they do not have fields for `canonicalAnswer`, `acceptedAnswers`, `sources`, authoring/review/moderation records, or unrevealed letters. Canonical content and rooms are only reachable by Admin SDKs.

## Roles, auth, and trust

Anonymous Firebase Auth is an explicit client helper for development and low-friction rooms; it is not called in fixture mode. Every callable requires an authenticated user. Functions assign host/player membership, normalize and allocate server-generated room codes, transact over membership/revision/buzz state, append an event/receipt, and replace role projections atomically. The client sends only intents with an `expectedRevision` and opaque idempotency key.

Firestore rules default deny. A signed active member may `get` audience; may `get` only their own player document; and a host may `get` host. There are no client lists, writes, catalog reads, canonical reads, event reads, or receipt reads.

## Release seeding

`scripts/build-firestore-release.ts` reads only `content/questions/approved/questions.jsonl`, parses a canonical JSONL representation, requires every record to be approved and valid under the existing question validator, then binds its count and SHA-256 to `content/questions/reports/release-manifest.json`. A normal release with zero items fails closed. The current bank is deliberately zero approved and therefore cannot be seeded as production content.

`scripts/seed-firestore.ts` is the only emulator seeder / local demo writer. A non-dry seed demands both `FIRESTORE_EMULATOR_HOST` and a `demo-*` project id before dynamically importing Admin SDK code. `--dry-run` never initializes Admin. `--demo` is explicit and marks the exception that permits a zero-item synthetic plan; it is not a production release. The separate guarded production publisher is the only production release writer.

Production publication is a distinct, guarded workflow. Its offline plan accepts only the approved JSONL, canonically sorts records and object keys, binds the manifest count/hash, derives a full SHA-256 release ID, and includes catalog and planned-document root hashes in the immutable release root. Prepare requires Application Default Credentials, exact project/database/location/release/hash confirmations, verified Firestore metadata, and create-or-exact-equality semantics with chunk readback; it never moves `runtime/activeRelease`. A separate activation transaction verifies the immutable root and publication receipt, compare-and-swaps the expected active release, creates an activation receipt, and then sets the pointer. Spark quota may require resumable prepare runs; conflicts never overwrite documents.

## Pre-mortem

| Failure mode | Early signal | Mitigation |
| --- | --- | --- |
| A client obtains answer data | projection contains a private-key name | pure projection tests and exact projection-only rules |
| A draft reaches a room | manifest count/hash mismatch or status differs | builder accepts approved JSONL only and validates all items |
| Concurrent buzz is misordered | duplicate events/revisions | single server transaction plus receipt idempotency |
| Local tooling touches production | missing emulator or non-demo project | hard target guard before Admin import/write |
| Emulator confidence is mistaken for deploy readiness | Java/Auth/App Check absent | explicit production blockers below |

## Rollout and rollback

1. Run validation and a dry-run release builder in the repository.
2. Test Auth, rules, Functions, and seeding against a `demo-*` emulator project.
3. **Completed cloud foundation:** use the Production-tagged `huroof-a3ee7` project with `(default)` Standard/Native Firestore in `me-central2`, Anonymous Auth, published repository rules, configured collection-group indexes, and the registered Web App. This foundation remains fixture-only; Functions are not deployed and no production content is seeded.
4. **Blocked runtime activation:** before any paid-plan upgrade, Functions deployment, or runtime change, approve App Check, abuse/rate controls, retention/audit policy, backup/PITR requirements, logging access, monitoring, budget alerts, regional/legal review, and the immutable release/rollback procedure. Spark cannot supply Functions or scheduled backups/PITR.
5. After those approvals and an approved immutable release, deploy Functions and activate the Firebase runtime through a separately approved change; do not reseed or mutate existing release content.
6. Roll back by changing `runtime/activeRelease` to a previous immutable release using an audited Admin-only operational procedure; never mutate an existing release document.

## Production blockers

The production project, region, Anonymous Auth, published rules, indexes, and Web App are already provisioned as described above. Production runtime activation remains blocked by Spark's Functions and backup/PITR limits, no approved release content, and the outstanding App Check, abuse/rate controls, retention/deletion, logging access, monitoring/budget, regional/legal, and release-approval/rollback decisions. This ADR does not authorize billing changes, Functions deployment, runtime activation, or production seeding.
