# Homepage Surface Specification — استوديو الحروف

## Current integration — September 11

Current product name: **تحدي الخلية**. The September 9 DESIGN-DNA amendment replaces the decorative home board with approved category-only background artwork. Current home composition is utility header, headline and create/join panel, real category chooser, and footer. Board-type selection appears first in game creation; the primary home link targets `/host/new`. The user approved the presented integration with “OK continue, do it all.” These narrow amendments supersede conflicting historical home composition and product-name statements below; immutable receipts remain unchanged.

Status: **binding build-facing contract** · 2026-09-05. This specification narrows the
Golbha audit to the homepage regions visible in the owner-supplied screenshots. It does not
authorize a new visual direction, source route, data model, asset, entitlement, or game mode.
[DESIGN-DNA.md](../DESIGN-DNA.md) and [DESIGN.md](../DESIGN.md) remain the visual and product
authority; [src/app/App.tsx](../src/app/App.tsx) and [EntryRoute.tsx](../src/routes/EntryRoute.tsx)
are runtime truth.

## 0006 spatial homepage supersession

The prior nine-region home composition is superseded for `/` by selected `spatial-studio`
in [history 0006](evidence/history/0006-spatial-studio-homepage-direction.md). The ordered
composition is utility header; cobalt stage with headline; canonical 25-cell DOM board;
opaque create/join rail; supported category chooser; concise footer. Unavailable roadmap
regions are not player-facing focal content.

Create links retain `mode` query semantics, category links retain `category` preselection,
and the join form retains room-code/name submission, validation, busy, error, and recovery.
CSS 3D decorates the real `EntryBoard`, never a separate topology. A new human live review
must approve this route before visual rollout beyond it.

## Evidence boundary and implementation truth

The four supplied screenshots are **audit evidence**, not instructions to reproduce their
brand, copy, images, cards, pricing, hierarchy, or page composition. They establish that the
audit must address the following visible region families individually:

| Evidence ID | Screenshot SHA-256 | Observed region family | Permitted use |
|---|---|---|---|
| `golbha-home-header` | `C30C2BAF1D9E6B2260B381E3F9324C4E0378FF14D016FE1CA148757943CA504B` | full navigation, primary game action, account/credit area | Require an individually scoped Huroof mapping. |
| `golbha-home-programme` | `A563EBC05BE8FC7F3ADA553B24FC2FCD2DF5B9A89EAC4B07810CE976C1098560` | reward banner, mode shortcuts, daily status, offers | Require explicit current/deferred status. |
| `golbha-home-discovery` | `A15D74B24E5BD76D7463F89ACE0CD421231622773ACD3D28F060B98BA4ACEABD` | featured band, most-played rail, all-games catalogue | Prevent an invented marketplace; map only source-backed routes/data. |
| `golbha-home-footer` | `11A63C279F48ABA304B4403ADD50F1644513D26902B582BA476AC4AD2BFFF4E9` | multi-column footer, legal/company, store/social links | Require footer ownership/status rather than copied destinations. |

No screenshot file is imported or shipped. Golbha is secondary descriptive research only; the
exclusions in the [study](evidence/golbha-public-site-study-2026-09-04.md) apply in full.

### Current-app mapping

The current router has exactly the 12 patterns enumerated in [App.tsx](../src/app/App.tsx).
The entry source currently implements a branded header with a theme control, a room-code/name
join form, **Join room**, **Create match** (`/host/new`), and **How to play**
(`/how-to-play`). Match setup currently exposes `classic`, `fast`, and `custom` configurations,
and category selection is backed by the existing question-category inventory and rights-managed
Tahadani cover assets. The entry route does **not** yet compose those modes or categories into
homepage sections or accept a source-backed homepage preselection contract.

The current app proves only Firebase Authentication identity entry/account basic fields and does
**not** prove a profile, credits, rewards, verification,
purchases, gifts, global discovery/analytics, social links, store links, or legal/company
destination routes. This surface therefore represents one core game and its existing
configuration/category content—not a fake multi-game marketplace. The `image` and `charades`
runtime modality literals are not current homepage choices because the setup UI submits the
classic modality only.

`Implemented` below means the route/control is directly traceable to current source. `Planned`
means a future build may add it only after product/data/authorization decisions. `Deferred`
means intentionally absent from the V1 homepage/runtime; it must not render as available.
`Not applicable` means the reference affordance has no honest counterpart in the one-game
product.

## Ordered homepage section map

1. `HomeHeader` — product identity, supported navigation and entry actions.
2. `AccountIdentityEntry` — Firebase Auth identity entry; rewards remain deferred.
3. `PlayModeShortcuts` — classic, fast, and custom configurations of the one core game.
4. `DailyChallengePanel` — daily/status reference affordance; deferred.
5. `OfferPackageArea` — commerce reference affordance; deferred.
6. `FeaturedCoreGameBand` — explain the single core game and route to setup/rules.
7. `WeeklyPlayRail` — aggregate popularity reference affordance; deferred.
8. `CategoryCatalogueSection` — rights-managed Tahadani category discovery for match setup.
9. `SiteFooter` — product/support/legal link inventory; destinations deferred until owned.

The existing `EntryBoard` is the visual identity within entry/featured content; it is not a
catalogue tile or decorative hex field. Each visible homepage section must preserve one
decision, action, then supporting status in the selected visual contract.

## Component tree and ownership

```text
EntryRoute (existing route composition)
└─ HomeSurface
   ├─ HomeHeader
   │  ├─ HomePrimaryActions
   │  └─ HomeUtilityNavigation
   ├─ AccountIdentityEntry [implemented: no rewards or credits]
   ├─ PlayModeShortcuts
   ├─ DailyChallengePanel [deferred]
   ├─ OfferPackageArea [deferred]
   ├─ FeaturedCoreGameBand
   │  └─ EntryBoard (existing code-native board identity)
   ├─ WeeklyPlayRail [deferred]
   ├─ CategoryCatalogueSection [planned from current category inventory]
   └─ SiteFooter [planned destination inventory]
```

`routes/` owns composition and route links; `design-system/` owns header, button, notice,
status, navigation, disclosure, and footer primitives; `features/board/` alone owns the
code-native board. A future account/rewards/commerce/catalogue feature needs its own
authoritative service and authorization boundary before it can own data or mutations.

## Section contracts

### 1. `HomeHeader` — implemented core and account utility

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Product wordmark/identity; theme control; supported navigation; clear primary “create match” action. No copied brand or credit treatment. |
| Actions and targets | **Primary:** Create match → `/host/new` (**implemented**). **Secondary:** Join a room → the entry join form on `/` (**implemented**); How to play → `/how-to-play` (**implemented**); account → `/login` or `/account` (**implemented**). “My matches”, completed categories, gifts, contact, and credit balance → **deferred; no target or enabled control**. |
| Component / data / status | `HomeHeader`, `HomePrimaryActions`, and `AuthAccountControl` in route/design-system/auth composition. Static product copy, current theme state, and Firebase basic identity are source-backed; credits, nav counts, and unread status have no source. Header core and identity utility are **implemented**; rewards/credits remain **deferred**. |
| Responsive and theme | Desktop: identity, supported links, then primary action in one framed row. Tablet: preserve primary action; move secondary links to a labelled disclosure only if it remains keyboard reachable. Mobile: identity + primary action + theme control; unsupported utilities do not appear. Use shared light/dark/system tokens, matte rectangular zones, no copied palette/pills. |
| Accessibility / RTL / keyboard | Landmark `header` + labelled `nav`; wordmark is text or an accessible home link; use Arabic labels, logical order, 44px targets, visible focus. Theme control announces state. Room codes remain LTR where surfaced. |
| States | Auth restoring, unavailable, signed-out, anonymous, Google, popup/error, and signing-out use text states in the account utility. Signed-out keeps guest-supported actions. Disabled primary only when setup is unavailable, with Arabic reason; route/network errors stay with their action. Credit/reward state remains **not applicable**. |

### 2. `AccountIdentityEntry` — implemented Firebase Auth identity

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Compact identity entry in the header and account homepage region: explain Google sign-in or guest linking without inventing a profile, reward, credit, or history. |
| Actions and targets | Sign in/link → `/login`; signed-in account → `/account`; logout is available only on `/account`. No verification reward or dismissible promotion exists. |
| Component / data / status | `AuthAccountControl`, `FirebaseAuthProvider`, and `AuthRoutes`. Firebase provides only display name, email, anonymous/Google provider state, and sign-out. **Implemented**; rewards/credits remain deferred. |
| Responsive and theme | Utility-level header control; login/account use one compact, bounded rectangular panel that stacks on mobile. Shared themes and approved mint primary action only; no promotional color or copied offer styling. |
| Accessibility / RTL / keyboard | Arabic labels, visible focus, 44px actions, and `aria-live` status text. Email remains isolated LTR. Do not trap focus or announce repeatedly. |
| States | restoring, unavailable, signed-out, anonymous, Google, popup pending, popup blocked/closed, network/configuration/unauthorized-domain error, credential collision, and signing-out are source-backed textual states. No reward eligibility state exists. |

### 3. `PlayModeShortcuts` — planned composition of implemented setup modes

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Three compact configuration shortcuts for the one core game: **classic**, **fast**, and **custom**. Each item contains a distinct code-native icon, Arabic mode name, one-line factual difference, and Start setup action. This adapts the reference’s mode strip without inventing separate games. |
| Actions and targets | Each mode opens `/host/new` with that mode preselected. `/host/new` and all three setup choices are **implemented**; URL/router-state preselection from `/` is **planned** and must be added and tested before these shortcuts become active. Join room and How to play remain header/entry actions, not mode tiles. `image` and `charades` do not render until a complete selectable lifecycle exists. |
| Component / data / status | `PlayModeShortcuts` reads a local typed mode registry shared with `HostNewRoute`; labels/descriptions cannot drift from setup behavior. **Planned** homepage composition over source-backed setup modes; no popularity counts or remote modes API. |
| Responsive and theme | Desktop: three equal rectangular shortcuts in one bounded row. Tablet may keep three compact columns; mobile becomes a horizontal snap list or stacked list without hiding labels. Shared themes; code-native icons only and no copied game art. |
| Accessibility / RTL / keyboard | Semantic labelled list; each action announces mode and that setup opens. Arrow-key carousel semantics are forbidden unless a true composite widget is implemented; native Tab and scroll remain valid. Normal RTL reading order never mirrors physical board axes. |
| States | Rest/focus/pressed use the shared action primitive. Registry load is synchronous; unsupported/unavailable modes are omitted rather than presented as playable. Preselection validation/failure returns to a safe default with an Arabic explanation. |

### 4. `DailyChallengePanel` — deferred

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Future daily challenge: date, availability/complete state, countdown/deadline, personal win-rate only if source-backed, and one play/resume action. |
| Actions and targets | Play/resume → **deferred**; no daily route, schedule, challenge state, completion record, or win-rate source exists. |
| Component / data / status | `DailyChallengePanel`, owned by a future challenge service with clock, eligibility, and result data. **Deferred**. |
| Responsive and theme | Bounded status panel in the shared shell; desktop may align summary/action, mobile stacks. Countdown can be circular only if it represents an authoritative deadline; no timer colour cycling. |
| Accessibility / RTL / keyboard | Status uses text plus icon, never colour alone; countdown announces meaningful threshold/state changes only, not each tick. Arabic date formatting; 44px play action when available. |
| States | Loading, unavailable, not started, active, completed, expired, signed-out, error, offline, reconnecting, stale, disabled reason, and no-result are **planned** and must not be faked. |

### 5. `OfferPackageArea` — deferred

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Future purchase/entitlement area: package name, what it unlocks, localized price/tax/legal disclosure, availability, restore/support link, and a purchase action. |
| Actions and targets | Purchase, restore, manage subscription, and gift → **deferred**; there is no catalogue, pricing, payment, credit, purchase, or entitlement route/service. |
| Component / data / status | `OfferPackageArea`, owned by a future commerce/entitlements boundary. **Deferred**. It must not use placeholder prices, discounts, credits, or a simulated checkout. |
| Responsive and theme | If approved later, a plain outlined comparison region with one honest CTA; stack rows on mobile. No copied Golbha pricing layout, colors, labels, or package names. |
| Accessibility / RTL / keyboard | Prices/legal terms remain textual/selectable; action communicates cost and next step; errors and refunds are not hidden behind color. |
| States | Catalog loading, unavailable region, sold out, signed-out, purchase pending/success/failure, restore, offline, stale, disabled, and legal-update states are **planned**. |

### 6. `FeaturedCoreGameBand` — planned homepage composition

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Explain the one core game: Arabic team-match title, concise factual description, code-native board identity, create-match primary action, and rules secondary action. No game thumbnail/card matrix, popularity claim, or borrowed art. |
| Actions and targets | Create match → `/host/new` (**implemented**); How to play → `/how-to-play` (**implemented**); Join remains the existing entry form on `/` (**implemented**). |
| Component / data / status | `FeaturedCoreGameBand` in route composition; `EntryBoard` from `features/board/`. Static source-backed product facts only. **Planned** as a distinct band; source destinations are implemented. |
| Responsive and theme | Desktop: explanation/action first and board supporting within one framed zone; tablet tightens columns; mobile stacks decision/action before board. Shared light/dark/system only; the board’s geometry and physical axes never mirror under RTL. |
| Accessibility / RTL / keyboard | Heading hierarchy, descriptive board caption, visible actions, and no auto-playing media. Board is meaningful identity but does not replace rule text. |
| States | Static content has no invented loading/popularity state. When a linked action is busy/disabled/error, use its actual source-backed route state and Arabic reason. No fake players, current-match status, score, or question. |

### 7. `WeeklyPlayRail` — deferred

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Future aggregate “most played this week” discovery: labelled period, source-backed ranked items, optional View all action, and honest empty/no-data state. |
| Actions and targets | View all and any item destination → **deferred**; no aggregate analytics, discoverability policy, current-games list, or catalogue route exists. |
| Component / data / status | `WeeklyPlayRail`, future discovery/analytics owner. **Deferred**. Do not render a horizontal carousel with invented counts/rankings or a disabled-but-promoted View all. |
| Responsive and theme | Future rail may use semantic list controls and clear clipping/scroll affordance; mobile must support standard touch/keyboard scrolling without a carousel trap. Shared themes; no copied cards. |
| Accessibility / RTL / keyboard | Ordered list conveys rank; View all appears only with a destination. Native scroll, named previous/next controls if introduced, focus management, and reduced motion are required. |
| States | Loading, empty, no-consent, unavailable analytics, signed-out personalization, error, offline, stale, and pagination are **planned**. |

### 8. `CategoryCatalogueSection` — planned from current category inventory

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Browse the real question categories available to the one game: section heading, search/filter or compact grouping when needed, rights-managed Tahadani cover, Arabic category name, verified stock status, and Start match action. It is a category catalogue—not an “all games” marketplace. |
| Actions and targets | Selecting a category opens `/host/new` with that category preselected. Category selection in setup is **implemented**; homepage rendering and URL/router-state preselection are **planned**. “View all” appears only if this section intentionally shows a limited subset and has an implemented full-list destination or disclosure. Join remains the entry form, not a card action. |
| Component / data / status | `CategoryCatalogueSection` uses the same category inventory, eligibility/stock rules, and cover provenance as `HostNewRoute`; no duplicated static catalogue. Existing Tahadani-derived assets remain rights-managed content with manifest/fallback handling. **Planned** homepage composition over current data. |
| Responsive and theme | Desktop: responsive semantic grid or bounded horizontal preview; tablet reduces columns; mobile uses two compact columns or native horizontal scrolling with visible continuation. Preserve cover aspect ratio/title strip and shared themes; never use covers as wallpaper. |
| Accessibility / RTL / keyboard | Each item has one heading and one primary action, useful image alternative/title, stock/availability in text, visible focus, and predictable Tab order. No nested interactive card. Native scroll is preferred over a carousel trap. |
| States | Loading skeleton preserves media ratio; populated, filtered, empty, no-stock-disabled with reason, unavailable cover fallback, service error/retry, offline, stale inventory, and preselection failure are required before implementation can be claimed complete. |

### 9. `SiteFooter` — planned destination inventory

| Contract | Requirement |
|---|---|
| Purpose and exact slots | Product identity; current help/rules link; future grouped company/legal/support/store/social destinations; copyright/ownership statement once legally supplied. This is not a copied multi-column footer or destination set. |
| Actions and targets | How to play → `/how-to-play` (**implemented**). Home → `/` (**implemented**). Contact, privacy, terms, accessibility, company, support, app stores, and social → **deferred; no target, icon link, or fabricated URL**. |
| Component / data / status | `SiteFooter`, design-system/layout owner; legal copy and destination registry require product/legal ownership. **Planned** with two current internal links only; all other columns **deferred**. |
| Responsive and theme | Desktop can group only available links in aligned columns; tablet reduces groups; mobile becomes ordered vertical sections. Empty deferred groups do not render. Shared themes, crisp rules, no copied social/store branding. |
| Accessibility / RTL / keyboard | `footer` landmark, labelled link groups, descriptive link text, keyboard order, current external-link disclosure if any later exists. Icons never stand alone without Arabic accessible labels. |
| States | Current internal links have normal router navigation. Legal update, external outage, consent, signed-out, loading, error, offline, stale, disabled, and empty link-group states are **planned/not applicable** until destinations exist. |

## Cross-section implementation rules

- **No false availability:** Deferred/not-applicable sections either remain absent or, in a
  deliberately approved roadmap preview, identify themselves as unavailable without a purchase,
  account, count, score, player, question, or destination claim.
- **One-game mapping:** `Create match`, join, rules, classic/fast/custom setup choices,
  rights-managed question categories, a user-provided-room display URL, and the room lifecycle
  are the only homepage-adjacent affordances this contract maps. It does not create a global
  lobby, match history, account dashboard, or multi-game marketplace.
- **State evidence:** A later implementation must add source/test evidence to
  [ROUTE-STATE-COVERAGE.md](ROUTE-STATE-COVERAGE.md) before changing a homepage status to
  implemented. Route presence alone does not prove data, authorization, entitlement, or
  analytics behavior.
- **Visual and interaction rules:** Follow the complete active visual contract in
  [DESIGN-DNA.md](../DESIGN-DNA.md): shared light/dark/system themes, IBM Plex Sans Arabic,
  zero-radius framed zones, 4px scale, 44px targets, visible focus, Arabic RTL logical order,
  non-colour state redundancy, and restrained/reduced motion. The physical board axes stay
  fixed. No yellow/gold, glow, glass, gradients, copied Golbha values, pills, category art,
  branding, pricing layout, or page composition.

## Acceptance for future homepage work

Before a section is claimed implemented, verify its declared route/data owner, the complete
loading/empty/error/disabled/signed-out/offline/reconnecting/stale treatment above, Arabic RTL
and keyboard behavior, shared-theme responsive composition at 320px, 768px, 1024px, and 1440px,
and honest deferred handling. Deterministic checks record structure/state evidence only; human
review decides fidelity to the existing selected direction.
