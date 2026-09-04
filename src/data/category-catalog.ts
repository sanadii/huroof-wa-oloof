import importedCatalog from '../../content/categories/categories.json';

export interface CategoryCover {
  id: string;
  displayNameAr: string;
  questionReadiness: string;
  cover: { web320: string; altAr: string; publishable: boolean };
}

/** A read-only presentation projection of the imported Tahadani catalog. */
export const categoryCatalog = (importedCatalog as { categories: CategoryCover[] }).categories;

export const featuredCategories = categoryCatalog.slice(0, 12);
