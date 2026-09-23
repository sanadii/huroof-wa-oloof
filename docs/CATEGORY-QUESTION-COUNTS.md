# Category question counts and generation backlog

Inventory captured: 2026-09-11T15:03:41Z; report generated: 2026-09-11T15:05:10Z. Source: local app `/api/question-inventory` (SQLite import plus supported file sources).

This report includes **all 88 inventory categories**, including categories hidden from game selection. Counts describe the current local playable inventory, **not production approval**. The database/review workflow remains separate.

## Summary

- Categories: **88**.
- Usable question references after runtime validation/deduplication: **12,603**.
- Held source records/references: **429**. These can include duplicates or unsupported/missing media; they are not all distinct extra questions.
- Huroof: **52 visible**, **36 hidden** because they have zero usable letter-based questions.
- Category game: **83 visible**, **5 hidden** under the existing eligibility rule.

## How to use these numbers

- **Usable** is the number of questions currently accepted by the local runtime for that category.
- **Huroof** is the subset with classic modality and a target Arabic letter. A category with zero is hidden in Huroof even if it has hundreds of questions for other modes.
- Huroof category visibility means it can contribute questions; it does not guarantee that category alone can fill the complete board. Final combined letter coverage is validated when creating/starting the match.
- **Category eligible** uses the runtime requirement of at least 14 distinct answer concepts, not merely 14 rows. The inventory endpoint does not expose distinct-concept counts, so an exact generation deficit cannot be calculated from row counts alone.
- **Held** records need review, deduplication, supported formatting or missing media. Inspect these before generating replacements.
- IDs are stable generation/import keys. Use the display name and ID together; some source labels repeat across separate categories.

## Priority: unavailable in category mode

| Category ID | Category | Usable | Held | Action |
|---|---|---:|---:|---|
| tahadani-016 | حيوانات / ولا كلمة | 0 | 60 | Review held charades/source records first; category mode needs at least 14 distinct usable answer concepts. |
| tahadani-017 | أغاني عربية / ولا كلمة | 0 | 60 | Review held charades/source records first; category mode needs at least 14 distinct usable answer concepts. |
| tahadani-018 | مشاهير عرب / ولا كلمة | 0 | 60 | Review held charades/source records first; category mode needs at least 14 distinct usable answer concepts. |
| tahadani-019 | كرتون / ولا كلمة | 0 | 60 | Review held charades/source records first; category mode needs at least 14 distinct usable answer concepts. |
| tahadani-020 | دول / ولا كلمة | 0 | 60 | Review held charades/source records first; category mode needs at least 14 distinct usable answer concepts. |

## Huroof generation list: zero usable letter questions

Create or repair classic Arabic questions with valid target letters and varied answer concepts. Spread coverage across letters; do not create filler or assume a raw count guarantees a playable board. Retain the separate game mode of existing image/video/charades content.

| Category ID | Category | Existing usable questions (all supported modes) | Huroof questions | Held |
|---|---|---:|---:|---:|
| goals-2026 | من سجل الهدف؟ | 99 | 0 | 0 |
| huroof-063 | كرة السلة وNBA | 300 | 0 | 0 |
| huroof-064 | دوري أبطال أوروبا | 300 | 0 | 0 |
| huroof-065 | الدوري الإنجليزي | 300 | 0 | 0 |
| huroof-066 | الدوري الإسباني | 300 | 0 | 0 |
| huroof-067 | الدوري السعودي | 300 | 0 | 0 |
| huroof-070 | الألعاب الأولمبية | 300 | 0 | 0 |
| huroof-071 | WWE | 300 | 0 | 0 |
| huroof-072 | الملاكمة | 300 | 0 | 0 |
| huroof-073 | ألعاب الفيديو | 300 | 0 | 0 |
| huroof-097 | علوم | 300 | 0 | 0 |
| huroof-098 | فضاء وفلك | 300 | 0 | 0 |
| huroof-099 | طب وجسم الإنسان | 300 | 0 | 0 |
| tahadani-001 | من أنا / دول | 300 | 0 | 0 |
| tahadani-002 | من أنا / لاعبين كرة قدم | 300 | 0 | 0 |
| tahadani-003 | من أنا / حيوانات | 300 | 0 | 0 |
| tahadani-005 | من أنا / ممثلين | 300 | 0 | 0 |
| tahadani-009 | تاريخ | 300 | 0 | 0 |
| tahadani-010 | منو المشهور | 300 | 0 | 0 |
| tahadani-011 | خمن الصورة | 111 | 0 | 69 |
| tahadani-012 | شنو هذا؟ | 60 | 0 | 0 |
| tahadani-014 | الجزء المفقود | 60 | 0 | 0 |
| tahadani-016 | حيوانات / ولا كلمة | 0 | 0 | 60 |
| tahadani-017 | أغاني عربية / ولا كلمة | 0 | 0 | 60 |
| tahadani-018 | مشاهير عرب / ولا كلمة | 0 | 0 | 60 |
| tahadani-019 | كرتون / ولا كلمة | 0 | 0 | 60 |
| tahadani-020 | دول / ولا كلمة | 0 | 0 | 60 |
| tahadani-025 | من هو اللاعب | 300 | 0 | 0 |
| tahadani-028 | أفلام كلاسيك | 300 | 0 | 0 |
| tahadani-029 | أفلام رعب | 300 | 0 | 0 |
| tahadani-030 | Game Of Thrones | 300 | 0 | 0 |
| tahadani-044 | أعلام | 300 | 0 | 0 |
| tahadani-049 | تنس | 300 | 0 | 0 |
| tahadani-050 | Formula 1 | 300 | 0 | 0 |
| tahadani-059 | توقعني (دول) | 300 | 0 | 0 |
| tahadani-061 | تشكيلات | 60 | 0 | 0 |

## All categories and related question counts

| # | Category ID | Display category | Source label | Usable | Huroof subset | Held | Category eligible | Huroof visible |
|---:|---|---|---|---:|---:|---:|---|---|
| 1 | goals-2026 | من سجل الهدف؟ | من سجل الهدف؟ | 99 | 0 | 0 | Yes | No |
| 2 | huroof-063 | كرة السلة وNBA | كرة السلة وNBA | 300 | 0 | 0 | Yes | No |
| 3 | huroof-064 | دوري أبطال أوروبا | دوري أبطال أوروبا | 300 | 0 | 0 | Yes | No |
| 4 | huroof-065 | الدوري الإنجليزي | الدوري الإنجليزي | 300 | 0 | 0 | Yes | No |
| 5 | huroof-066 | الدوري الإسباني | الدوري الإسباني | 300 | 0 | 0 | Yes | No |
| 6 | huroof-067 | الدوري السعودي | الدوري السعودي | 300 | 0 | 0 | Yes | No |
| 7 | huroof-068 | منتخب الكويت | منتخب الكويت | 60 | 38 | 0 | Yes | Yes |
| 8 | huroof-069 | كرة القدم الكويتية | كرة القدم الكويتية | 60 | 15 | 0 | Yes | Yes |
| 9 | huroof-070 | الألعاب الأولمبية | الألعاب الأولمبية | 300 | 0 | 0 | Yes | No |
| 10 | huroof-071 | WWE | WWE | 300 | 0 | 0 | Yes | No |
| 11 | huroof-072 | الملاكمة | الملاكمة | 300 | 0 | 0 | Yes | No |
| 12 | huroof-073 | ألعاب الفيديو | ألعاب الفيديو | 300 | 0 | 0 | Yes | No |
| 13 | huroof-076 | Fortnite | Fortnite | 60 | 54 | 0 | Yes | Yes |
| 14 | huroof-088 | مسلسلات خليجية | مسلسلات خليجية | 60 | 56 | 0 | Yes | Yes |
| 15 | huroof-089 | مسلسلات كويتية | مسلسلات كويتية | 60 | 57 | 0 | Yes | Yes |
| 16 | huroof-090 | مشاهير الكويت | مشاهير الكويت | 60 | 54 | 0 | Yes | Yes |
| 17 | huroof-091 | مشاهير العرب | مشاهير العرب | 60 | 58 | 0 | Yes | Yes |
| 18 | huroof-092 | أغاني خليجية | أغاني خليجية | 30 | 30 | 0 | Yes | Yes |
| 19 | huroof-093 | أغاني كويتية | أغاني كويتية | 30 | 29 | 0 | Yes | Yes |
| 20 | huroof-094 | السيرة النبوية | السيرة النبوية | 60 | 54 | 0 | Yes | Yes |
| 21 | huroof-095 | الصحابة | الصحابة | 60 | 55 | 0 | Yes | Yes |
| 22 | huroof-096 | الحضارة الإسلامية | الحضارة الإسلامية | 60 | 32 | 0 | Yes | Yes |
| 23 | huroof-097 | علوم | علوم | 300 | 0 | 0 | Yes | No |
| 24 | huroof-098 | فضاء وفلك | فضاء وفلك | 300 | 0 | 0 | Yes | No |
| 25 | huroof-099 | طب وجسم الإنسان | طب وجسم الإنسان | 300 | 0 | 0 | Yes | No |
| 26 | huroof-100 | جغرافيا العالم | جغرافيا العالم | 330 | 20 | 0 | Yes | Yes |
| 27 | tahadani-001 | من أنا / دول | من أنا - دول | 300 | 0 | 0 | Yes | No |
| 28 | tahadani-002 | من أنا / لاعبين كرة قدم | من أنا - لاعبين كرة قدم | 300 | 0 | 0 | Yes | No |
| 29 | tahadani-003 | من أنا / حيوانات | من أنا - حيوانات | 300 | 0 | 0 | Yes | No |
| 30 | tahadani-004 | من أنا / مسلسلات عربيه | من أنا - مسلسلات عربية | 60 | 46 | 0 | Yes | Yes |
| 31 | tahadani-005 | من أنا / ممثلين | من أنا - ممثلين | 300 | 0 | 0 | Yes | No |
| 32 | tahadani-006 | معلومات عامة | في المعلومات العامة | 494 | 194 | 0 | Yes | Yes |
| 33 | tahadani-007 | عالم الحيوان | في عالم الحيوان | 55 | 37 | 0 | Yes | Yes |
| 34 | tahadani-008 | تكنولوجيا | في التكنولوجيا والعلوم | 43 | 28 | 0 | Yes | Yes |
| 35 | tahadani-009 | تاريخ | تاريخ | 300 | 0 | 0 | Yes | No |
| 36 | tahadani-010 | منو المشهور | منو المشهور | 300 | 0 | 0 | Yes | No |
| 37 | tahadani-011 | خمن الصورة | خمن الصورة | 111 | 0 | 69 | Yes | No |
| 38 | tahadani-012 | شنو هذا؟ | شنو هذا | 60 | 0 | 0 | Yes | No |
| 39 | tahadani-013 | ألغاز | لغز لفظي | 73 | 25 | 60 | Yes | Yes |
| 40 | tahadani-014 | الجزء المفقود | الجزء المفقود | 60 | 0 | 0 | Yes | No |
| 41 | tahadani-015 | أمثال وغطاوي | أمثال وغطاوي | 60 | 43 | 0 | Yes | Yes |
| 42 | tahadani-016 | حيوانات / ولا كلمة | حيوانات - ولا كلمة | 0 | 0 | 60 | No | No |
| 43 | tahadani-017 | أغاني عربية / ولا كلمة | أغاني عربية - ولا كلمة | 0 | 0 | 60 | No | No |
| 44 | tahadani-018 | مشاهير عرب / ولا كلمة | مشاهير عرب - ولا كلمة | 0 | 0 | 60 | No | No |
| 45 | tahadani-019 | كرتون / ولا كلمة | كرتون - ولا كلمة | 0 | 0 | 60 | No | No |
| 46 | tahadani-020 | دول / ولا كلمة | دول - ولا كلمة | 0 | 0 | 60 | No | No |
| 47 | tahadani-021 | ريال مدريد | ريال مدريد | 60 | 57 | 0 | Yes | Yes |
| 48 | tahadani-022 | برشلونة | برشلونة | 60 | 59 | 0 | Yes | Yes |
| 49 | tahadani-023 | كأس العالم | كأس العالم | 60 | 52 | 0 | Yes | Yes |
| 50 | tahadani-024 | ميسي وكرستيانو | ميسي وكرستيانو | 60 | 53 | 0 | Yes | Yes |
| 51 | tahadani-025 | من هو اللاعب | من هو اللاعب | 300 | 0 | 0 | Yes | No |
| 52 | tahadani-026 | طاش ماطاش | طاش ما طاش | 30 | 21 | 0 | Yes | Yes |
| 53 | tahadani-027 | باب الحارة | باب الحارة | 60 | 58 | 0 | Yes | Yes |
| 54 | tahadani-028 | أفلام كلاسيك | أفلام كلاسيك | 300 | 0 | 0 | Yes | No |
| 55 | tahadani-029 | أفلام رعب | أفلام رعب | 300 | 0 | 0 | Yes | No |
| 56 | tahadani-030 | Game Of Thrones | Game Of Thrones | 300 | 0 | 0 | Yes | No |
| 57 | tahadani-031 | أغاني الزمن الجميل | الزمن الجميل | 60 | 47 | 0 | Yes | Yes |
| 58 | tahadani-032 | أم كلثوم | أم كلثوم | 60 | 53 | 0 | Yes | Yes |
| 59 | tahadani-033 | أغاني وطنية | نشيد وطني | 60 | 50 | 0 | Yes | Yes |
| 60 | tahadani-034 | أغاني أجنبية | أغاني أجنبية | 60 | 60 | 0 | Yes | Yes |
| 61 | tahadani-035 | عبدالكريم عبدالقادر | عبدالكريم عبدالقادر | 30 | 23 | 0 | Yes | Yes |
| 62 | tahadani-036 | One Piece | One Piece | 60 | 58 | 0 | Yes | Yes |
| 63 | tahadani-037 | Attack on Titan | Attack on Titan | 60 | 55 | 0 | Yes | Yes |
| 64 | tahadani-038 | Naruto | Naruto | 60 | 60 | 0 | Yes | Yes |
| 65 | tahadani-039 | كونان | المحقق كونان | 60 | 58 | 0 | Yes | Yes |
| 66 | tahadani-040 | لعبة PUBG | PUBG | 60 | 49 | 0 | Yes | Yes |
| 67 | tahadani-041 | Call of Duty | Call Of Duty | 60 | 57 | 0 | Yes | Yes |
| 68 | tahadani-042 | Minecraft | Minecraft | 60 | 26 | 0 | Yes | Yes |
| 69 | tahadani-043 | العاب الطفولة | ألعاب الطفولة | 60 | 23 | 0 | Yes | Yes |
| 70 | tahadani-044 | أعلام | أعلام | 300 | 0 | 0 | Yes | No |
| 71 | tahadani-045 | عواصم | في الجغرافيا | 303 | 10 | 0 | Yes | Yes |
| 72 | tahadani-046 | دول و عواصم | في الجغرافيا | 309 | 8 | 0 | Yes | Yes |
| 73 | tahadani-047 | عملات | في العملات | 309 | 9 | 0 | Yes | Yes |
| 74 | tahadani-048 | الفنون القتالية | UFC والفنون القتالية | 60 | 51 | 0 | Yes | Yes |
| 75 | tahadani-049 | تنس | تنس | 300 | 0 | 0 | Yes | No |
| 76 | tahadani-050 | Formula 1 | Formula One | 300 | 0 | 0 | Yes | No |
| 77 | tahadani-051 | سيارات | في عالم السيارات | 67 | 56 | 0 | Yes | Yes |
| 78 | tahadani-052 | منوعات كرة قدم | منوعات كرة قدم | 60 | 40 | 0 | Yes | Yes |
| 79 | tahadani-053 | منوعات شعرية | منوعات شعرية | 60 | 29 | 0 | Yes | Yes |
| 80 | tahadani-054 | كرة قدم عالمية | كرة قدم عالمية | 60 | 48 | 0 | Yes | Yes |
| 81 | tahadani-055 | كرة قدم ايطالية | الكرة الإيطالية | 60 | 57 | 0 | Yes | Yes |
| 82 | tahadani-056 | قصص الأنبياء | قصص الأنبياء | 60 | 40 | 0 | Yes | Yes |
| 83 | tahadani-057 | القرآن الكريم | القرآن الكريم | 60 | 40 | 0 | Yes | Yes |
| 84 | tahadani-058 | مطاعم الكويت | مطاعم الكويت | 30 | 14 | 0 | Yes | Yes |
| 85 | tahadani-059 | توقعني (دول) | من أنا جغرافيا | 300 | 0 | 0 | Yes | No |
| 86 | tahadani-060 | مسيرة لاعب | مسيرة لاعب | 60 | 60 | 0 | Yes | Yes |
| 87 | tahadani-061 | تشكيلات | LineUp | 60 | 0 | 0 | Yes | No |
| 88 | tahadani-062 | كأس العالم 2026 | كأس العالم 2026 | 60 | 31 | 0 | Yes | Yes |

## Generation checklist

1. Choose the stable category ID from the tables.
2. Review held records and resolve duplicates/media issues before replacing content.
3. For Huroof, supply valid Arabic target letters and diversify letter coverage and answer concepts.
4. For category mode, meet the existing distinct-answer-concept requirement; raw row totals alone do not establish eligibility.
5. Supply factual sources and complete the existing review/approval workflow. New questions should remain drafts until reviewed.
6. Rebuild the local inventory and regenerate this report after import. Recheck combined match selection before publishing.

Inventory evidence SHA-256: `b738ba0fbbd9679c4dfcae2213ff9ac76c5f9d3a21633ec1c4340366c2bbcd35`.
