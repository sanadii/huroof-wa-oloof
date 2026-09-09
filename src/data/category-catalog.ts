import publicCatalog from "./category-catalog.public.json";

export interface CategoryCover {
  id: string;
  displayNameAr: string;
  questionReadiness: string;
  cover: { web320: string; altAr: string; publishable: boolean };
}

/** Public presentation metadata; source provenance remains outside the client bundle. */
export const categoryCatalog = (publicCatalog as {
  categories: CategoryCover[];
}).categories;

/**
 * Categories that have documented question inventory. Drafting means content exists
 * in the imported record; it does not promise a reviewed or playable full board.
 */
export const availableCategoryCatalog = categoryCatalog.filter(
  (category) => category.questionReadiness === "drafting" || category.questionReadiness === "ready",
);

/** Homepage presentation is restricted to the same documented inventory as setup. */
export const featuredCategories = availableCategoryCatalog.slice(0, 12);
