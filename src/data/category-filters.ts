import { type CategoryCover } from "./category-catalog";

export type CategoryTopicId =
  | "sports"
  | "geography"
  | "screen"
  | "music"
  | "animation"
  | "games"
  | "science"
  | "religion"
  | "culture"
  | "restaurants";

export type CategoryTopic = {
  id: CategoryTopicId;
  labelAr: string;
  categoryIds: readonly string[];
};

/** Browse-only grouping for the imported catalog; it never changes match semantics. */
export const categoryTopics: readonly CategoryTopic[] = [
  { id: "sports", labelAr: "رياضة", categoryIds: ["tahadani-002", "tahadani-021", "tahadani-022", "tahadani-023", "tahadani-024", "tahadani-025", "tahadani-048", "tahadani-049", "tahadani-050", "tahadani-052", "tahadani-054", "tahadani-055", "tahadani-060", "tahadani-061", "tahadani-062"] },
  { id: "geography", labelAr: "جغرافيا ودول", categoryIds: ["tahadani-001", "tahadani-020", "tahadani-044", "tahadani-045", "tahadani-046", "tahadani-047", "tahadani-059"] },
  { id: "screen", labelAr: "أفلام ومسلسلات ومشاهير", categoryIds: ["tahadani-004", "tahadani-005", "tahadani-010", "tahadani-018", "tahadani-026", "tahadani-027", "tahadani-028", "tahadani-029", "tahadani-030"] },
  { id: "music", labelAr: "أغاني وموسيقى", categoryIds: ["tahadani-017", "tahadani-031", "tahadani-032", "tahadani-033", "tahadani-034", "tahadani-035"] },
  { id: "animation", labelAr: "أنمي وكرتون", categoryIds: ["tahadani-019", "tahadani-036", "tahadani-037", "tahadani-038", "tahadani-039"] },
  { id: "games", labelAr: "ألعاب", categoryIds: ["tahadani-040", "tahadani-041", "tahadani-042", "tahadani-043"] },
  { id: "science", labelAr: "علوم وطبيعة", categoryIds: ["tahadani-003", "tahadani-007", "tahadani-008", "tahadani-016", "tahadani-051"] },
  { id: "religion", labelAr: "دين", categoryIds: ["tahadani-056", "tahadani-057"] },
  { id: "culture", labelAr: "ثقافة وألغاز", categoryIds: ["tahadani-006", "tahadani-009", "tahadani-011", "tahadani-012", "tahadani-013", "tahadani-014", "tahadani-015", "tahadani-053"] },
  { id: "restaurants", labelAr: "مطاعم", categoryIds: ["tahadani-058"] },
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

export type CategoryFilter = {
  query: string;
  selectedIds: readonly string[];
  selectedOnly: boolean;
  topicId: CategoryTopicId | "all";
};

export function filterCategories(
  categories: readonly CategoryCover[],
  { query, selectedIds, selectedOnly, topicId }: CategoryFilter,
) {
  const normalizedQuery = normalizeCategoryFilterText(query);
  const topicIds =
    topicId === "all"
      ? undefined
      : new Set(categoryTopics.find((topic) => topic.id === topicId)?.categoryIds);
  const selected = new Set(selectedIds);
  return categories.filter((category) => {
    if (topicIds && !topicIds.has(category.id)) return false;
    if (selectedOnly && !selected.has(category.id)) return false;
    return !normalizedQuery || normalizeCategoryFilterText(
      `${category.displayNameAr} ${category.id}`,
    ).includes(normalizedQuery);
  });
}
