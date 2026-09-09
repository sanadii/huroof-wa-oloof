# DESIGN DNA — تحدي الخلية

## Current user-directed brand and background amendment — 2026-09-09

The user renamed the app **تحدي الخلية**, approved the glowing hexagonal-cell artwork, and explicitly requested: “remove all the letters and just add other categoreis”, “remove the text at the top”, and “put it as background for the app”. This narrow amendment supersedes older product-name and decorative-background requirements below. Historical selections and receipts remain unchanged; this is not a new whole-app layout direction or inferred visual approval of the rendered integration.

Use category-only, text-free artwork at `/assets/backgrounds/cell-challenge-categories-v1.webp` as the shared decorative background. The concept combines a luminous central cell with geography, literature, science, cinema, sport, and music symbols. Preserve existing Arabic typography, responsive RTL layouts, functional controls, and readable foreground surfaces. Home actions and actual gameplay questions/boards retain priority over the background; the decorative homepage board may be removed to expose the artwork. Actual game boards, letter/category modes, physical team axes, and runtime identifiers remain unchanged. No new ambient animation is authorized. The artwork's approved colors apply to imagery; existing semantic control tokens remain authoritative.

Status: **binding current visual authority** · selected whole-app target: `spatial-studio` with human-approved whole-app rollout

## 0006 selected whole-app target; historical homepage-first gate

The human product owner selected **“C — مدار الحروف: vivid blue spatial studio”** on
2026-09-05. The immutable selection evidence is
[`0006-spatial-studio-homepage-direction.md`](design/evidence/history/0006-spatial-studio-homepage-direction.md),
its [receipt](design/evidence/selection-receipt-0006.json), and the exact-three
[concept-set artifact](design/evidence/concept-set-immersive-2026-09-05.json).

`مدار الحروف` is the selected **whole-app target**. Current authorization is a homepage and
create/join representative rollout followed by a mandatory new human live review. Other
routes remain temporarily on their existing treatment until that review explicitly expands
rollout; this is sequencing, not a permanent decision to keep flat gameplay. Future spatial
gameplay preserves the canonical 25-cell six-neighbour board, physical crimson left/right
and emerald top/bottom axes, fast legibility, permissions, and truthful data.

For `.spatial-home-page` only, 0006 supersedes prior flat/no-blue/no-radius/no-depth and
nine-home-region clauses. Use `--spatial-*` tokens, opaque ice-white controls, cobalt
architectural canvas, and real code-rendered board CSS perspective. Mockups are evidence,
never bitmap product UI.

## 0007 whole-app rollout approved

The human product owner approved the reviewed C homepage for whole-app rollout on 2026-09-05:
**“Approve C homepage and continue across the app”**. Immutable authority is
[`0007-spatial-studio-whole-app-rollout.md`](design/evidence/history/0007-spatial-studio-whole-app-rollout.md)
and [receipt 0007](design/evidence/selection-receipt-0007.json), bound to immutable 0006 and
review screenshots. 0007 supersedes the remaining flat-only/no-blue/no-depth/no-radius clauses
from 0005 for future route implementations. Existing flat routes are temporary rollout fallback,
not the selected target. The full 0007 visual contract is authoritative for batches; board
geometry, team axes, truthful data, projection privacy, auth, and authorization remain invariant.
## Current supersession summary

The human-selected **استوديو الحروف** identity remains active. History
[0005](design/evidence/history/0005-flat-broadcast-game-direction.md) is immutable historical gameplay evidence. Its former flat-midnight material treatment is superseded for future route implementation by 0007. Do not modify either record or receipt.

[design/ROUTE-STATE-COVERAGE.md](design/ROUTE-STATE-COVERAGE.md) is the current route/state
audit. [design/TOKENS.md](design/TOKENS.md) and `design/tokens.css` own exact values; this
document assigns semantic roles only.

[design/HOME-SURFACE-SPEC.md](design/HOME-SURFACE-SPEC.md) binds the individually audited
homepage section mapping. It is a source-constrained build contract: this one-core-game product
does not imply credits, rewards, purchases, gifts, catalogue variants, social/store
destinations, or a copied Golbha homepage composition.

The old nine-region homepage rhythm is historical scope only. The approved C homepage composition is defined by `HOME-SURFACE-SPEC.md` and 0007; unsupported reward, daily, commerce, analytics, legal, social, and store capability remains deferred.

## Active visual contract

> Product mood and visual concept: ‘استوديو الحروف’ is an Arabic party-game studio with a celebratory outer shell and a calm broadcast core. It should carry Golbha’s confidence, contrast, and group-play energy without reproducing its brand. The honeycomb board, Arabic letters, and two physical team axes remain the unmistakable identity.
>
> Dominant focal point and scan order: Entry and setup show the current decision first, its primary action second, and supporting explanation/status third. Live host and audience views show board first, question plus timer second, fixed side scores third, and operational controls last. Player view shows phase instruction first and the buzzer second; administration shows inventory health, filters, then records/editor.
>
> Information density: Public entry and lobby are 4/10; setup and host are 5/10; question administration is 6/10; player and audience are 3/10. Density comes from grouping and alignment, never tiny text, nested cards, or indiscriminate decoration.
>
> Desktop and mobile composition: Shared pages use a centered maximum-width shell and decisive framed zones. Setup uses two balanced columns on desktop and one focused column on mobile. Host gameplay uses green score physically left, centered board, red score physically right, with the control console below; tablet stacks score summaries above the board. Audience is a 16:9 safe stage with the same physical score placement. Player is a phone-first one-thumb layout. RTL changes reading order, never physical board coordinates or win axes.
>
> Typography roles: Keep IBM Plex Sans Arabic as the Arabic-first family. Use 700 for brand/display/game letters and major scores, 600 for actions and section headings, 400–500 for body and metadata. Display scale is bold and compact; joined Arabic is never letter-spaced. Scores and timers use tabular figures; room codes and technical identifiers are isolated LTR.
>
> Palette and surface treatment: Preserve the approved light/dark/system themes and exact token authority. Shared pages use mineral light or deep charcoal canvases, high-contrast ink, matte paper/slate surfaces, mint only for active/focus/ready/primary action, crimson only for the horizontal team, and deep green only for the vertical team. Use solid color blocks, decisive rules, and bounded framed zones to create energy. History-0005 gameplay remains theme-invariant midnight and flat. No yellow, amber, gold, copied Golbha indigo/lime/red values, glow, glass, or unapproved gradients.
>
> Spacing and shape rules: Use the existing 4px spacing scale with 24–64px section rhythm, stable max-width alignment, and a clear single focal zone per viewport. Preserve zero-radius rectangular structure, circle only for countdown, and hexagons only for game objects. Adapt the reference’s confidence through outline hierarchy and color blocking, not its pill system or rounded cards.
>
> Icon and imagery direction: Use one 2px outline icon family with Arabic labels and currentColor. The authentic code-native board is the hero. Real Tahadani category covers are content media and must keep their aspect ratio, rights metadata, loading/error fallback, and readable title strip; they are not decorative wallpaper. No Golbha logo, artwork, avatars, screenshots, or copied illustrations ship.
>
> Interaction and UI states: Every action has rest, hover where available, focus-visible, pressed, loading, disabled with a visible reason, success/error, offline, reconnecting, and stale handling. Selection count and the next legal action remain visible during setup. Buzzer, adjudication, correction, rematch, editor save/review, and empty/search states have explicit Arabic copy. Color never carries state alone.
>
> Motion restraint: Use 90–120ms press feedback and 200ms state transitions. A newly exact-one-away owned path flashes once for 320ms; an authoritative winning path pulses up/down exactly three finite 320ms iterations and then keeps its static 4px border. No looping ambient motion, floating cards, elastic springs, or timer color cycling. Reduced motion is instant/static.
>
> Explicit anti-patterns: no Golbha clone; no copied wordmark, copy, media, icons, category art, palette, typography, pill chrome, pricing layout, or branded game cards; no generic gamer neon; no glassmorphism; no yellow/gold; no dashboard made of nested rounded cards; no decorative hexagons unrelated to gameplay; no fake scores, fake players, fake questions, or planned features presented as implemented.

## Non-negotiable semantics

- Arabic RTL shell; 25-cell six-neighbour board; physical crimson left/right horizontal axis and
  deep-green top/bottom vertical axis. Board geometry never mirrors in RTL.
- Shared routes are light/dark/system. Host/player/audience gameplay is flat midnight under all
  theme choices and uses one real countdown state.
- Identity is team color + Arabic label; owned cell interiors stay clear for letters. Answers/moderation are role-filtered.
- Tahadani covers are rights-managed content media, not a palette or backdrop.

## Brand, board, typography, and color invariants

1. **The letter is the hero.** Arabic letters stay large, joined correctly, and legible at
   distance. A code-native board—not a borrowed logo, photograph, or decorative hex field—is
   the recognizable product mark.
2. **The board explains the game.** Preserve the 440×440 viewBox, 25 pointy-side cells,
   six-neighbour topology, fitted rail paths, rendered vertices, and hit-overlay centres.
   Rails physically follow the outer hex boundary; they are not detached bars. Flat gameplay
   uses flat faces and crisp inset outlines only.
3. **Competition is structural.** Tension comes from legal selection, timer, buzzer,
   ownership, path, and derived score. Correct/incorrect feedback is neutral icon/text/border
   treatment, never generic green/red that conflicts with teams.
4. **Arabic without costume.** Arabic language, direction, letterforms, and rhythm create
   cultural confidence. No stock Arabesque, mosque silhouette, mascot, generic 3D art, copied
   television imagery, ornamental calligraphy, or Latin display-font substitution.
5. **Type is semantic.** IBM Plex Sans Arabic, Tahoma, Arial, sans-serif; weights 400 body,
   500 metadata, 600 controls/subheads, 700 display/game letters/major scores. Use compact
   bold display scale, 1.15/1.35/1.6 display/UI/body leading, normal Arabic tracking, and
   tabular figures for scores, timers, ranks, and result columns. Audience public numbers may
   use Arabic-Indic digits; room codes, UUIDs, URLs, timestamps, and technical logs remain
   ASCII in `bdi dir="ltr"` or equivalent.
6. **Color roles never exchange meaning.** Existing light/dark tokens own canvas/surface/ink.
   Mint is active, selected, ready, focus, and primary action only. Crimson is horizontal
   ownership/left-right rails only; deep green is vertical ownership/top-bottom rails only.
   Yellow, amber, gold, violet, indigo, copied Golbha values, and ad-hoc gradient colors are
   unassigned. Neutral cells use the exact theme cell role with strong outline.

## Accessibility, bidi, and interaction invariants

- Set document `lang="ar"` and `dir="rtl"`; prefer logical CSS properties. Do not
  `scaleX(-1)` an application shell or board. Board q/r coordinates, adjacency, physical
  top/bottom and left/right goals, and path calculation do not change with direction.
- Every interactive target is at least 44×44px; host primary controls remain reachable at
  200% zoom. Use visible `:focus-visible`, semantic buttons/links, meaningful titles and
  skip links, and Arabic labels for icon-only controls.
- Cell accessible names include coordinate, visible/revealed value, owner team color, selection, and
  winning-path state. Live regions announce meaningful buzzer, connection, award, correction,
  round, and match changes but never every countdown tick.
- Public/player payloads omit private accepted answers, alternatives, sources, and moderation
  before the permitted reveal; visual hiding does not satisfy this rule.
- Keyboard-only operation, reduced motion, 200% zoom, mixed Arabic-LTR readability, grayscale
  identity, common color-vision distinction, offline/reconnect/stale handling, and explicit
  disabled reasons are release evidence requirements.

## Motion and surface invariants

- Rectangles, fields, panels, score blocks, and buttons are zero radius. Countdown alone can
  be circular; hexagons are game objects only. Structural borders are 1px, selected/cell
  borders 2px, winning path 4px; use existing spacing and token values.
- Shared pages use matte mineral/charcoal surfaces and decisive outlined zones. Gameplay
  remains midnight, flat, without elevation/shadow/gradient. No generic rounded-card
  dashboard, glass, neon gamer shell, floating cards, or decorative hexagons.
- Press feedback is 90–120ms; state changes 200ms; a new near-win flashes once for 320ms and an
  authoritative winning path resolves with exactly three finite 320ms pulses before stopping on
  its 4px border. Never delay legal actions for animation. Reduced motion removes translation,
  scale, sweep, and pulse and limits opacity transitions to the existing token constraints.

## Reference lock and research boundary

Golbha is secondary descriptive research only. Its dated observations, method, limitations,
and route translation are in
[design/evidence/golbha-public-site-study-2026-09-04.md](design/evidence/golbha-public-site-study-2026-09-04.md).
The manifest preserves earlier research and records bounded Golbha/Refero roles.

The four owner-supplied Golbha homepage screenshots are retained only as hashed audit evidence
in the homepage specification. They require a section-by-section Huroof mapping, not imitation;
they add no route, feature, commerce, account, or content-data authority.

Permitted synthesis: Arabic-first confidence, contrast, grouped saturated blocks, strong framed
zones, one primary decision, explicit empty/disabled states, category breadth, and focused live
flows. Refero informs only sectional rhythm (Navigate), blunt solid fields (Cards Against
Humanity), catalogue hierarchy (Spotify), filters (Resend), focused steps (Spline), empty/search
clarity, results (Deezer), and room/game sequencing.

Rejected: Golbha logo/wordmark/copy/media/category art/photography, palette, typography, pills
or rounded chrome, composition, pricing, branded cards, mechanics; and all exact Refero
compositions or branded assets.

## Governance and history integrity

- Immutable selection history and receipts are evidence, not mutable implementation notes.
  `0004` is historical; `0005` is active gameplay supersession.
- C1: “The deterministic validator may verify only evidence identity, structure, dimensions, provenance, and threshold consistency; it must never certify aesthetic quality or emit an aesthetic PASS.”
- C2: “Every AI/model review is optional and advisory; it cannot authorize or block exact human selection or live-review gates. Distinct-family, distinct-session, read-only, provenance-backed review may be provenance-separated but remains advisory, and same-family or same-session review is never independent.”
- C3: “History bindings must remain valid when later directions or outcomes are appended; no implementation may revalidate an old receipt against a different mutable whole-file history hash.”
- C4: “Preserve all existing uncommitted and untracked work; do not reset, stash, broad-stage, auto-commit, or import stale runtime policy over canonical source.”
- C5: “Use Golbha only as secondary, descriptive research evidence. Do not copy or ship its logo, wordmark, copy, category artwork, photography, palette, typography, pill/rounded chrome, page composition, or game mechanics.”
- C6: “Do not edit numbered history records or existing receipts. If a proposed Golbha-derived clause changes the selected visual direction rather than clarifies it, stop and require exactly three new concepts, an explicit human selection, a new numbered record, and a new receipt.”

## Admin surface application

The administrative studio applies the approved shared-shell direction with a 6/10 density: right-side desktop rail, compact environment/account bar, semantic tables and framed records, zero-radius controls, and a single main workspace. It must stay Arabic-first and bidi-safe for technical IDs, retain 44px targets/focus visibility/reduced-motion behavior, and show truthful loading, empty, forbidden, stale, offline, conflict, success, and error states. It must not use fake metrics, rounded-card dashboards, decorative game hexagons, glass, gradients, or unimplemented publication claims.




