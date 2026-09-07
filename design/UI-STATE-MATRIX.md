# UI State Matrix

Rule authority: [GAME_REVIEW_AR.md](../GAME_REVIEW_AR.md). Runtime truth:
[lifecycle.ts](../src/features/game/domain/lifecycle.ts) and
[GameRoutes.tsx](../src/routes/GameRoutes.tsx). “Required” rows describe the target visual
contract; they do not assert a component or event exists.

## Authoritative lifecycle projection matrix

| State | Host (required treatment) | Player (required treatment) | Audience (required treatment) | Current exit truth |
|---|---|---|---|---|
| `LOBBY` | roster/start reason | join/ready/test | waiting roster | `START_MATCH` |
| `ROUND_SETUP` | stock/board preparation | preparing; buzzer locked | round interstitial | `ROUND_READY` |
| `CELL_SELECTION` | choose neutral cell | entitled team copy | board focus | `SELECT_CELL` |
| `LETTER_REVEAL` | verify letter/question availability | public reveal; locked | public reveal | `LETTER_REVEALED` |
| `QUESTION_READING` | private evidence + public prompt/timer | enabled only after acknowledgement | prompt/timer, no answer | `BUZZ_ACCEPTED`, `TIME_EXPIRED` |
| `FIRST_ANSWER` | fixed judgment controls | first player answer-now; others locked | public winner, no answer | `JUDGE_CORRECT`, `JUDGE_INCORRECT` |
| `OPPONENT_CHANCE` | exclusive-team context | eligible/locked reasons | public second-chance copy | `BUZZ_ACCEPTED`, `TIME_EXPIRED` |
| `QUESTION_FAILED` | reveal/retry/return controls | result waiting copy | permitted reveal treatment | `RETRY_CELL`, `RETURN_CELL` |
| `CELL_AWARDED` | ownership/audit confirmation | claimed feedback | owned cell and real score | `AWARD_CELL` |
| `PATH_CHECK` | computed state, no manual claim | locked waiting | awarded board | `CHECK_PATH` |
| `ROUND_COMPLETE` | path and next round | result/ready | winning path/round result | `START_NEXT_ROUND` |
| `MATCH_COMPLETE` | final derived report | role-safe result | final result | no normal reducer exit |
| `PAUSED` | pause reason/resume | no buzzer | public pause | `RESUME` |
| `CORRECTION` | reason + preview + confirm/cancel | frozen generic notice | frozen public-safe notice | `CONFIRM_CORRECTION`, `CANCEL_CORRECTION` |

## Current versus conceptual events

Current reducer entry events include `PAUSE` and `BEGIN_CORRECTION`; current exits are
listed above. `CANCEL_QUESTION`, `FLAG_QUESTION`, `PATH_FOUND`, `NO_PATH`,
`COMPLETE_MATCH`, `REMATCH`, and `CLOSE_ROOM` are **conceptual requirements** only
unless source and tests later establish them. Do not label them shipped.

## Global state treatments

| Family | Required treatment | Current/gap status |
|---|---|---|
| `connecting` / `connected` / `reconnecting` / `offline` / `stale` | Stable skeleton; authorized live controls; one recovery notice; explicit offline copy; refresh stale projection while preserving entered note. | Five values are source-backed; full role coverage is tracked in ROUTE-STATE-COVERAGE. |
| unavailable question / correction / fatal | Host replacement/correction evidence, public neutral pause, role-safe reload path. | Required; fatal route treatment needs evidence. |
| loading / empty / search / service error | Stable geometry, explicit Arabic explanation, retry/safe return. | Required across inventory/editor and shared routes. |
| closed / unauthorized | Explain room closure or restricted admin access without exposing private state. | Required; state-specific evidence gap. |
| admin/editor | blank, validation, dirty, saving, saved, save-error, review-return, approved read-only, not-found, service-error, unauthorized. | Route exists; broad state evidence gap. |
| accessibility | focus-visible, keyboard, 200% zoom, reduced motion, mixed Arabic-LTR. | Required cross-route evidence. |

Hidden-data invariant: before a permitted reveal, accepted answer, alternatives, sources, and
moderation fields must be absent from player/audience payloads—not merely visually hidden.
Color never carries state alone; Arabic copy, icon, border, and structural change accompany it.
