import type { ApprovedReleaseCatalog } from '../game/runtime/contracts';
import { isQuestionTypeCounts, QUESTION_TYPE_CLASSIFIER_VERSION, QUESTION_TYPE_KEYS } from '../game/runtime/question-type-counts';

type PreviewCatalog = ApprovedReleaseCatalog & { localTypeIndexPreview?: true };

/** Local development only: attach the reviewed aggregate for this exact immutable release. */
export function mergeLocalQuestionTypePreview(catalog: ApprovedReleaseCatalog, raw: unknown): PreviewCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = (raw as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const index = data as Record<string, unknown>;
  if (index.schemaVersion !== 't40-question-type-index-v1' || index.classifierVersion !== QUESTION_TYPE_CLASSIFIER_VERSION || index.immutable !== true || index.releaseId !== catalog.releaseId || index.releaseRootSha256 !== catalog.releaseRootSha256 || !Array.isArray(index.categories) || index.categoryCount !== catalog.categories.length || !Number.isSafeInteger(index.approvedQuestionCount)) return null;
  const counts = new Map<string, NonNullable<ApprovedReleaseCatalog['categories'][number]['questionTypeCounts']>>();
  let total = 0;
  for (const item of index.categories) {
    if (!item || typeof item !== 'object') return null;
    const category = item as Record<string, unknown>;
    if (typeof category.id !== 'string' || counts.has(category.id) || !isQuestionTypeCounts(category.questionTypeCounts)) return null;
    const categoryCounts = category.questionTypeCounts;
    counts.set(category.id, categoryCounts);
    total += QUESTION_TYPE_KEYS.reduce((sum, type) => sum + categoryCounts[type], 0);
  }
  if (counts.size !== catalog.categories.length || total !== index.approvedQuestionCount || catalog.categories.some(category => !counts.has(category.id))) return null;
  return { ...catalog, localTypeIndexPreview: true, categories: catalog.categories.map(category => ({ ...category, questionTypeCounts: counts.get(category.id)! })) };
}
