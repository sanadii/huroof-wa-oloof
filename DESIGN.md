# Product & Interface Design Specification

Product: **استوديو الحروف** · React + TypeScript + Vite · Arabic-first RTL

## Selected direction and rollout

Human selection 2026-09-05: **“C — مدار الحروف: vivid blue spatial studio”**. It is the
selected whole-app direction, recorded immutably in
[`0006`](design/evidence/history/0006-spatial-studio-homepage-direction.md) with
[receipt 0006](design/evidence/selection-receipt-0006.json). The homepage/create/join journey received human approval for full-route rollout in immutable 0007; existing flat surfaces are temporary fallback, not the selected long-term direction.

The homepage replaces the old nine-region composition with a cobalt spatial stage: utility
header, headline, canonical board, opaque create/join rail, supported category chooser, and
concise footer. Homepage-only radii, shadows, and depth use `--spatial-*` tokens.

## 0007 whole-app rollout authority

The human live review approved the C homepage for whole-app rollout on 2026-09-05: **“Approve C homepage and continue across the app”**. Immutable [0007](design/evidence/history/0007-spatial-studio-whole-app-rollout.md) and [receipt 0007](design/evidence/selection-receipt-0007.json) bind that authorization to immutable 0006 and reviewed screenshots. It supersedes the remaining 0005 flat-only treatment for new route work; setup, gameplay, account/auth, and administration now implement the 0007 contract in reviewable batches. Existing flat surfaces are temporary fallback, never the selected target.
## Active authority and visual summary

This is the current authority for screen composition and semantic use of existing tokens. The approved direction is **استوديو الحروف** inside the C cobalt architectural spatial world defined by 0007. It borrows only confidence, contrast, framed zones, and explicit action
hierarchy observed on Golbha; it is not a Golbha derivative. The 25-cell Arabic honeycomb,
physical team axes, and real match state remain the product identity.

Shared routes retain light, dark, and system controls. Host, player, and audience use the 0007 spatial treatment while gameplay legibility remains theme-invariant. At desktop live play:
vertical green score physical left, authentic board centered, horizontal crimson score physical
right, control console below. RTL affects reading order only; it never mirrors board axes.

| Concern | Binding authority |
|---|---|
| Exact values and aliases | [design/TOKENS.md](design/TOKENS.md), [design/tokens.css](design/tokens.css) |
| Visual concept, supersession, research boundary | [DESIGN-DNA.md](DESIGN-DNA.md) |
| Route/state audit and current-vs-gap status | [design/ROUTE-STATE-COVERAGE.md](design/ROUTE-STATE-COVERAGE.md) |
| Role projections and lifecycle treatments | [design/UI-STATE-MATRIX.md](design/UI-STATE-MATRIX.md) |
| Route composition and responsive behavior | [design/ROUTE-VISUAL-CONTRACT.md](design/ROUTE-VISUAL-CONTRACT.md) |
| Homepage section mapping, component/data ownership, and deferred-reference treatment | [design/HOME-SURFACE-SPEC.md](design/HOME-SURFACE-SPEC.md) |
| Information architecture and authorization | [design/IA.md](design/IA.md) |
| QA evidence and human-review boundary | [design/ACCEPTANCE.md](design/ACCEPTANCE.md) |
| Runtime truth | [src/app/App.tsx](src/app/App.tsx), [src/features/game/domain/lifecycle.ts](src/features/game/domain/lifecycle.ts), [src/routes/GameRoutes.tsx](src/routes/GameRoutes.tsx) |

Source-backed role/data safety outranks visual treatment. A requirement is never described as
implemented without source or test evidence.

The homepage is one core-game entry surface, not a multi-game marketplace. All nine audited
regions are binding scope in [the homepage surface specification](design/HOME-SURFACE-SPEC.md):

1. full product/navigation header;
2. verification/reward notice;
3. classic, fast, and custom mode shortcuts;
4. daily challenge panel;
5. offer/package area;
6. featured core-game band;
7. weekly-play discovery rail;
8. Tahadani category catalogue for match setup; and
9. complete product/support/legal footer.

The mode and category sections are planned compositions over source-backed setup concepts.
Unsupported account, credit, reward, daily, commerce, aggregate-analytics, legal, social, and
store behavior stays explicitly deferred until its route, data owner, and authorization exist.

## Product semantics that do not move

- Arabic RTL reading order; technical codes, URLs, UUIDs, and identifiers are isolated LTR.
- A 25-cell, six-neighbour honeycomb with physical crimson left/right horizontal rails and
  physical deep-green top/bottom vertical rails.
- Team identity is color + axis icon + pattern + Arabic label. Color alone never carries state.
- Real state only: no fake players, scores, questions, timers, or planned modes.
- Mint is active/focus/ready/primary action, never a team; use existing token authority only.

## Product jobs and experience principles

This is one realtime match expressed through four deliberately different projections, not one
dashboard resized for every user:

1. **Audience stage:** make the board, question, timer, score, and winning path readable at a
   glance and from a television distance.
2. **Host console:** make the next legal action, private answer evidence, timer state, first
   responder, adjudication, and correction consequences unambiguous under time pressure.
3. **Player controller:** make eligibility and the one-thumb buzzer trustworthy; acknowledge
   the server result instead of implying that a local tap won.
4. **Question administration:** make stock health, source quality, review state, and validation
   visible without leaking draft or private content into gameplay projections.

The board precedes chrome. Explicit Arabic status precedes animation. Private/public separation
is a data boundary, not a CSS treatment. The host sees the consequence of a correction before
confirmation. English and technical fragments remain isolated exceptions inside an Arabic RTL
layout.

## Screen compositions for every router pattern

| Pattern | Surface and focal order | Current stance |
|---|---|---|
| `/` | Current decision → primary join/create action → concise status → code-native board identity in a centered shared shell. The homepage section contract is in `HOME-SURFACE-SPEC.md`; it maps only the one core game and marks unsupported reference affordances deferred. | Implemented route; query/failure evidence is tracked. |
| `/how-to-play` | Authentic annotated board → select → ask/buzz → capture → connect. | Implemented; long Arabic/bidi/zoom evidence required. |
| `/host/new` | Two balanced desktop columns: configuration and selected-count/category summary; one focused mobile column. | Implemented; stock/error/success states are gap-tracked. |
| `/room/:roomCode/lobby` | Room/readiness → physical-team rosters → legal host start action. | Implemented; lifecycle/connection projections require evidence. |
| `/room/:roomCode/host` | Board → question/timer → fixed physical score flanks → console below. Under 768px, safe host limitation. | Implemented; full lifecycle/failure evidence required. |
| `/room/:roomCode/play` | Phase instruction → one-thumb buzzer → eligibility/recovery copy. | Implemented; private data excluded. |
| `/room/:roomCode/display` | 16:9: centered board, physical score flanks, timer/round above, question tray below. | Implemented; projection/closed/recovery evidence required. |
| `/room/:roomCode/results` | Winner/path → derived rounds → role-filtered actions. Nonterminal deep links explain nonfinal status. | Implemented; rematch/history cases gap-tracked. |
| `/questions` | Inventory health → filters → records, at dense 6/10. | Implemented; authorization/service states tracked. |
| `/questions/new` | Blank editor → review/source context → validation/save status. | Implemented; publishing is source/authorization-bound. |
| `/questions/:questionId` | Record status → fields → review evidence; approved records read-only. | Implemented; not-found/service/authorization tracked. |
| `*` | Calm unknown-path/expired-session explanation and one safe return action. | Implemented NotFound route; wording/return evidence required. |

## Visual and interaction system

- IBM Plex Sans Arabic: 700 display letters/major scores, 600 controls/headings, 400–500
  body; joined Arabic is never letter-spaced. Scores/timers use tabular figures.
- Existing 4px scale and 24–64px section rhythm; zero-radius rectangles; circular countdown
  only; hexagons only for game objects.
- Bounded outlined zones and solid blocks create energy. Do not copy Golbha pills, rounded
  cards, palette, layout, artwork, photography, language, or mechanics.
- Every action has rest, hover where available, focus-visible, pressed, loading, disabled
  with Arabic reason, success/error, offline, reconnecting, and stale treatment.
- Motion: 90–120ms press, 200ms transition, one 320ms winning path. Reduced motion removes
  translation, scale, sweep, and pulse; no ambient loops or timer color cycling.

## Component and ownership contract

Keep rendering, server authority, and role filtering separate. Recommended module boundaries:

```text
src/
  app/                 router, providers, document direction, fatal boundary
  routes/              route composition only
  design-system/       tokens, type, buttons, fields, dialogs, status, icons
  features/room/       join, lobby, roster, connection
  features/game/       projections, adapters, selectors, event copy
  features/board/      geometry, HexBoard, HexCell, ownership/path rendering
  features/host/       question evidence, timer controls, judgment, correction
  features/player/     buzzer and personal status
  features/display/    audience stage and public results
  features/questions/  inventory, editor, source and review workflow
  test/fixtures/       one role-safe fixture per state and recovery case
```

| Component | Owns | Must not own |
|---|---|---|
| `HexBoard` / `HexCell` | coordinates, visible state, focus/hit target, ownership/path rendering | adjacency rules, winner calculation, hidden surprise value |
| `TeamScoreBlock` | team name, axis/pattern, derived rounds and question score display | score mutation or winner calculation |
| `QuestionStage` | public letter/category/prompt and permitted reveal | pre-reveal answer/source fields |
| `Countdown` | display derived from authoritative deadline and offset | expiry decisions |
| `PlayerBuzzer` | one intent, pending acknowledgement, explicit result | deciding who was first |
| `HostQuestionPanel` | private accepted answers, sources, revision context | projection filtering |
| `HostJudgmentControls` | fixed legal intent controls and disabled reasons | local ownership mutation |
| `ConnectionStatus` | connecting/reconnecting/offline/stale feedback | transport implementation |
| `RoundResult` | authoritative path and role-safe summary | recalculating the result |
| `QuestionEditor` | draft fields, normalization preview, validation/save status | automatic approval or publication |

Components receive semantic values such as `team="horizontal"` and `phase="selected"`, not raw
presentational colors.

## State/data boundary

Authoritative lifecycle names and legal reducer events are in the coverage artifact. Earlier
documents used conceptual events such as `CANCEL_QUESTION`, `PATH_FOUND`,
`COMPLETE_MATCH`, `REMATCH`, and `CLOSE_ROOM`; those are requirements, not current
reducer events. Projection and server authorization—not URL—decide action/private-answer
availability. Player/audience payloads omit answers, alternatives, sources, and moderation
before permitted reveal.

- Use discriminated TypeScript unions for the 14 lifecycle values; do not build one object from
  unrelated optional booleans.
- Render from a role-filtered projection and revision. An intent includes the expected revision;
  a stale response refreshes the projection and preserves only non-authoritative entered text.
- Keep question-score points, cell ownership, effective round outcomes, match result, and timer
  as separate values. Do not derive one from a visual counter.
- URLs may contain routes, room codes, filters, and selected admin IDs. They never contain
  accepted answers, role secrets, capability material, or moderation data.

## Arabic, RTL, icons, and media

- Set `<html lang="ar" dir="rtl">`; use logical CSS properties. Do not mirror the app shell,
  board, team axes, play/pause/check icons, or physical goal edges.
- Wrap room codes, UUIDs, URLs, timestamps, and diagnostic latency with `<bdi dir="ltr">`.
  Joined Arabic keeps normal tracking; question copy targets readable 35–60-character lines.
- Public scores/timers may use `Intl.NumberFormat("ar-KW-u-nu-arab")`; technical identifiers
  stay ASCII. Product copy is stored by message key even while Arabic is the only locale.
- Use one outline icon family at 2px stroke and `currentColor`. Icon-only controls need an
  Arabic accessible name and at least a 44×44px target.
- The board, rails, patterns, timer, and winning path are code-native. Tahadani category covers
  are real content media with provenance, aspect ratio, title, loading skeleton, unavailable
  fallback, and rights state. Historic show photos, Golbha, and Refero screenshots are evidence
  only and never production assets.

## Loading, error, and recovery contract

| Condition | Required treatment |
|---|---|
| Initial load | Stable skeleton that preserves form/board geometry and never implies readiness |
| Room not found or closed | Plain Arabic explanation, room code when safe, and one return/retry path |
| Reconnecting | Freeze unsafe actions, retain the last safe projection, announce once |
| Offline while buzzer is open | Disable immediately, show the reason, use an assertive announcement |
| Stale host action | Preserve the ruling note, refresh state, explain the conflict |
| Question unavailable/invalid | Host-only replace/flag path; public neutral pause; no penalty implied |
| Correction | Preview affected cell, score, path, and round; require reason; apply one ordered event |
| Admin unauthorized | Explain restricted access without rendering the protected editor/data |
| Save/rematch failure | Keep entered configuration where safe and expose a specific retry |
| Fatal render failure | Role-safe reload/return with room code; never print answer-bearing state |

## Current scoring and result presentation

The implementation’s lifecycle reducer treats one finalized owned cell as one question-score
point for its physical team. Round wins and match result are derived from append-only round
outcome history, rather than being independent decorative counters. For the current `v2`
rules, a match winner is derived by either two consecutive round wins or three total round
wins; legacy best-of counters are explicitly grandfathered behavior. Results therefore show
real derived winner/path and round state first, question-score points second, and only
role-authorized actions. A rematch UI is a requirement until an application-level source proves
its behavior.

## Reference synthesis decision ledger

| Decision | Evidence | Bounded use | Exclusion |
|---|---|---|---|
| Arabic-first confidence and framed zones | Golbha public-site study | Clear decisions, explicit empty/disabled states, focused live flow | No logo, wordmark, copy, assets, palette, typography, pill chrome, composition, mechanics |
| Alternating sectional rhythm | Navigate / Refero | Shared-shell pacing and disciplined accents | No exact colors or rounded forms |
| Direct tabletop hierarchy | Cards Against Humanity / Refero | Solid fields and blunt hierarchy | No palette, cards, brand, or copy |
| Catalogue hierarchy | Spotify / Refero | Category browsing/media density | No sidebar, gradients, brand, layout |
| Search/filter clarity | Resend / Refero | Inventory controls and grid/list hierarchy | No copied screen composition |
| Focused setup | Spline / Refero | Visible progress and task focus | No copied UI styling |
| Empty/search clarity | Untitled / Refero | Explicit empty state after controls | No copied copy/assets |
| Result/replay hierarchy | Deezer + Playlist Quiz / Refero | Derived score/result/replay hierarchy | No brand, mechanics, visual copying |
| Lobby-to-live boundary | Around / Refero | Presence, launch, help, exit treatment | No copied flow mechanics |

Read [the Golbha study](design/evidence/golbha-public-site-study-2026-09-04.md) and the
[visual reference manifest](design/evidence/visual-reference-manifest.md) for observations,
provenance, limitations, and exclusions.

## Design governance

1. History `0004` remains immutable historical material context. `0005` is active for
   gameplay and supersedes incompatible material-depth clauses only.
2. Do not edit numbered history records or receipts. A Golbha-derived direction change requires
   exactly three new concepts, explicit human selection, a new numbered record, and a receipt.
3. The deterministic validator may verify only evidence identity, structure, dimensions,
   provenance, and threshold consistency; it must never certify aesthetic quality or emit an
   aesthetic PASS.
4. Every AI/model review is optional and advisory; it cannot authorize or block exact human
   selection or live-review gates. Distinct-family, distinct-session, read-only,
   provenance-backed review may be provenance-separated but remains advisory, and same-family
   or same-session review is never independent.
5. History bindings must remain valid when later directions or outcomes are appended; no
   implementation may revalidate an old receipt against a different mutable whole-file hash.

## Delivery sequence from the current codebase

1. **Authority alignment:** implement the shared-shell framed-zone treatment without changing
   existing token values; keep history-0005 gameplay flat and midnight.
2. **Shared routes:** finish entry, rules, setup, lobby, wildcard, and their light/dark/system,
   loading, validation, empty, error, and authorization evidence.
3. **Role surfaces:** complete every lifecycle and connection projection for host, player, and
   audience, including sub-768 host limitation and public/private payload tests.
4. **Results and administration:** complete both-winner results, nonterminal deep links,
   rematch outcomes, inventory/editor save/review/read-only states, and Tahadani media fallbacks.
5. **Verification:** capture the exact route/state/theme/viewport artifact matrix in
   [design/ACCEPTANCE.md](design/ACCEPTANCE.md); deterministic checks remain evidence, while the
   owner performs the live aesthetic review.

## Definition of design implementation done

- Every row in [design/ROUTE-STATE-COVERAGE.md](design/ROUTE-STATE-COVERAGE.md) is source-backed
  and tested or is explicitly accepted as deferred; no required state is silently omitted.
- Both shared themes and the midnight gameplay exception are verified at the required
  viewports, with no P0/P1/P2 visual, accessibility, privacy, or responsive issue remaining.
- The host can operate by keyboard at 200% zoom; player and display states remain readable on
  their target devices; reduced motion and common color-vision/grayscale cases preserve meaning.
- Player/audience payload tests prove pre-reveal private fields are absent. Board topology,
  physical axes, score derivation, and winning path match the authoritative domain.
- Production build, relevant type/lint/unit/component/browser checks, and human live review are
  recorded without any automated aesthetic PASS claim.

## Open decisions

- Legally cleared product name and wordmark; final self-hosted Arabic font package/license.
- Final production authentication/authorization for question administration and room roles.
- Exact question-stock release threshold per visible letter and rights treatment for every
  imported category cover.
- Whether secondary question-score points stay visible throughout play or primarily at results;
  any choice must not compete with round/match victory.
- Whether team appearance becomes configurable after V1; axis, pattern, label, and contrast
  redundancy remain mandatory.

## Administrative studio

`/admin` is an Arabic-first, server-backed operations surface: desktop uses a right-side navigation rail, compact environment/account bar, one bounded workspace, and semantic inventory regions at 6/10 density. Mobile uses a horizontally reachable drawer-equivalent navigation row and single-column detail. It does not invent metrics, users, questions, release results, or successful publication. All administrative loading, empty, forbidden, stale, offline, conflict, success, and error outcomes require Arabic copy; the callable result—not a route guard—remains authoritative.




