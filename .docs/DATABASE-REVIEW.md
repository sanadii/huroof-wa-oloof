# Database, auth, and runtime review

## Scope and sources

This review is source-grounded in [Firebase Functions runtime](../functions/src/index.ts), [admin callables](../functions/src/admin/admin.ts), [Firestore rules](../firestore.rules), [Storage rules](../storage.rules), and [indexes](../firestore.indexes.json). No schema, Firestore/Storage rule, RLS, production data, or production-auth change was made.

## Data model and relationships

| Entity | Purpose / relationship | Consistency boundary |
| --- | --- | --- |
| `runtime/activeRelease` → `releases/{releaseId}` → `questions` | Pins the approved runtime release and its immutable question set. | Room creation reads the active release and validates question scope. |
| `rooms/{roomId}` | Canonical match configuration, lifecycle, board, scores, timer and revision. | Server transaction owns intent application and revision advancement. |
| `roomCodes/{code}` → room | Stable, unique human code lookup. | Created transactionally with the room. |
| `rooms/{roomId}/members/{uid}` | Host/player membership, role, readiness/team. | Join and intent transactions read/write membership with room state. |
| `rooms/{roomId}/projections/{roleOrUid}` | Host, audience, and player-safe derived views. | Rebuilt atomically with room lifecycle update; projections omit role-private data. |
| `rooms/{roomId}/events/{revision}` | Ordered audit/event stream. | Revision-padded document IDs support deterministic ordering. |
| `rooms/{roomId}/intentReceipts/{actor+intent}` | Idempotency receipt for client intent retries. | Read in the same transaction before applying an intent. |
| `adminQuestionDrafts`, `adminReviewRequests`, `adminRoomSummaries`, `adminOperations`, `adminAudit` | Guarded management workflow, operational summary, and audit records. | Callable capability checks and expected-revision mutations. |
| `adminPrincipals/{uid}`, `adminSettings/runtime` | Role/identity state and mutable runtime settings. | Last-super-admin protection, claims synchronization, and expected revision checks. |

## Index/query map

`firestore.indexes.json` supports status/category plus `updatedAt` paging for question drafts and reviews; room summary recency; actor/time lookup for operations and audit; and enabled/identity/role lookup for admin principals. Collection-group overrides cover event revision and intent receipt creation time. Admin list callables use bounded pages (the client requests a limit of 50) and expose cursor continuation; the UI does not synthesize records when a category/list is empty.

## Transactions, recovery, and privacy

Room creation, joining, audience attachment, and intents use Firestore transactions. Intent receipts make repeated client submissions safe, while revision checking rejects stale authority. Projections are regenerated from canonical room/member state in the transaction, then rules expose only the allowed role document. The local fixture has a separate SQLite store with room/event/snapshot persistence; it is not a production schema migration path.

Errors recover through explicit room-not-found, guarded-access, stale-revision, disabled-reason, and retry-capable UI states. Nonterminal results describe the current phase instead of fabricating a final result. Runtime release validation remains strict; only the **demo emulator seed** adds missing legacy `modality`/`answerConceptId` values using existing fixture defaults while retaining original content, `draft`, and `demoUnreviewed` fields.

## Auth and authorization

Firebase rules require authenticated room membership for appropriate projections, and callable admin endpoints enforce capabilities/roles. Local verification used an actual Auth emulator Google popup and the existing guarded demo bootstrap; it did not add an auth bypass. Public/player/audience E2E assertions found no private answer/alternatives in those projections.

## Local evidence and limits

- Firestore rules: 10 isolated-emulator assertions passed, including an expected denial.
- Storage rules: 4 isolated-emulator denial assertions passed.
- Firebase E2E: isolated Auth/Functions/Firestore/Storage passed 1/1 in 29.2s; it covers role privacy, concurrent buzz winner, reload, correction, and 5-second expiry.
- Admin: synthetic emulator draft persisted/reopened and was submitted `in_review`; the **default question timer value of 35 seconds** persisted after reload.

Production Google identity, App Check/signing, production release publication, and production data/rules behavior remain unverified or guarded. Functions target Node 22; local execution used a Node 24 host, which is an environment compatibility warning.

