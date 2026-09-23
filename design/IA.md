# Information Architecture

Arabic-first RTL SPA. Router truth: [src/app/App.tsx](../src/app/App.tsx). Admin route
presence is not authorization; server/projection authorization governs editing and publication.

## Route map and access boundary

| Pattern | Surface | Intended role | Authorization distinction |
|---|---|---|---|
| `/` | entry | everyone | join/create is not role proof |
| `/how-to-play` | rules | everyone | public explanation |
| `/host/new` | setup | host | setup capability is runtime-authorized |
| `/login` | Google sign-in | everyone | identity only; no room or editor role is granted |
| `/account` | Firebase identity | signed-in user | basic Auth fields and sign-out only |
| `/room/:roomCode/lobby` | lobby | host/player/audience | filtered projection per role |
| `/room/:roomCode/host` | host | host | private answers/judgment only when authorized |
| `/room/:roomCode/play` | player | player | personal buzzer only |
| `/room/:roomCode/display` | display | audience | public projection; no answer/moderation fields |
| `/room/:roomCode/results` | results | filtered | host actions are not shown/accepted for other roles |
| `/questions` | inventory | editor/admin | route does not grant production access |
| `/questions/new` | editor | editor/admin | create/save/review require authorization |
| `/questions/:questionId` | editor | editor/admin | approved may be read-only; unauthorized stays safe |
| `/admin` | admin redirect | Google administrator | redirects to `/admin/overview`; UI guard is not authorization |
| `/admin/overview` | inventory health | enabled server-authorized administrator | callable-backed summary, no fake metrics |
| `/admin/questions`, `/admin/questions/new`, `/admin/questions/:questionId` | question inventory/editor | scoped content administrator or reviewer | authoring authority only; immutable review revisions |
| `/admin/reviews/:id`, `/admin/categories/:id`, `/admin/releases/:id`, `/admin/rooms/:id` | administrative detail | exact callable capability | direct Firestore browser access remains denied |
| `/admin/users`, `/admin/audit`, `/admin/health`, `/admin/settings` | system operations | capability- and role-gated | user changes require super administrator |
| `*` | not found | everyone | expired/unknown path returns safely |

The homepage section map is [HOME-SURFACE-SPEC.md](HOME-SURFACE-SPEC.md). Current entry supports
join, `/host/new`, `/how-to-play`, `/login`, and `/account`. Google identity is limited to Firebase
Auth basic fields and sign-out; it does not add profile data or permissions.
Credits, reward verification, gifts, commerce, daily challenges, match history,
global discovery, game variants/catalogue, contact, legal/company, social, and store routes are
deferred until separately authorized and source-backed.

## Journeys

- Host: entry → setup → lobby readiness → host board/console → round/match result → role-safe
  rematch or new setup. All lifecycle transitions are source-defined, not invented by UI.
- Player: entry → room/name/role session → lobby ready → phase instruction/buzz eligibility →
  public result. No host data or other-player latency.
- Audience: display URL → lobby wait → board-first public live projection → result. No private
  answer/source/moderation.
- Editor: inventory health/filter → new or record editor → validation/source/review → saved or
  read-only outcome. No direct publication claim without source-authorized flow.
- Unknown/expired: wildcard → Arabic explanation → safe return to entry.
- Homepage now plans classic/fast/custom setup shortcuts and a Tahadani category preview over
  existing setup concepts; their homepage preselection contract still requires implementation.
  Reward/daily/commerce/discovery/footer utilities cannot imply an account, entitlement,
  analytics result, or destination before it exists in the route/data map. Google
  identity itself grants no editor, admin, publication, or room role.

## Responsive matrix

| Surface | Preferred composition | Narrow treatment |
|---|---|---|
| Shared entry/rules/lobby | centered max-width framed zones | one column; decision/action before support |
| Setup | two balanced desktop columns | one focused column, selection count/next action remain visible |
| Host | physical green-left / centered-board / crimson-right plus console below | tablet scores above board; under 768 safe limitation |
| Player | phone-first phase then thumb-zone buzzer | 320×568 minimum target |
| Audience | 16:9 centered board with physical score flanks | preserve safe stage; do not mirror board |
| Admin | 6/10 filters then records/editor | do not hide validation/save/authorization status |

Coverage, all lifecycle states, all connections, and cross-route accessibility/failure work are
audited in [ROUTE-STATE-COVERAGE.md](ROUTE-STATE-COVERAGE.md).
