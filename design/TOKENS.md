# Design Tokens

Authority: exact reusable values for [`DESIGN-DNA.md`](../DESIGN-DNA.md).  
Implementation seed: [`tokens.css`](tokens.css).

## Theme colors

Gameplay uses the flat midnight aliases in `tokens.css`: `midnight-canvas`, `gameplay-cell`,
`gameplay-paper`, `gameplay-ink`, `gameplay-muted`, `gameplay-rule`, `gameplay-active`, and
the gameplay team and disabled-control tokens. They are restricted to host, player, and audience
gameplay surfaces; that scope overrides every foreground, background, rule, active, disabled,
and team role so gameplay is identical under light, dark, and system choices. Shared routes
retain the selected base theme.
Gameplay does not use material stop tokens or elevation recipes.

| Token | Light | Dark | Meaning |
|---|---:|---:|---|
| `surface-stage` | `#F2F1EC` | `#0D1318` | Application and audience canvas |
| `on-surface-stage` | `#171717` | `#F5F2EA` | Text on the application canvas |
| `surface-paper` | `#FFFFFF` | `#162129` | Reading and control surface |
| `on-surface-paper` | `#171717` | `#F5F2EA` | Text on a reading/control surface |
| `surface-cell` | `#FFFDF8` | `#1B252C` | Neutral playable cell |
| `on-surface-cell` | `#171717` | `#F5F2EA` | Text on a neutral cell |
| `surface-raised` | `#FFFFFF` | `#1C2932` | Selective matte elevated face |
| `on-surface-raised` | `#171717` | `#F5F2EA` | Text on a raised surface |
| `surface-recessed` | `#E5EAE8` | `#091116` | Board/plinth inset |
| `surface-ink` | `#171717` | `#F5F2EA` | Strong inverse structural surface |
| `on-surface-ink` | `#F5F2EA` | `#0D1318` | Text on the inverse surface |
| `ink-primary` | `#171717` | `#F5F2EA` | Primary text and strong borders |
| `ink-muted` | `#62645F` | `#A8B0B5` | Secondary text |
| `rule-soft` | `#C9C8C2` | `#40505B` | Dividers and cell outlines |
| `action-active` | `#79D4B6` | `#4FE0BD` | Active, selected, ready, focus |
| `action-active-deep` | `#54AE93` | `#249C7D` | Lower edge of active material |
| `action-hover` | `rgb(121 212 182 / 24%)` | `rgb(79 224 189 / 22%)` | Hover acknowledgement only |
| `action-pressed` | `rgb(121 212 182 / 48%)` | `rgb(79 224 189 / 42%)` | Press acknowledgement only |
| `action-primary-bg` | `#79D4B6` | `#4FE0BD` | Primary action background |
| `action-primary-fg` | `#082E27` | `#062C25` | Text/icon on primary action; never `surface-ink` |
| `action-primary-hover-bg` | `#54AE93` | `#249C7D` | Primary action hover background |
| `action-primary-hover-fg` | `#061F1A` | `#F5F2EA` | Text/icon on primary action hover |
| `control-disabled-bg` | `#DDE2DE` | `#253238` | Disabled control background |
| `control-disabled-fg` | `#4C5652` | `#C8D1D4` | Disabled control text/icon |
| `control-disabled-border` | `#7A8580` | `#637078` | Disabled control border |
| `team-horizontal` | `#B92F49` | `#D54A60` | Horizontal ownership and left/right edges |
| `team-horizontal-strong` | `#8E2037` | `#AE344A` | Horizontal pressed/path emphasis |
| `team-vertical` | `#176B54` | `#27916E` | Vertical ownership and top/bottom edges |
| `team-vertical-strong` | `#10513F` | `#1C7055` | Vertical pressed/path emphasis |
| `on-team` | `#FFFFFF` | `#FFFFFF` | Text/icon on either team fill |
| `feedback-correct-bg` | `#171717` | `#F5F2EA` | Correct-answer neutral inverse |
| `feedback-correct-ink` | `#F5F2EA` | `#0D1318` | Correct-answer foreground |
| `feedback-error-bg` | `#FFFFFF` | `#162129` | Incorrect/error surface |
| `feedback-error-ink` | `#171717` | `#F5F2EA` | Incorrect/error foreground |
| `scrim` | `rgb(23 23 23 / 72%)` | `rgb(0 0 0 / 72%)` | Modal/sheet backdrop |
| `edge-low` | `#899592` | `#05090C` | Lower material edge |
| `shadow-soft` | `rgb(13 19 24 / 10%)` | `rgb(0 0 0 / 36%)` | Restrained ambient depth |

Yellow, amber, gold, violet, and indigo are unassigned and must not appear as ad-hoc accents. Correct/incorrect feedback avoids green/red semantics because those hues identify the teams. State is communicated with Arabic copy, icon, border treatment, and the resulting team-aware transition.

## Typography

- Family: `"IBM Plex Sans Arabic", Tahoma, Arial, sans-serif`.
- Weights: 400, 500, 600, 700.
- Scale: 12, 14, 16, 20, 24, 32, 48px and `clamp(3rem, 7vw, 4.5rem)`.
- Line heights: 1.15 display, 1.35 UI, 1.6 reading.
- Timers, scores, ranks, and result columns use tabular numerals.

## Spacing, sizing, shape

- Base unit 4px; scale 4, 8, 12, 16, 24, 32, 48, 64px.
- Page gutter: 16px mobile, 24px tablet, 32px desktop, 48px audience display.
- Minimum touch target 44×44px; host primary controls 52px high.
- Player buzzer: `min(72vw, 320px)` across flats, never below 220px.
- Radius 0 for rectangular components. Circle only for countdown; hexagon only for game objects.
- Borders: 1px divider, 2px control/cell, 4px winning path; icon stroke 2px.

## Motion and layering

- Durations: press 90ms, fast 120ms, state 200ms, large 320ms.
- Never use `transition: all`; reduced motion removes translation/scale and limits opacity to 100ms.
- z-index scale: base 0, sticky 20, popover 40, modal 60, toast 80.
- `shadow-control` remains a legacy non-gameplay control token. Gameplay surfaces must not
  use elevation recipes, material stop tokens, or SVG gradients. Press translation is 2px
  for the 90ms press token and is removed under reduced motion.
- Disabled controls use the named disabled background, foreground, and border tokens. They do
  not use opacity as their only signal and do not receive hover or active treatment.
