# Design plan

## Selected direction

**مدار الحروف** is the selected whole-app direction for **استوديو الحروف**. It uses a cobalt/ultramarine architectural canvas, dimensional ice-white neutral letter tiles, deep-blue ink, cyan action/focus, and physical crimson-horizontal / emerald-vertical ownership. Controls are opaque and readable; 3D comes from contact shadows, bevels, and finite CSS motion rather than a bitmap interface or WebGL.

The canonical board remains real SVG/DOM geometry: 25 cells, six-neighbor topology, unchanged q/r centers and hit mapping, no RTL mirroring. Owned tactile cells retain red/green faces and legible on-team text. Product name is unchanged; “مدار الحروف” names the visual direction only.

## Human authority and evidence

| Record | Status | Binding evidence |
| --- | --- | --- |
| 0005 | Historical prior direction | Preserved; later incompatible rollout clauses are superseded, not edited. |
| 0006 | Human selected C | [selection record](../design/evidence/history/0006-spatial-studio-homepage-direction.md), SHA-256 `651F61920EDC000AA62961B1C168F4E23B821E62C2BCC93F6BA88963BC8BD84F`. |
| 0007 | Human authorized whole-app rollout | [rollout record](../design/evidence/history/0007-spatial-studio-whole-app-rollout.md), SHA-256 `B6FF90DD167B0813A1118C23AC030B71260D66A71DCCC38B077643DE8EFB7510`. |

0007 authorizes carrying the **human-approved homepage treatment** across the app. It is not a claim of separate human route-by-route aesthetic review. The three concept previews and generated-background provenance remain under `design/mockups/immersive-2026-09-05/` and immutable selection evidence. They are visual targets only: no preview bitmap is shipped as UI.

## Acceptance

The canonical acceptance IDs, owners, dependencies, and states are maintained in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). This plan records visual authority and direction only, so it does not duplicate or redefine release acceptance. Production-only checks remain pending as stated in the canonical implementation plan and [DEPLOYMENT.md](DEPLOYMENT.md).

