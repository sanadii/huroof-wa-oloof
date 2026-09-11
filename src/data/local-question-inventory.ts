import { categoryCatalog, type CategoryCover } from "./category-catalog";
import { normalizeCategoryFilterText } from "./category-filters";
import publicCategoryInventory from "./category-inventory.public.json";
import tahadaniImages from "./tahadani-image-catalog.public.json";

const importedCovers = new Map(
  tahadaniImages.covers.map((cover) => [normalizeCategoryFilterText(cover.name), cover]),
);
// Equivalent topic names in the local inventory and the source image library.
const coverAliases = new Map([
  ["كرة القدم الكويتية", "الكرة الكويتية"],
  ["طب وجسم الإنسان", "طب"],
  ["جغرافيا العالم", "جغرافيا"],
].map(([label, name]) => [normalizeCategoryFilterText(label), normalizeCategoryFilterText(name)]));

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
    if (knownCategory) return knownCategory;
    const name = normalizeCategoryFilterText(category.labelAr);
    const importedCover = importedCovers.get(coverAliases.get(name) ?? name);
    return {
      id: category.id,
      displayNameAr: category.labelAr,
      questionReadiness: "drafting",
      cover: {
        web320: importedCover?.web320 ?? "assets/categories/320/category-006.webp",
        altAr: importedCover
          ? `غلاف فئة ${category.labelAr}`
          : `صورة افتراضية لفئة ${category.labelAr}`,
        // Imported legacy artwork retains its unverified rights status.
        publishable: importedCover === undefined,
      },
    };
  });
}
