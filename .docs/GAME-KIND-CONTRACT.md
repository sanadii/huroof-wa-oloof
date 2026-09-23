# T-15 game-kind and failure contract

Authority: user authorized the whole T-15 plan start to end on 2026-09-08. Root adopts D-15.1–7 as implementation defaults under that authorization. This is the domain contract referenced by [T-15](IMPLEMENTATION-PLAN.md#t-15--category-game-flow-and-whole-app-polish-2026-09-08), not another execution plan. Implementation and evidence remain in the canonical milestone sections.

## Game settings and board

- `gameKind` is `huroof` or `categories`; absent legacy value means Huroof. Pace presets and question modality remain distinct settings.
- New category rooms initially use classic text questions. Unsupported image/charades combinations must be visibly unavailable and rejected by both authorities. Existing supported modality paths retain their behavior. Image delivery remains T-14.2's separate dependency.
- Both kinds retain exactly 25 cells, immutable coordinate IDs, six-neighbor connections, physical team axes, question scoring, round history, and two consecutive or three total round wins.
- Category rooms select 2–10 distinct playable categories. Allocate cells as evenly as usable inventory permits with deterministic seeded positions. Never silently remove a selected category or add an unselected one.
- Category label is its real Arabic title plus an occurrence number within that category and round. Replacement allocates its new category's next number; other labels are never renumbered. Coordinate identity is separate. Numbers are neither difficulty nor points.
- Huroof numbered surprise cells keep their original 1–9 number. Their current letter can change after terminal failure. Ordinary letter cells retain their letter and get a fresh question when selected again.

## State/event matrix

The authoritative reducer, timer and intent boundary enforce this table; UI renders the legal next action and never advances optimistically.

| State | Legal normal action / event | Result and invariant |
| --- | --- | --- |
| LOBBY | Host starts after existing readiness/team rules | ROUND_SETUP; kind, scope and release are pinned |
| ROUND_SETUP | Host ready | CELL_SELECTION |
| CELL_SELECTION | Host selects unowned cell | Reveal its letter/category and obtain an unused scoped question atomically; unavailable inventory enters content hold without ownership changes |
| LETTER_REVEAL | Host/established reveal completion | QUESTION_READING; authoritative buzzer/deadline starts |
| QUESTION_READING | Eligible buzz | FIRST_ANSWER; close buzzer and wait for host judgment |
| QUESTION_READING | Server deadline expires with no buzz | QUESTION_FAILED; no score |
| FIRST_ANSWER, initial | Correct | Existing CELL_AWARDED → PATH_CHECK sequence |
| FIRST_ANSWER, initial | Incorrect | OPPONENT_CHANCE on the same question; do not change cell yet |
| OPPONENT_CHANCE | Opponent buzz | FIRST_ANSWER with opponent attempt |
| OPPONENT_CHANCE | Server deadline | QUESTION_FAILED |
| FIRST_ANSWER, opponent | Correct / incorrect | Award path / QUESTION_FAILED respectively |
| QUESTION_FAILED | Host Continue (legacy retry/return aliases must be safe) | Atomically replace eligible category or surprise letter, clear disclosed question, return CELL_SELECTION; never reopen the old question |
| CELL_AWARDED / PATH_CHECK | Existing award/check event | Award one point once, assign owner and determine round/match result |
| ROUND_COMPLETE | Host next round | Fresh board, next round; retain match-level consumed question/concept history |
| MATCH_COMPLETE | Existing new-match/rematch action | Preserve results; create new match with same valid settings |
| PAUSED | Resume | Restore prior state and remaining authoritative time; no failure or replacement from wall-clock pause duration |
| CORRECTION | Confirm / cancel | Existing audited score/path correction; never rewind consumption or replacement labels |
| Content-exhausted hold | Host ends without winner or starts a new match | Preserve prior earned scores/history, truthfully show incomplete outcome; no fabricated winner, score or substitute content |

Pause/reconnect/reload are not terminal failures. FIRST_ANSWER remains host-adjudicated without an invented answer timer. Existing lifecycle correction permissions remain server-owned; any newly discovered correction edge case must be fixed without allowing hidden question reuse.

## Consumption, persistence and compatibility

Selection already consumes an ID/concept; retain that once-only convention rather than consuming a second time at failure. Reservation, counter changes, room revision, event receipt and projection update belong in the existing transaction/serialized mutation. Terminal Continue needs a distinct eligible new category/letter backed by unused inventory. A stale or replayed event cannot consume again, allocate another number or score twice.

Use additive versioned room policy metadata and explicit legacy defaults; exact field names follow the database/security review. No live schema migration, rules expansion, production writes or release swap is needed to implement the feature. Clients never supply question IDs, replacement category/letter, counts, owner or score. Reject invalid game kinds/combinations before storing a room.

Public projections expose only current cell/category/occurrence/current revealed letter and existing lifecycle-approved question data. Do not spread private queues, reserved questions, accepted answers or source metadata into public responses. Keep the host's private answer and existing audience visibility preference intact.

Finite pools cannot guarantee unlimited failures. Startup checks must validate real unique concepts for allocated slots and state a finite reserve policy; final evidence includes deliberate exhaustion. No disabling cells to continue a potentially unwinnable board. Demo/fixture content stays explicitly demo and cannot be represented as approved production inventory.

## Verification and rollback

T-15.2 must prove local/Functions event parity, exactly-once rotation, opponent preservation, no disclosed-question reuse, pinned scope/release, long-run exhaustion recovery, old-room defaults, and role-safe projections. T-15.6 must demonstrate these with independent host/two-player/display browser contexts and Firebase persistence, including reconnect and later rounds.

Rollback disables new category-room creation while keeping readers/handlers for already-created category rooms. Never downgrade those rooms to Huroof or erase consumption/history. Each milestone records exact checks and source evidence before root acceptance.
