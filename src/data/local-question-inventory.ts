import { categoryCatalog, type CategoryCover } from "./category-catalog";
import { normalizeCategoryFilterText } from "./category-filters";
import publicCategoryInventory from "./category-inventory.public.json";
import tahadaniImages from "./tahadani-image-catalog.public.json";
import tahadaniGamesCategoryCovers from "./tahadani-games-category-covers.public.json";

const importedCovers = new Map(
  tahadaniImages.covers.map((cover) => [normalizeCategoryFilterText(cover.name), cover]),
);
// Equivalent topic names in the local inventory and the source image library.
const coverAliases = new Map([
  ["كرة القدم الكويتية", "الكرة الكويتية"],
  ["طب وجسم الإنسان", "طب"],
  ["جغرافيا العالم", "جغرافيا"],
].map(([label, name]) => [normalizeCategoryFilterText(label), normalizeCategoryFilterText(name)]));

const generatedCovers = new Map([
  ["PlayStation", "legacy/320/playstation.webp"],
  ["Nintendo", "legacy/320/nintendo.webp"],
  ["أفلام ديزني وبيكسار", "legacy/320/disney-pixar.webp"],
  ["DC Comics", "legacy/320/dc-comics.webp"],
  ["مسلسلات أجنبية", "legacy/320/foreign-series.webp"],
  ["أفلام هوليوود", "legacy/320/hollywood-films.webp"],
  ["أفلام عربية", "legacy/320/arabic-films.webp"],
  ["من سجل الهدف؟", "goals-2026.webp"],
  ["كرة السلة وNBA", "huroof-063.webp"],
  ["دوري أبطال أوروبا", "huroof-064.webp"],
  ["الدوري الإنجليزي", "huroof-065.webp"],
  ["الدوري الإسباني", "huroof-066.webp"],
  ["الدوري السعودي", "huroof-067.webp"],
  ["منتخب الكويت", "cover-generated-kuwait-team.png"],
  ["الألعاب الأولمبية", "huroof-070.webp"],
  ["WWE", "huroof-071.webp"],
  ["الملاكمة", "huroof-072.webp"],
  ["ألعاب الفيديو", "huroof-073.webp"],
  ["مسلسلات خليجية", "cover-generated-gulf-series.png"],
  ["مسلسلات كويتية", "cover-generated-kuwait-series.png"],
  ["مشاهير الكويت", "cover-generated-kuwait-celebrities.png"],
  ["مشاهير العرب", "cover-generated-arab-celebrities.png"],
  ["أغاني خليجية", "cover-generated-gulf-music.png"],
  ["أغاني كويتية", "cover-generated-kuwait-music.png"],
  ["السيرة النبوية", "cover-generated-prophetic-biography.png"],
  ["الصحابة", "cover-generated-companions.png"],
  ["الحضارة الإسلامية", "cover-generated-islamic-civilization.png"],
  ["فضاء وفلك", "huroof-098.webp"],
].map(([label, file]) => [normalizeCategoryFilterText(label), file]));

// New category art for exact live IDs whose imported covers lack reuse
// evidence. These generated assets have separate source/visual receipts.
const rightsReplacementCovers = new Set([
  "huroof-069",
  "huroof-097",
  "huroof-099",
  "huroof-100",
  "tahadani-001",
  "tahadani-003",
  "tahadani-006",
  "tahadani-007",
  "tahadani-008",
  "tahadani-009",
  "tahadani-010",
  "tahadani-013",
  "tahadani-015",
  "tahadani-025",
  "tahadani-028",
  "tahadani-029",
  "tahadani-043",
  "tahadani-044",
  "tahadani-045",
  "tahadani-047",
  "tahadani-049",
  "tahadani-051",
  "tahadani-052",
  "tahadani-053",
  "tahadani-games-067",
  "tahadani-games-069",
  "tahadani-games-073",
  "tahadani-games-196",
  "tahadani-games-219",
  "tahadani-games-272",
  "tahadani-games-277",
  "tahadani-games-280",
  "tahadani-games-455",
  "tahadani-games-458",
  "tahadani-games-523",
  "tahadani-games-551",
]);

// Reviewed exact/punctuation-equivalent topics can reuse already-publishable
// generated art. Bind both catalog labels so later content edits fail closed.
const exactGeneratedCoverReuseByLiveId = new Map<string, {
  sourceId: string;
  liveLabelAr: string;
  sourceLabelAr: string;
}>([
  ["tahadani-002", { sourceId: "tahadani-games-024", liveLabelAr: "من أنا - لاعبين كرة قدم", sourceLabelAr: "من أنا / لاعبين كرة قدم" }],
  ["tahadani-011", { sourceId: "tahadani-games-134", liveLabelAr: "خمن الصورة", sourceLabelAr: "خمن الصورة" }],
  ["tahadani-012", { sourceId: "tahadani-games-135", liveLabelAr: "شنو هذا", sourceLabelAr: "شنو هذا؟" }],
  ["tahadani-014", { sourceId: "tahadani-games-127", liveLabelAr: "الجزء المفقود", sourceLabelAr: "الجزء المفقود" }],
  ["tahadani-050", { sourceId: "tahadani-games-554", liveLabelAr: "Formula One", sourceLabelAr: "Formula 1" }],
  ["tahadani-055", { sourceId: "tahadani-games-194", liveLabelAr: "الكرة الإيطالية", sourceLabelAr: "كرة قدم ايطالية" }],
]);

type TahadaniGamesCategoryCover = {
  categoryId: string;
  normalizedNameAr: string;
  cover: {
    source: "existing_library" | "generated_review";
    web320: string;
    web640: string;
    publishable: boolean;
  } | null;
};

// Candidate catalog metadata is presentation-only. It does not activate categories
// or alter their question ownership/readiness.
const tahadaniGamesCoverByCategoryId = new Map(
  (tahadaniGamesCategoryCovers.categories as TahadaniGamesCategoryCover[])
    .filter((category) => category.cover !== null)
    .map((category) => [category.categoryId, category.cover!] as const),
);

const tahadaniGamesCategoryById = new Map(
  (tahadaniGamesCategoryCovers.categories as TahadaniGamesCategoryCover[])
    .map((category) => [category.categoryId, category] as const),
);

// Release and legacy inventories can use different IDs for the same topic.
// Match exact normalized labels as well; never use fuzzy topic substitution.
const tahadaniGamesCoverByName = new Map(
  (tahadaniGamesCategoryCovers.categories as TahadaniGamesCategoryCover[])
    .filter((category) => category.cover !== null)
    .map((category) => [normalizeCategoryFilterText(category.normalizedNameAr), category.cover!] as const),
);

export type LocalQuestionInventory = {
  source: "local_firestore_import" | "local_sqlite_import";
  huroofAvailable: boolean;
  recommendedHuroofCategoryIds?: string[];
  categories: Array<{
    id: string;
    labelAr: string;
    sourceOnly: boolean;
    questionCount: number;
    heldQuestionCount: number;
    huroofQuestionCount: number;
    categoryGameEligible: boolean;
    availability: "ready" | "insufficient_questions" | "held_only";
  }>;
};

type PublicCategoryInventory = Omit<LocalQuestionInventory, "source"> & {
  schemaVersion: number;
};

const staticPreviewInventory = publicCategoryInventory as PublicCategoryInventory;

/**
 * Checked-in, metadata-only inventory used when static hosting intentionally has
 * no local service. It describes preview content and availability only; it does
 * not make a claim about a production gameplay release.
 */
export const staticPreviewQuestionInventory: LocalQuestionInventory = {
  source: "local_sqlite_import",
  huroofAvailable: staticPreviewInventory.huroofAvailable,
  categories: staticPreviewInventory.categories,
};

/** Metadata-only local setup projection; questions and answers remain server-side. */
export async function fetchLocalQuestionInventory(): Promise<
  LocalQuestionInventory | undefined
> {
  const response = await fetch("/api/question-inventory", {
    cache: "no-store",
  });
  if (response.status === 404) return undefined;
  if (response.status === 400) {
    const failure = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (failure?.error === "LOCAL_DB_SOURCE_DISABLED") return undefined;
  }
  if (!response.ok) throw new Error("تعذر تحميل فهرس أسئلة التجربة المحلية.");
  return response.json() as Promise<LocalQuestionInventory>;
}

export function inventoryCategoryCovers(
  inventory: LocalQuestionInventory,
): CategoryCover[] {
  return catalogCategoryCovers(inventory.categories);
}

/** Presentation-only category cards shared by local inventory and approved release metadata. */
export function catalogCategoryCovers(
  categories: Array<{ id: string; labelAr: string }>,
): CategoryCover[] {
  const existing = new Map(
    categoryCatalog.map((category) => [category.id, category]),
  );
  return categories.map((category) => {
    const knownCategory = existing.get(category.id);
    const rightsReplacement = rightsReplacementCovers.has(category.id);
    const reuse = exactGeneratedCoverReuseByLiveId.get(category.id);
    const reuseSource = reuse ? tahadaniGamesCategoryById.get(reuse.sourceId) : undefined;
    const exactGeneratedReuse = reuseSource?.cover?.source === "generated_review"
      && reuseSource.cover.publishable
      && normalizeCategoryFilterText(reuseSource.normalizedNameAr) === normalizeCategoryFilterText(reuse!.sourceLabelAr)
      && normalizeCategoryFilterText(category.labelAr) === normalizeCategoryFilterText(reuse!.liveLabelAr)
      && normalizeCategoryFilterText(knownCategory?.displayNameAr ?? "") === normalizeCategoryFilterText(reuse!.sourceLabelAr)
      ? reuseSource.cover
      : undefined;
    if (knownCategory) {
      return rightsReplacement || exactGeneratedReuse
        ? {
          ...knownCategory,
          cover: {
            web320: rightsReplacement
              ? `assets/categories/generated/t44-rights/320/${category.id}.webp`
              : exactGeneratedReuse!.web320,
            altAr: `غلاف مولّد لفئة ${category.labelAr}`,
            publishable: true,
          },
        }
        : knownCategory;
    }
    const name = normalizeCategoryFilterText(category.labelAr);
    const mappedCover = tahadaniGamesCoverByCategoryId.get(category.id)
      ?? tahadaniGamesCoverByName.get(name);
    const importedCover = importedCovers.get(coverAliases.get(name) ?? name);
    const generatedCover = generatedCovers.get(name);
    return {
      id: category.id,
      displayNameAr: category.labelAr,
      questionReadiness: "drafting",
      cover: {
        web320: rightsReplacement
          ? `assets/categories/generated/t44-rights/320/${category.id}.webp`
          : mappedCover?.web320 ?? importedCover?.web320 ?? (generatedCover
          ? `assets/categories/generated/${generatedCover}`
          : "assets/categories/320/category-006.webp"),
        altAr: rightsReplacement
          ? `غلاف مولّد لفئة ${category.labelAr}`
          : mappedCover?.source === "generated_review"
          ? `غلاف مولّد لفئة ${category.labelAr}`
          : mappedCover || importedCover
          ? `غلاف فئة ${category.labelAr}`
          : generatedCover
            ? `غلاف مولّد لفئة ${category.labelAr}`
          : `صورة افتراضية لفئة ${category.labelAr}`,
        // Imported legacy artwork retains its unverified rights status.
        publishable: rightsReplacement ? true : mappedCover?.publishable ?? importedCover === undefined,
      },
    };
  });
}
