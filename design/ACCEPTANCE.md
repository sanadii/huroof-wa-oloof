# Design and Frontend Acceptance Contract

This is an evidence gate, not aesthetic authorization. Scope and gaps are enumerated in
[ROUTE-STATE-COVERAGE.md](ROUTE-STATE-COVERAGE.md).

## Required evidence

| Evidence family | Required coverage |
|---|---|
| Router | all 14 patterns: entry, rules, setup, login, account, four room views, results, inventory, new/editor record, wildcard |
| Homepage sections | [HOME-SURFACE-SPEC.md](HOME-SURFACE-SPEC.md): each audited region’s component owner, supported target, current/deferred data status, responsive shared themes, and keyboard/RTL/state treatment; no claim that deferred marketplace/commerce features exist |
| Lifecycle | all 14 values in `LIFECYCLE_STATES` for relevant host/player/audience projections |
| Connection | connecting, connected, reconnecting, offline, stale across room views |
| Setup/lobby | default/demo/selection/empty/no-stock/creating/error/success; readiness/closed/unavailable variants |
| Gameplay | question unavailable, correction, fatal, sub-768 host limitation; player buzzer/result/unauthorized states; public display selection/question/winner/reveal/award/correction/results |
| Results/admin | both winners, nonterminal, filtered actions, rematch busy/error, history missing; loading/populated/filtered/empty/service/authorization and every editor save/review mode |
| Cross-route | light/dark/system where shared; midnight gameplay exception; keyboard focus, reduced motion, 200% zoom, mixed Arabic-LTR, loading/empty/error/closed/unauthorized/stale/offline/reconnecting/fatal |
| Viewports | player 320×568 and 390×844; host 768×1024/1024×768/1440×900; audience 1024×576/1280×720/1920×1080; admin 1024×768/1440×900 |

## Deterministic and human boundary

C1: “The deterministic validator may verify only evidence identity, structure, dimensions,
provenance, and threshold consistency; it must never certify aesthetic quality or emit an
aesthetic PASS.”

C2: “Every AI/model review is optional and advisory; it cannot authorize or block exact human
selection or live-review gates. Distinct-family, distinct-session, read-only,
provenance-backed review may be provenance-separated but remains advisory, and same-family or
same-session review is never independent.”

Deterministic evidence may check route identity, source/state coverage, token/geometry use,
dimensions, contrast thresholds, overflow, keyboard semantics, accessibility thresholds, and
provenance. Human review decides visual fidelity to the selected direction; technical QA cannot
override a human rejection.

## Invariants and severity

- 25-cell six-neighbour board; fixed physical axes; non-color redundancy; no early answer leak.
- Shared light/dark/system and history-0005 flat midnight gameplay exception.
- No Golbha copy; no generic neon, yellow/gold, glass, or nested rounded dashboard.
- Homepage review confirms all nine ordered sections, proves classic/fast/custom and Tahadani
  category preselection against the real setup contract before enabling them, and preserves
  honest omission/deferred labelling for credits, rewards, purchases, gifts, daily,
  analytics, legal/company, social, and store features without source-backed ownership.
- P0: answer leak, wrong winner/path, unavailable legal action, severe accessibility/security.
  P1: missing required lifecycle/recovery or material visual-contract break. P2: responsive,
  state-evidence, or significant accessibility gap. P3: non-blocking polish.

No handoff calls an untested requirement passed. Evidence must state its source, viewport/state,
and whether it is deterministic or human-reviewed.

## Current homepage implementation evidence

The homepage composition is implemented in `HomeSurface`, with the shared setup query registry
used by both its mode/category destinations and `HostNewRoute`. Deterministic unit evidence is
in `tests/app/entry-route.test.tsx` and `tests/app/setup-route.test.tsx`; local browser checks
covered the supported `mode=fast` route, invalid-query fallback, and 320px horizontal bounds.
These records do not approve visual quality. Account identity is limited to Firebase Auth basic
fields and no privileges; reward, daily, commerce, weekly analytics,
legal, social, and store capabilities remain deferred.

## Admin implementation evidence

Deterministic route evidence covers the `/admin` redirect, capability-filtered shell, callable-backed question inventory, legacy identifier redirect, a real v3.3 draft-save payload, and preservation of source provenance across revisioned editor saves in `tests/app/admin-routes.test.tsx`. `functions/src/admin.test.ts` covers answer/source/member non-disclosure for room lists, canonical idempotency hashing, claim-version parity, modality reviewer/source validation, last-Super-Admin policy, review-revision binding, and archive-state policy. `tests/storage-rules.test.ts` defines anonymous and forged claimed-admin denial assertions for Storage list/upload operations. The Storage and Firestore rules suites could not execute on this workstation because Java is absent; these source-level tests therefore do not prove Emulator Suite behavior. Deployed App Check, administrative claim propagation against a staging project, visual quality, and production readiness also remain unproven until the configured staging and human-review gates run.
