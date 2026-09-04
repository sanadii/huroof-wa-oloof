# DESIGN DNA — استوديو الحروف

Status: **binding visual and theme authority**  
Selected concept: `concept-studio-letters`  
Human-selection receipt: [`design/evidence/selection-receipt.json`](design/evidence/selection-receipt.json)  
Immutable history record: SHA-256 `7D87203666937CEDB2BE1BEC99CD8767111A9E4A0DECF43EA83CA35BB4F03A21`

> **Owner override — 2026-09-03:** the amber/yellow canvas was explicitly rejected and
> the coordinated light and dark theme pair was approved. Do not implement any amber,
> yellow, or gold token, nor the earlier “no dark mode” rule contained in this historical
> DNA. The binding replacement palette contract is
> [`design/THEME-EXPLORATION.md`](design/THEME-EXPLORATION.md). Board topology, goal-edge
> geometry, information hierarchy, typography, interaction, accessibility, and motion
> clauses remain binding.

This file governs aesthetic intent. [`design/TOKENS.md`](design/TOKENS.md) owns exact reusable values; [`DESIGN.md`](DESIGN.md) owns screens and implementation boundaries; [`GAME_REVIEW_AR.md`](GAME_REVIEW_AR.md) owns gameplay.

## North star

**A live Arabic knowledge studio built from letters, not a generic quiz dashboard.**

The experience should feel like a contemporary cultural broadcast set translated into software: sunny, intelligent, competitive, and unmistakably driven by the hex-letter board. It must feel appropriate in a family majlis, a classroom, and on a projected event screen without becoming childish, ornamental, or “esports.”

## Visual contract

> **Product mood and visual concept:** “استوديو الحروف” is a modern Arabic cultural game studio: calm, precise, and broadcast-ready rather than ornamental or esports-styled. Cultural confidence and live-game tension come from mineral-light or deep-charcoal canvases, crisp editorial typography, sharp flat geometry, and one mint interaction signal.
>
> **Dominant focal point and scan order:** On game surfaces the hex board is always first; current question and timer are second; team score and match progress are third; secondary metadata is last. On the entry screen the cropped letter-board composition is first, the join/create action is second, and supporting explanation is third.
>
> **Information density:** Default density is 5/10. Audience and player surfaces are sparse and glanceable; host and administration surfaces are compact but grouped by task. Empty space creates hierarchy, not pale text or decorative cards.
>
> **Desktop and mobile composition:** Audience display is designed first for 16:9 at 1280×720 and 1920×1080. Host uses an asymmetric 62/38 board-to-control split at ≥1024px and a stacked board/control layout below that. Player phone is a one-thumb interface with one dominant hexagonal buzzer and no host-only information. RTL changes reading order and panel placement, never board coordinates, adjacency, or win axes.
>
> **Typography roles:** Use one Arabic-first sans family, IBM Plex Sans Arabic, across display and UI. Large Arabic letters and scores carry the personality through scale and weight; body copy remains functional. Use tabular numerals for timers and scores. Technical codes remain isolated LTR.
>
> **Palette and surface treatment:** Light uses mineral white `#F2F1EC`, white surfaces, near-black ink, and mint `#79D4B6`. Dark uses deep charcoal `#0D1318`, slate surfaces, off-white text, and vivid mint `#4FE0BD`. Mint is limited to active/focus/ready states. Team ownership uses independent crimson and deep-green tokens plus pattern, axis icon, and label. Both themes are first-class. No amber, yellow, gold, gradients, glow, glass, or elevation shadows.
>
> **Spacing and shape rules:** Use a 4px-derived spacing system with deliberate 24–64px sectional rhythm. Panels, fields, score blocks, and buttons are square-cornered. Circles are reserved for countdown progress; hexagons are reserved for the board, buzzer, and game identity. Borders are visible and structural.
>
> **Icon and imagery direction:** Use one 2px-stroke outline icon family, preferably Lucide, with optical RTL correction and `currentColor`. Product identity is code-native: hex grids, edge markers, axis glyphs, numerals, and Arabic letterforms. Do not use stock Arabesques, mosque silhouettes, mascots, generic 3D art, or copied television imagery.
>
> **Interaction and UI states:** Every control has rest, hover where applicable, focus-visible, pressed, loading, disabled-with-reason, success/error, offline, and reconnecting behavior. The buzzer has ready, locked, pressed, first, answer-now, missed, and disconnected states. Color never carries state alone.
>
> **Motion restraint:** Motion serves feedback, continuity, or hierarchy only. Use 120ms micro-feedback, 200ms state changes, and 320ms large transitions. Cell award follows the winning team’s axis; the winning path resolves once and stops. Reduced motion removes translation, scale, sweep, and pulses.
>
> **Explicit anti-patterns:** no rounded-card dashboard, glassmorphism, default violet/indigo, dark gamer shell, gold gradients, decorative calligraphy, one-word display-font swaps, emoji icons, color-only teams, generic hero/feature grids, ornamental side stripes, fake photography, slow hover motion, or `transition: all`.

## Reference lock

Primary light reference: V–A–C Refero style `ffef8672-f789-4329-8895-47e50f517d31`.

Primary dark reference: Turso Refero style `30f57fef-66d5-4f84-a528-88deacf24080`.

Preserve:

- Mineral-white or deep-charcoal canvas, high typographic contrast, oversized sans display text, and flat surfaces.
- Sharp zero-radius component language.
- Mint only as an active/focus/ready signal.
- Exhibition-like asymmetry and generous sectional rhythm.

Borrow only:

- Compact, aligned score numerals from Uniswap Cup; its fuchsia is explicitly omitted in V1.
- Countdown clarity and immediate adjudication feedback from the Deezer quiz screen.
- Leaderboard row hierarchy from Brilliant.
- Symmetric team-score legibility from Apple TV match cards.

Media strategy: all V1 identity graphics are code-native SVG/CSS primitives with real game data. The board is not a decorative illustration; it is the product. The historic photograph is research evidence only and is never shipped.

Reject: soft neutral averaging, “heritage beige,” decorative Arabic motifs, borrowed brand assets, image-led sports styling, and generic mobile-game gloss.

## Brand principles

1. **The letter is the hero.** Arabic letters must remain large, correctly shaped, and legible from a distance.
2. **The board explains the product.** A screenshot without the logo should still be recognizable as this game.
3. **Competition is structural.** Tension comes from paths, timer, buzzer, and score—not neon effects.
4. **Cultural without costume.** Arabic language, direction, rhythm, and geometry create identity; clichés do not.
5. **One state, one meaning.** Brand, team, judgment, and system-status colors never silently exchange roles.

## Composition system

### Entry screen

- Asymmetric 7/5 composition on desktop: a cropped, oversized neutral hex field occupies the visual side; the join/create block occupies the RTL reading start.
- One large title, one concise value statement, one room-code field, and two explicit actions: `انضم إلى غرفة` and `أنشئ مباراة`.
- No feature-card row. Supporting facts appear as a restrained inline sequence: `فريقان · أسئلة عربية · مسار يفوز`.
- On mobile, the board crop becomes a shallow header field; join remains above create.

### Audience display

- Board uses 60–70% of the usable stage and stays centered in the safe area.
- The physical board silhouette is preserved: crimson sawtooth goal strips hug the full
  left/right edges and deep-green sawtooth goal strips hug the full top/bottom edges.
- Team scores use compact, symmetric readouts aligned near the board. Large detached
  score cards are prohibited because the colored goal edges already carry team identity.
- Timer stays near the active question, not in global navigation.
- The question appears in a full-width lower band only during question states; it collapses when selecting a cell.
- Match code and operational controls are absent or visually tertiary.

### Host console

- Desktop: board/event context 62%; question, answer, timer, and judgment controls 38% at the RTL start edge.
- The accepted answer and source are visually separated from audience-safe question copy.
- Correct and incorrect actions remain fixed in position; destructive correction requires confirmation and reason.
- Dense metadata uses dividers and alignment, not nested cards.

### Player phone

- Team name and connection state at top; current phase in the middle; large hex buzzer within thumb reach.
- No answer, source, other players’ latency, or host controls.
- After buzzing, replace the action label with an explicit status; do not leave an apparently tappable disabled control.

### Question administration

- Desktop-first work surface with filters, table/list, editor, evidence/source panel, and review status.
- It uses the same colors and type but a quieter canvas and denser 6/10 layout.
- This surface may use interactive rows; it must not wrap every grouping in a card.

## Typography

- Family: `IBM Plex Sans Arabic`, then `Tahoma`, `Arial`, sans-serif.
- Load as a self-hosted variable WOFF2 when licensing/package verification is completed; use `font-display: swap`.
- Weights: 400 body, 500 labels, 600 controls/subheads, 700 display letters and major scores.
- App scale: 12, 14, 16, 20, 24, 32, 48, 72px. Audience letter tiles may scale with `clamp()` beyond 72px.
- Arabic display tracking remains normal; do not copy Latin negative tracking rules onto joined Arabic glyphs.
- Line heights: 1.15 display, 1.35 UI, 1.6 reading copy.
- Scores, countdowns, ranks, and result columns use tabular figures.
- Audience numbers default to Arabic-Indic digits. Room codes, UUIDs, technical logs, and URLs use ASCII digits inside `dir="ltr"` / `bdi`.

## Color roles

Exact values and contrast pairs live in [`design/TOKENS.md`](design/TOKENS.md).

- Canvas and surface neutrals define the active light or dark theme; neither theme uses amber, yellow, or gold.
- Mint means interactive readiness, selection, or keyboard focus, never team ownership or generic decoration.
- Crimson means horizontal-team ownership only within game context.
- Deep green means vertical-team ownership only within game context.
- Correct/incorrect judgment uses neutral inverse treatment plus icon and text; it never uses generic green/red feedback that could be mistaken for team ownership.
- Neutral cells use the theme's cell fill with a strong border so they remain distinct from the canvas.

## Shape, border, and depth

- Radius is `0` for panels, fields, buttons, menus, banners, and score blocks.
- Hexagons are game objects, not decorative card masks.
- Countdown rings may be circular because circular progress encodes elapsed time.
- Default structural border is 1px; selected and board-cell borders are 2px; winning path is 4px.
- No elevation shadow. Overlays use an ink scrim and a 2px ink border.
- Focus uses a two-part ink-and-jade ring; this is a focus indicator, not elevation.

## Motion language

- Button press: 90–120ms, maximum scale change `0.98`.
- Panel/state change: 200ms.
- Modal/drawer: 240–320ms.
- Cell award: 200ms directional fill aligned to `↔` or `↕`, plus an immediate ownership icon.
- Winning path: sequential highlight completed within 320ms, then static.
- Countdown: continuous visual decrement without bouncing or color cycling.
- All motion is interruptible. Never delay a host ruling or buzzer lock for animation.
- Under `prefers-reduced-motion`, use instant state changes or opacity-only transitions ≤100ms.

## Accessibility and bidi invariants

- Body text contrast ≥4.5:1; large text and meaningful graphics ≥3:1.
- All interactive targets are ≥44×44px on touch; the player buzzer is substantially larger.
- Focus uses `:focus-visible`; never remove focus without replacement.
- Ownership is encoded by color + pattern + axis icon + accessible name.
- Horizontal-team pattern runs horizontally and carries an `↔` SVG glyph; vertical-team pattern runs vertically and carries an `↕` SVG glyph.
- `dir="rtl"` is set at the document root. Use logical CSS properties.
- Board coordinate IDs, adjacency, top/bottom and left/right goal edges, and path computation never change with direction.
- Live score, connection, timer, and adjudication changes use appropriate `aria-live` regions without announcing every countdown tick.
- Reduced motion, 200% zoom, keyboard-only host operation, and common color-vision deficiencies are release gates.

## Governance

- This DNA became binding only after the exact three Refero-backed concepts and human selection were recorded.
- Automated checks may validate evidence identity, structure, dimensions, provenance, token usage, and contrast thresholds. They must never certify aesthetic quality.
- AI/model reviews are advisory and cannot approve or block the human visual gate.
- Never edit the immutable selection record. A change of direction requires a new numbered history record and a new receipt that explicitly supersedes the old one.
- The entry screen is implemented and human-reviewed before this visual language expands across the app.

## Owner-approved premium material evolution — 2026-09-04

This is an approved material-depth evolution inside the selected **Studio of Letters**
direction, not a new identity. Immutable history records `0001`–`0003` remain untouched;
the corresponding append-only record is
[`design/evidence/history/0004-premium-material-evolution.md`](design/evidence/history/0004-premium-material-evolution.md).

The product becomes a calm, tactile, contemporary Arabic broadcast tabletop: refined matte
product depth, never esports, glass, neon, toy plastic, ornamental heritage, chrome, or a
rounded-card dashboard. Things-style cool canvases and selective soft elevation inform the
atmosphere; Playdate contributes only the tactile product-object treatment; Franky’s
contributes only contained game-frame/inset material cues; restrained New Yorker mini-game
screens inform the quiet puzzle-canvas hierarchy. Their yellow, violet, retro type, gold,
and decorative languages are excluded.

### Exact material code

- Background imagery is decorative atmosphere only. `--studio-background-image` points to
  the approved light/dark generated fields at `cover center / scroll`; its centre stays
  low-detail and contains no semantic, team, active, or glyph information. Provenance is
  recorded in [`design/evidence/background-provenance-2026-09-04.md`](design/evidence/background-provenance-2026-09-04.md).
- Reusable material roles are the tokenized `surface-raised`, `surface-recessed`,
  `edge-highlight`, `edge-low`, `shadow-soft`, `shadow-deep`, `shadow-raised`,
  `shadow-panel`, and `shadow-control`. Light values include raised `#FFFFFF`, recessed
  `#E5EAE8`, high edge `rgb(255 255 255 / 90%)`, low edge `#899592`; dark values include
  raised `#1C2932`, recessed `#091116`, high edge `rgb(245 242 234 / 16%)`, low edge
  `#05090C`. Exact values are in `design/tokens.css`.
- Elevation is reserved for the central board/plinth, active question/control tray, buzzer,
  and selected or primary actions. It never turns every section into a floating card.
  Rectangular surfaces remain square-cornered.
- Every authentic game cell retains its existing outer polygon, centre, overlay hit target,
  board viewBox, and topology. A component-local SVG `<defs>` block provides token-only
  vertical gradients named `neutral`, `active`, `horizontal`, and `vertical`; each cell is
  a full-size shell polygon followed by an inset face calculated at 92% around the exact
  same centre and shifted `-2` SVG units, then upper-left highlight/lower-right shade,
  ownership pattern, letter, axis glyph, and title. A single board/plinth shadow is
  allowed; per-cell SVG filters are not.
- Each rail keeps its existing fitted path and divider positions. It gains one
  `translate(0 4)` solid depth path in the matching strong team token below the existing
  top face; this does not duplicate test IDs or semantic labels.
- Controls use a tokenized 3px extrusion. Press feedback moves down 2px for 90ms; reduced
  motion removes translation. State changes retain the existing 120/200/320ms limits.

The implementation code shape is intentionally exact and narrow:

```css
.game-board-wrap { background: var(--surface-recessed); box-shadow: var(--shadow-panel); }
.game-board__cell-shell { fill: var(--edge-low); stroke: var(--ink-primary); }
.game-board__cell-face { stroke: var(--ink-primary); }
.game-board__cell-highlight { stroke: var(--edge-highlight); }
.game-board__cell-shade { stroke: var(--edge-low); }
.button--primary, .buzzer { box-shadow: var(--shadow-control); }
```

```tsx
<linearGradient id={`${prefix}-${state}`} x1="0" x2="0" y1="0" y2="1">
  <stop offset="0" stopColor={`var(--material-${state}-top)`} />
  <stop offset="1" stopColor={`var(--material-${state}-bottom)`} />
</linearGradient>
<polygon className="game-board__cell-shell" points={outerPoints} />
<polygon className="game-board__cell-face" fill={`url(#${prefix}-${state})`} points={insetPoints} />
<path className="game-board__rail-depth" d={railPath} transform="translate(0 4)" />
```

### Non-negotiable invariants

Keep the 440×440 board silhouette, 25 cells, four half-cell rails, hit target centres,
adjacency, physical LTR board axes, centred board with green score physically left and
crimson score physically right, mobile two-column score row, Arabic-first type stack,
mint-only interaction, crimson-horizontal/green-vertical ownership, zero yellow/amber/gold,
and contrast/accessibility requirements. Automated validation may check geometry,
provenance, contrast, dimensions, accessibility, and regressions; it is evidence only and
must never claim aesthetic approval or replace human visual review.
