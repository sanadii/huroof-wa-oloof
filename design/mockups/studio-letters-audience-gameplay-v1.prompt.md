# استوديو الحروف — Audience Gameplay Mockup V1

Status: **rejected by human review on 2026-09-03**

Rejection reason: the board read as detached vertical hex columns, the score panels were
too large, and the composition did not preserve the physical game's red left/right and
green top/bottom sawtooth goal edges. This image is retained only as iteration history.

- Image: `studio-letters-audience-gameplay-v1.png`
- Use case: `ui-mockup`
- Canvas: 1672×941 PNG (16:9)
- SHA-256: `757B3B220680F080BF27F01A78694F93B0476E64DF3A4C7B46B49B006601FBB2`
- Generation mode: `invoke-codex-image.ps1` → GPT-5.6 Sol → built-in Image Gen
- Source truth: `DESIGN-DNA.md`, with the selected Refero direction “استوديو الحروف”
- Scope: public audience display during an active question; this is not a host console

## Exact final prompt

```text
Execution note for the image runner: You are already executing inside the required scripts/invoke-codex-image.ps1 wrapper. Do not invoke that wrapper again. Call the built-in image_gen tool directly now, then copy/save the returned bitmap to the exact output path supplied by the enclosing wrapper.

Use case: ui-mockup
Asset type: high-fidelity implementation reference for a React + TypeScript + Vite public audience gameplay screen
Primary request: Create exactly one polished full-screen Arabic RTL gameplay interface for the game brand “استوديو الحروف”, showing one public audience-display state during an active question.
Scene/backdrop: A straight-on, full-bleed app screenshot on a single landscape 16:9 canvas, with no browser chrome, no device chrome, no people, and no physical studio. Translate a sunny minimal Arabic cultural broadcast studio into precise contemporary software.
Focused correction: The entire outer viewport behind every board, score, and question element MUST be an opaque solid amber #FCD579 from edge to edge. Do not use black, charcoal, white, transparency, or any other color as the page background. Reserve near-black only for ink, borders, and the single selected hex. Render the vertical-team score as an unmistakable Arabic-Indic zero glyph “٠”, not a dot or circle.
Style/medium: High-fidelity implementation-ready product UI mockup; flat exhibition-graphic design; crisp vector-like raster rendering; typography and spacing should look immediately implementable.

Visual lock:
- Dominant opaque amber stage background #FCD579 filling every exposed part of the frame edge-to-edge; absolutely no black outer field.
- Near-black structural ink #171717.
- Jade #81D6B9 only for active, focus, and ready states.
- Warm paper #FFF8E7 and neutral cells #FFF3C8.
- Horizontal team crimson #B4233C; vertical team deep green #146C54.
- All surfaces flat. Sharp zero-radius rectangular blocks. Visible 2px near-black borders. No shadows and no gradients.

Composition and scan order:
- RTL interface with generous negative space outside the play area, density 5/10.
- The dominant focal point is a large central flat-top 5-by-5 honeycomb / axial hex-letter board occupying roughly 65% of the usable stage. It must read instantly as a connected hex topology: five clear staggered rows, exactly 25 visible flat-top hexagonal tiles total, tightly controlled small gaps, consistent size and alignment.
- Scores anchor the left and right edges of the board without competing with it.
- Top area: concise brand text “استوديو الحروف” and match progress “الجولة ٢ من ٣”.
- Crimson score block: exact label “الفريق الأفقي”, clear ↔ axis icon, score “١”.
- Deep-green score block: exact label “الفريق العمودي”, clear ↕ axis icon, score “٠”.
- Neutral board cells: warm paper or #FFF3C8, 2px #171717 border, one large centered Arabic letter.
- Use only these short board letters, one centered letter per tile: أ، ب، ت، ث، ج، ح، خ، د، ر، س، ش، ص، ط، ع، ف، ق، ك، ل، م، ن، هـ، و، ي. Letters may repeat only if necessary to fill all 25 cells.
- A few claimed cells are crimson or deep green. Add subtle directional line patterns and small ↔ or ↕ glyphs inside claimed cells, so ownership is not communicated by color alone.
- Exactly one active selected cell is near-black with a very large amber or jade Arabic letter “ج”. Make it unmistakably selected while retaining the sharp hex silhouette.

Lower question band:
- Full-width warm-paper rectangular band with square corners and strong ink border, aligned cleanly along the bottom.
- Include exact category “معلومات عامة”.
- Include a prominent target-letter marker “ج”.
- Include the exact public question, verbatim and highly legible in correct RTL: “جزء من النبات يوجد تحت سطح التربة، ما هو؟”
- Include a circular timer showing exactly “١٢”. The timer may be circular, but surrounding containers remain square.
- Include ready status “الأجراس مفتوحة” on jade #81D6B9 with an ink border.
- Do not reveal the answer. Do not show host controls or host-only information.

Typography:
- Clean bold Arabic-first sans inspired by IBM Plex Sans Arabic; correct connected Arabic shaping and RTL reading order.
- Large display letters and scores; tabular Arabic-Indic numerals; exceptionally legible from a television or projector.
- Render only the specified UI text and short board letters. No invented copy, no English labels, no gibberish, no extra numbers.

Exact UI text allowed, verbatim only:
“استوديو الحروف”
“الجولة ٢ من ٣”
“الفريق الأفقي”
“الفريق العمودي”
“معلومات عامة”
“ج”
“جزء من النبات يوجد تحت سطح التربة، ما هو؟”
“١٢”
“الأجراس مفتوحة”
Scores: “١” and “٠”
Axis glyphs: “↔” and “↕”

Mood: sunny, intelligent, competitive, contemporary, family and classroom appropriate.
Hard avoid: rounded cards, pill containers, glassmorphism, gradients, drop shadows, purple, blue, dark gamer shell, esports glow, decorative Arabic calligraphy, Arabesque motifs, mosque silhouettes, mascots, people, photography, generic 3D art, confetti, stock imagery, extra logos, watermarks, answer text, host-only information, tiny dashboard charts, distorted pseudo-Arabic, extra UI copy.
Output constraint: one clean landscape 16:9 interface frame only, visually straight-on and presentation-ready.
```

## Human review gate

This mockup must not be used as an implementation target. See the latest versioned
mockup and its human-review status instead. The production interface must use real
HTML/CSS/SVG and exact game data rather than shipping any mockup bitmap as UI.
