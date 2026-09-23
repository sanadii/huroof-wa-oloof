import registry from "../content/source-catalog/huroof-everything-v1.json" with { type: "json" };

export type SourceCategory = {
  sourceIndex: string;
  sourceCategoryId: string;
  sourceTitleAr: string;
  sourceFile: string;
  sourceFileSha256: string;
  declaredMode: "unclassified";
  runtimeCategoryId: string | null;
  runtimeMapping: "explicit_legacy_identity" | "source_only_no_runtime_target";
};

type SourceRegistry = { schemaVersion: string; provenance: { bundleSha256: string; entryCount: number }; categories: SourceCategory[] };
export const sourceCategoryRegistry = registry as SourceRegistry;
const byId = new Map(sourceCategoryRegistry.categories.map((category) => [category.sourceCategoryId, category]));
const byIndex = new Map(sourceCategoryRegistry.categories.map((category) => [category.sourceIndex, category]));

/**
 * Resolve only explicit category identifiers. `source-file-category:NNN` is a
 * parser-owned source namespace and is resolved through the pinned outer registry;
 * bare numbers, titles, and runtime title aliases are deliberately never accepted.
 */
export function resolveSourceCategoryIdentifiers(identifiers: string[]) {
  const recognized: SourceCategory[] = [];
  const unresolved: string[] = [];
  const contradictory: string[] = [];
  for (const raw of identifiers) {
    const identifier = raw.trim();
    const sourceFileReference = identifier.match(/^source-file-category:(\d{3})$/i)?.[1];
    const categoryShaped = identifier.match(/^(?:tahadani|huroof)-(\d{3})$/i);
    const category = byId.get(identifier) ?? (sourceFileReference ? byIndex.get(sourceFileReference) : undefined);
    if (category) recognized.push(category);
    else {
      unresolved.push(identifier);
      const indexed = categoryShaped ? byIndex.get(categoryShaped[1]) : undefined;
      if (indexed) contradictory.push(identifier);
    }
  }
  const categories = [...new Map(recognized.map((category) => [category.sourceCategoryId, category])).values()].sort((left, right) => left.sourceIndex.localeCompare(right.sourceIndex));
  const runtimeTargets = [...new Set(categories.flatMap((category) => category.runtimeCategoryId ? [category.runtimeCategoryId] : []))].sort();
  const conflict = categories.length > 1 || runtimeTargets.length > 1 || contradictory.length > 0;
  return {
    sourceCategories: categories,
    sourceCategoryIds: categories.map((category) => category.sourceCategoryId),
    sourceIndexes: categories.map((category) => category.sourceIndex),
    sourceTitles: categories.map((category) => category.sourceTitleAr),
    runtimeCategoryId: !conflict && runtimeTargets.length === 1 && categories.length === 1 ? runtimeTargets[0] : undefined,
    unresolvedIdentifiers: [...new Set(unresolved)].sort(),
    contradictoryIdentifiers: [...new Set(contradictory)].sort(),
    conflict,
  };
}
