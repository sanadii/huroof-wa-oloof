# T-15 runtime review disposition

Preimplementation read-only database and security reviews completed 2026-09-08 against the current mixed working tree. Root disposition: proceed with the additive design below; no production migration, rules expansion or release-schema change is required. Detailed implementation belongs to T-15.2. These are source-grounded constraints; races/emulator behavior remain to be tested.

## Required changes

1. Fix terminal disclosed-question reuse. Current lifecycle Retry returns QUESTION_FAILED to QUESTION_READING while both services keep activeQuestion. New-policy Retry/Return must act as safe Continue or reject; they must never reopen the disclosed answer. Selection already consumes IDs/concepts; do not double-consume on failure.
2. Validate every local intent after authentication and before receipt lookup/mutation. Current local service invokes its validator only for audience visibility. Unknown events, unsafe revisions, null/array payloads, extra fields and malformed IDs must fail without mutations.
3. Bind local receipts to actor and exact canonical request content, matching Firebase's actor/hash design. A different actor's matching intent ID is not its receipt; altered content with the same actor/ID is rejected. Tests must cover both. Do not reinterpret old unscoped receipt data as authenticated new-policy receipts.
4. Serialize local asynchronous mutations per room (including expiry versus selection) and commit a completed candidate snapshot, or prove equivalent atomic behavior. Firebase selection/Continue metadata, reservation, room revision, receipt, event and projections stay in the same transaction. Load transaction reads before writes; retries must use deterministic selection and occurrence allocation.
5. Keep host authorization on Continue/exhaustion exit; never accept client-selected replacement category/letter/question/occurrence/score. Preserve active membership and room capability checks. Verify player/audience/cross-room/replay/stale requests.
6. Add a versioned room policy discriminator and game kind with explicit legacy defaults. Keep existing schemaVersion2 compatibility; unknown future policy/kind fails closed. Existing started rooms are not destructively migrated. Category cell metadata and per-round occurrence counters are additive, owned by the server.
7. Use explicit projection allowlists. Current category ID/label/occurrence may be public; private queues/reservations/concepts/answers/sources may not leak through new fields. Test all roles at fail/Continue/pause/hold/reconnect. The existing audience toggle is presentation behavior, not a newly promised confidentiality boundary; its existing behavior must remain covered and no stronger claim made without server/rules verification.

## Presentation label snapshot

Category IDs and usable question/concept inventory must come exclusively from the room's pinned release. Global catalog labels are not currently bound into the release hash. Treat titles as presentation metadata: read and validate selected catalog IDs/title fields server-side at create, persist a sorted immutable `{id,labelAr}` snapshot in room config, and optionally hash that snapshot. Do not resolve live labels on reconnect or later rounds. This snapshot does not claim its titles were signed in the content release. The local runtime uses its trusted server catalogue, never a browser-supplied label.

No new release-scoped catalogue or production data change is required for this presentation-only snapshot. Demo/fixture seeds must provide valid labels and enough unique content explicitly as demo. Firebase emulator tests prove handler/persistence compatibility, not availability of a production reviewed release.

## Required evidence

T-15.2: malformed-intent matrix; actor/hash replay traces; concurrent selection/Continue/expiry; consumed IDs/concepts monotonic through correction/rounds; public-field deny assertions; old/new/unknown policy traces; persisted category/letter rotation after reload; label snapshot unchanged after catalog edit; insufficient-reserve hold and end/new-match recovery. Integrated T-15.6 adds real independent browser roles and material Gate.

Security sources: `server/service.ts` intent/commit/project; `functions/src/game.ts` validIntent/reduceIntent/projectRoom; `functions/src/index.ts` submitGameIntent transaction; `runtime/question-selector.ts` consumption. Database sources: same canonical transaction plus `scripts/build-firestore-release.ts` global catalog documents and pinned release question paths. Graphify was used with direct source checks; reported skill/package version mismatch is recorded, not repaired as part of this feature.
