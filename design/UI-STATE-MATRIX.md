# UI State Matrix

Rule authority: [`GAME_REVIEW_AR.md`](../GAME_REVIEW_AR.md).  
Runtime boundary: [`ADR-001-runtime-topology.md`](ADR-001-runtime-topology.md).

Each row describes the role-filtered projection of one authoritative game state.

| State | Host projection and actions | Player projection and actions | Audience projection | Exit event |
|---|---|---|---|---|
| `LOBBY` | Settings summary, roster, assignments, device tests; start only when requirements pass | Join/name/team/ready and buzzer test | Room code, teams, ready count | `START_MATCH` |
| `ROUND_SETUP` | Seed, stock validation, board preview; retry or cancel on failure | `تجهيز الجولة…`; no buzzer | Round interstitial and match score | `ROUND_READY` |
| `CELL_SELECTION` | Select a neutral cell for the entitled team; pause allowed | Shows which team chooses; no cell action in V1 | Board with entitled team highlighted | `SELECT_CELL` |
| `LETTER_REVEAL` | For surprise cell, confirm revealed letter and question availability | Public letter reveal; buzzer locked | Public letter reveal on active cell | `LETTER_REVEALED` |
| `QUESTION_READING` | Private answer/source plus public prompt; open/pause timer and buzzer | Prompt, timer, enabled buzzer only after server acknowledgement | Prompt, active cell, timer; **no answer field in payload** | `BUZZ_ACCEPTED`, `TIME_EXPIRED`, `PAUSE` |
| `FIRST_ANSWER` | Winner identity, answer controls, private accepted answer/source | Winner: `أنت الأسرع — أجب`; others locked | Winner/team identity and paused timer; no accepted answer | `JUDGE_CORRECT`, `JUDGE_INCORRECT`, `CANCEL_QUESTION` |
| `OPPONENT_CHANCE` | Remaining team, private answer, opponent timer, judgment | Eligible team may buzz; first team locked with reason | `الفرصة للفريق الآخر` and timer; no answer | `BUZZ_ACCEPTED`, `TIME_EXPIRED`, `JUDGE_*` |
| `QUESTION_FAILED` | Reveal answer; retry same cell, new question, return cell, or flag question | Answer reveal and waiting status | Answer reveal and concise explanation if approved | `RETRY_CELL`, `RETURN_CELL`, `FLAG_QUESTION` |
| `CELL_AWARDED` | New owner, points delta, audit entry; controls temporarily locked | Ownership/score feedback | Cell fill, pattern, axis icon, public score | `CHECK_PATH` |
| `PATH_CHECK` | Computation status; no manual selection | `فحص المسار…`; buzzer locked | Board holds final awarded state | `PATH_FOUND`, `NO_PATH` |
| `ROUND_COMPLETE` | Winning path, round record, next-round action | Winner/loser feedback and ready state | Winning path, round winner, match score | `START_NEXT_ROUND`, `COMPLETE_MATCH` |
| `MATCH_COMPLETE` | Final report, rematch/close/question issues | Winner and personal/public stats | Champion, path, rounds, optional points | `REMATCH`, `CLOSE_ROOM` |
| `PAUSED` | Pause reason, resume, safe close; private data remains private | `المباراة متوقفة مؤقتًا`; no buzzer | Same public pause message | `RESUME`, `CLOSE_ROOM` |
| `CORRECTION` | Select event, enter reason, preview dependent changes, confirm/cancel | Actions frozen; generic correction notice | Actions frozen; public correction notice | `CONFIRM_CORRECTION`, `CANCEL_CORRECTION` |

## Global connection states

These wrap every game state:

| Connection | Behavior |
|---|---|
| `connecting` | Skeleton only for stable layout; no implied readiness |
| `connected` | Projection revision visible to diagnostics; actions follow state |
| `reconnecting` | Freeze inputs, keep last safe projection, announce reconnection once |
| `offline` | Explain that actions are unavailable; show `حاول الاتصال مجددًا` |
| `stale` | Reject action, fetch fresh projection, preserve entered non-authoritative text |

## Hidden-data invariant

Before an explicit reveal event, `primaryAnswer`, normalized answer, alternatives, source notes, and moderation flags must not exist in player or audience JSON. Visual hiding, redaction after receipt, and client-side encryption keys shipped to those clients do not satisfy this rule.

## Announcement policy

- `aria-live="assertive"`: buzzer winner on that player’s device, connection lost during an open buzzer, match paused.
- `aria-live="polite"`: cell awarded, round result, corrected public result, reconnect success.
- Countdown ticks are not individually announced. Announce meaningful thresholds such as 10 and 5 seconds through concise text if user testing supports it.

