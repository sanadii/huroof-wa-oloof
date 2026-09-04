# Theme Exploration — Light and Dark

Status: **approved palette contract**  
Date: 2026-09-03

The owner approved this light/dark direction after rejecting the amber/yellow canvas. The
board structure remains: 25 interlocking hexes, crimson left/right goal edges, deep-green
top/bottom goal edges, compact scores, and an adjacent circular countdown.

## Light theme reference lock

Primary reference: V–A–C Refero style `ffef8672-f789-4329-8895-47e50f517d31`.

Preserve: architectural grid, mineral-white canvas, black rules, typography-led hierarchy,
zero-radius structure, sparse chrome, and generous macro spacing.

Borrow only: Gumroad's confident geometric sans scale and high-contrast playful clarity;
its pink, yellow, illustrations, pills, and rounded cards are excluded.

| Role | Candidate token |
|---|---|
| Canvas | `#F2F1EC` |
| Primary surface | `#FFFFFF` |
| Neutral cell | `#FFFDF8` |
| Ink / strong border | `#171717` |
| Muted text / soft rule | `#70716D` / `#C9C8C2` |
| Active / ready | `#79D4B6` |
| Horizontal team | `#B92F49` |
| Vertical team | `#176B54` |

## Dark theme reference lock

Primary reference: Turso Refero style `30f57fef-66d5-4f84-a528-88deacf24080`.

Preserve: deep-space canvas, charcoal surface separation, crisp slate borders, off-white
typography, and teal reserved for important active states.

Borrow only: Cards Against Humanity's direct high-contrast game typography and flat solid
color treatment; its yellow, violet, multicolor badges, pills, and card merchandising are
excluded.

| Role | Candidate token |
|---|---|
| Canvas | `#0D1318` |
| Primary surface | `#162129` |
| Neutral cell | `#1B252C` |
| Primary text | `#F5F2EA` |
| Border / muted text | `#40505B` / `#A8B0B5` |
| Active / ready | `#4FE0BD` |
| Horizontal team | `#D54A60` |
| Vertical team | `#27916E` |

## Shared invariants

- No yellow, amber, gold, beige-gold, or yellow-tinted gradient.
- Both themes use the same layout, spacing, board coordinates, and game state.
- Red remains horizontal-team ownership; green remains vertical-team ownership.
- Teal/mint remains active, focus, timer-progress, or ready only.
- Theme changes never alter team identity or board topology.
- Strong rules and matte surfaces remain primary. The approved 2026-09-04 material evolution
  permits only tokenized raised/recessed faces, named selective shadows, token-only board
  gradients, and the two provenance-recorded quiet background fields; no glow, glass, or
  decorative semantic imagery.
- Mockups are review targets only. Production UI is semantic HTML/CSS/SVG.
