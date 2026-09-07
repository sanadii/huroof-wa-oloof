# 0007 — human approval for مدار الحروف whole-app rollout

**Record ID:** `design-history-0007`  
**Date:** 2026-09-05  
**Status:** immutable human rollout authorization

## Authority and binding

This record appends to, and does not alter, [0006](0006-spatial-studio-homepage-direction.md).
Its exact immutable SHA-256 is
`651F61920EDC000AA62961B1C168F4E23B821E62C2BCC93F6BA88963BC8BD84F`.

The human review question was:

> Please review the implemented C homepage at http://localhost:5173/ (desktop and phone captures linked above). Do you approve carrying this visual treatment across setup, gameplay, account, and admin pages, or want homepage changes first?

The exact human answer was:

> Approve C homepage and continue across the app

This authorizes the selected **مدار الحروف** direction for the whole application. `استوديو الحروف` remains the product wordmark; `مدار الحروف` is the approved design direction, not a product rename.

## Evidence bound to this decision

| Artifact | SHA-256 | Purpose |
| --- | --- | --- |
| `output/playwright/spatial-home-tactile-1440.png` | `308BC94CC0D54C36958554B610944D98D4F745689ADA8572FF043DD6CE375C9C` | Reviewed desktop representative homepage |
| `output/playwright/spatial-home-tactile-390.png` | `0DF78E9BEC12F030C88E11FE3D1FBD314CBB42B0E28DB19C498F734E6522C769` | Reviewed phone representative homepage |
| `output/playwright/spatial-home-reduced-motion-asset-fallback-390.png` | `D6D8F69B7544C96A8C2268B43DAFA1DCD7B7B492541CC7A60E852996851F36AB` | Asset-fallback and reduced-motion usability evidence |

## Supersession and invariants

For future setup, lobby, gameplay, account/auth, results, and administration implementation, this
record supersedes the remaining incompatible 0005 flat-only, no-blue, no-radius, no-depth, and
flat-midnight treatment clauses. It preserves 0005 and 0006 as immutable historical evidence.
It does not authorize changing the canonical 25-cell six-neighbour topology, SVG centers,
hit targets, physical crimson left/right and emerald top/bottom axes, truthful data, role
projections, private-answer boundary, authentication semantics, or authorization checks.

Implementation rolls out in reviewable route batches. Existing unreviewed surfaces remain a
temporary fallback only until their approved-C implementation is complete.

## Visual contract (verbatim)

Mood/concept: استوديو الحروف becomes a premium Arabic game studio inside the human-approved مدار الحروف cobalt architectural world. Retain product wordmark; selected concept is direction, not renaming. Raised ice-white letter tiles, cobalt frames, opaque readable controls, calm precise motion.

Focal/scan order: setup starts with game mode and category decision, then teams/settings and persistent create action; lobby starts with room code/share and player readiness, then start; host starts with authentic board/question/currentphase and fixed timer, then a clearly separated moderation console; player starts with current instruction and one dominant tactile buzzer; audience starts with centered board/question/timer and physically stable scores; results starts with actual winning team and round result, then rematch; account/auth starts with sign-in/accounttask; administration starts with page title/status, filters, records, and bounded editor actions.

Density: setup/host5, public/lobby/account4, player/audience3, admin6 out of10. No nested cards, compressed body copy, or decorative metrics.

Desktop/mobile: shared shell max1200px, restrained architectural background edge/crop that leaves main text on opaque surfaces. Setup desktop two columns (mainchoices + summary/settings), mobile one column with action reachable by natural scroll. Lobby desktop roomcode + roster, mobile roomcode then roster/start. Host desktop board centered with fixed score sides and question/clock, command console below; mobile scores compact above board and 44px controls in logical order. Player phone-first one-thumb layout with broad buzzer, no large decorative header. Audience 16:9 safe stage, never crowd board, maintain readable projected text at1280x720 and1920x1080. Results centered truthful outcome. Admin desktop navigation rail with data workspace; mobile accessible navigation disclosure with filters/records stacked and deliberate horizontal table scroll only within tablecontainer. No whole-document horizontal overflow320px+.

Typography: IBM Plex Sans Arabic700display600headings/actions400–500body; Arabic never tracked; scores/timers tabular; roomcodes/identifiers isolatedLTR. Body minimum14px (16px onphone) except compact metadata with clearcontrast.

Palette/surfaces: approved --spatial-* cobalt/ultramarine canvas, deepblueink, icewhite opaque task surfaces, cyanprimary/focus, explicit crimsonhorizontal physicalleft/right and emeraldvertical physicaltop/bottom. C background replaces oldmarble/gameplayfield where environmentused. Appcontrols meet4.5:1body/3:1largecontrast. Gameplay visualtreatment invariant across savedthemes like selectedhomepage; sharedlight/dark/system control remains functional for appropriate readablepanel variants, never hide/relabel existingauth semantics. Use tokenvalues, no broadglobals leaking.

Spacing/shapes: existing4px scale;24–64pxsectionrhythm;44pxcontrols;12pxcontrolradius16–20pxmajorpanels; restrainedframes/shadows without nestedcard clutter. Preserve canonical25cell six-neighbor topology, SVGcenters/hitpositions and teamaxes; no mirroredgeometry.

Imagery/icons: consume approved spatialdesktop/mobile WebPs, never bakeUIintobitmap. Tactileboardpresentation can now opt-in gameplay; liveboard should be frontal/static for accuratehitmapping (no CSSperspective oninteractiveoverlays unless verified aligned). Use canonical cellmaterials with clearlyvisible owned/active/winningstates; reveal lettersremainlegible. Existing rights-cleared categorymedia can be displayed withrealreadiness labels/fallback. One consistent labelledoutlineiconfamily; no unavailablefeatures dressed as live.

Interaction/states: preserve every real action/route/deeplink/roleboundary. Clearly handle busy/disabledreason/validation/empty/searcherror/offline/reconnecting/stale/success. No fakeplayers/scores/questions/progress. Auth/adminactualaccess remainsguarded; no bypass to create screenshots. Hostprivateanswers stay onlyhost, neveraudience/player. The user can recover from errors with concrete actions.

Motion:100mspress200msstate; finite600–800msentry onlywhere useful; existing finitewinning feedback remains. Buzzerpress tactile, selectedtilelift subtle, finalresult finitecelebration withoutextraheavydependency. No constantambientloop/scrollhijack/timerjitter; reducedmotionstatic, touchneverdependsonhover. Pointertiltonhomepage<=4degrees; livecontrolsnevermoveaway fromtouch. Static/assetfailurefallbackusable, cleanuphandlers.

Performance: no newWebGLdependency; backgroundassets<=500KB total; coreactionsusablebeforeimage; lazyroutes target initialJS<=250KBgzip; don'tloadprivateanswercontentinpublicbundle.

Anti-patterns: flatpreviousmarble direction, genericneongamer/glass/rainbow/gold, stackedcardsforeachlabel, fakecommerce/livecounts, movingArabic, accidentalRTLgeometryflip, inaccessiblecyanwhitecontrast, stretchedcategoryimages, authbypass, destructiveoverwrite.

## Review boundary

This is authorization to implement the selected direction, not an automated aesthetic approval.
Each route batch still requires source-backed behavior, targeted checks, and human review evidence
where the delivery plan calls for it. Deterministic validation may verify provenance and structure;
it cannot certify aesthetic quality.
