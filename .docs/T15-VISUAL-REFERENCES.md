# T-15 visual reference lock

The sole visual authority remains [DESIGN-DNA](../DESIGN-DNA.md) and immutable [0007](../design/evidence/history/0007-spatial-studio-whole-app-rollout.md). This research refines execution; it does not approve a new direction. The T-15 visual contract remains verbatim in the canonical implementation plan.

## Research evidence — 2026-09-08

Refero searches covered cobalt/tactile product UI, multiplayer quiz/party games and focused workflow hierarchy. Full style records inspected: Splice `6cdcbe02-96f5-4daa-8094-9c61bbaf3147`, Playdate `c91209ef-f7f3-4d2b-bf69-41b58e4e2cc2`, Linear Changelog `11d3e58a-87d7-4a9a-bbf5-720f4fd3ffc6`. Search previews were followed by full descriptions, layout, components, spacing and token-role guidance. These are secondary references; no foreign palette, typeface or radius replaces repository tokens.

| Reference | Narrow lesson used | Explicitly excluded |
| --- | --- | --- |
| [Splice](https://splice.com) | A studio atmosphere stays outside the task surface; one vivid action remains immediately recognizable | Green photography wash, foreign blue token, rounded pills and marketing hero dominance |
| [Playdate](https://play.date) | Tactile game objects and hierarchy through size/weight in one type family | Yellow/violet palette, Latin tracking, retail CTA and product imagery |
| [Linear Changelog](https://linear.app/changelog) | Quiet supporting navigation and clear row/section separation preserve focus | Black/glass direction, Inter/mono replacement and universal pill controls |
| [Hashnode content filtering screen](https://refero.design/pages/fdfa6c70-d505-4400-9068-6b76d8c0065e) | Title → status tabs → search/filter → titled data columns; removable active filters with clear Apply/Cancel | Claiming loaded-page search is global; copying taxonomy or decorative colors |
| [Around lobby flow](https://refero.design/flows/1998) | Visible copy confirmation, share action available while waiting, roster/count updated only after actual membership change | New admission permissions, camera/video features, decorative concentric rings |

The Hashnode full screen and all three Around flow steps were inspected via Refero metadata. Current application screenshots in [APP-POLISH-REVIEW](APP-POLISH-REVIEW.md) are the primary rendered baseline. Root inspected the actual lobby and display captures. External screenshots were not used as proof of this app's behavior.

## Locked direction and decisions

- Preserve cobalt architectural canvas, ice-white task zones, IBM Plex Sans Arabic, cyan actions, physical red/green axes and the frontal 25-cell board. Use approved WebPs; no new bitmap generation is needed.
- Entry: keep recognizable board identity but make join/create choice visible without traversing a full-height hero. A compact room-code path leads to the required name step; errors retain intent and input.
- Waiting room: code/share strip, two team rosters, explicit readiness and primary Start with blocking reason. Remove the dominant empty title slab; show a small board preview only when it does not displace the task. Actual member updates drive finite feedback.
- Host: board/question/timer first, concise phase action next, supporting controls last. Failed answer summary and Continue explain the change; never animate replacement before server acknowledgment.
- Audience: preserve current board and scores. Add readable category text/occurrence in cells and a full active-category line, with phase copy that accurately says when the host is choosing. Do not trade hit geometry or TV readability for decoration.
- Player: one-thumb buzzer and unambiguous waiting/opponent/offline instruction; feedback must never delay submission.
- Admin: compact navigation plus workspace, named Arabic statuses/metrics, dedicated columns, visible filter scope/pagination and grouped editable fields. Keep raw technical details in optional disclosure. Data availability and permissions remain truthful.
- Motion: use the contract's 100ms press/200ms state transitions, finite entry only where useful, and resolution-revision-keyed replacement/win feedback. Static reduced motion, no ambient loops or replay on reconnect.

## Validation targets

Compare each implemented route to the approved C authority and its current baseline, checking the intended action is discoverable, text remains readable, 320/390px layouts do not overflow, and audience is usable at 1280×720/1920×1080. Capture normal and adverse states, reduced motion and keyboard focus. Root technical/rendered review is not a claim of human aesthetic approval; collect the final live walkthrough for user review without inventing a receipt.

## Font delivery finding and source

Source inspection found no @font-face or font asset load, only the declared --font-ui family; index.html also loads no font. T-15.3 should bundle the approved IBM Plex Sans Arabic family locally with font-display:swap and preserved fallback. Root obtained unmodified 400/500/600/700 WOFF2 files plus SIL OFL license from an immutable commit in the official IBM/plex repository. Source manifest, URLs, byte counts and SHA256 are in ../.agent-runtime/t15-font-source/manifest.json; all four fonts total 298,036 bytes. Copy only these needed assets/license into the app in the visual milestone; no new npm dependency or runtime third-party request is needed. This makes the existing approved typeface portable, not a new type direction.

Category-cell legibility must be checked using the delivered font, not fallback font measurements. At narrow phone widths, do not shrink labels indiscriminately to fit: allow word wrapping, full accessible labels and a prominent active-category title, with a usable expanded-board view if necessary. Preserve the canonical topology and hit positions; final rendered evidence decides the layout.
