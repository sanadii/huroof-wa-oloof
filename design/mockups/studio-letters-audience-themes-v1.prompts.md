# Audience Gameplay Themes V1 — Generation Prompts

Status: **candidate theme pair awaiting human approval**

## Outputs

| Theme | File | SHA-256 |
|---|---|---|
| Light | `studio-letters-audience-light-v1.png` | `96D938A03F169A31DF05FB7F8FE367A8ACCD19D31D97455CCF9607BA4E5C1E74` |
| Dark | `studio-letters-audience-dark-v1.png` | `ED85F9A93085EA7F061150F4B6F05236F316BEDF63D24F225B547147E7B7E57C` |

Both images were produced as precise theme transformations of
`studio-letters-audience-gameplay-v3.png` through the project image wrapper and built-in
Image Gen. They preserve one layout and one game state.

## Shared exact prompt contract

```text
Use case: precise-object-edit
Asset type: high-fidelity theme variant of an Arabic React + TypeScript + Vite public-audience gameplay UI mockup
Edit target / sole structural reference: D:\projects\huroof_wa_oloof\design\mockups\studio-letters-audience-gameplay-v3.png
Primary request: Create the requested theme of the exact same product and exact same layout. Preserve V3’s structure, proportions, typography hierarchy, UI copy, and active game state while replacing its rejected yellow palette. This is a theme-token transformation, not a redesign.

Preserve exactly: one 16:9 frame; thin RTL header; two compact equal score readouts;
one dominant contiguous board; exactly 25 nonblank flat-top hexes in five staggered rows
of five; crimson sawtooth goals fused left/right; deep-green sawtooth goals fused
top/bottom; integrated claimed cells; central active ج; lower question zone; circular timer;
ready label.

Exact copy:
استوديو الحروف
الجولة ٢ من ٣
الفريق الأفقي — ↔ — ١
الفريق العمودي — ↕ — ٠
معلومات عامة
جزء من النبات يوجد تحت سطح التربة، ما هو؟
الأجراس مفتوحة
active cell: ج
timer: ١٢

Only these UI phrases plus one Arabic letter per board cell. No English, extra text,
answer, host controls, people, photography, broadcast décor, decorative cultural motifs,
copied logos, or watermarks.

Absolute rejection: no yellow, amber, gold, mustard, ochre, tan-yellow, cream-yellow,
yellow-tinted vignette, or yellow gradient anywhere. No layout drift, wrong cell count,
blank tile, detached goal edge, giant score card, gradients, glow, bevel, texture, shadow,
glass, 3D, or rounded structural UI.
```

## Light prompt extension

```text
Primary Refero foundation: V–A–C architectural-white style
ffef8672-f789-4329-8895-47e50f517d31. Preserve precise monochrome grid, extensive
negative space, razor-thin black rules, typography-led hierarchy, zero-radius surfaces,
and no shadows/gradients. Borrow only Gumroad’s confident geometric sans scale and
playful directness; exclude its pink, yellow, illustrations, pills, and rounding.

Canvas #F2F1EC; main surface #FFFFFF; cells #FFFDF8; ink #171717; muted #70716D;
soft rule #C9C8C2; active/ready/timer #79D4B6; horizontal team #B92F49; vertical team
#176B54. All fills solid. Scores are compact typographic readouts with thin team-color
rules or small swatches. The result feels like a modern cultural institution’s interactive
game, not a generic dashboard.
```

## Dark prompt extension

```text
Primary Refero foundation: Turso deep-space style
30f57fef-66d5-4f84-a528-88deacf24080. Preserve deep-space canvas, charcoal layering,
crisp slate borders, off-white typography, breathing room, and mint reserved for active
states. Borrow only Cards Against Humanity’s direct high-contrast game typography and
flat colors; exclude yellow, violet, rainbow badges, pills, rounding, and merchandise.

Canvas #0D1318; main surface #162129; cells #1B252C; primary type #F5F2EA;
border #40505B; muted #A8B0B5; active/ready/timer #4FE0BD; horizontal team #D54A60;
vertical team #27916E. All fills solid. No glow or esports treatment. Scores are compact
typographic readouts with thin team-color rules. The result is a calm, high-contrast
cultural broadcast interface.
```
