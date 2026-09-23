# 0006 — Human-selected spatial-studio homepage direction

Date: 2026-09-05  
Status: append-only implementation authorization for the representative homepage and its create/join journey. The human product owner remains the only selection authority.

The exact human selection was: “C — مدار الحروف: vivid blue spatial studio”. It selects
`CONCEPT-C` from the immutable `concept-set-immersive-2026-09-05.json` evidence set.

This record supersedes only incompatible homepage clauses from prior records and design
documents: the flat/no-blue/no-radius/no-depth treatment and the nine-region homepage
composition. It does not change the flat midnight gameplay direction, authentication and
permission boundaries, truthful-data rule, or the canonical 25-cell six-neighbour topology.
Crimson remains physical left/right and emerald remains physical top/bottom.

## Visual contract (verbatim)

Product mood and concept: مدار الحروف is a vivid cobalt Arabic spatial game studio, with an architectural dimensional environment, white sculptural letter tiles, and playful yet premium presentation.
Focal point and scan order: the central authentic board dominates, with a bold centered Arabic headline above and a stable white create/join dock below. Utility navigation and secondary content recede.
Density: entry 4/10; eventual setup and host 5/10; admin 6/10; player 3/10.
Desktop and mobile: a bounded 1200–1440px desktop stage with compact header, title, 440–500px board, and action dock visible within a 900px viewport. Mobile uses a compact two-row header, 220–280px board, and stacked actions reachable within 844px. No scroll hijacking.
Typography: IBM Plex Sans Arabic, 700 display, 600 actions/headings, 400–500 body; no tracking on joined Arabic. Tabular figures; technical codes isolated LTR.
Palette and materials: cobalt/ultramarine architectural backdrop, ice-white sculptural faces, deep-blue ink, cyan for active/focus/primary only. Crimson rails stay physically left/right and emerald rails top/bottom. Opaque controls guarantee contrast. Depth comes from environment, contact shadows, and bevels; no glass-panel clutter.
Spacing and shapes: existing 4px spacing scale, 24–64px section rhythm, 12px controls and 16–20px major action dock. Game hexagons retain exact geometry. No nested dashboard cards.
Icons and imagery: consistent labelled outline icons, a new generated architectural background without baked-in UI, a real code-rendered board, and rights-cleared category media only.
States and accessibility: explicit rest, focus, press, busy, disabled reason, empty, validation, error, and success. Touch targets at least 44px, keyboard operation, RTL, LTR code labels, contrast at least 4.5:1 for body and 3:1 for large text, and clear recovery.
Motion and 3D: CSS perspective board with finite entrance lasting at most 600–800ms, 100ms press feedback, and 200ms state transitions. Pointer tilt bounded to 4 degrees and fine pointers only. No constant motion, timer jitter, or hover-dependent actions. Reduced motion is fully static. Clean up handlers. Static board and solid cobalt canvas remain usable if assets fail.
Performance: no new WebGL dependency for this screen. Optimize responsive WebP assets toward 500KB or less. Core actions work while assets load. Later route splitting targets initial JavaScript at 250KB gzip or less.
Anti-patterns: no fake players, scores, stock or commerce; no old marble background; no concept bitmap as interface; no ambient neon, rainbow, or gold; no moving unreadable Arabic; no mirrored board topology; no overwritten unrelated work.

The next mandatory gate is a new human live review of the implemented homepage. Visual
expansion to other routes remains unauthorized until that gate is explicit.
