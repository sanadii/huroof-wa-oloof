/**
 * Local-only, read-only access to the pinned private import. This module is never
 * imported by browser code and deliberately has no write or release capability.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  resolveSourceCategoryIdentifiers,
  sourceCategoryRegistry,
} from "../scripts/source-category-crosswalk.js";
import type { RuntimeQuestionV32 } from "../src/features/game/runtime/question-selector.js";

export const IMPORT_PROJECT = "huroof-a3ee7";
export const IMPORT_DATABASE = "(default)";
export const IMPORT_BUNDLE_SHA256 =
  "7afd1423925b68e11f3f0cab5253879154763994272203b1a4df8007f9cd31ec";
export const LOCAL_FIRESTORE_NORMALIZER_VERSION =
  "local-firestore-normalizer-v2";
const require = createRequire(import.meta.url);
const QUESTION_COLLECTION = `questionImports/${IMPORT_BUNDLE_SHA256}/questions`;
const letters = new Set([
  "ا",
  "ب",
  "ت",
  "ث",
  "ج",
  "ح",
  "خ",
  "د",
  "ذ",
  "ر",
  "ز",
  "س",
  "ش",
  "ص",
  "ض",
  "ط",
  "ظ",
  "ع",
  "غ",
  "ف",
  "ق",
  "ك",
  "ل",
  "م",
  "ن",
  "ه",
  "و",
  "ي",
]);

type RecordValue = Record<string, unknown>;
type IntakeQuestion = {
  path: string;
  data: {
    contentHash?: string;
    rawCanonicalSha256?: string;
    bundleSha256?: string;
  };
};
type Reconciliation = {
  dispositions: Array<{
    contentHash: string;
    disposition: string;
    technicalEligibility: string;
  }>;
};
export type FirestoreQuestionDocument = {
  path: string;
  exists: boolean;
  data?: RecordValue;
};
export interface FirestoreQuestionReader {
  read(paths: string[]): Promise<FirestoreQuestionDocument[]>;
}
export type ImportedQuestion = RuntimeQuestionV32 & {
  targetLetter?: string;
  status: "draft_test_import";
  sourceContentHash: string;
  difficulty: string;
};
export type LocalQuestionInventory = {
  source: "local_firestore_import" | "local_sqlite_import";
  snapshotId: string;
  bundleSha256: string;
  boundedReadCount: number;
  sourceCandidateCount: number;
  usableQuestionCount: number;
  heldQuestionCount: number;
  heldByReason?: Record<string, number>;
  huroofAvailable: boolean;
  recommendedHuroofCategoryIds?: string[];
  categories: Array<{
    id: string;
    labelAr: string;
    sourceOnly: boolean;
    questionCount: number;
    classicQuestionCount: number;
    huroofQuestionCount: number;
    categoryGameEligible: boolean;
  }>;
};
export type LocalFirestoreQuestionSource = {
  snapshotId: string;
  questions: ImportedQuestion[];
  inventory: LocalQuestionInventory;
};
export type LocalRuntimeQuestionSource = {
  snapshotId: string;
  questions: ImportedQuestion[];
  inventory: LocalQuestionInventory;
};

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const text = (...values: unknown[]) =>
  values
    .find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    ?.trim() ?? "";
const values = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter(
              (item): item is string =>
                typeof item === "string" && item.trim().length > 0,
            )
            .map((item) => item.trim()),
        ),
      ].sort()
    : [];
const normalize = (value: string) =>
  value
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as RecordValue)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonical(child)]),
        )
      : value;
const canonicalJson = (value: unknown) => JSON.stringify(canonical(value));

function identifiers(data: RecordValue): string[] {
  const raw = record(data.raw);
  return [raw.category_id, raw.categoryId]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .map((value) => value.trim());
}

function explicitCategory(data: RecordValue) {
  const resolved = resolveSourceCategoryIdentifiers(identifiers(data));
  if (resolved.conflict || resolved.sourceCategories.length !== 1)
    return undefined;
  return resolved.sourceCategories[0];
}

function explicitLetter(raw: RecordValue) {
  const direct = text(raw.target_letter, raw.targetLetter, raw.letter);
  const labelled =
    text(raw.rawText).match(
      /(?:\*\*)?الحرف(?:\*\*)?\s*:\s*([\u0621-\u064A])/u,
    )?.[1] ?? "";
  const letter = direct || labelled;
  return letters.has(letter) ? letter : undefined;
}

function questionContentHash(data: RecordValue): string {
  const raw = record(data.raw);
  return hash(
    canonicalJson({
      kind: data.recordKind,
      raw,
      sourceCategoryIdentifiers: Array.isArray(data.sourceCategoryIdentifiers)
        ? data.sourceCategoryIdentifiers
        : [],
      sourceReviewState: data.sourceReviewState,
      approval: data.approval,
    }),
  );
}

function hasPinnedDocumentIdentity(
  document: FirestoreQuestionDocument,
  expected: IntakeQuestion,
): boolean {
  if (!document.exists || !document.data || document.path !== expected.path)
    return false;
  const data = document.data,
    raw = record(data.raw);
  return (
    data.bundleSha256 === IMPORT_BUNDLE_SHA256 &&
    data.contentHash === expected.data.contentHash &&
    data.rawCanonicalSha256 === expected.data.rawCanonicalSha256 &&
    data.rawCanonicalSha256 === hash(canonicalJson(raw)) &&
    data.contentHash === questionContentHash(data)
  );
}

/** Converts only direct DB fields; it does not infer a category, mode, or letter. */
export function normalizeImportedQuestion(
  document: FirestoreQuestionDocument,
  expected: IntakeQuestion,
): ImportedQuestion | undefined {
  if (!hasPinnedDocumentIdentity(document, expected)) return undefined;
  const data = document.data!,
    raw = record(data.raw);
  const category = explicitCategory(data);
  if (!category) return undefined;
  const question = text(
      raw.question,
      raw.questionText,
      raw.question_ar,
      raw.prompt,
      raw.prompt_ar,
      raw.text,
      raw.clue,
    ),
    answer = text(
      raw.answer,
      raw.answerText,
      raw.answer_ar,
      raw.canonical_answer,
    );
  const mode = text(raw.mode, raw.modality).toLowerCase();
  if (!question || !answer || !["classic", "trivia"].includes(mode))
    return undefined;
  const acceptedAnswers = values(raw.accepted_answers).length
    ? values(raw.accepted_answers)
    : values(raw.acceptedAnswers).length
      ? values(raw.acceptedAnswers)
      : values(raw.accepted).length
        ? values(raw.accepted)
        : [answer];
  if (
    !acceptedAnswers.length ||
    !acceptedAnswers.every((value) => normalize(value))
  )
    return undefined;
  const targetLetter = explicitLetter(raw);
  if (targetLetter && normalize(answer).charAt(0) !== targetLetter)
    return undefined;
  return {
    id: String(data.contentHash),
    categoryId: category.sourceCategoryId,
    modality: "classic",
    targetLetter,
    answerConceptId: hash(normalize(answer)),
    headerAr: category.sourceTitleAr,
    promptAr: question,
    canonicalAnswer: answer,
    acceptedAnswers,
    difficulty: text(raw.difficulty, raw.difficulty_status) || "unspecified",
    status: "draft_test_import",
    sourceContentHash: String(data.contentHash),
  };
}

export async function createFirebaseCliQuestionReader(): Promise<FirestoreQuestionReader> {
  const { getGlobalDefaultAccount } = require("firebase-tools/lib/auth.js") as {
    getGlobalDefaultAccount: () =>
      { tokens?: { refresh_token?: string } } | undefined;
  };
  const refresh = getGlobalDefaultAccount()?.tokens?.refresh_token;
  if (!refresh) throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
  const { clientId, clientSecret } = require("firebase-tools/lib/api.js") as {
    clientId: () => string;
    clientSecret: () => string;
  };
  const { Firestore } = await import("@google-cloud/firestore");
  const db = new Firestore({
    projectId: IMPORT_PROJECT,
    databaseId: IMPORT_DATABASE,
    credentials: {
      type: "authorized_user",
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refresh,
    } as never,
  });
  return {
    read: async (paths) =>
      (await db.getAll(...paths.map((path) => db.doc(path)))).map(
        (snapshot) => ({
          path: snapshot.ref.path,
          exists: snapshot.exists,
          data: snapshot.data() as RecordValue | undefined,
        }),
      ),
  };
}

function huroofAvailable(questions: ImportedQuestion[]): boolean {
  const queues = new Map<string, Set<string>>();
  for (const question of questions)
    if (question.targetLetter)
      queues.set(
        question.targetLetter,
        new Set([
          ...(queues.get(question.targetLetter) ?? []),
          question.answerConceptId,
        ]),
      );
  return (
    queues.size >= 25 &&
    [...queues.values()].every((concepts) => concepts.size >= 1)
  );
}

/**
 * Reads bounded exact document batches from the pinned intake. Missing, unexpected,
 * duplicate, missing-hash, or malformed responses fail closed. Semantically
 * unsupported records stay counted as held.
 */
export async function loadLocalFirestoreQuestionSource(
  options: {
    reader?: FirestoreQuestionReader;
    reconciliationPath?: string;
    intakePath?: string;
    maxReads?: number;
  } = {},
): Promise<LocalFirestoreQuestionSource> {
  const reconciliationPath =
    options.reconciliationPath ??
    resolve("tmp/bundle-import-20260908/t14.3-mapping-reconciliation-v1.json");
  const intakePath =
    options.intakePath ??
    resolve(
      "tmp/bundle-import-20260908/bundle-question-import.documents.jsonl",
    );
  const reconciliation = JSON.parse(
    await readFile(reconciliationPath, "utf8"),
  ) as Reconciliation;
  // This preserves duplicate/field/mode holds. Source-only huroof identities are
  // accepted when the pinned registry resolves them, even without a legacy runtime ID.
  const usableCandidates = new Set(
    reconciliation.dispositions
      .filter(
        (entry) =>
          entry.disposition === "effective_candidate" &&
          entry.technicalEligibility === "candidate",
      )
      .map((entry) => entry.contentHash),
  );
  const intake = (await readFile(intakePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IntakeQuestion)
    .filter(
      (entry) =>
        entry.path.startsWith(`${QUESTION_COLLECTION}/`) &&
        entry.data.bundleSha256 === IMPORT_BUNDLE_SHA256 &&
        typeof entry.data.contentHash === "string" &&
        typeof entry.data.rawCanonicalSha256 === "string",
    );
  const expectedByPath = new Map(intake.map((entry) => [entry.path, entry]));
  if (expectedByPath.size !== intake.length || !intake.length)
    throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
  const maxReads = Math.max(1, Math.min(options.maxReads ?? 1400, 2000));
  const selected = intake
    .filter((entry) => usableCandidates.has(entry.data.contentHash!))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, maxReads);
  if (!selected.length) throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
  const selectedByPath = new Map(selected.map((entry) => [entry.path, entry]));
  const reader = options.reader ?? (await createFirebaseCliQuestionReader());
  const documents: FirestoreQuestionDocument[] = [];
  for (let index = 0; index < selected.length; index += 100)
    documents.push(
      ...(await reader.read(
        selected.slice(index, index + 100).map((entry) => entry.path),
      )),
    );
  if (documents.length !== selected.length)
    throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
  const returnedPaths = new Set<string>();
  for (const document of documents) {
    if (
      !document.exists ||
      !document.data ||
      returnedPaths.has(document.path) ||
      !selectedByPath.has(document.path)
    )
      throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
    returnedPaths.add(document.path);
  }
  if (returnedPaths.size !== selectedByPath.size)
    throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
  const questions: ImportedQuestion[] = [];
  let heldQuestionCount = 0;
  for (const document of documents) {
    const expected = selectedByPath.get(document.path)!;
    if (!hasPinnedDocumentIdentity(document, expected))
      throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
    if (!usableCandidates.has(String(document.data!.contentHash))) {
      heldQuestionCount += 1;
      continue;
    }
    const normalized = normalizeImportedQuestion(document, expected);
    if (normalized) questions.push(normalized);
    else heldQuestionCount += 1;
  }
  questions.sort((left, right) => left.id.localeCompare(right.id));
  if (!questions.length)
    throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
  const snapshotId = hash(
    canonicalJson({
      normalizer: LOCAL_FIRESTORE_NORMALIZER_VERSION,
      registrySchemaVersion: sourceCategoryRegistry.schemaVersion,
      registryBundleSha256: sourceCategoryRegistry.provenance.bundleSha256,
      questions: questions.map((question) => ({
        id: question.id,
        categoryId: question.categoryId,
        modality: question.modality,
        targetLetter: question.targetLetter,
        answerConceptId: question.answerConceptId,
        headerAr: question.headerAr,
        promptAr: question.promptAr,
        canonicalAnswer: question.canonicalAnswer,
        acceptedAnswers: question.acceptedAnswers,
        difficulty: question.difficulty,
        status: question.status,
        sourceContentHash: question.sourceContentHash,
      })),
    }),
  );
  const categories = sourceCategoryRegistry.categories
    .map((category) => {
      const records = questions.filter(
        (question) => question.categoryId === category.sourceCategoryId,
      );
      const concepts = new Set(
        records.map((question) => question.answerConceptId),
      );
      return {
        id: category.sourceCategoryId,
        labelAr: category.sourceTitleAr,
        sourceOnly: category.runtimeCategoryId === null,
        questionCount: records.length,
        classicQuestionCount: records.length,
        huroofQuestionCount: records.filter((question) =>
          Boolean(question.targetLetter),
        ).length,
        categoryGameEligible: concepts.size >= 14,
      };
    })
    .filter((category) => category.questionCount > 0);
  return {
    snapshotId,
    questions,
    inventory: {
      source: "local_firestore_import",
      snapshotId,
      bundleSha256: IMPORT_BUNDLE_SHA256,
      boundedReadCount: documents.length,
      sourceCandidateCount: usableCandidates.size,
      usableQuestionCount: questions.length,
      heldQuestionCount,
      huroofAvailable: huroofAvailable(questions),
      categories,
    },
  };
}
