# Design Documentation Index

Start with [`../DESIGN.md`](../DESIGN.md) for the product/interface contract and [`../DESIGN-DNA.md`](../DESIGN-DNA.md) for visual authority.

Question-category import, cover-image copying, and letter-aware content production are specified separately in [`../QUESTIONS_PLAN.md`](../QUESTIONS_PLAN.md).

## Build-facing documents

- [`TOKENS.md`](TOKENS.md) — exact semantic values.
- [`tokens.css`](tokens.css) — React/Vite CSS token seed.
- [`IA.md`](IA.md) — routes, journeys, screens, responsive targets.
- [`BOARD-SPEC.md`](BOARD-SPEC.md) — hex coordinates, states, accessibility, path tests.
- [`UI-STATE-MATRIX.md`](UI-STATE-MATRIX.md) — host/player/audience projections for all game states.
- [`ADR-001-runtime-topology.md`](ADR-001-runtime-topology.md) — fixture and server-authoritative adapter boundary.
- [`ACCEPTANCE.md`](ACCEPTANCE.md) — future implementation and visual QA gate.

## Evidence and governance

- [`evidence/visual-reference-manifest.md`](evidence/visual-reference-manifest.md) — Refero and product evidence.
- [`evidence/concepts.md`](evidence/concepts.md) — exactly three directions considered.
- [`evidence/history/0001-human-selection.md`](evidence/history/0001-human-selection.md) — immutable human decision record.
- [`evidence/selection-receipt.json`](evidence/selection-receipt.json) — hash-bound selection receipt.
- [`reviews/ENTRY-SCREEN-REVIEW.md`](reviews/ENTRY-SCREEN-REVIEW.md) — human review gate after the first screen is implemented.

## Change policy

- Do not edit numbered history records.
- A new visual direction requires a new numbered record and receipt that explicitly supersedes the prior receipt.
- Update token values only with a linked design decision explaining semantic impact and accessibility results.
- Update game rules in `GAME_REVIEW_AR.md` before changing state, score, timer, or board behavior here.
