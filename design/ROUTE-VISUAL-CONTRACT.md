# Route Visual Implementation Contract

Status: **implementation brief derived from the approved `DESIGN-DNA.md`**  
This document does not introduce or approve a new visual direction. Human visual approval remains authoritative.

## Shared rules

- Arabic-first RTL shell. Reading order is RTL; board coordinates and goal axes are always physical and never mirrored.
- The light and dark palettes in `design/tokens.css` are both first-class. No yellow, amber, gold, glow, glass, violet, indigo, or ornamental motifs. Only tokenized board-material SVG gradients and the named `shadow-raised`, `shadow-panel`, and `shadow-control` recipes are allowed; no raw gradients or ad-hoc shadows.
- Rectangular UI has square corners. Hexagons are reserved for game objects and the product identity; the countdown alone may be circular.
- Use IBM Plex Sans Arabic with Tahoma/Arial fallback. Scores and timers use tabular numerals; room codes are uppercase ASCII in isolated LTR text.
- Use structural borders and whitespace instead of generic cards. One dominant focal point per view. Default density 5/10; question administration 6/10.
- Every route includes a skip link, a meaningful page title, keyboard-visible focus, disabled reasons, loading/empty/error/offline states, and a path back.
- Team identity is always color + axis icon + label + pattern: crimson `↔` and deep green `↕`. Mint means active/ready/focus only.
- Motion is limited to 120 ms presses, 200 ms state changes, and one 320 ms winning-path resolve. Reduced motion removes translation, scale, sweeps, and pulses.

## Board component

- Render one contiguous 5×5 field of 25 pointy-sided hexagons with six-neighbour topology. Cells touch; they are never rectangular tiles and never a loose card grid.
- Crimson sawtooth goal rails physically hug the full left and right board edges. Green sawtooth goal rails physically hug the full top and bottom edges. No detached bars.
- The board owns 60–70% of the audience stage and approximately 62% of the host desktop work area.
- Neutral, active, owned, winning-path, surprise, disabled, hover, focus, and pressed states remain legible in both themes and in grayscale.
- Cell accessible names include coordinate, visible value or revealed letter, owner/axis, selection, and winning-path state.
- Preserve the 440×440 viewBox, rendered vertices, overlay hit centres, and all four rail
  paths. Every cell uses its existing full-size shell plus an inset 92% face shifted -2 SVG
  units, token-only vertical material stops, and code-native upper-left/lower-right edge
  treatment. Rails may add only a matching-team solid depth path translated down 4 SVG
  units. No per-cell filters, duplicate semantic labels, or coordinate changes.
- Decorative theme background assets are quiet, central-low-detail atmospheric fields only;
  page shells use the theme token at cover/center/scroll and retain text/graphic contrast.

## `/host/new` — setup

- Desktop uses a balanced two-column composition: configuration at the RTL reading start and a persistent live match summary/category selection area opposite it. No narrow form marooned on one side of an empty canvas.
- Keep the page title to a controlled editorial scale, not entry-screen display scale.
- Present mode and best-of as custom square segmented controls; never browser-default radio dots.
- Show real Tahadani category covers from `public/assets/categories/320` in a selectable grid with name, selected state, and rights/readiness warning. Because the imported artwork is predominantly yellow, render the covers through a neutral grayscale treatment so the rejected yellow visual language does not dominate either theme; selection/focus uses mint and the team colors are not applied to covers. The review summary shows selected count and available question stock.
- Team names include compact axis/pattern previews. Timing fields are grouped. The final action and validation summary are visible without losing context at 1440×900.
- Normal mode with zero approved questions is disabled with an actionable explanation. Demo mode is explicit and its draft warning is adjacent to the control.

## `/room/:code/lobby` — lobby

- Make the join code, readiness, and two team rosters the visual hierarchy. Use a compact board/axis motif to bind the screen to the product.
- Team rosters face one another across a central readiness/status rail on desktop; stack cleanly on narrow screens.
- Each member row shows name, device connection, buzzer test, and ready state without relying on color alone.
- Host start is a fixed, prominent action with an explicit disabled reason until requirements pass. Player readiness is the dominant player action.
- Share/copy/display controls are secondary and grouped; avoid an undifferentiated row of raw buttons.

## `/room/:code/host` — host console

- **User-directed host composition:** At 1440×900 and wider, use one physically centered board stage: deep-green vertical-team score at the physical left, the enlarged authentic board in the middle, and crimson horizontal-team score at the physical right. This placement is explicit and does not rely on RTL auto-placement. Main numerals are rounds won; cell points are secondary. Controls are a subordinate console below the stage, not a competing side card. At ≤1024px keep compact physical score flanks where they fit, then place both score summaries above the board before stacking the console.
- Goal rails are four continuous fitted zigzag bands which follow the actual outer hex boundary behind the cells: crimson left/right for the horizontal team and deep-green top/bottom for the vertical team. They form the board silhouette, with consistent band thickness and clean endpoints; they are never detached bars, thick polylines, or separate triangle teeth.
- Replace raw enum/connection text with Arabic phase labels and a separate connection indicator.
- The active question groups category/letter, public prompt, private accepted answer/alternatives, source, timer, and first-buzz identity through alignment and dividers.
- Judgment controls occupy fixed positions and remain reachable at 200% zoom. State-specific primary action is singular and unmistakable.
- Pause, audit, and correction are secondary disclosure panels. Correction is never an always-open full form; confirmation shows the dependent effect and requires a reason.

## `/room/:code/play` — player controller

- Design for 320×568 and 390×844 first. Team/name and connection sit at top, phase/status in the middle, and one large hexagonal buzzer in the thumb zone.
- The buzzer has ready, locked, open, first, answer-now, missed, disconnected, and reconnecting states with explicit copy. A locked action never looks tappable.
- Never render private answers, sources, moderation notes, other players' latency, or host controls.

## `/room/:code/display` — audience stage

- Match the approved light/dark reference composition at 1024×576, 1280×720, and 1920×1080: compact score header, board-dominant center, question/timer band below.
- Score readouts remain near the board and symmetric. Do not add detached team cards because goal rails already carry identity.
- The question band collapses during cell selection. During a live question it shows category, prompt, active letter, countdown, and public buzzer status only.
- A revealed answer appears only after the authoritative reveal event. Round and match wins replace the question band with one resolved result treatment.

## `/room/:code/results` — results

- Lead with winner and completed path, then rounds won, then secondary points/accuracy and a concise event timeline.
- Reuse the authentic board at a supporting scale. Do not reduce the result to a generic title and button.
- Provide new match, same-settings rematch, and host-only question report actions with clear role filtering.

## `/how-to-play` — rules

- Explain the game through one annotated authentic board and four short numbered steps: select, ask/buzz, capture, connect.
- Axis legends and one winding-path example must make the two win directions clear without a long prose wall.

## `/questions`, `/questions/new`, `/questions/:id` — administration

- Desktop-first 6/10 density. Inventory uses a filter rail + aligned data table/list; editor uses a field column + evidence/review panel.
- Filters cover letter, category, difficulty, status, source state, use count, and objection state. Show real category covers as compact square, neutrally desaturated thumbnails, not decorative hero imagery.
- Empty inventory, local-only mode, incomplete source, validation error, saved draft, review return, and approved/read-only states are explicit.
- Editor fields follow `design/IA.md`; never publish generated content without human review.

## Evidence required before handoff

- Capture and inspect both themes for setup, lobby, host, player, audience, results, rules, inventory, and editor at their required acceptance viewports.
- Browser journeys must exercise actual state, not static fixture-only screenshots. Add route component tests for empty/error/offline and key interaction states.
- Automated tools may report geometry, contrast, overflow, accessibility, and image-diff evidence; they must not emit an aesthetic approval.
