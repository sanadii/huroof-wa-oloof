# Design & Frontend Acceptance Contract

This is a future implementation gate. Deterministic tooling can validate identity, structure, dimensions, provenance, tokens, behavior, and accessibility thresholds; it cannot certify aesthetic quality.

## Required viewport evidence

| Surface/state | Viewports |
|---|---|
| Entry | 320×568, 390×844, 768×1024, 1440×900 |
| Player buzzer | 320×568, 390×844; ready, open, first, locked, offline |
| Host console | 768×1024, 1024×768, 1440×900; question, judgment, correction |
| Audience stage | 1024×576, 1280×720, 1920×1080; selection, question, award, win |
| Question admin | 1024×768, 1440×900; list, editor, review error |

## Traceability matrix

| Requirement | Evidence target | Future verification |
|---|---|---|
| 5×5 board and six-neighbor topology | `HexBoard` fixture | Unit tests from `BOARD-SPEC.md` |
| Horizontal/vertical win axes | Path fixtures | LTR/RTL identical graph tests |
| 14 engine states | Fixture gallery | One fixture per role/state intersection |
| Server-authoritative buzzer | Realtime adapter | Contention test with ordered acknowledgements |
| No early answer disclosure | Role payloads | Schema/contract tests assert field absence |
| Human adjudication | Host console | Keyboard and browser flow tests |
| Correction with audit reason | Correction flow | State rollback/recompute integration test |
| Arabic RTL | Every route | Screenshot + computed direction + bidi cases |
| Non-color team identity | Board/team blocks | Grayscale and color-vision review |
| Reduced motion | All motion states | Media emulation screenshots and behavior tests |
| Reconnect recovery | Player/host/display | Offline/reconnect browser flow |
| Question provenance | Admin editor | Required-field and version-flow tests |

## Visual DNA checks

- Light uses the approved mineral-white palette and dark uses the approved charcoal palette; mint appears only in active/focus/ready roles.
- No yellow, amber, gold, or yellow-tinted gradient appears in either theme.
- Team colors never become general chrome or judgment colors.
- All rectangular panels, fields, and buttons use zero radius.
- No elevation shadows or gradients are introduced.
- The hex board is the dominant focal point during play.
- The entry screen uses the approved asymmetric composition and code-native board graphic.
- No generic cards, stock Arabesque, mosque silhouette, emoji icon, violet/indigo accent, or dark-default shell appears.
- Exact colors and spacing come from tokens, not component-local literals.

## Accessibility checks

- Body text ≥4.5:1; large text and meaningful graphics ≥3:1.
- Interactive targets ≥44×44px.
- Visible `:focus-visible` for every keyboard action.
- No interactive `<div>`/`<span>` substitutes for buttons or links.
- Screen-reader labels include letter/value, ownership, axis, selection, and path state.
- Countdown does not announce every tick.
- 200% zoom does not hide host judgment or player leave/reconnect actions.
- Mixed Arabic/LTR codes remain readable and copyable.
- Reduced-motion users receive no sweep, bounce, scale, or repeated pulse.

## Behavioral scenarios

1. Create room, join four players, test all buzzers, start.
2. Select visible letter, open buzzers, award correct first answer.
3. Reject first answer, give exclusive opponent chance, award cell.
4. Fail both teams, reveal answer, retry same cell.
5. Reveal a numbered surprise cell and continue.
6. Complete winding horizontal and vertical paths.
7. Pause during question, reconnect a player, resume without duplicate buzz.
8. Correct an awarded cell and recompute a formerly complete path.
9. Reject stale host judgment and recover without losing entered note.
10. Confirm audience/player clients never receive private answer fields early.

## Quality severity

- `P0`: broken match, answer leak, wrong winner/path, unusable controls, or severe accessibility failure.
- `P1`: major visual DNA drift, unreliable buzzer state, missing correction/reconnect path.
- `P2`: responsive break, missing state, contrast/pattern issue, or significant reference drift.
- `P3`: polish that does not impair understanding or identity.

Do not hand off with unresolved P0/P1/P2 unless blocked by a named missing external dependency.

## Human authority

- Automated validation never emits an aesthetic PASS.
- AI/model review is optional and advisory.
- The first implemented entry screen requires the human receipt template under `design/reviews/` before visual expansion.
- A human rejection cannot be overridden by technical QA.
