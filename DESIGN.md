# Product & Interface Design Specification

Product working title: **استوديو الحروف**  
Client: React + TypeScript + Vite  
Direction: Arabic-first, RTL, light-only V1  
Status: implementation-ready design baseline; product name and backend vendor remain open

## 1. Authority map

Do not duplicate or silently override these sources:

| Concern | Authority |
|---|---|
| Historical findings and source confidence | [`report-source.md`](report-source.md) |
| Gameplay, rules, roles, scoring, edge cases, and V1 scope | [`GAME_REVIEW_AR.md`](GAME_REVIEW_AR.md) |
| Category import and letter-aware question production | [`QUESTIONS_PLAN.md`](QUESTIONS_PLAN.md) |
| Aesthetic intent and non-negotiable visual rules | [`DESIGN-DNA.md`](DESIGN-DNA.md) |
| Exact design values | [`design/TOKENS.md`](design/TOKENS.md) and [`design/tokens.css`](design/tokens.css) |
| Routes and journeys | [`design/IA.md`](design/IA.md) |
| Role-specific visibility/actions | [`design/UI-STATE-MATRIX.md`](design/UI-STATE-MATRIX.md) |
| Hex geometry and board interaction | [`design/BOARD-SPEC.md`](design/BOARD-SPEC.md) |
| Client/server responsibility | [`design/ADR-001-runtime-topology.md`](design/ADR-001-runtime-topology.md) |
| Verification and release evidence | [`design/ACCEPTANCE.md`](design/ACCEPTANCE.md) |
| Visual provenance and human selection | [`design/evidence/selection-receipt.json`](design/evidence/selection-receipt.json) |

When authorities conflict, game safety/data visibility outranks animation or layout. Gameplay changes belong in the game specification before they appear here.

## 2. Product definition

This is a synchronous Arabic knowledge game for two teams. Players race to answer questions whose accepted answer begins with the selected cell’s letter. A correct answer captures the hex cell. The horizontal team wins a round by connecting left to right; the vertical team connects top to bottom.

The application serves four distinct jobs:

1. **Audience stage:** understand the board and match in seconds.
2. **Host console:** operate the game accurately under time pressure.
3. **Player controller:** buzz reliably with one thumb and understand eligibility.
4. **Question administration:** maintain a credible, sourced Arabic question bank.

The design is not one dashboard resized four ways. Each surface is a role-filtered projection of the same authoritative match.

## 3. Provisional V1 rule profile

Until the product owner changes it, fixtures and UI copy use the recommended profile from the game review:

- Two teams: horizontal and vertical.
- 5×5 board with 16 visible letters and 9 numbered surprise cells.
- Best of 3 by default; configurable to 1/3/5/7.
- 20-second first question, 10-second opponent chance.
- First server-accepted buzz becomes the official answerer.
- Incorrect first answer gives the other team one exclusive opportunity.
- Correct answer awards 10 optional points and ownership of the cell.
- Round winner is determined by completed path, not point total.
- Human host adjudicates with explicit correct, incorrect, alternative, cancel, and correction actions.
- Double failure uses a new question on the same cell in classic mode.

These remain product assumptions, not newly claimed historical facts.

## 4. Experience principles

### Board before chrome

In a five-second glance, a user must locate the board, active cell, timer, current question, and leading/winning team in that order. Navigation and settings recede during play.

### Explicit status before clever animation

Every time-sensitive state uses clear Arabic copy. `مغلق` is more trustworthy than a dimmed buzzer with no explanation. Motion confirms state but never defines it.

### Host certainty

Judgment controls remain stable in position. The host always sees what will happen before a destructive correction and can identify the active revision, player, team, cell, question, and timer.

### Public/private separation

The host’s accepted answer and source are separate data, not text visually hidden from other roles. Audience and player payloads omit them until reveal.

### Arabic is the base layout

The app starts RTL and uses CSS logical properties. English and technical fragments are isolated exceptions, not a reason to flip the whole interface.

## 5. Main screen compositions

### 5.1 Entry

Desktop uses an asymmetric 7/5 grid. At the RTL start edge, the action column contains:

- provisional wordmark;
- title `استوديو الحروف`;
- statement `أسئلة عربية. فريقان. مسار واحد يفوز.`;
- room-code input;
- primary action `انضم إلى غرفة`;
- secondary action `أنشئ مباراة`;
- text link `كيف تلعب؟`.

The opposite field contains a cropped, oversized 5×5 code-native hex composition using actual Arabic letters and a single jade active cell. It is not a fake screenshot. On mobile it becomes a shallow header composition while the join form remains above the fold.

### 5.2 Lobby

- Top: room code, copy action, connection summary.
- Main: horizontal and vertical roster columns with axis icons and pattern samples.
- Each player row shows name, device connection, buzzer-test status, and ready state.
- Host footer: missing requirements plus one specific `ابدأ المباراة` action.
- Audience projection removes controls and enlarges names/readiness.

### 5.3 Host console

At ≥1024px:

- 62% context region: board, team scores, round status, current selector, and concise event log.
- 38% RTL control region: current letter/category, public prompt, private accepted answer/source, timer, buzz winner, and fixed judgment controls.
- Secondary actions such as pause, replace question, and correction sit behind labeled disclosure—not icon-only mystery menus.

At 768–1023px, board appears above a sticky judgment tray. Below 768px the host view is unsupported for active operation and displays a clear “use a larger screen” message while allowing safe pause/close.

### 5.4 Player controller

- Top: room, player, team axis, connection.
- Center: one phase instruction.
- Lower thumb zone: one large hexagonal buzzer.
- Bottom: brief eligibility explanation and safe leave action.

The buzzer states are `connecting`, `ready`, `open`, `pressed_pending`, `first`, `locked`, `opponent_only`, and `offline`. Each state changes copy, icon, and structure in addition to fill.

### 5.5 Audience display

- Designed for 16:9, full screen, and distance viewing.
- Board occupies 60–70% of the safe stage.
- Team scores remain aligned to their labels and axis icons.
- During cell selection, the board expands and the question band collapses.
- During a question, a lower band shows category, question, timer, and public buzzer state.
- Round and match results use the winning path as the hero, not confetti or a generic trophy illustration.

### 5.6 Match results

- Champion and winning path.
- Round score (`2–1`, for example) with tabular numerals.
- Optional points, correct answers, average accepted response time, and question issues.
- Host actions: rematch with same setup, new setup, question report, close room.
- Player/audience actions omit moderation details.

### 5.7 Question administration

- Default overview is stock health by Arabic letter.
- Filter rail and virtualized results list/table.
- Editor holds prompt, target letter, answer, alternatives, normalization preview, category, difficulty, citation/source, explanation, status, and version note.
- Objections and `needs_review` items are visually prominent through label + icon + border, not color alone.

## 6. React component architecture

Recommended ownership boundaries:

```text
src/
  app/                 router, providers, document direction, error boundary
  routes/              one route composition per IA route
  design-system/       tokens, typography, Button, Field, Dialog, Status, Icon
  features/room/       join, lobby, connection, roster
  features/game/       projection types, adapters, state selectors, event copy
  features/board/      axial geometry, HexBoard, HexCell, path visualization
  features/host/       question panel, judgment, timer controls, correction
  features/player/     buzzer and player status
  features/display/    audience stage and result presentation
  features/questions/  inventory, editor, source/review workflow
  test/fixtures/       one fixture per game state and edge case
```

### Core visual components

| Component | Responsibility | Must not own |
|---|---|---|
| `HexBoard` | Render coordinates, edges, ownership, selection, path | Winning logic or role authorization |
| `HexCell` | One semantic/visual cell and its states | Hidden surprise value |
| `TeamScoreBlock` | Name, axis, rounds, optional points, status | Winner calculation |
| `QuestionStage` | Public question, category, active letter | Accepted answer before reveal |
| `Countdown` | Render from server deadline and server offset | Decide expiry |
| `PlayerBuzzer` | Emit one buzz intent and render acknowledgement | Decide first player |
| `HostQuestionPanel` | Private question evidence | Public projection filtering |
| `HostJudgmentControls` | Emit adjudication intents | Mutate ownership locally |
| `ConnectionStatus` | Connecting/reconnecting/offline feedback | Transport implementation |
| `RoundResult` | Completed path and public round summary | Recalculate result |
| `QuestionEditor` | Draft and validation UI | Auto-publish generated content |

Components receive semantic values (`team="horizontal"`, `phase="selected"`), never raw presentational colors.

## 7. State and data rules

- Use discriminated TypeScript unions for the 14 authoritative states rather than one object with many optional booleans.
- Render from a role-filtered projection and revision.
- Intents include `expectedRevision`; reject and refresh stale actions.
- Server deadlines are ISO timestamps plus synchronized server offset. The browser animation is display-only.
- Keep match score, optional answer points, cell ownership, round result, and timer as distinct values.
- Never infer permissions from the current route alone; the projection and server authorize actions.
- URL state may hold route, room code, filters, and selected admin item. It must not hold answers or role secrets.

## 8. RTL and Arabic content

- Set `<html lang="ar" dir="rtl">`.
- Use `margin-inline`, `padding-inline`, `inset-inline`, and `border-inline`; avoid directional left/right CSS except inside board geometry.
- Do not apply `transform: scaleX(-1)` to app shells or the board.
- Wrap room codes, UUIDs, URLs, timestamps, and latency values with `<bdi dir="ltr">`.
- Do not letter-space joined Arabic display text.
- Allow question text to wrap naturally; target 35–60 Arabic characters per line on the host and audience surfaces.
- Use Arabic-Indic numerals for public scores/timers through `Intl.NumberFormat("ar-KW-u-nu-arab")`; technical identifiers stay ASCII.
- All UI copy is stored as message keys from the start even if Arabic is the only V1 locale.

## 9. Icons and assets

- Use Lucide outline icons at 2px stroke, one library only.
- Mirror only directional navigation icons whose meaning changes with reading direction. Do not mirror play, pause, check, X, vertical/horizontal axis, or board edges.
- Icon buttons require Arabic `aria-label` and ≥44px hit area.
- The brand graphic, entry composition, board, patterns, timer, and path are SVG/code-native.
- Self-host the chosen Arabic font after verifying its package and license. Do not hotlink production fonts.
- Historic show imagery and Refero screenshots are evidence only; they are not production assets.

## 10. Loading, error, and recovery

| Condition | Treatment |
|---|---|
| Initial route load | Stable geometry skeleton; preserve board/form dimensions |
| Room not found | `لم نجد هذه الغرفة. تحقق من الرمز وحاول مرة أخرى.` plus focused code field |
| Room closed | State when it closed and return to entry |
| Reconnecting | Freeze actions and show `نعيد الاتصال بالغرفة…` once |
| Player offline while buzzer open | Disable buzzer immediately and use assertive announcement |
| Stale host action | Keep the entered ruling note, refresh projection, explain conflict |
| Question unavailable | Host-only replacement flow; public surfaces show a neutral pause |
| Invalid question | Cancel without penalty and create `needs_review` record |
| Correction | Preview affected cell/path/round, require reason, then apply ordered event |
| Fatal render error | Role-safe fallback with room code and reload; never print answer-bearing state |

## 11. Design decision ledger

| Decision | Source | Preserved role | Reason |
|---|---|---|---|
| Mineral light canvas | V–A–C style | Light-theme canvas | Architectural calm and strong black-rule contrast |
| Deep charcoal canvas | Turso style | Dark-theme canvas | Quiet low-light display without gamer glow |
| Mint signal | V–A–C/Turso synthesis | Active/focus/ready only | Keeps one sharp interaction signal in both themes |
| Sharp surfaces | V–A–C/Turso synthesis | Rectangular components | Prevents generic rounded-card UI |
| Compact score numerals | Uniswap Cup style | Score/rank blocks only | Fast competitive scanning |
| Countdown hierarchy | Deezer quiz screen | Timer and immediate feedback only | Time is understandable at a glance |
| Leaderboard row hierarchy | Brilliant screen | Result ranking only | Highlights current player/team clearly |
| Team-score symmetry | Apple TV screen | Public comparison only | Makes two sides readable at distance |
| Code-native hex identity | Game image + rules | Board, buzzer, entry composition | Product-specific memorable visual move |
| Server-authoritative buzz | Game review + runtime ADR | Ordering and timer truth | Fairness across devices |
| Separate projections | Game review + runtime ADR | Data visibility | Prevents answer/control leakage |

## 12. Implementation sequence

### Phase 0 — Foundation

- Scaffold React + TypeScript + Vite.
- Install routing and one icon library.
- Import `design/tokens.css` into the app token layer.
- Add document language/direction, global reset, self-hosted font placeholder, and fixture adapter interfaces.
- Add static checks for TypeScript, lint, tests, and production build.

### Phase 1 — Entry-screen gate

- Implement `/` only, including 320, 390, 768, 1280, and 1440px states.
- Capture light-theme screenshots at the acceptance viewports.
- Complete [`design/reviews/ENTRY-SCREEN-REVIEW.md`](design/reviews/ENTRY-SCREEN-REVIEW.md) with a human decision.
- Do not expand the aesthetic system to all routes until the human review accepts or amends it.

### Phase 2 — Visual primitives and fixtures

- Implement tokens, typography, focus, icons, Button/Field/Dialog/Status.
- Implement `HexBoard`, cells, patterns, team blocks, timer, and path states.
- Build deterministic fixture routes for all states in the UI matrix.

### Phase 3 — Room and player

- Entry, join, lobby, team assignment, buzzer test, player controller, connection recovery.

### Phase 4 — Host and audience game loop

- Host console and audience projection across all 14 states.
- Correction preview and hidden-answer tests.
- 16:9 projector/television verification.

### Phase 5 — Results and question administration

- Match report, question issues, inventory health, editor, review/version states.

### Phase 6 — Realtime integration

- Replace fixture adapter with the approved server implementation.
- Run contention, reconnect, stale revision, pause, and correction scenarios.

## 13. Definition of design implementation done

- All applicable checks in [`design/ACCEPTANCE.md`](design/ACCEPTANCE.md) pass.
- Human entry-screen review is accepted and later visual expansion matches that receipt.
- No P0/P1/P2 visual QA issues remain at required viewports.
- Every authoritative game state has host, player, and audience fixture evidence.
- Hidden-answer payload tests prove player/audience projections omit private fields.
- RTL changes reading order but not board topology or team win axes.
- Teams remain identifiable in grayscale and common color-vision simulations.
- Keyboard, focus, screen-reader announcements, 200% zoom, reduced motion, offline/reconnect, and correction flows are verified.
- Production build, typecheck, lint, unit tests, component tests, and targeted browser flows pass.

## 14. Open decisions

These do not block the design documents but must be resolved before production release:

- Legally cleared product name and wordmark.
- Final font package/license and whether Arabic-Indic digits remain the public default.
- Backend/realtime/database/auth stack and hosting region.
- Exact minimum question stock per visible letter.
- Whether team colors are user-customizable in V1; any choice must retain pattern/icon/label redundancy.
- Whether points are shown during play or only at results.
- Approval or amendment of the eleven recommended product decisions in the game review.
