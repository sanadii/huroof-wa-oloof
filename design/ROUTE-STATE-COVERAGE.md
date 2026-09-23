# Route and State Coverage Audit

Status: auditable documentation contract, dated 2026-09-04. **Implemented** means directly
traceable to the listed source; **Test evidence** names current evidence only. “Required” and
“Gap” never claim a planned runtime behavior is shipped.

## Source enumeration

- Router: 14 patterns from [src/app/App.tsx](../src/app/App.tsx).
- Lifecycle: 14 values from [src/features/game/domain/lifecycle.ts](../src/features/game/domain/lifecycle.ts).
- Connection: five values from [src/routes/GameRoutes.tsx](../src/routes/GameRoutes.tsx):
  `connecting`, `connected`, `reconnecting`, `offline`, `stale`.

| Required route/state family | Implemented | Test evidence | Gap-owner |
|---|---|---|---|
| `/`: idle, query-prefilled, validation, joining, join failure, success navigation | Route implements the ordered home surface, existing join input/normalization/runtime path, and query-driven setup destinations. Join lifecycle outcomes beyond the existing validation/fallback remain gap-tracked. | `tests/app/entry-route.test.tsx` covers normalization and all nine ordered regions; local browser evidence verifies the supported mode destination. | App writer: add browser evidence for all join outcomes. |
| Homepage audited sections: header, mode shortcuts, account identity, daily, commerce, featured core game, discovery rail, Tahadani category catalogue, and footer | All nine regions are source-backed in `HomeSurface`: header, classic/fast/custom links, Firebase Auth account entry, passive non-account roadmap regions, core board band, catalogue preselection links, and two-link footer. `setup-options.ts` validates/deduplicates query input and seeds setup once. Catalogue states use imported names/readiness and non-publishable media fallbacks. Credits, verification/rewards, purchases, gifts, daily challenge, analytics, legal/company, social, and store features remain deferred—not implemented. | `tests/app/entry-route.test.tsx`, `tests/app/auth-routes.test.tsx`, and `tests/app/setup-route.test.tsx` prove ordering, account states, links, query fallback/deduplication, and user edits. | Product owners must approve data/authorization/routes for every deferred capability; Firebase Console provider/domain setup remains manual. |
| `/login`, `/account` | restoring, unavailable, signed out, anonymous guest, Google identity, collision/error, signing out | Firebase Auth is a global source with a public-config-only availability guard. Google links anonymous users without replacing their UID; account uses only Firebase basic fields and safely redirects signed-out/unavailable users to `/login`. | `tests/app/auth-service.test.tsx` and `tests/app/auth-routes.test.tsx` cover service branches, state UI, observer cleanup, collision guidance, and logout. | Firebase Console must enable Google and Anonymous providers, OAuth consent, support email, and authorized domains. |
| `/how-to-play`: default, long Arabic, bidi, 200% zoom | Default route implemented. | No specific long-copy/bidi/zoom evidence located. | App writer + QA. |
| `/host/new`: default-demo, category selected, filtered-empty, no-stock-disabled, creating, error, success | Setup route implements source-validated `mode` and repeated `category` query preselection, including invalid-value fallback without overwriting later local edits. Existing creation/category filter behavior remains implemented; no-stock/creating/error/success evidence remains gap-tracked. | `tests/app/setup-route.test.tsx` covers selection/filtering plus valid, deduplicated, invalid, and edited query seeds. | App writer: capture no-stock/creating/error/success states; QA validates. |
| `/room/:roomCode/lobby`: connecting/unavailable/closed, host empty/blocked/ready, player unready/ready, audience waiting | Room surface implemented; connection hook is shared. Named roster/closed projections need explicit source/test trace. | No complete lifecycle projection suite located. | Runtime/app writer + QA. |
| `/room/:roomCode/host`: 14 lifecycle states, five connections, unavailable question, correction, fatal, sub-768 limitation | Host room surface and lifecycle labels are implemented; connection values are implemented. Other listed treatment is requirement unless source-proven. | Domain/unit game tests; no complete host state matrix evidence. | Runtime/app writer + QA. |
| `/room/:roomCode/play`: ready, locked, open, pressed-pending gap, first-answer, opponent-only, missed, paused, round/match result, offline/reconnecting/stale/unauthorized | Player surface, buzz permission and offline/reconnecting treatments are source-backed; all named render variants need fixture evidence. | `tests/e2e/visual.spec.ts` captures offline/reconnecting player states. | App writer + QA. |
| `/room/:roomCode/display`: all 14 public projections plus loading/reconnect/offline/closed/selection/question/winner/reveal/award/correction/round/match result | Display surface is implemented. Public payload filtering is a product/runtime requirement; all projections must be proven. | No complete display state evidence located. | Runtime/app writer + QA. |
| `/room/:roomCode/results`: both winners, nonterminal deep link, role-filtered actions, rematch busy/error, missing history | Results surface implemented. Derived result logic exists in lifecycle source; rematch/missing-history variants are not asserted here. | Domain tests exercise match derivation. | Runtime/app writer + QA. |
| `/questions`: loading/populated/filtered/empty/local-only/service error/unauthorized-production | Inventory route implemented. Local-only/service/authorization variants require source-backed evidence. | `tests/app/setup-route.test.tsx` includes question-route coverage. | Admin writer + QA. |
| `/questions/new`: blank/validation/dirty/saving/saved/save error/review return/approved read-only/not found/service error/unauthorized | Editor route pattern implemented; approved read-only behavior is source-backed. Other variants are requirements until tested. | `tests/app/setup-route.test.tsx` read-only route case. | Admin writer + QA. |
| `/questions/:questionId`: same editor family, record-specific | Pattern implemented through `QuestionsRoute`. | Read-only test above. | Admin writer + QA. |
| `*`: unknown path, expired-session wording, safe return | `NotFoundRoute` implemented; it contains page-not-found/possible-session wording and home link. | No route test located. | App writer + QA. |
| Cross-route: fatal, system/light/dark, keyboard focus, reduced motion, 200% zoom, mixed Arabic-LTR | Theme provider and tokens exist; full cross-route evidence is required, not inferred. | `tests/app/theme-toggle.test.tsx`; visual scan is structural only. | App writer + QA. |

## Lifecycle truth: reducer states and legal current exits

| Lifecycle | Current reducer exits (source truth) | Required visual/state treatment | Implemented / gap |
|---|---|---|---|
| `LOBBY` | `START_MATCH` | roster/readiness; no premature game controls | State exists; role projections need coverage. |
| `ROUND_SETUP` | `ROUND_READY` | board preparation, safe waiting | State exists; projection evidence gap. |
| `CELL_SELECTION` | `SELECT_CELL` | entitled team and selected-cell affordance | State exists; projection evidence gap. |
| `LETTER_REVEAL` | `LETTER_REVEALED` | visible letter, buzzer locked | State exists; projection evidence gap. |
| `QUESTION_READING` | `BUZZ_ACCEPTED`, `TIME_EXPIRED` | prompt/timer and public-safe status | State exists; projection evidence gap. |
| `FIRST_ANSWER` | `JUDGE_CORRECT`, `JUDGE_INCORRECT` | adjudication and locked others | State exists; projection evidence gap. |
| `OPPONENT_CHANCE` | `BUZZ_ACCEPTED`, `TIME_EXPIRED` | exclusive second chance | State exists; projection evidence gap. |
| `QUESTION_FAILED` | `RETRY_CELL`, `RETURN_CELL` | reveal/neutral retry outcome | State exists; projection evidence gap. |
| `CELL_AWARDED` | `AWARD_CELL` | ownership confirmation; actions temporarily locked | State exists; projection evidence gap. |
| `PATH_CHECK` | `CHECK_PATH` | computed-path wait; no conceptual `PATH_FOUND` UI claim | State exists; projection evidence gap. |
| `ROUND_COMPLETE` | `START_NEXT_ROUND` | path/result and next-round action | State exists; projection evidence gap. |
| `MATCH_COMPLETE` | no normal reducer exit | final result; rematch is an application requirement, not reducer event | State exists; rematch evidence gap. |
| `PAUSED` | `RESUME` | role-safe pause message | State exists; close-room is conceptual requirement. |
| `CORRECTION` | `CONFIRM_CORRECTION`, `CANCEL_CORRECTION` | reason, preview, freeze, public-safe copy | State exists; projection evidence gap. |

`PAUSE` may enter `PAUSED` from nonterminal states; `BEGIN_CORRECTION` may enter
`CORRECTION` when a board exists. These are current reducer events. `CANCEL_QUESTION`,
`FLAG_QUESTION`, `PATH_FOUND`, `NO_PATH`, `COMPLETE_MATCH`, `REMATCH`, and
`CLOSE_ROOM` remain conceptual requirements unless a separate source demonstrates them.

## Connection truth and fallbacks

| Connection | Source-backed behavior | Required visual treatment | Status |
|---|---|---|---|
| `connecting` | Initial room-hook value | stable skeleton; no implied readiness | Implemented value; route evidence gap. |
| `connected` | snapshot/socket success | actions follow projection/authorization | Implemented value. |
| `reconnecting` | socket/fetch recovery | freeze unsafe actions; announce once; preserve safe projection | Implemented value; player visual evidence exists. |
| `offline` | navigator/socket failure | explicit Arabic reason and recovery | Implemented value; player visual evidence exists. |
| `stale` | declared hook union/label | refresh/reject action and preserve entered non-authoritative text | Required; explicit state transition/evidence gap. |

## Required state evidence rule

Every row above must ultimately say **required, implemented, tested, or gap** using source
and test links. Admin/editor modes, loading, empty, error, closed, unauthorized, stale,
offline, reconnecting, and fatal fallbacks are mandatory audit scope. This artifact does not
make them implemented.

C7: “The route-state coverage artifact must enumerate all 12 router patterns from
src/app/App.tsx, all 14 lifecycle states, all five connection states, admin/editor modes, and
loading, empty, error, closed, unauthorized, stale, offline, reconnecting, and fatal
fallbacks; each item must say required, implemented, tested, or gap.”

## Admin route coverage

| Route family | Required state | Current evidence |
|---|---|---|
| `/admin` → `/admin/overview` | Arabic redirect, Google-only UX guard | implemented and tested in `tests/app/admin-routes.test.tsx`; callable remains authority |
| `/admin/*` | loading, forbidden, configuration error | implemented source states in `src/features/admin/AdminRoutes.tsx`; live Firebase evidence gap |
| question editor | loading, empty, conflict, success/error, stale/offline | required; disabled truthful staging state implemented, live mutation state gap |
| rooms/users/releases | empty, forbidden, blocked prerequisite | required; blocked release copy and answer-free DTO source tests implemented; emulator evidence gap |
