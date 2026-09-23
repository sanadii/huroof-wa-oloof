# Route Visual Implementation Contract

Status: derives implementation treatment from [DESIGN-DNA.md](../DESIGN-DNA.md), without
authorizing a new direction. Source/status truth is
[ROUTE-STATE-COVERAGE.md](ROUTE-STATE-COVERAGE.md).

## 0006 temporary rollout exception for `/`

`/` is the selected `مدار الحروف` representative route under
[history 0006](evidence/history/0006-spatial-studio-homepage-direction.md): cobalt
architectural canvas, central authentic board, and opaque create/join rail. Its homepage-only
`--spatial-*` radii, shadows, and CSS perspective are authorized. Other rows remain current
rollout fallback pending human live review; `spatial-studio` remains the whole-app target.

## Shared rules

- Shared routes use existing light/dark/system tokens; gameplay (`host`, `play`,
  `display`) is history-0005 theme-invariant flat midnight. No yellow, amber, gold, copied
  Golbha indigo/lime/red, glow, glass, gradients, gameplay elevation, or decorative rounding.
- RTL changes reading sequence only. The board stays physically horizontal crimson left/right
  and vertical green top/bottom. Identity is color + pattern + axis glyph + Arabic label.
- Centered maximum-width shell, decisive outlined zones, one focal zone per viewport. Use
  zero-radius rectangles; circle only for countdown; hexagon only for game objects.
- IBM Plex Sans Arabic with tabular scores/timers; codes and technical identifiers isolated LTR.
- Every route has title, skip link, focus-visible, rest/hover/pressed/loading/disabled-reason,
  success/error/offline/reconnecting/stale treatment, and a safe return.
- Motion is 90–120ms press, 200ms state, one 320ms winning path; reduced motion removes
  translation, scale, sweep, and pulse.

The homepage region-by-region contract is [HOME-SURFACE-SPEC.md](HOME-SURFACE-SPEC.md). Its
navigation/reward/modes/daily/offers/discovery/catalogue/footer mapping is source-constrained:
the shared entry is one core game, never a copied multi-game Golbha page. Deferred account,
credits, purchases, gifts, analytics, variants, legal/company, social, and store features do
not render as available.

## Pattern contracts

| Pattern | Composition | Responsive/theme/state treatment |
|---|---|---|
| `/` | Decision/action first; board identity is supporting, code-native, and never a fake product screenshot. `HomeHeader` and featured core-game actions map to current routes. `PlayModeShortcuts` and `CategoryCatalogueSection` are planned compositions over current setup modes/category inventory; the remaining audited sections follow `HOME-SURFACE-SPEC.md` capability gates. | Shared themes; query-prefilled/validation/joining/failure/success copy stays explicit. |
| `/how-to-play` | Authentic annotated board + four concise steps. | Shared themes; long Arabic, bidi and 200% zoom reflow without hidden controls. |
| `/host/new` | Balanced setup/summary columns on desktop; focused single column mobile; visible selection count and next legal action. | Shared themes; default/demo/selected/empty/no-stock/creating/error/success use explicit reason/copy. |
| `/room/:roomCode/lobby` | Room/readiness then physical-team rosters; start action fixed and reasoned. | Shared themes; connecting/unavailable/closed/host/player/audience states retain safe recovery. |
| `/room/:roomCode/host` | Green vertical score physically left, centered board, crimson horizontal score physically right; question/timer second; console below. | Midnight always. Tablet score summaries stack above board; sub-768 shows safe limitation. All lifecycle/connection/fatal states are required per coverage. |
| `/room/:roomCode/play` | Phone-first phase instruction then one-thumb hex buzzer. | Midnight always; ready/locked/open/pending/first/opponent/missed/pause/result/recovery states have Arabic reason and no private data. |
| `/room/:roomCode/display` | 16:9 safe stage: same physical score placement, one timer/round module above, question tray below. | Midnight always; selection collapses tray; question/winner/reveal/award/correction/result projections are public-safe. |
| `/room/:roomCode/results` | Winner/path then derived rounds then secondary metrics/actions. | Midnight gameplay context; both winners, nonterminal deep link, missing history, busy/error rematch and role filtering are explicit. |
| `/questions` | Inventory health → filters → records; aligned dense 6/10 workstation. | Shared themes; loading/populated/filtered/empty/local-only/service-error/unauthorized treatments. |
| `/questions/new` | Fields with source/review panel; no nested cards. | Shared themes; blank/validation/dirty/saving/saved/error/review/authorized status. |
| `/questions/:questionId` | Record state first, edit/evidence second; approved is read-only. | Shared themes; not-found/service-error/unauthorized are safe, explicit. |
| `*` | Framed unknown-path/expired-session panel and one return action. | Shared themes; no technical trace or private data. |

Tahadani covers, where supplied, retain aspect ratio, rights metadata, title strip, loading/error
fallback, and content role. They are never decorative wallpaper or a substitute for the
code-native board. Golbha assets/copy/visual mechanics never ship.
