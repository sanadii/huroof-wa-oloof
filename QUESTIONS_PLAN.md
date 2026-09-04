# Question Bank & Tahadani Category Import Plan

Status: implementation handoff for a future agent  
Target repository: `D:\projects\huroof_wa_oloof`  
Read-only source repository: `D:\projects\tahadani`  
Client context: React + TypeScript + Vite  
Gameplay authority: [`GAME_REVIEW_AR.md`](GAME_REVIEW_AR.md)

## 1. Mission

Build the content foundation for «استوديو الحروف» by:

1. Importing all 62 Tahadani category records in their existing order.
2. Copying the 62 mapped Tahadani category-cover images into this repository.
3. Creating a new question-bank schema designed for answers that begin with a target Arabic letter.
4. Building validation, coverage, review, and provenance tooling before producing questions at scale.
5. Producing a small reviewed pilot before attempting the launch-sized bank.

This plan authorizes copying **category metadata and category-cover images only**. It does not authorize modifying Tahadani or copying its question text wholesale.

## 2. Pre-mortem

### Failure 1 — Importing 12,400 incompatible questions

Tahadani cards use 200/400/600 difficulty slots, but most answers were not written to begin with a specified letter. Copying them would create a large bank that the board cannot safely query.

Mitigation: copy categories and covers only. Create a new letter-aware schema and validate every accepted answer against `targetLetter`.

### Failure 2 — Shipping unlicensed category artwork

No explicit license/provenance declaration was found for the Tahadani images. Many covers appear to reference entertainment, games, clubs, personalities, or trademarks.

Mitigation: copy exact files for internal development, record their hashes and origin, set `rightsStatus: "unverified_legacy_import"`, and keep `publishable: false` until a rights review or replacement asset is completed.

### Failure 3 — “Complete” categories that cannot generate a fair board

A category can contain many questions while still lacking usable questions for letters such as ث، ذ، ض، ظ، and غ. Raw totals would hide the shortage.

Mitigation: readiness is calculated per category × target letter × difficulty. The game may activate a category pack only when its selected pack passes the minimum-per-letter rule.

## 3. Non-negotiable boundaries

- Treat `D:\projects\tahadani` as read-only. Do not edit, rename, optimize, delete, or regenerate files there.
- Preserve all existing work in this repository.
- Do not copy the entire `images` directory, `cropped.zip`, `questions.zip`, generated archives, cache files, or Tahadani question Markdown.
- Copy only the 62 explicitly mapped covers from `D:\projects\tahadani\images\cropped`.
- Use `D:\projects\tahadani\category_manifest.json` for category order, name, slug, source mode, and source policy.
- Use `D:\projects\tahadani\top_50_categories.md` for category-to-cover mapping. Despite its old name, it maps all 62 current categories.
- A category cover is not question media. Image questions need their own licensed media record.
- Do not preserve Tahadani’s 200/400/600 values as gameplay scores. In this app, path completion wins the round and answer points are governed by the game rules.
- Generated questions never become playable without human review.
- Do not claim that copied images are cleared for production.

## 4. Verified Tahadani inventory

### Canonical files

| Source | SHA-256 | Finding |
|---|---|---|
| `D:\projects\tahadani\category_manifest.json` | `5C787C9982EBA35AAA95211EDC571A20AB2EE692DE0399B62A508FB3CF759318` | Manifest v2; 62 ordered categories |
| `D:\projects\tahadani\top_50_categories.md` | `E40AF8F08F5095FA24C2C66F35D2B329CB285D6B60D02F3298DD6622F8CF213D` | 62 category-cover mappings |
| `D:\projects\tahadani\completion_report.json` | `58003511B256DCBAFBE80583377652055F5382E9697E9106553CA05BA86A1B0D` | Reports 62 categories and 12,400 cards |
| `D:\projects\tahadani\validate_questions.py` | `8E0D0E649643DC0ACC9E621CAFDB4772D9F1E428E24AA38505921E1CE76DB468` | Current v2/62-category Markdown validator |
| `D:\projects\tahadani\generate_bulk.py` | `E6D3662E5E75B8CF6C81DBBBD681EEA844715764BD020B9256F0A2DADD811048` | Legacy generator; currently expects manifest v1 and exactly 50 categories |

Do not reuse `generate_bulk.py` unmodified: its loader contradicts the current v2/62-category manifest. The new game also needs a different letter-aware schema.

### Category modes

| Source mode | Count | Main-game treatment |
|---|---:|---|
| `trivia` | 41 | Directly compatible after letter-aware rewriting and verification |
| `identity` | 9 | Compatible when the identity answer begins with the target letter |
| `puzzle` | 3 | Compatible only when there is one unambiguous answer |
| `image` | 4 | Deferred until question-specific media has rights, alt text, and a stable asset ID |
| `charades` | 5 | Catalogued but disabled for the classic buzzer mode; requires a separate future mode |

### Cover assets

- Mapping rows: 62.
- Missing source files: 0.
- Source format: 62 mappings point to PNG files.
- Unique source files: 61.
- Deliberate reuse: `من أنا جغرافيا.png` maps to both category 1 and category 59.
- Dimensions by mapping: 57 at 1250×1250, 3 at 1251×1251, and 2 at 625×625.
- Unique-source byte total: 58,750,644 bytes.
- Rights/provenance status: not documented; treat as unverified.

## 5. Required output structure

The future agent should create this structure without waiting for the React UI:

```text
content/
  categories/
    categories.json
    import-receipt.json
    asset-manifest.json
    originals/
      category-001.png
      ...
      category-062.png
  questions/
    question.schema.json
    drafts/
      questions.jsonl
    approved/
      questions.jsonl
    reports/
      coverage.json
      duplicates.json
      source-review.json
      readiness.json
public/
  assets/
    categories/
      320/
      640/
scripts/
  import-tahadani-categories.ts
  validate-question-bank.ts
  build-category-assets.ts
```

Rules:

- `content/categories/originals` preserves exact copied bytes with stable category-specific filenames.
- Create 62 destination originals even though categories 1 and 59 initially have identical bytes. This allows either category to receive a distinct replacement later.
- `public/assets/categories/320` and `640` contain optimized WebP or AVIF derivatives for the app; do not overwrite originals.
- Images must be generated without upscaling. Preserve a square crop.
- The import receipt records source path, destination path, source/destination SHA-256, dimensions, and copy timestamp.
- `categories.json` is the application’s category source of truth after import. It must not depend on absolute Tahadani paths at runtime.

## 6. Category data schema

Minimum category record:

```json
{
  "id": "tahadani-001",
  "legacyIndex": 1,
  "displayNameAr": "من أنا / دول",
  "slug": "من_أنا_دول",
  "sourceMode": "identity",
  "sourcePolicy": "identity_trios",
  "classicCompatibility": "text",
  "catalogStatus": "imported",
  "questionReadiness": "empty",
  "cover": {
    "original": "content/categories/originals/category-001.png",
    "web320": "assets/categories/320/category-001.webp",
    "web640": "assets/categories/640/category-001.webp",
    "width": 1250,
    "height": 1250,
    "sha256": "source hash here",
    "altAr": "غلاف فئة من أنا / دول",
    "rightsStatus": "unverified_legacy_import",
    "publishable": false
  },
  "provenance": {
    "sourceRepository": "D:/projects/tahadani",
    "manifestVersion": 2,
    "sourceImageName": "من أنا جغرافيا.png"
  }
}
```

Allowed `classicCompatibility` values:

- `text`: may receive normal letter questions.
- `image_pending`: requires question-specific media pipeline.
- `separate_mode`: does not enter the classic board question pool.

Allowed `questionReadiness` values:

- `empty`
- `drafting`
- `reviewing`
- `playable_combined_only`
- `playable_standalone`
- `blocked`

## 7. Exact category and cover mapping

The importer must use this mapping. Destination names are deterministic and do not copy human filenames into application URLs.

| # | Category | Source mode | Source cover under `images/cropped` | Classic treatment |
|---:|---|---|---|---|
| 1 | من أنا / دول | identity | `من أنا جغرافيا.png` | text |
| 2 | من أنا / لاعبين كرة قدم | identity | `من أنا رياضية.png` | text |
| 3 | من أنا / حيوانات | identity | `من أنا حيوانات.png` | text |
| 4 | من أنا / مسلسلات عربيه | identity | `من أنا مسلسلات عربية.png` | text |
| 5 | من أنا / ممثلين | identity | `من أنا ؟.png` | text |
| 6 | معلومات عامة | trivia | `معلومات عامة.png` | text |
| 7 | عالم الحيوان | trivia | `عالم الحيوان.png` | text |
| 8 | تكنولوجيا | trivia | `تكنولوجيا.png` | text |
| 9 | تاريخ | trivia | `تاريخ.png` | text |
| 10 | منو المشهور | identity | `منو المشهور.png` | text |
| 11 | خمن الصورة | image | `فتّح عينك.png` | image_pending |
| 12 | شنو هذا؟ | image | `زوم.png` | image_pending |
| 13 | ألغاز | puzzle | `ألغاز.png` | text |
| 14 | الجزء المفقود | puzzle | `صورة ناقصة.png` | text |
| 15 | أمثال وغطاوي | puzzle | `أمثال شعبية.png` | text |
| 16 | حيوانات / ولا كلمة | charades | `ولا كلمة حيوانات.png` | separate_mode |
| 17 | أغاني عربية / ولا كلمة | charades | `ولا كلمة أغاني عربية.png` | separate_mode |
| 18 | مشاهير عرب / ولا كلمة | charades | `ولا كلمة مشاهير عرب.png` | separate_mode |
| 19 | كرتون / ولا كلمة | charades | `ولا كلمة كرتون.png` | separate_mode |
| 20 | دول / ولا كلمة | charades | `ولا كلمة دول.png` | separate_mode |
| 21 | ريال مدريد | trivia | `ريال مدريد.png` | text |
| 22 | برشلونة | trivia | `برشلونة.png` | text |
| 23 | كأس العالم | trivia | `كاس العالم.png` | text |
| 24 | ميسي وكرستيانو | trivia | `ميسي وكرستيانو.png` | text |
| 25 | من هو اللاعب | identity | `من هو اللاعب.png` | text |
| 26 | طاش ماطاش | trivia | `طاش ما طاش.png` | text |
| 27 | باب الحارة | trivia | `باب الحارة.png` | text |
| 28 | أفلام كلاسيك | trivia | `أفلام كلاسيك.png` | text |
| 29 | أفلام رعب | trivia | `أفلام رعب.png` | text |
| 30 | Game Of Thrones | trivia | `Game Of Thrones.png` | text |
| 31 | أغاني الزمن الجميل | trivia | `الزمن الجميل.png` | text |
| 32 | أم كلثوم | trivia | `أم كلثوم.png` | text |
| 33 | أغاني وطنية | trivia | `نشيد وطني.png` | text |
| 34 | أغاني أجنبية | trivia | `أغاني أجنبية.png` | text |
| 35 | عبدالكريم عبدالقادر | trivia | `عبدالكريم عبدالقادر.png` | text |
| 36 | One Piece | trivia | `أنمي ون بيس.png` | text |
| 37 | Attack on Titan | trivia | `أنمي هجوم العمالقة.png` | text |
| 38 | Naruto | trivia | `أنمي ناروتو.png` | text |
| 39 | كونان | trivia | `المحقق كونان.png` | text |
| 40 | لعبة PUBG | trivia | `لعبة PUBG.png` | text |
| 41 | Call of Duty | trivia | `Call Of Duty.png` | text |
| 42 | Minecraft | trivia | `Minecraft.png` | text |
| 43 | العاب الطفولة | trivia | `ألعاب الطفولة.png` | text |
| 44 | أعلام | image | `أعلام.png` | image_pending |
| 45 | عواصم | trivia | `عواصم.png` | text |
| 46 | دول و عواصم | trivia | `دول و عواصم.png` | text |
| 47 | عملات | trivia | `عملات.png` | text |
| 48 | الفنون القتالية | trivia | `UFC.png` | text |
| 49 | تنس | trivia | `تنس.png` | text |
| 50 | Formula 1 | trivia | `Formula One.png` | text |
| 51 | سيارات | trivia | `سيارات.png` | text |
| 52 | منوعات كرة قدم | trivia | `منوعات كرة قدم.png` | text |
| 53 | منوعات شعرية | trivia | `منوعات شعرية.png` | text |
| 54 | كرة قدم عالمية | trivia | `كرة قدم عالمية.png` | text |
| 55 | كرة قدم ايطالية | trivia | `الكرة الايطالية.png` | text |
| 56 | قصص الأنبياء | trivia | `قصص الانبياء.png` | text, sensitive review |
| 57 | القرآن الكريم | trivia | `القرآن الكريم.png` | text, sensitive review |
| 58 | مطاعم الكويت | trivia | `مطاعم الكويت.png` | text, dated/local review |
| 59 | توقعني (دول) | identity | `من أنا جغرافيا.png` | text; duplicate cover pending replacement |
| 60 | مسيرة لاعب | identity | `مسيرة لاعب.png` | text |
| 61 | تشكيلات | image | `LineUp.png` | image_pending |
| 62 | كأس العالم 2026 | trivia | `كأس العالم 2026.png` | text, dated review |

## 8. Question schema

The source of truth should be JSONL: one independent object per line, easy to diff, stream, validate, and batch-review.

```json
{
  "id": "q_01J...",
  "schemaVersion": 1,
  "locale": "ar-KW",
  "categoryId": "tahadani-006",
  "targetLetter": "ج",
  "promptAr": "جزء من النبات يوجد عادةً تحت سطح التربة، ما هو؟",
  "canonicalAnswer": "جذر",
  "acceptedAnswers": ["جذر", "الجذر"],
  "difficulty": "easy",
  "questionType": "text",
  "explanationAr": "الجذر يثبت النبات ويمتص الماء والأملاح من التربة.",
  "sources": [
    {
      "title": "عنوان المصدر",
      "publisher": "الجهة",
      "url": "https://example.org/reference",
      "accessedAt": "2026-09-03"
    }
  ],
  "temporal": {
    "kind": "stable",
    "verifiedAt": "2026-09-03",
    "validUntil": null
  },
  "media": null,
  "status": "draft",
  "authoring": {
    "method": "human|model_assisted",
    "model": null,
    "createdAt": "2026-09-03T00:00:00Z"
  },
  "review": {
    "factReviewer": null,
    "languageReviewer": null,
    "reviewedAt": null,
    "notes": null
  }
}
```

Allowed difficulties are `easy`, `medium`, and `hard`. They may be seeded conceptually from Tahadani’s 200/400/600 levels, but they do not change cell value or match victory.

Question types:

- `text`
- `identity`
- `puzzle`
- `image`

Charades content must live in a separate future schema and must not enter the classic question pool.

## 9. Arabic letter policy

Supported board letters:

`ا ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي`

Validation pipeline:

1. Unicode-normalize text to NFC.
2. Trim and collapse whitespace.
3. Remove Arabic diacritics and tatweel for comparison only.
4. Normalize `أ إ آ ٱ` to the letter key `ا` for matching.
5. For the letter check only, optionally remove one leading definite article `ال` when `acceptDefiniteArticle` is enabled.
6. Compare the first lexical letter of every accepted answer with `targetLetter`.
7. `ى/ي` and `ة/ه` similarity may be shown to the host as a suggestion but must not cause automatic acceptance.
8. Preserve the original spelling for display; normalized forms are never shown as the official answer.
9. If accepted variants begin with different target letters, split or reject the question.
10. The human host remains the final judge during play.

Examples:

| Target | Canonical | Accepted variant | Result |
|---|---|---|---|
| ج | `جذر` | `الجذر` | Valid when optional article removal is enabled |
| ق | `القاهرة` | `قاهرة` | Valid after article removal |
| ا | `أورانوس` | `اورانوس` | Valid after hamza normalization |
| ك | `الكلب` | `كلب` | Valid after article removal |
| س | `سيارة` | `مركبة` | Reject as a same-question accepted variant because the starting letter changes |

## 10. Quality and source rules

Every playable question must pass all of these:

- One clear, factually correct answer.
- Prompt does not leak the answer or depend on spelling tricks.
- All accepted answers satisfy the target-letter policy.
- Prompt length target: 20–220 Arabic characters.
- Canonical answer target: 1–60 characters.
- No multiple-choice or true/false cards in the classic mode.
- No “current,” “latest,” “today,” or unstable superlative without explicit temporal metadata.
- At least one reliable factual source for every fact question.
- Two-source or primary-source review for dated sports/local facts, religious content, disputed claims, and hard questions.
- Religious questions use primary religious sources and receive a qualified human review; generated interpretation is not accepted as authority.
- Entertainment questions avoid verbatim lyrics, scripts, long quotes, and copied trivia wording.
- Image questions use a local asset ID, descriptive Arabic alt text, rights/license record, and no hotlink.
- Exact duplicates are rejected globally after Arabic normalization.
- Near duplicates are flagged for human review using prompt and answer similarity.
- Repeated canonical answers within the same category/letter are limited and reported.
- Explanations are concise and do not introduce unsupported facts.
- Model-assisted content records model/version and remains `draft` until both fact and Arabic-language review are complete.

## 11. Coverage and readiness

Raw question count is not readiness. Generate a matrix for:

`categoryId × targetLetter × difficulty × status`

Recommended milestones:

### Pilot

- 280 approved questions total.
- Minimum 10 approved questions for each of the 28 supported letters across the combined pilot pack.
- At least 8 broad, stable categories represented.
- Used to test question length, letter policy, host adjudication, and repetition.

### First playable category packs

- A category is `playable_standalone` only when every supported letter has at least 8 approved questions in that category: 224 approved questions minimum.
- A category may be `playable_combined_only` when a selected multi-category pack provides at least 8 approved questions for every generated board letter.
- Board generation must consult approved inventory before choosing letters.

### Launch bank

- Minimum 1,120 approved questions: 40 per supported letter across enabled launch packs.
- No letter may contribute more than 1.5× the median letter inventory without an explicit balancing reason.
- Rare letters must not be silently excluded; use difficulty and board-frequency configuration transparently.

### Long-term catalog

- Import all 62 categories immediately, but activate them only as their bank and rights status become ready.
- Do not fill all categories simultaneously with low-quality generated content.

## 12. Recommended production waves

### Wave 0 — Import categories and covers

1. Parse both canonical Tahadani files.
2. Assert manifest hash and mapping hash match the audited values above.
3. Assert exactly 62 contiguous category indices and 62 mapping rows.
4. Copy the mapped source image to its category-specific original destination.
5. Hash source and destination; fail on any mismatch.
6. Record dimensions and duplicate-byte groups.
7. Create 320px and 640px web derivatives.
8. Set every cover to unverified/non-publishable pending rights review.

### Wave 1 — Schema and validator

1. Create JSON Schema for categories and questions.
2. Implement Arabic normalization as a pure function with unit tests.
3. Implement letter, duplicate, source, temporal, media, and coverage validation.
4. Create fixtures for every supported letter and known normalization edge case.
5. Produce empty coverage/readiness reports successfully.

### Wave 2 — Reviewed pilot

1. Select broad text-compatible categories; avoid media-dependent and charades categories.
2. Draft 280 questions with balanced letters and difficulties.
3. Run automated validation.
4. Fact-review and Arabic-language-review every item.
5. Playtest at least three complete matches and record rejected/ambiguous questions.

### Wave 3 — Launch scale

1. Correct pilot findings before scaling.
2. Reach 1,120 approved questions.
3. Re-run global duplicate and coverage checks.
4. Test category-selection combinations against board generation.
5. Freeze a versioned bank release with a content hash.

### Wave 4 — Sensitive, dated, and media packs

- Add dated sports/local categories with expiry/reverification workflows.
- Add religious categories only after specialist review.
- Replace or clear category covers for production.
- Build licensed question-specific media for image categories.
- Keep charades for a separately specified game mode.

## 13. Import acceptance checks

The category/image import is complete only when:

- `categories.json` contains exactly 62 unique IDs and contiguous legacy indices 1–62.
- Display name, slug, source mode, and source policy match Tahadani manifest v2.
- Exactly 62 category-specific original files exist.
- All 62 destination hashes equal their mapped source hashes.
- All originals are square PNGs with the audited dimensions.
- Categories 1 and 59 are reported as duplicate bytes, not treated as an error.
- No unrelated Tahadani image or archive was copied.
- No absolute source path is used by the runtime application.
- Each cover has Arabic alt text, origin metadata, and `rightsStatus`.
- No copied cover is marked publishable without separate evidence.
- Optimized derivatives preserve aspect ratio and do not upscale.

## 14. Question-bank acceptance checks

- JSON Schema validation passes for every line.
- Every approved answer and accepted variant passes the target-letter rule.
- Every approved fact has the required sources and review record.
- No exact duplicates exist across approved content.
- Near-duplicate report has no unresolved high-confidence matches.
- Coverage report meets the current milestone and contains no hidden zero-letter cells.
- Category readiness is computed from approved—not draft—questions.
- Dated content has `verifiedAt` and `validUntil` or an explicit recheck policy.
- Image content has a local media record, alt text, rights status, and integrity hash.
- Religious content has the required specialist review.
- A versioned release manifest records counts, category/letter coverage, and SHA-256 of the approved bank.
- The game can simulate at least 1,000 seeded board setups without selecting a letter that lacks the configured question reserve.

## 15. Required tests

At minimum:

- Manifest version/hash drift.
- Missing or extra category mapping.
- Missing source image and destination hash mismatch.
- Duplicate source image used by categories 1 and 59.
- Arabic diacritic/tatweel removal.
- Hamza forms mapped to `ا`.
- Optional definite article handling.
- Accepted-answer variant with a conflicting first letter.
- Empty or malformed prompt/answer.
- Exact and near duplicates across categories.
- Missing, malformed, or disallowed source URL.
- Expired dated fact.
- Media question without asset, alt text, hash, or rights status.
- Draft question excluded from runtime inventory.
- Insufficient per-letter reserve prevents category/board activation.
- Deterministic coverage report and release hash.

## 16. Agent handoff checklist

The future question-bank agent must:

1. Inspect the current target worktree before writing.
2. Recalculate and compare the five audited Tahadani source hashes.
3. Treat Tahadani as read-only.
4. Implement Wave 0 and Wave 1 before generating questions.
5. Stop if the category manifest or mapping hash changed; report the drift instead of silently importing a new catalog.
6. Keep question generation and human approval as separate statuses.
7. Return files changed, copied asset count/bytes, tests run, coverage totals, source-review status, and remaining rights risks.

The agent must not claim completion merely because files were generated. Completion means the relevant acceptance checks above pass and the resulting content is usable by the letter-based game.

