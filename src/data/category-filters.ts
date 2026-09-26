import { type CategoryCover } from "./category-catalog";
import { type QuestionTypeCounts, type QuestionTypeKey } from "../features/game/runtime/question-type-counts";
import {
  type ParentTopicId,
  topicForKnownNormalizedLabel,
  topicForKnownSourceCategoryId,
} from "./category-topic-taxonomy";

export type CategoryTopicId = ParentTopicId;

export type CategoryTopic = {
  id: CategoryTopicId;
  labelAr: string;
  categoryIds: readonly string[];
};

/** Browse-only grouping for the imported catalog; it never changes match semantics. */
export const categoryTopics: readonly CategoryTopic[] = [
  { id: "sports", labelAr: "رياضة", categoryIds: ["goals-2026", "huroof-063", "huroof-064", "huroof-065", "huroof-066", "huroof-067", "huroof-068", "huroof-069", "huroof-070", "huroof-071", "huroof-072", "tahadani-002", "tahadani-021", "tahadani-022", "tahadani-023", "tahadani-024", "tahadani-025", "tahadani-048", "tahadani-049", "tahadani-050", "tahadani-052", "tahadani-054", "tahadani-055", "tahadani-060", "tahadani-061", "tahadani-062"] },
  { id: "geography", labelAr: "جغرافيا ودول", categoryIds: ["huroof-100", "tahadani-001", "tahadani-020", "tahadani-044", "tahadani-045", "tahadani-046", "tahadani-047", "tahadani-059"] },
  { id: "screen", labelAr: "أفلام ومسلسلات ومشاهير", categoryIds: ["huroof-079", "huroof-080", "huroof-081", "huroof-082", "huroof-083", "huroof-084", "huroof-085", "huroof-086", "huroof-087", "huroof-088", "huroof-089", "huroof-090", "huroof-091", "tahadani-004", "tahadani-005", "tahadani-010", "tahadani-018", "tahadani-026", "tahadani-027", "tahadani-028", "tahadani-029", "tahadani-030"] },
  { id: "music", labelAr: "أغاني وموسيقى", categoryIds: ["huroof-092", "huroof-093", "tahadani-017", "tahadani-031", "tahadani-032", "tahadani-033", "tahadani-034", "tahadani-035"] },
  { id: "animation", labelAr: "أنمي وكرتون", categoryIds: ["huroof-078", "tahadani-019", "tahadani-036", "tahadani-037", "tahadani-038", "tahadani-039"] },
  { id: "games", labelAr: "ألعاب", categoryIds: ["huroof-073", "huroof-074", "huroof-075", "huroof-076", "huroof-077", "tahadani-040", "tahadani-041", "tahadani-042", "tahadani-043"] },
  { id: "science", labelAr: "علوم وطبيعة", categoryIds: ["huroof-097", "huroof-098", "huroof-099", "tahadani-003", "tahadani-007", "tahadani-008", "tahadani-016"] },
  { id: "religion", labelAr: "دين", categoryIds: ["huroof-094", "huroof-095", "huroof-096", "tahadani-056", "tahadani-057"] },
  { id: "culture", labelAr: "ثقافة وألغاز", categoryIds: ["tahadani-006", "tahadani-011", "tahadani-012", "tahadani-013", "tahadani-014", "tahadani-015"] },
  { id: "restaurants", labelAr: "طعام ومطاعم", categoryIds: ["tahadani-058"] },
  { id: "digital", labelAr: "إنترنت وصنّاع محتوى", categoryIds: [] },
  { id: "lifestyle", labelAr: "أسلوب حياة", categoryIds: ["tahadani-051"] },
  { id: "history", labelAr: "تاريخ وتراث", categoryIds: ["tahadani-009"] },
  { id: "literature", labelAr: "لغة وأدب", categoryIds: ["tahadani-053"] },
  // Dynamic Firebase catalogues have no parent/group field. This visible fallback
  // ensures every newly released category remains browseable until it gains a stable mapping.
  { id: "other", labelAr: "موضوعات أخرى", categoryIds: [] },
];

export const normalizeCategoryFilterText = (value: string) =>
  value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");

const explicitTopicByCategoryId = new Map(
  categoryTopics.flatMap((topic) => topic.categoryIds.map((id) => [id, topic.id] as const)),
);

const labelTopicHints: ReadonlyArray<readonly [CategoryTopicId, readonly string[]]> = [
  // Specific overlapping topics must precede their broad screen/game counterparts.
  ["animation", ["انمي", "كرتون", "anime", "naruto", "one piece", "pokemon", "dragon ball", "كونان"]],
  ["sports", ["رياضة", "كرة", "دوري", "لاعب", "منتخب", "nba", "wwe", "ufc", "tennis", "formula", "olympic", "الاولمبية", "ملاكمة", "تنس", "ريال", "برشلونة", "lineup"]],
  ["music", ["اغاني", "موسيقى", "نشيد", "ام كلثوم", "عبدالكريم", "song"]],
  ["religion", ["اسلام", "قران", "نبي", "صحابة", "السيرة"]],
  ["geography", ["جغرافيا", "دول", "عواصم", "اعلام", "عملات", "خريطة"]],
  ["screen", ["افلام", "فيلم", "مسلسلات", "مسلسل", "مشاهير", "ممثل", "سينما", "هوليوود", "marvel", "dc comics", "harry potter", "friends", "breaking bad", "game of thrones", "طاش", "باب الحارة", "ديزني", "بيكسار"]],
  ["games", ["لعبة", "العاب", "pubg", "call of duty", "minecraft", "fortnite", "playstation", "nintendo", "video games"]],
  ["science", ["علوم", "تكنولوجيا", "حيوانات", "سيارات", "فضاء", "فلك", "طب", "جسم", "طبيعة"]],
  ["restaurants", ["مطاعم", "طعام", "اكل"]],
  ["culture", ["معلومات عامة", "تاريخ", "لغز", "الغاز", "امثال", "غطاوي", "شعر", "خمن", "شنو هذا", "جزء مفقود", "ثقافة"]],
];

const normalizedWords = (value: string) =>
  normalizeCategoryFilterText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const labelIncludesHint = (labelWords: readonly string[], hint: string) => {
  const hintWords = normalizedWords(hint);
  if (!hintWords.length) return false;
  return labelWords.join(" ").includes(hintWords.join(" ")) &&
    labelWords.some((word, index) =>
      hintWords.every((hintWord, hintIndex) => labelWords[index + hintIndex] === hintWord),
    );
};

/**
 * Resolve a browse-only parent for every category displayed by setup. Explicit
 * IDs preserve reviewed assignments; label hints only classify clear future
 * catalogue entries, and everything else stays visible in the fallback group.
 */
export function categoryTopicIdForCategory(
  category: Pick<CategoryCover, "id" | "displayNameAr">,
): CategoryTopicId {
  const explicitTopic = explicitTopicByCategoryId.get(category.id);
  if (explicitTopic) return explicitTopic;

  const sourceTopic = topicForKnownSourceCategoryId(category.id);
  if (sourceTopic) return sourceTopic;

  const normalizedLabel = normalizeCategoryFilterText(category.displayNameAr);
  const knownLabelTopic = topicForKnownNormalizedLabel(normalizedLabel);
  if (knownLabelTopic) return knownLabelTopic;

  const labelWords = normalizedWords(normalizedLabel);
  return labelTopicHints.find(([, hints]) =>
    hints.some((hint) => labelIncludesHint(labelWords, hint)),
  )?.[0] ?? "other";
}

export type CategoryFilter = {
  query: string;
  selectedIds: readonly string[];
  selectedOnly: boolean;
  topicId: CategoryTopicId | "all";
  questionType?: CategoryQuestionType | "all";
  questionTypeCountsByCategory?: ReadonlyMap<string, CategoryQuestionTypeCounts>;
};

export type CategoryQuestionType = QuestionTypeKey;
export type CategoryQuestionTypeCounts = QuestionTypeCounts;

export const categoryQuestionTypes: ReadonlyArray<{ id: CategoryQuestionType; labelAr: string }> = [
  { id: "text", labelAr: "أسئلة نصية" },
  { id: "image", labelAr: "صور" },
  { id: "video", labelAr: "فيديو" },
  { id: "audio", labelAr: "صوت" },
  { id: "interactive", labelAr: "تحديات تفاعلية" },
  { id: "other", labelAr: "أنواع أخرى" },
];

export function filterCategories(
  categories: readonly CategoryCover[],
  { query, selectedIds, selectedOnly, topicId, questionType = "all", questionTypeCountsByCategory }: CategoryFilter,
) {
  const normalizedQuery = normalizeCategoryFilterText(query);
  const selected = new Set(selectedIds);
  return categories.filter((category) => {
    if (topicId !== "all" && categoryTopicIdForCategory(category) !== topicId) return false;
    if (selectedOnly && !selected.has(category.id)) return false;
    if (questionType !== "all" && !((questionTypeCountsByCategory?.get(category.id)?.[questionType] ?? 0) > 0)) return false;
    return !normalizedQuery || normalizeCategoryFilterText(
      `${category.displayNameAr} ${category.id}`,
    ).includes(normalizedQuery);
  });
}
