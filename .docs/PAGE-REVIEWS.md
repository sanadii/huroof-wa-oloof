# Page reviews and visual QA

## Authority boundary

0006 selected C; 0007 authorizes carrying the **human-approved homepage treatment** across the app. The route evidence below is root/Forge implementation review, not a separate human route-by-route aesthetic approval. Gate technical review is independent and has passed.

| ID | Finding / scope | Owner | Dependency | Current disposition |
| --- | --- | --- | --- | --- |
| F-001 | Baseline typecheck failure class | Forge | Existing TS contracts | Closed; Gate typecheck passed. |
| F-002 | Baseline lint failure class | Forge | Existing lint rules | Closed; Gate lint passed. |
| F-003 | Admin access initially unreviewable without staff session | Root | Local emulator Google/bootstrap | Resolved locally; authenticated workspace and final details reviewed. Production access remains unverified. |
| F-004 | Rules/authorization design invariant | Root / Gate | Firestore/Storage rules, role projections | Verified locally: Firestore 10, Storage 4 denials, public projection privacy; not a P0 defect. |
| F-005 | Unavailable homepage claims / roadmap prominence | Forge | Honest supported data | Superseded by C home composition; supported modes/categories stay real and unavailable roadmap is not focal UI. |
| F-006 | Homepage focal hierarchy and responsive dock | Forge / root | 0006 representative contract | Closed after human homepage review, mobile repair, fallback and motion evidence. |
| F-007 | Active lobby role exit | Forge | Game lifecycle | Closed; host/player route safely after active start. |
| F-008 | Host primary action contrast | Forge / root | C control tokens | Closed in rendered host review. |
| F-009 | Missing-room perpetual connecting copy | Forge | Error projection | Closed; concrete unable-to-join recovery. |
| F-010 | Nonterminal results falsely read final | Forge | Result projection | Closed; current phase/return route is truthful. |
| F-011 | Entry payload / route chunking | Forge / root | Lazy App routes | Closed local evidence: 92.12 KB gzip entry; deferred chunks absent on homepage preview. |
| F-012 | C public/setup/lobby composition | Forge / root | 0007 rollout authority | Implemented/reviewed locally, no document overflow at reviewed widths. |
| F-013 | C role layouts/materials | Forge / root | Board/privacy contracts | Implemented/reviewed locally; axes/hit geometry and role privacy retained. |
| F-014 | C auth/admin/recovery composition | Forge / root | Existing guards | Implemented/reviewed locally; guard and real recovery retained. |
| F-015 | Final real results/admin/account route inspection | Root | Local emulator principal | Closed local evidence: final details/results at 1440/390, Axe 0/no overflow. |
| F-016 | Independent Gate technical review | Gate | Source freeze | Closed: PASS. Not production authorization. |
| F-017 | Owned tactile cells lost team face fill | Forge / root | Spatial material CSS | Closed: explicit C owned face selectors retain crimson/emerald faces and white text; root verified real result/host captures. |

## Limits

Production Google identity, App Check/signing, and a production approved-release journey remain unexercised. Gate noted seven moderate transitive `uuid` dependency-audit findings for release follow-up.
