# Feature status

| Feature | Current behavior | Verification / limit |
| --- | --- | --- |
| Room creation and join | Real mode/category/teams inputs create rooms; room-code join validates empty/missing cases and supports optional name. | Fixture smoke and real Firebase E2E. |
| Lobby and lifecycle | Real room code/share, roster/readiness, start routing, and active-role exits. | Fixture smoke and Firebase E2E. |
| Host gameplay | Canonical board, phase controls, host-private question/answer context, scoring and correction actions. | Fixture smoke/Firebase E2E; C visual review. |
| Player projection | One dominant buzzer and role-safe instruction; no private answer/alternatives. | Browser/privacy tests. |
| Audience projection | Public board/question/timer/scores only, without private answer/alternatives. | Browser/privacy tests. |
| Results/rematch | Truthful final or nonfinal state, existing history/return controls, guarded rematch busy behavior. | Route tests and root review. |
| Category catalogue | Supported categories/search remain real; limited home preview exposes an honest path to more rather than implying unavailable content. | Source/UI evidence. |
| Auth/account | Existing Google/account semantics remain guarded and functional; C panels improve composition only. | Local emulator Google/account review; production identity unverified. |
| Admin | Existing guarded data workspace, create question entry, technical details disclosure, filters, reviews/releases/rooms/users/audit/health/settings. | Local authorized emulator review; production permission path unverified. |
| C presentation | Architectural background, opaque panels, tactile optional board, responsive layouts, reduced-motion and asset fallback. | Human 0007 approval and route captures. |

No fake scores, players, questions, stock, commerce, or planned functionality is presented as active.

