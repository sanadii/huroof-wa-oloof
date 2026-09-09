import { categoryCatalog, type CategoryCover } from "./category-catalog";

export type LocalQuestionInventory = {
  source: "local_firestore_import" | "local_sqlite_import";
  huroofAvailable: boolean;
  recommendedHuroofCategoryIds?: string[];
  categories: Array<{
    id: string;
    labelAr: string;
    sourceOnly: boolean;
    categoryGameEligible: boolean;
  }>;
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
  const existing = new Map(
    categoryCatalog.map((category) => [category.id, category]),
  );
  return inventory.categories.map(
    (category) =>
      existing.get(category.id) ?? {
        id: category.id,
        displayNameAr: category.labelAr,
        questionReadiness: "drafting",
        cover: {
          web320: "assets/categories/320/category-006.webp",
          altAr: `صورة افتراضية لفئة ${category.labelAr}`,
          publishable: true,
        },
      },
  );
}
