# Application inventory

## Architecture

React/Vite client with Firebase Auth/Firestore/Functions/Storage integration, a local fixture runtime, role-specific game routes, and guarded admin callables. `App.tsx` defers Game, Auth, and Admin route chunks; the public entry remains usable without loading them. Firebase emulator port overrides apply only in emulator mode and retain defaults otherwise.

Graphify was used for the original GameRoutes/service/lifecycle/contracts/Firebase-adapter trace. Generated-function copies and incomplete admin graph coverage are known limitations; this route inventory is checked against [App.tsx](../src/app/App.tsx) and browser evidence.

## Exact route matrix

| Paths | Surface / behavior | Current evidence |
| --- | --- | --- |
| `/` | C homepage, real create/join/category controls and tactile canonical board. | Human homepage review; root desktop/mobile/fallback/motion evidence. |
| `/how-to-play` | Rules in C public shell. | Root public route/Axe review. |
| `/host/new` | C setup with real mode/category/team/settings create form. | Root 1440/390/320 and E2E create flow. |
| `/room/:roomCode/lobby` | Lobby code/share/roster/readiness/start; routes active host/player to their role surface. | Fixture smoke and Firebase E2E. |
| `/room/:roomCode/host` | Host board, fixed score sides, phase/action console. | Root final 1440/390/320 captures. |
| `/room/:roomCode/play` | Player instruction/buzzer; role-private projection. | Forge 390/320 and privacy checks. |
| `/room/:roomCode/display` | Audience public board/question/timer/scores. | Forge 1280/390 and privacy checks. |
| `/room/:roomCode/results` | Truthful active/final result, role return/rematch as allowed. | Root completed real result 1440/390. |
| `/questions`, `/questions/new`, `/questions/:questionId` | Legacy redirects/compatibility editor to guarded admin questions. | Source and route tests. |
| `/admin` | Redirect to guarded overview. | Public guard and emulator-admin review. |
| `/admin/overview` | Guarded overview. | Root local-auth review. |
| `/admin/questions`, `/admin/questions/new`, `/admin/questions/:questionId` | Question list/editor/detail. | Root final question review; technical JSON closed initially. |
| `/admin/reviews`, `/admin/reviews/:id` | Review list/detail. | Root final review-detail review. |
| `/admin/categories`, `/admin/categories/:id` | Category list/detail; empty/missing recovery does not invent data. | Root final category-missing review. |
| `/admin/releases`, `/admin/releases/:id` | Release list/detail. | Root final release-detail review. |
| `/admin/rooms`, `/admin/rooms/:id` | Room list/detail/action surface. | Root final room-detail review. |
| `/admin/users` | User lookup and role/status controls; there is no `/admin/users/:id` route. | Root authenticated lookup review. |
| `/admin/audit`, `/admin/health`, `/admin/settings` | Audit, health, settings. | Root local-auth review; 35-second default timer persisted after reload. |
| `/login`, `/account` | Existing guarded auth/account semantics in C panels. | Root account 1440/390 no overflow. |
| `*` including unmatched `/admin/*` | Public C not-found recovery. | Root public not-found review. |

Admin route evidence uses a real local Auth emulator Google popup plus existing guarded demo bootstrap. It does not verify production authorization, Google, App Check, signing, or a production release.
