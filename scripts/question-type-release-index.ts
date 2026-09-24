import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  QUESTION_TYPE_CLASSIFIER_VERSION,
  addQuestionTypeCount,
  classifyQuestionSideType,
  emptyQuestionTypeCounts,
  isQuestionTypeCounts,
  type QuestionTypeCounts,
} from "../src/features/game/runtime/question-type-counts.js";
import type { FirestoreReleasePlan, ReleaseDocument } from "./build-firestore-release.js";
import { canonicalJson } from "./firestore-release-canonical.js";

export const QUESTION_TYPE_INDEX_SCHEMA_VERSION = "t40-question-type-index-v1" as const;
const releaseIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/iu;
const indexKeys = ["schemaVersion", "classifierVersion", "releaseId", "releaseRootSha256", "approvedQuestionCount", "categoryCount", "categories", "indexSha256", "immutable"];
const categoryKeys = ["id", "questionTypeCounts"];
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const compareIds = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const MAX_INDEX_DOCUMENT_BYTES = 900 * 1024;

export type QuestionTypeReleaseIndex = {
  schemaVersion: typeof QUESTION_TYPE_INDEX_SCHEMA_VERSION;
  classifierVersion: typeof QUESTION_TYPE_CLASSIFIER_VERSION;
  releaseId: string;
  releaseRootSha256: string;
  approvedQuestionCount: number;
  categoryCount: number;
  categories: Array<{ id: string; questionTypeCounts: QuestionTypeCounts }>;
  indexSha256: string;
  immutable: true;
};

const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
const categoryPath = (releaseId: string) => new RegExp(`^releases/${releaseId}/catalogCategories/([^/]+)$`, "u");
const questionPath = (releaseId: string) => new RegExp(`^releases/${releaseId}/questions/([^/]+)$`, "u");
const inventoryPath = (releaseId: string) => new RegExp(`^releases/${releaseId}/inventory/([^/]+)$`, "u");

export function questionTypeIndexDocumentId(releaseId: string, releaseRootSha256: string): string {
  if (!releaseIdPattern.test(releaseId) || !sha256Pattern.test(releaseRootSha256)) throw new Error("QUESTION_TYPE_INDEX_INVALID_RELEASE_IDENTITY");
  return createHash("sha256").update(releaseId).update("\0").update(releaseRootSha256.toLowerCase()).digest("hex");
}

export function questionTypeIndexDocumentPath(releaseId: string, releaseRootSha256: string): string {
  return `releaseQuestionTypeIndexes/${questionTypeIndexDocumentId(releaseId, releaseRootSha256)}`;
}

function rootFor(plan: FirestoreReleasePlan): Record<string, unknown> {
  const root = plan.documents.find((document) => document.path === `releases/${plan.releaseId}`)?.data;
  if (!root || root.immutable !== true || root.releaseId !== plan.releaseId || root.documentRootSha256 !== plan.documentRootSha256 || root.approvedCount !== plan.approvedCount)
    throw new Error("QUESTION_TYPE_INDEX_RELEASE_ROOT_MISMATCH");
  if (!sha256Pattern.test(plan.documentRootSha256)) throw new Error("QUESTION_TYPE_INDEX_INVALID_RELEASE_ROOT");
  return root;
}

function indexPayload(index: Omit<QuestionTypeReleaseIndex, "indexSha256" | "immutable">) {
  return {
    schemaVersion: index.schemaVersion,
    classifierVersion: index.classifierVersion,
    releaseId: index.releaseId,
    releaseRootSha256: index.releaseRootSha256,
    approvedQuestionCount: index.approvedQuestionCount,
    categoryCount: index.categoryCount,
    categories: index.categories,
  };
}

/** Builds a release-bound, metadata-only aggregate from an exact release plan. */
export function buildQuestionTypeReleaseIndex(plan: FirestoreReleasePlan): QuestionTypeReleaseIndex {
  const root = rootFor(plan);
  const categories = new Map<string, QuestionTypeCounts>();
  const inventories = new Map<string, number>();
  const categoryMatcher = categoryPath(plan.releaseId);
  const questionMatcher = questionPath(plan.releaseId);
  const inventoryMatcher = inventoryPath(plan.releaseId);
  const questionIds = new Set<string>();
  let questionCount = 0;

  for (const document of plan.documents.slice().sort((left, right) => compareIds(left.path, right.path))) {
    const categoryMatch = categoryMatcher.exec(document.path);
    if (categoryMatch) {
      const id = categoryMatch[1]!;
      if (!releaseIdPattern.test(id) || document.data.id !== id || categories.has(id)) throw new Error("QUESTION_TYPE_INDEX_CATEGORY_RECONCILIATION_FAILED");
      categories.set(id, emptyQuestionTypeCounts());
      continue;
    }
    const inventoryMatch = inventoryMatcher.exec(document.path);
    if (inventoryMatch) {
      const id = inventoryMatch[1]!;
      const approvedCount = document.data.approvedCount;
      if (!releaseIdPattern.test(id) || document.data.categoryId !== id || !Number.isSafeInteger(approvedCount) || (approvedCount as number) < 0 || inventories.has(id)) throw new Error("QUESTION_TYPE_INDEX_INVENTORY_RECONCILIATION_FAILED");
      inventories.set(id, approvedCount as number);
      continue;
    }
    const questionMatch = questionMatcher.exec(document.path);
    if (!questionMatch) continue;
    const id = questionMatch[1]!;
    const categoryId = document.data.categoryId;
    if (!releaseIdPattern.test(id) || document.data.id !== id || questionIds.has(id) || typeof categoryId !== "string" || !categories.has(categoryId))
      throw new Error("QUESTION_TYPE_INDEX_QUESTION_RECONCILIATION_FAILED");
    questionIds.add(id);
    const type = classifyQuestionSideType(document.data);
    categories.set(categoryId, addQuestionTypeCount(categories.get(categoryId)!, type));
    questionCount += 1;
  }
  if (!categories.size || questionCount !== plan.approvedCount || root.categoryCount !== undefined && root.categoryCount !== categories.size)
    throw new Error("QUESTION_TYPE_INDEX_RELEASE_COUNT_MISMATCH");
  for (const [id, counts] of categories) {
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (inventories.has(id) && inventories.get(id) !== total) throw new Error("QUESTION_TYPE_INDEX_INVENTORY_COUNT_MISMATCH");
  }
  for (const id of inventories.keys()) if (!categories.has(id)) throw new Error("QUESTION_TYPE_INDEX_INVENTORY_CATEGORY_UNKNOWN");
  const draft = {
    schemaVersion: QUESTION_TYPE_INDEX_SCHEMA_VERSION,
    classifierVersion: QUESTION_TYPE_CLASSIFIER_VERSION,
    releaseId: plan.releaseId,
    releaseRootSha256: plan.documentRootSha256.toLowerCase(),
    approvedQuestionCount: plan.approvedCount,
    categoryCount: categories.size,
    categories: [...categories.entries()].sort(([left], [right]) => compareIds(left, right)).map(([id, questionTypeCounts]) => ({ id, questionTypeCounts })),
  } as const;
  return { ...draft, indexSha256: hash(indexPayload(draft)), immutable: true };
}

/**
 * Streams a verified successor-children capture for a live release. The
 * capture's caller supplies the independently captured active root identity;
 * this avoids loading a multi-hundred-megabyte release plan into memory.
 */
export async function buildQuestionTypeReleaseIndexFromChildrenJsonl(input: {
  childrenPath: string;
  releaseId: string;
  releaseRootSha256: string;
  approvedQuestionCount: number;
  categoryCount: number;
  expectedChildrenSha256: string;
  expectedChildDocumentCount: number;
}): Promise<QuestionTypeReleaseIndex> {
  if (!releaseIdPattern.test(input.releaseId) || !sha256Pattern.test(input.releaseRootSha256) || !sha256Pattern.test(input.expectedChildrenSha256) || !Number.isSafeInteger(input.approvedQuestionCount) || input.approvedQuestionCount < 1 || !Number.isSafeInteger(input.categoryCount) || input.categoryCount < 1 || !Number.isSafeInteger(input.expectedChildDocumentCount) || input.expectedChildDocumentCount < input.approvedQuestionCount) throw new Error("QUESTION_TYPE_INDEX_CAPTURE_IDENTITY_INVALID");
  const categories = new Map<string, QuestionTypeCounts>();
  const inventories = new Map<string, number>();
  const questionIds = new Set<string>();
  const categoryMatcher = categoryPath(input.releaseId), questionMatcher = questionPath(input.releaseId), inventoryMatcher = inventoryPath(input.releaseId);
  let questionCount = 0, lineNumber = 0, priorPath = "";
  const captureHash = createHash("sha256");
  const source = createReadStream(input.childrenPath);
  source.on("data", (chunk: string | Buffer) => { captureHash.update(chunk); });
  const stream = createInterface({ input: source, crlfDelay: Infinity });
  for await (const line of stream) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { throw new Error(`QUESTION_TYPE_INDEX_CAPTURE_JSON_INVALID:${lineNumber}`); }
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`QUESTION_TYPE_INDEX_CAPTURE_ROW_INVALID:${lineNumber}`);
    const document = row as { path?: unknown; data?: unknown };
    if (typeof document.path !== "string" || !document.data || typeof document.data !== "object" || Array.isArray(document.data)) throw new Error(`QUESTION_TYPE_INDEX_CAPTURE_ROW_INVALID:${lineNumber}`);
    if (!document.path.startsWith(`releases/${input.releaseId}/`)) throw new Error("QUESTION_TYPE_INDEX_CAPTURE_RELEASE_MISMATCH");
    if (document.path <= priorPath) throw new Error("QUESTION_TYPE_INDEX_CAPTURE_NOT_PATH_SORTED");
    priorPath = document.path;
    const data = document.data as Record<string, unknown>;
    const categoryMatch = categoryMatcher.exec(document.path);
    if (categoryMatch) {
      const id = categoryMatch[1]!;
      if (!releaseIdPattern.test(id) || data.id !== id || categories.has(id)) throw new Error("QUESTION_TYPE_INDEX_CATEGORY_RECONCILIATION_FAILED");
      categories.set(id, emptyQuestionTypeCounts());
      continue;
    }
    const inventoryMatch = inventoryMatcher.exec(document.path);
    if (inventoryMatch) {
      const id = inventoryMatch[1]!, approvedCount = data.approvedCount;
      if (!releaseIdPattern.test(id) || data.categoryId !== id || !Number.isSafeInteger(approvedCount) || (approvedCount as number) < 0 || inventories.has(id)) throw new Error("QUESTION_TYPE_INDEX_INVENTORY_RECONCILIATION_FAILED");
      inventories.set(id, approvedCount as number);
      continue;
    }
    const questionMatch = questionMatcher.exec(document.path);
    if (!questionMatch) continue;
    const id = questionMatch[1]!, categoryId = data.categoryId;
    if (!releaseIdPattern.test(id) || data.id !== id || questionIds.has(id) || typeof categoryId !== "string" || !categories.has(categoryId)) throw new Error("QUESTION_TYPE_INDEX_QUESTION_RECONCILIATION_FAILED");
    questionIds.add(id);
    categories.set(categoryId, addQuestionTypeCount(categories.get(categoryId)!, classifyQuestionSideType(data)));
    questionCount += 1;
  }
  if (lineNumber !== input.expectedChildDocumentCount || captureHash.digest("hex") !== input.expectedChildrenSha256.toLowerCase()) throw new Error("QUESTION_TYPE_INDEX_CAPTURE_HASH_MISMATCH");
  if (categories.size !== input.categoryCount || questionCount !== input.approvedQuestionCount) throw new Error("QUESTION_TYPE_INDEX_RELEASE_COUNT_MISMATCH");
  for (const [id, counts] of categories) {
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (inventories.has(id) && inventories.get(id) !== total) throw new Error("QUESTION_TYPE_INDEX_INVENTORY_COUNT_MISMATCH");
  }
  for (const id of inventories.keys()) if (!categories.has(id)) throw new Error("QUESTION_TYPE_INDEX_INVENTORY_CATEGORY_UNKNOWN");
  const draft = { schemaVersion: QUESTION_TYPE_INDEX_SCHEMA_VERSION, classifierVersion: QUESTION_TYPE_CLASSIFIER_VERSION, releaseId: input.releaseId, releaseRootSha256: input.releaseRootSha256.toLowerCase(), approvedQuestionCount: input.approvedQuestionCount, categoryCount: input.categoryCount, categories: [...categories.entries()].sort(([left], [right]) => compareIds(left, right)).map(([id, questionTypeCounts]) => ({ id, questionTypeCounts })) } as const;
  return { ...draft, indexSha256: hash(indexPayload(draft)), immutable: true };
}

export function isQuestionTypeReleaseIndex(value: unknown): value is QuestionTypeReleaseIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!hasExactKeys(value as Record<string, unknown>, indexKeys)) return false;
  const index = value as Partial<QuestionTypeReleaseIndex>;
  if (index.schemaVersion !== QUESTION_TYPE_INDEX_SCHEMA_VERSION || index.classifierVersion !== QUESTION_TYPE_CLASSIFIER_VERSION || typeof index.releaseId !== "string" || !releaseIdPattern.test(index.releaseId) || typeof index.releaseRootSha256 !== "string" || !sha256Pattern.test(index.releaseRootSha256) || !Number.isSafeInteger(index.approvedQuestionCount) || !Number.isSafeInteger(index.categoryCount) || !Array.isArray(index.categories) || typeof index.indexSha256 !== "string" || !sha256Pattern.test(index.indexSha256) || index.immutable !== true) return false;
  const approvedQuestionCount = index.approvedQuestionCount as number;
  const categoryCount = index.categoryCount as number;
  if (approvedQuestionCount < 0 || categoryCount < 1 || index.categories.length !== categoryCount) return false;
  const ids = new Set<string>();
  let total = 0;
  let priorId = "";
  for (const category of index.categories) {
    if (!category || typeof category !== "object" || Array.isArray(category) || !hasExactKeys(category as Record<string, unknown>, categoryKeys) || typeof category.id !== "string" || !releaseIdPattern.test(category.id) || category.id <= priorId || ids.has(category.id) || !isQuestionTypeCounts(category.questionTypeCounts)) return false;
    priorId = category.id;
    ids.add(category.id);
    total += Object.values(category.questionTypeCounts).reduce((sum, count) => sum + count, 0);
  }
  if (total !== approvedQuestionCount || ids.size !== categoryCount) return false;
  const payload = indexPayload(index as Omit<QuestionTypeReleaseIndex, "indexSha256" | "immutable">);
  return hash(payload) === index.indexSha256.toLowerCase();
}

export function questionTypeIndexDocument(index: QuestionTypeReleaseIndex): ReleaseDocument {
  if (!isQuestionTypeReleaseIndex(index)) throw new Error("QUESTION_TYPE_INDEX_INVALID");
  if (Buffer.byteLength(JSON.stringify(index), "utf8") > MAX_INDEX_DOCUMENT_BYTES) throw new Error("QUESTION_TYPE_INDEX_DOCUMENT_TOO_LARGE");
  return { path: questionTypeIndexDocumentPath(index.releaseId, index.releaseRootSha256), data: index };
}

export type QuestionTypeIndexPublicationAdapter = {
  read(paths: string[]): Promise<Array<{ path: string; exists: boolean; data?: Record<string, unknown> }>>;
  create(documents: ReleaseDocument[]): Promise<void>;
  /** Must atomically re-read the active pointer and exact immutable root before create. */
  createQuestionTypeIndexIfActiveReleaseMatches?: (document: ReleaseDocument, releaseId: string, releaseRootSha256: string) => Promise<boolean>;
};

/**
 * Create-only, idempotent sidecar publication. The write requires an adapter
 * that atomically guards the active pointer and immutable root, so a stale
 * offline plan can never attach metadata to a changed release by accident.
 */
export async function publishQuestionTypeReleaseIndex(index: QuestionTypeReleaseIndex, adapter: QuestionTypeIndexPublicationAdapter): Promise<{ created: boolean; path: string }> {
  const document = questionTypeIndexDocument(index);
  if (!adapter.createQuestionTypeIndexIfActiveReleaseMatches)
    throw new Error("QUESTION_TYPE_INDEX_GUARDED_PUBLICATION_UNAVAILABLE");
  const created = await adapter.createQuestionTypeIndexIfActiveReleaseMatches(document, index.releaseId, index.releaseRootSha256);
  const readback = (await adapter.read([document.path]))[0];
  if (!readback?.exists || canonicalJson(readback.data) !== canonicalJson(document.data)) throw new Error("QUESTION_TYPE_INDEX_READBACK_MISMATCH");
  return { created, path: document.path };
}
