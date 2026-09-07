# Hex Board Specification

This document translates the gameplay board into a stable rendering and interaction contract. [`GAME_REVIEW_AR.md`](../GAME_REVIEW_AR.md) remains the rule authority.

## Coordinate model

- Default board: 5×5 odd-column offset honeycomb, 25 cells.
- Coordinate: `(q, r)`, where both values are integers from `0` through `4`.
- Stable cell ID: `cell-${q}-${r}`.
- DOM/test order: `r` ascending, then `q` ascending.
- Odd-q neighbors (the same graph rendered by the compact honeycomb):
  - even `q`: `(q, r ± 1)`, `(q ± 1, r)`, `(q ± 1, r - 1)`
  - odd `q`: `(q, r ± 1)`, `(q ± 1, r)`, `(q ± 1, r + 1)`
- Coordinates outside the configured board are ignored.

For flat-top SVG hexagons with radius `s`:

```text
x = s × 1.5 × q
y = s × √3 × (r + (q % 2) / 2)
```

The SVG owns its `viewBox` and aspect ratio. Do not mirror the SVG with CSS under RTL.

## Team axes

- `team-horizontal` wins by connecting `q = 0` to `q = 4`.
- `team-vertical` wins by connecting `r = 0` to `r = 4`.
- The rendered board labels both goal-edge pairs with team color and accessible text; owned cell interiors carry no pattern or axis arrow.
- Rendered cells are horizontally widened while preserving their vertical pitch so the complete
  framed 5×5 silhouette has approximately equal visible width and height. This is presentation
  geometry only; q/r identity, odd-q adjacency, and pathfinding are unchanged.
- Team names/colors may be customized, but their `horizontal` or `vertical` axis remains stable for the round.

## Rendering envelope

### Flat midnight gameplay supersession

- Each cell is one flat dark-navy face with its outer keyline and one crisp inset outline. Do not render shell/face depth, gradients, highlights, shades, or SVG filters.
- Each of the four fitted rails is one continuous flat path. Do not render rail depth faces or divider elements.
- Keep the existing 440×440 viewBox, vertices, centre points, overlays, q/r ordering, and rail path calculations exactly unchanged.

- The cells render as one compact, contiguous interlocking field. Thin shared-looking
  borders are allowed; wide canvas channels that make rows or columns look detached are not.
- The horizontal team's goal is a crimson sawtooth strip that physically hugs the full
  left and right outer edges. Its teeth point into the adjacent edge cells.
- The vertical team's goal is a deep-green sawtooth strip that physically hugs the full
  top and bottom outer edges. Its teeth point into the adjacent edge cells.
- These four strips form the board silhouette and remain visible throughout play. They
  are not floating labels, score cards, or decorative rails.
- RTL never swaps these edges: horizontal remains left/right and vertical remains
  top/bottom.
- The board presentation is grounded in the owner-provided physical-board and television
  references recorded in `evidence/visual-reference-manifest.md`.

## Cell data

```ts
type TeamAxis = "horizontal" | "vertical";
type CellKind = "letter" | "surprise";
type CellPhase =
  | "neutral"
  | "selectable"
  | "selected"
  | "question_active"
  | "owned"
  | "winning_path"
  | "correcting";

interface BoardCell {
  id: `cell-${number}-${number}`;
  q: number;
  r: number;
  kind: CellKind;
  visibleValue: string;
  revealedLetter?: string;
  owner?: TeamAxis;
  phase: CellPhase;
}
```

The client receives only the public `visibleValue`. Hidden surprise letters and question answers stay server-side until their reveal events.

## Visual states

| Phase | Fill | Border | Additional cue |
|---|---|---|---|
| Neutral | `surface-cell` | 2px ink | Letter/number in ink |
| Selectable | `surface-cell` | 2px ink | Hover/focus uses compound ring; no color-only cue |
| Selected | `action-active` | 2px ink | Selection marker and `aria-current="true"` |
| Question active | `surface-ink` | 2px ink | Letter in theme active mint; active-cell label |
| Owned horizontal | `team-horizontal` | 2px ink | White letter; accessible name says red team |
| Owned vertical | `team-vertical` | 2px ink | White letter; accessible name says green team |
| Winning path | Team fill | 4px ink | Connected path overlay and `ضمن مسار الفوز` label |
| Correcting | Paper/owner split | 2px dashed ink | Busy text and blocked interaction |

## Ownership interior rules

- Owned cells retain only the team fill, keyline, and high-contrast letter; do not render interior patterns or axis arrows.
- Owner-aware accessible names use the team colors (red/green), not axis names.

## Interaction

- Cells are semantic `<button>` elements only on the host surface during `CELL_SELECTION`; elsewhere they are non-interactive SVG groups with accessible summaries.
- Minimum pointer target is 44×44px even if the visible hex is smaller.
- Use roving `tabIndex` for the host board. Arrow keys choose the visually nearest valid neighbor in that screen direction; `Enter`/`Space` selects.
- A visually hidden board summary lists ownership count, active cell, and each team’s remaining path status for screen-reader users.
- Selection never depends on hover.

## Path computation

After `CELL_AWARDED`, run BFS/DFS or union-find on cells owned by the awarded team:

1. Seed all owned cells on that team’s start edge.
2. Traverse only the six odd-q visual neighbors owned by the same team.
3. A path exists when traversal reaches the opposite goal edge.
4. Return the ordered/identified path cells for highlighting; do not derive the path from DOM position.

Fixed tests must cover:

- straight horizontal and vertical wins;
- winding wins using visible odd-q diagonal neighbors;
- near-touching corners that are not neighbors;
- blocked path through opponent or neutral cell;
- identical result under document `ltr` and `rtl`;
- corrected ownership removing and restoring a completed path.

## Board generation

- `classic_5x5`: 16 visible letter cells plus 9 surprise cells numbered 1–9.
- Layout and letter distribution are driven by a saved seed.
- A generated board is rejected before play if any visible letter lacks minimum question stock.
- Surprise number placement is stable for the round; its letter may be revealed per attempt according to the game rule profile.

## Motion

- When a team newly enters or changes an exact-one-neutral-cell-away domain path, its already-owned path cells flash once for 320ms; the neutral candidate remains unowned and unhinted.
- A newly authoritative winning path pulses its ordered cells up/down for exactly three finite 320ms iterations, then keeps its static 4px border.
- Motion never delays the authoritative state transition.
- With reduced motion, state changes are instant and the final border and accessible labels carry the full meaning.
