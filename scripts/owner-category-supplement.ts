/** Owner-authorized Category-only supplement for the 4,500 v19/v19.1 rows. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { normalizeArabic } from "../src/question-bank.js";
import {
  createCategoryQuestionSelection,
  createMatchQuestionSelection,
  type RuntimeQuestionV32,
} from "../src/features/game/runtime/question-selector.js";
import {
  canonicalJson,
  SAFE_DOCUMENT_ID,
} from "./firestore-release-canonical.js";
import {
  decodeSourceDocument,
  type SourceDocument,
} from "./owner-approved-release.js";

export const CATEGORY_IDS = [
  "huroof-063",
  "huroof-064",
  "huroof-065",
  "huroof-066",
  "huroof-067",
  "huroof-070",
  "huroof-071",
  "huroof-072",
  "huroof-073",
  "tahadani-003",
  "tahadani-005",
  "tahadani-025",
  "tahadani-028",
  "tahadani-029",
  "tahadani-030",
] as const;
export const MEDIA_RELEASE_ID =
  "owner-media-release-548087aee7b942cb8c0a96cc95d85c17";
const V19_SOURCE_SHA256 =
  "8bbb7ace97272e8f37673633a05c36b3320ed26766b5a98df48cb774955adec5";
const V191_SOURCE_SHA256 =
  "ba4751006628b165ea64108e9f51913705fd3aa73a5e80c829418e238e7a4cf5";
const V19_SOURCE_PATH = "output/v19-db-import-20260911";
const V191_SOURCE_PATH = "output/v191-db-update-20260911";
const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => sha(canonicalJson(value));
const same = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const literal = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
const docHash = (documents: ReleaseDocument[]) =>
  hash(
    documents
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(({ path, data }) => ({ path, data })),
  );
const pathOf = (name: string) => {
  const marker = "/documents/",
    index = name.indexOf(marker);
  if (index < 0) throw new Error("Firestore document name is invalid.");
  return name.slice(index + marker.length);
};

export type ReleaseDocument = { path: string; data: Record<string, unknown> };
export type CapturedBase = {
  capturedAt: string;
  projectId: string;
  databaseId: string;
  locationId: string;
  pointer: Record<string, unknown>;
  root: ReleaseDocument;
  documents: ReleaseDocument[];
};
export type SourceHashManifest = {
  v19: { path: string; sha256: string };
  v191: { path: string; sha256: string };
};
export type CategorySupplementPlan = {
  schemaVersion: "owner-category-supplement-v1";
  releaseId: string;
  target: {
    projectId: "huroof-a3ee7";
    databaseId: "(default)";
    locationId: "me-central2";
  };
  base: CapturedBase;
  source: {
    sqliteSha256: string;
    hashes: SourceHashManifest;
    recordCount: 4500;
    categories: Record<string, number>;
    bindingSha256: string;
  };
  ownerApproval: {
    path: string;
    runId: string;
    authority: "owner_approval";
    specialistReview: "not_claimed";
  };
  documents: ReleaseDocument[];
  approvalDocuments: ReleaseDocument[];
  approvedCount: 15338;
  catalogSha256: string;
  documentRootSha256: string;
  sourceManifestSha256: string;
  readiness: Record<
    string,
    { selected: number; categoryMode: boolean; huroof: false; detail: string }
  >;
};
type SourceRow = {
  id: string;
  contentHash: string;
  categoryId: string;
  labelAr: string;
  mode: "trivia" | "identity";
  promptAr: string;
  canonicalAnswer: string;
  acceptedAnswers: string[];
  source: Record<string, unknown>;
  status: Record<string, unknown>;
};
export type CategorySupplementApi = {
  target(): Promise<{
    projectId: string;
    databaseId: string;
    locationId: string;
    type: string;
  }>;
  read(paths: string[]): Promise<Array<SourceDocument | undefined>>;
  create(documents: ReleaseDocument[]): Promise<void>;
  listCollectionIds(path: string): Promise<string[]>;
  listCollection(path: string): Promise<SourceDocument[]>;
  activate(
    plan: CategorySupplementPlan,
    verification: ReleaseDocument,
  ): Promise<void>;
  rollback(
    plan: CategorySupplementPlan,
    receipt: ReleaseDocument,
  ): Promise<void>;
  reactivate(
    plan: CategorySupplementPlan,
    rollbackReceipt: ReleaseDocument,
    reactivationReceipt: ReleaseDocument,
  ): Promise<void>;
};

function sourceRows(sqlite: string, hashes: SourceHashManifest) {
  const db = new DatabaseSync(resolve(sqlite), { readOnly: true });
  let values: Record<string, unknown>[];
  try {
    values = (
      db
        .prepare("SELECT data FROM local_admin_drafts ORDER BY id")
        .all() as Array<{ data: string }>
    ).map((row) => JSON.parse(row.data) as Record<string, unknown>);
  } finally {
    db.close();
  }
  const selected: SourceRow[] = [];
  for (const value of values) {
    const source = record(value.importSource),
      categoryId = text(source.category_id ?? value.categoryId);
    if (!(CATEGORY_IDS as readonly string[]).includes(categoryId)) continue;
    const mode = text(source.mode ?? value.sourceMode).toLowerCase();
    const id = text(source.id ?? value.id),
      contentHash = text(
        source.source_content_sha256 ?? value.sourceContentHash,
      ),
      labelAr = literal(source.category_title ?? value.headerAr),
      promptAr = literal(source.question ?? value.promptAr),
      canonicalAnswer = literal(source.answer ?? value.canonicalAnswer),
      acceptedAnswers = strings(
        source.accepted_answers ?? value.acceptedAnswers,
      );
    const sourcePackage = text(source.source_package),
      sourceHash = sourcePackage.includes("v19.1")
        ? hashes.v191.sha256
        : sourcePackage.includes("v19")
          ? hashes.v19.sha256
          : "";
    if (
      !id ||
      !/^[a-f0-9]{64}$/iu.test(contentHash) ||
      !labelAr.trim() ||
      !promptAr.trim() ||
      !canonicalAnswer.trim() ||
      !acceptedAnswers.some(
        (answer) =>
          normalizeArabic(answer) === normalizeArabic(canonicalAnswer),
      ) ||
      !["trivia", "identity"].includes(mode) ||
      !sourceHash ||
      value.status !== "draft" ||
      source.approved !== false ||
      source.review_status !== "Needs Review" ||
      source.human_review_required !== true ||
      source.verification_status !== "source_transcribed_not_fact_reviewed" ||
      value.letterModeEligible !== false ||
      source.letter_mode_eligible !== false
    )
      throw new Error(
        "Missing-category SQLite row is incomplete, changed, or no longer category-only: " +
          (id || "unknown"),
      );
    selected.push({
      id,
      contentHash: contentHash.toLowerCase(),
      categoryId,
      labelAr,
      mode: mode as "trivia" | "identity",
      promptAr,
      canonicalAnswer,
      acceptedAnswers,
      source,
      status: {
        status: value.status,
        approved: source.approved,
        review_status: source.review_status,
        human_review_required: source.human_review_required,
        verification_status: source.verification_status,
        letter_mode_eligible:
          source.letter_mode_eligible ?? value.letterModeEligible,
      },
    });
  }
  if (
    selected.length !== 4500 ||
    new Set(selected.map((row) => row.id)).size !== 4500 ||
    new Set(selected.map((row) => row.contentHash)).size !== 4500 ||
    CATEGORY_IDS.some(
      (id) => selected.filter((row) => row.categoryId === id).length !== 300,
    )
  )
    throw new Error(
      "Expected exactly 4,500 unique v19/v19.1 rows at 300 per allowlisted category.",
    );
  return selected.sort((a, b) => a.contentHash.localeCompare(b.contentHash));
}
function assertBase(base: CapturedBase) {
  if (
    base.projectId !== "huroof-a3ee7" ||
    base.databaseId !== "(default)" ||
    base.locationId !== "me-central2" ||
    base.root.path !== "releases/" + MEDIA_RELEASE_ID ||
    base.root.data.releaseId !== MEDIA_RELEASE_ID ||
    base.root.data.immutable !== true ||
    !same(base.pointer, pointer(base.root.data)) ||
    base.pointer.releaseId !== MEDIA_RELEASE_ID
  )
    throw new Error("Captured M04 base identity is invalid.");
  const children = base.documents.filter((document) =>
    document.path.startsWith(base.root.path + "/"),
  );
  if (
    children.length !== 11463 ||
    docHash(children) !== base.root.data.documentRootSha256 ||
    children.filter((document) => document.path.includes("/questions/"))
      .length !== 10838 ||
    children.filter((document) => document.path.includes("/catalogCategories/"))
      .length !== 68 ||
    children.filter((document) => document.path.includes("/inventory/"))
      .length !== 68 ||
    children.filter((document) => document.path.includes("/media/")).length !==
      489
  )
    throw new Error(
      "Captured M04 base tree is incomplete or differs from its immutable root.",
    );
  if (
    new Set(children.map((document) => document.path)).size !==
      children.length ||
    children.some((document) => document.path.split("/").length !== 4)
  )
    throw new Error(
      "Captured M04 base contains duplicate or unsupported descendants.",
    );
}
function pointer(root: Record<string, unknown>) {
  return {
    releaseId: root.releaseId,
    approvedCount: root.approvedCount,
    catalogSha256: root.catalogSha256,
    documentRootSha256: root.documentRootSha256,
    sourceManifestSha256: root.sourceManifestSha256,
    ownerApprovalPath: root.ownerApprovalPath,
    publicationAuthority: root.publicationAuthority,
    baseReleaseId: root.baseReleaseId,
  };
}
function assertUniquePaths(documents: ReleaseDocument[]) {
  if (
    new Set(documents.map((document) => document.path)).size !==
    documents.length
  )
    throw new Error("Supplement contains duplicate immutable document paths.");
}
function validateNewDocumentPaths(documents: ReleaseDocument[]) {
  assertUniquePaths(documents);
  if (
    documents.some((document) =>
      document.path.split("/").some((part) => !SAFE_DOCUMENT_ID.test(part)),
    )
  )
    throw new Error("Supplement contains unsafe new immutable document paths.");
}

export async function buildOwnerCategorySupplementPlan(input: {
  base: CapturedBase;
  sqlitePath: string;
  sourceHashes: SourceHashManifest;
  sqliteBytes?: Uint8Array;
}): Promise<CategorySupplementPlan> {
  if (
    input.sourceHashes.v19.sha256 !== V19_SOURCE_SHA256 ||
    input.sourceHashes.v191.sha256 !== V191_SOURCE_SHA256 ||
    input.sourceHashes.v19.path !== V19_SOURCE_PATH ||
    input.sourceHashes.v191.path !== V191_SOURCE_PATH
  )
    throw new Error(
      "Category supplement source hash manifest differs from the audited v19/v19.1 inputs.",
    );
  assertBase(input.base);
  const bytes = input.sqliteBytes ?? (await readFile(input.sqlitePath)),
    rows = sourceRows(input.sqlitePath, input.sourceHashes);
  const bindings = rows
    .map((row) => ({
      id: row.id,
      contentHash: row.contentHash,
      categoryId: row.categoryId,
      sourcePackage: row.source.source_package,
      sourceFile: row.source.source_file,
      sourceLine: row.source.source_line,
    }))
    .sort((a, b) => a.contentHash.localeCompare(b.contentHash));
  const bindingSha256 = hash(bindings),
    runId = "owner-category-supplement-" + bindingSha256.slice(0, 32),
    approvalPath = "contentOwnerApprovals/" + runId;
  const baseQuestions = input.base.documents
    .filter((document) => document.path.includes("/questions/"))
    .map(
      (document) =>
        document.data as RuntimeQuestionV32 & Record<string, unknown>,
    );
  const tuple = (categoryId: string, promptAr: string, answer: string) =>
    categoryId +
    "\0" +
    normalizeArabic(promptAr) +
    "\0" +
    normalizeArabic(answer);
  const seenTuples = new Set(
      baseQuestions.map((question) =>
        tuple(question.categoryId, question.promptAr, question.canonicalAnswer),
      ),
    ),
    seenIds = new Set(baseQuestions.map((question) => String(question.id)));
  const additions: ReleaseDocument[] = rows.map((row) => {
    const id =
        "owner-category-" +
        hash({ id: row.id, contentHash: row.contentHash }).slice(0, 48),
      key = tuple(row.categoryId, row.promptAr, row.canonicalAnswer);
    if (seenIds.has(id) || seenTuples.has(key))
      throw new Error(
        "Category supplement source collides with a captured M04 question.",
      );
    seenIds.add(id);
    seenTuples.add(key);
    return {
      path: "",
      data: {
        id,
        categoryId: row.categoryId,
        modality: "classic",
        targetLetter: "",
        letterModeEligible: false,
        categoryModeOnly: true,
        answerConceptId: sha(normalizeArabic(row.canonicalAnswer)),
        headerAr: row.labelAr,
        promptAr: row.promptAr,
        canonicalAnswer: row.canonicalAnswer,
        acceptedAnswers: row.acceptedAnswers,
        sourceContentHash: row.contentHash,
        sourceIdentity: row.id,
        sourceMode: row.mode,
        sourceProvenance: { ...row.source, ...row.status },
        publicationAuthority: "owner_authorization_category_supplement",
        specialistReview: "not_claimed",
        immutable: true,
      },
    };
  });
  const releaseId =
    "owner-category-release-" +
    hash({
      base: input.base.root.data.documentRootSha256,
      bindingSha256,
      ids: additions.map((document) => document.data.id).sort(),
    }).slice(0, 32);
  for (const addition of additions)
    addition.path = "releases/" + releaseId + "/questions/" + addition.data.id;
  const copied = input.base.documents
    .filter((document) => document.path !== input.base.root.path)
    .map((document) => ({
      path: document.path.replace(
        "releases/" + MEDIA_RELEASE_ID + "/",
        "releases/" + releaseId + "/",
      ),
      data: document.data,
    }));
  const catalog = CATEGORY_IDS.map((categoryId) => ({
    path: "releases/" + releaseId + "/catalogCategories/" + categoryId,
    data: {
      id: categoryId,
      labelAr: rows.find((row) => row.categoryId === categoryId)!.labelAr,
      runtimeScope: "owner_category_supplement",
      immutable: true,
    },
  }));
  const inventory = CATEGORY_IDS.map((categoryId) => ({
    path: "releases/" + releaseId + "/inventory/" + categoryId,
    data: {
      categoryId,
      approvedCount: 300,
      uniqueAnswerConceptCount: new Set(
        additions
          .filter((document) => document.data.categoryId === categoryId)
          .map((document) => document.data.answerConceptId),
      ).size,
      immutable: true,
    },
  }));
  const children = [...copied, ...catalog, ...inventory, ...additions].sort(
    (a, b) => a.path.localeCompare(b.path),
  );
  // M04 media IDs are captured immutable inputs and include Firestore-valid
  // colons. The stricter local document-ID rule applies only to additions.
  validateNewDocumentPaths([...catalog, ...inventory, ...additions]);
  assertUniquePaths(children);
  if (children.length !== 15993)
    throw new Error(
      "Supplement release has an unexpected immutable child count.",
    );
  const catalogSha256 = docHash(
      children.filter((document) =>
        document.path.includes("/catalogCategories/"),
      ),
    ),
    documentRootSha256 = docHash(children),
    sourceManifestSha256 = hash({
      sqliteSha256: sha(bytes),
      hashes: input.sourceHashes,
      bindingSha256,
      count: rows.length,
    });
  const root: ReleaseDocument = {
    path: "releases/" + releaseId,
    data: {
      schemaVersion: "owner-category-supplement-v1",
      releaseId,
      baseReleaseId: MEDIA_RELEASE_ID,
      baseDocumentRootSha256: input.base.root.data.documentRootSha256,
      capturedPointerSha256: hash(input.base.pointer),
      ownerApprovalPath: approvalPath,
      publicationAuthority: "owner_authorization_category_supplement",
      specialistReview: "not_claimed",
      approvedCount: 15338,
      catalogSha256,
      documentRootSha256,
      sourceManifestSha256,
      categoryModeOnlyCount: 4500,
      mediaRecordCount: 489,
      immutable: true,
    },
  };
  const allQuestions = [
    ...baseQuestions,
    ...additions.map((document) => document.data as RuntimeQuestionV32),
  ];
  const readiness: CategorySupplementPlan["readiness"] = {};
  for (const categoryId of CATEGORY_IDS) {
    const partner = [
      ...new Set(allQuestions.map((question) => question.categoryId)),
    ].find(
      (id) =>
        id !== categoryId &&
        (() => {
          try {
            createCategoryQuestionSelection(allQuestions, {
              categories: [categoryId, id],
              modality: "classic",
              seed: 1,
            });
            return true;
          } catch {
            return false;
          }
        })(),
    );
    if (!partner)
      throw new Error("New category does not pass a Category-mode selector.");
    readiness[categoryId] = {
      selected: 300,
      categoryMode: true,
      huroof: false,
      detail:
        "Category selector passed with " +
        partner +
        "; explicitly excluded from Huroof.",
    };
  }
  try {
    createMatchQuestionSelection(
      additions.map((document) => document.data as RuntimeQuestionV32),
      { categories: [...CATEGORY_IDS], modality: "classic", seed: 1 },
    );
    throw new Error(
      "Category-only additions unexpectedly entered Huroof selection.",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "Category-only additions unexpectedly entered Huroof selection."
    )
      throw error;
  }
  const approvalDocuments: ReleaseDocument[] = Array.from(
    { length: 45 },
    (_, index) => {
      const slice = bindings.slice(index * 100, index * 100 + 100);
      return {
        path:
          approvalPath + "/entries/chunk-" + String(index + 1).padStart(5, "0"),
        data: {
          schemaVersion: "owner-category-source-binding-v1",
          runId,
          approvalState: "owner_approved",
          authority: "owner_authorization_category_supplement",
          specialistReview: "not_claimed",
          sourceBindings: slice,
          sourceBindingsSha256: hash(slice),
          immutable: true,
        },
      };
    },
  );
  approvalDocuments.push({
    path: approvalPath,
    data: {
      schemaVersion: "owner-category-approval-v1",
      runId,
      approvalState: "owner_approved",
      manifestComplete: true,
      releaseActivated: false,
      authority: "owner_authorization_category_supplement",
      userInstruction: "all uploaded categories working",
      specialistReview: "not_claimed",
      sourceReviewNotes: "source_transcribed_not_fact_reviewed preserved",
      sqliteSha256: sha(bytes),
      sourceHashes: input.sourceHashes,
      sourceRecordCount: 4500,
      bindingSha256,
      projectId: "huroof-a3ee7",
      databaseId: "(default)",
      immutable: true,
    },
  });
  return {
    schemaVersion: "owner-category-supplement-v1",
    releaseId,
    target: {
      projectId: "huroof-a3ee7",
      databaseId: "(default)",
      locationId: "me-central2",
    },
    base: input.base,
    source: {
      sqliteSha256: sha(bytes),
      hashes: input.sourceHashes,
      recordCount: 4500,
      categories: Object.fromEntries(CATEGORY_IDS.map((id) => [id, 300])),
      bindingSha256,
    },
    ownerApproval: {
      path: approvalPath,
      runId,
      authority: "owner_approval",
      specialistReview: "not_claimed",
    },
    documents: [...children, root].sort((a, b) => a.path.localeCompare(b.path)),
    approvalDocuments,
    approvedCount: 15338,
    catalogSha256,
    documentRootSha256,
    sourceManifestSha256,
    readiness,
  };
}
function root(plan: CategorySupplementPlan) {
  const value = plan.documents.find(
    (document) => document.path === "releases/" + plan.releaseId,
  );
  if (!value) throw new Error("Supplement root is absent.");
  return value;
}
function verification(plan: CategorySupplementPlan) {
  return {
    path:
      "ownerCategoryVerificationReceipts/" +
      plan.releaseId +
      "-" +
      plan.documentRootSha256,
    data: {
      releaseId: plan.releaseId,
      baseReleaseId: MEDIA_RELEASE_ID,
      documentRootSha256: plan.documentRootSha256,
      ownerApprovalPath: plan.ownerApproval.path,
      verificationKind: "owner_category_exact_readback",
      immutable: true,
    },
  };
}
function activation(plan: CategorySupplementPlan) {
  return {
    path: "activationReceipts/" + plan.releaseId + "-owner-category",
    data: {
      releaseId: plan.releaseId,
      baseReleaseId: MEDIA_RELEASE_ID,
      activePointer: pointer(root(plan).data),
      ownerApprovalPath: plan.ownerApproval.path,
      immutable: true,
    },
  };
}
function rollbackReceipt(
  plan: CategorySupplementPlan,
  operationReference: string,
) {
  return {
    path:
      "rollbackReceipts/" +
      plan.releaseId +
      "-" +
      sha(operationReference).slice(0, 32),
    data: {
      releaseId: plan.releaseId,
      expectedActivePointer: pointer(root(plan).data),
      restorePointer: plan.base.pointer,
      operationReference,
      immutable: true,
    },
  };
}
function reactivationReceipt(
  plan: CategorySupplementPlan,
  rollback: ReleaseDocument,
  operationReference: string,
) {
  return {
    path:
      "reactivationReceipts/" +
      plan.releaseId +
      "-" +
      sha(operationReference).slice(0, 32),
    data: {
      releaseId: plan.releaseId,
      baseReleaseId: MEDIA_RELEASE_ID,
      originalActivationPath: activation(plan).path,
      originalActivationSha256: hash(activation(plan).data),
      rollbackReceiptPath: rollback.path,
      rollbackReceiptSha256: hash(rollback.data),
      expectedM04Pointer: plan.base.pointer,
      activePointer: pointer(root(plan).data),
      operationReference,
      immutable: true,
    },
  };
}
async function pending(
  api: CategorySupplementApi,
  documents: ReleaseDocument[],
) {
  const result: ReleaseDocument[] = [];
  for (let offset = 0; offset < documents.length; offset += 300) {
    const part = documents.slice(offset, offset + 300),
      stored = await api.read(part.map((document) => document.path));
    for (let index = 0; index < part.length; index += 1) {
      const value = stored[index];
      if (!value) result.push(part[index]!);
      else if (!same(decodeSourceDocument(value).data, part[index]!.data))
        throw new Error(
          "Existing immutable supplement document conflicts with the prepared payload.",
        );
    }
  }
  return result;
}
export async function applyOwnerCategorySupplement(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
  rebuild: () => Promise<CategorySupplementPlan>,
) {
  if (!same(plan, await rebuild()))
    throw new Error(
      "Supplement plan differs from the deterministic local authority rebuild.",
    );
  const target = await api.target();
  if (
    target.projectId !== "huroof-a3ee7" ||
    target.databaseId !== "(default)" ||
    target.locationId !== "me-central2" ||
    target.type !== "FIRESTORE_NATIVE"
  )
    throw new Error("Supplement target is not pinned production Firestore.");
  await verifyBase(plan, api);
  for (const stage of [
    plan.approvalDocuments,
    plan.documents.filter((document) => document.path !== root(plan).path),
  ]) {
    const creates = await pending(api, stage);
    if (creates.length) await api.create(creates);
  }
  await verifyPreparedChildren(plan, api);
  const preparedRoot = root(plan);
  const rootCreates = await pending(api, [preparedRoot]);
  if (rootCreates.length) await api.create(rootCreates);
  await verifyRoot(plan, api);
  const verificationCreates = await pending(api, [verification(plan)]);
  if (verificationCreates.length) await api.create(verificationCreates);
  await verifyOwnerCategorySupplement(plan, api);
  await api.activate(plan, verification(plan));
  await verifyOwnerCategorySupplement(plan, api);
}
async function verifyBase(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  const expected = new Map([
    [plan.base.root.path, plan.base.root.data],
    ...plan.base.documents.map(
      (document) =>
        [document.path, document.data] as [string, Record<string, unknown>],
    ),
  ]);
  const pointerDocument = (await api.read(["runtime/activeRelease"]))[0],
    expectedActive = pointer(root(plan).data);
  if (
    !pointerDocument ||
    (!same(decodeSourceDocument(pointerDocument).data, plan.base.pointer) &&
      !same(decodeSourceDocument(pointerDocument).data, expectedActive))
  )
    throw new Error("Captured M04 base pointer, root, or child changed.");
  const paths = [...expected.keys()];
  for (let offset = 0; offset < paths.length; offset += 300) {
    const part = paths.slice(offset, offset + 300),
      actual = await api.read(part);
    if (
      actual.some(
        (document, index) =>
          !document ||
          !same(
            decodeSourceDocument(document).data,
            expected.get(part[index]!)!,
          ),
      )
    )
      throw new Error("Captured M04 base pointer, root, or child changed.");
  }
}
async function verifyApproval(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  const approval = await api.read(
    plan.approvalDocuments.map((document) => document.path),
  );
  if (
    approval.some(
      (document, index) =>
        !document ||
        !same(
          decodeSourceDocument(document).data,
          plan.approvalDocuments[index]!.data,
        ),
    )
  )
    throw new Error(
      "Supplement owner authority differs from the prepared payload.",
    );
}
async function verifyPreparedChildren(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  await verifyApproval(plan, api);
  const expectedRoot = root(plan);
  const ids = (await api.listCollectionIds(expectedRoot.path)).sort();
  if (!same(ids, ["catalogCategories", "inventory", "media", "questions"]))
    throw new Error(
      "Supplement immutable child readback collection contract differs from the prepared payload.",
    );
  const children: ReleaseDocument[] = [];
  for (const id of ids)
    for (const document of await api.listCollection(
      expectedRoot.path + "/" + id,
    ))
      children.push({
        path: pathOf(document.name),
        data: decodeSourceDocument(document).data,
      });
  const expectedChildren = plan.documents.filter(
    (document) => document.path !== expectedRoot.path,
  );
  if (
    children.length !== expectedChildren.length ||
    docHash(children) !== plan.documentRootSha256 ||
    expectedChildren.some(
      (document) =>
        !same(
          children.find((child) => child.path === document.path)?.data,
          document.data,
        ),
    )
  )
    throw new Error(
      "Supplement immutable child readback differs from the prepared payload.",
    );
}
async function verifyRoot(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  const expectedRoot = root(plan);
  const rootDocument = (await api.read([expectedRoot.path]))[0];
  if (
    !rootDocument ||
    !same(decodeSourceDocument(rootDocument).data, expectedRoot.data)
  )
    throw new Error(
      "Supplement completion root differs from the prepared payload.",
    );
}
async function verifyRetainedSupplement(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  await verifyRoot(plan, api);
  const verificationDocument = (await api.read([verification(plan).path]))[0];
  if (
    !verificationDocument ||
    !same(
      decodeSourceDocument(verificationDocument).data,
      verification(plan).data,
    )
  )
    throw new Error(
      "Supplement verification receipt differs from the prepared payload.",
    );
  const originalActivation = (await api.read([activation(plan).path]))[0];
  if (
    !originalActivation ||
    !same(decodeSourceDocument(originalActivation).data, activation(plan).data)
  )
    throw new Error(
      "Supplement original activation receipt differs from the prepared payload.",
    );
  await verifyApproval(plan, api);
  await verifyPreparedChildren(plan, api);
}
export async function verifyOwnerCategorySupplement(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  const expectedRoot = root(plan),
    expectedVerification = verification(plan),
    expectedActivation = activation(plan);
  const [pointerDoc, rootDoc, verificationDoc, activationDoc] = await api.read([
    "runtime/activeRelease",
    expectedRoot.path,
    expectedVerification.path,
    expectedActivation.path,
  ]);
  if (
    !rootDoc ||
    !verificationDoc ||
    !same(decodeSourceDocument(rootDoc).data, expectedRoot.data) ||
    !same(decodeSourceDocument(verificationDoc).data, expectedVerification.data)
  )
    throw new Error(
      "Supplement root or verification receipt differs from the prepared payload.",
    );
  await verifyApproval(plan, api);
  if (!pointerDoc) throw new Error("Supplement active pointer is absent.");
  const pointerData = decodeSourceDocument(pointerDoc).data;
  const active = Boolean(activationDoc);
  if (
    active
      ? !same(pointerData, pointer(expectedRoot.data)) ||
        !same(
          decodeSourceDocument(activationDoc!).data,
          expectedActivation.data,
        )
      : !same(pointerData, plan.base.pointer)
  )
    throw new Error(
      "Supplement active pointer or receipt differs from the prepared payload.",
    );
  await verifyPreparedChildren(plan, api);
  return { releaseId: plan.releaseId, active: Boolean(active) };
}
export async function rollbackOwnerCategorySupplement(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
  operationReference: string,
) {
  if (!/^[A-Za-z0-9._:-]{3,160}$/u.test(operationReference))
    throw new Error("Rollback operation reference is invalid.");
  await api.rollback(plan, rollbackReceipt(plan, operationReference));
}
export async function reactivateOwnerCategorySupplement(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
  rollbackOperationReference: string,
  operationReference: string,
) {
  if (
    !/^[A-Za-z0-9._:-]{3,160}$/u.test(rollbackOperationReference) ||
    !/^[A-Za-z0-9._:-]{3,160}$/u.test(operationReference)
  )
    throw new Error("Reactivation operation reference is invalid.");
  const target = await api.target();
  if (
    target.projectId !== "huroof-a3ee7" ||
    target.databaseId !== "(default)" ||
    target.locationId !== "me-central2" ||
    target.type !== "FIRESTORE_NATIVE"
  )
    throw new Error("Supplement target is not pinned production Firestore.");
  await verifyBase(plan, api);
  const rollback = rollbackReceipt(plan, rollbackOperationReference);
  await verifyRetainedSupplement(plan, api);
  await api.reactivate(
    plan,
    rollback,
    reactivationReceipt(plan, rollback, operationReference),
  );
  await verifyOwnerCategorySupplement(plan, api);
}

type Transport = { fetch?: typeof fetch; accessToken?: () => Promise<string> };
const firestoreName = (path: string) =>
  "projects/huroof-a3ee7/databases/(default)/documents/" + path;
const encode = (value: unknown): Record<string, unknown> => {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    )
      throw new Error(
        "Supplement number is not a finite safe Firestore value.",
      );
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === "object")
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(
            ([key, child]) => [key, encode(child)],
          ),
        ),
      },
    };
  throw new Error("Supplement value is not Firestore serializable.");
};
const rows = (body: string): Array<{ found?: SourceDocument }> => {
  const value = body.trim();
  return !value
    ? []
    : value.startsWith("[")
      ? JSON.parse(value)
      : value
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
};
export async function createProductionOwnerCategorySupplementApi(
  transport: Transport = {},
): Promise<CategorySupplementApi> {
  const require = createRequire(import.meta.url),
    fetcher = transport.fetch ?? fetch;
  const base =
    "https://firestore.googleapis.com/v1/projects/huroof-a3ee7/databases/(default)/documents";
  const getToken = async () => {
    if (transport.accessToken) return transport.accessToken();
    const auth = require("firebase-tools/lib/auth.js") as {
      getGlobalDefaultAccount():
        { tokens?: { refresh_token?: string } } | undefined;
      getAccessToken(
        value: string,
        scopes: string[],
      ): Promise<{ access_token?: string }>;
    };
    const refresh = auth.getGlobalDefaultAccount()?.tokens?.refresh_token;
    const access = refresh
      ? await auth.getAccessToken(refresh, [
          "https://www.googleapis.com/auth/cloud-platform",
        ])
      : undefined;
    if (!access?.access_token)
      throw new Error("Firebase CLI access token is unavailable.");
    return access.access_token;
  };
  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetcher(url, {
      ...init,
      headers: {
        Authorization: "Bearer " + (await getToken()),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok)
      throw new Error("Firestore REST " + String(response.status));
    return response;
  };
  const read = async (paths: string[]) => {
    const response = await request(base + ":batchGet", {
      method: "POST",
      body: JSON.stringify({ documents: paths.map(firestoreName) }),
    });
    const found = new Map(
      rows(await response.text())
        .filter((row) => row.found)
        .map((row) => [pathOf(row.found!.name), row.found!]),
    );
    return paths.map((path) => found.get(path));
  };
  const create = async (documents: ReleaseDocument[]) => {
    for (let offset = 0; offset < documents.length; offset += 250) {
      const pendingDocs = await pending(
        { read } as CategorySupplementApi,
        documents.slice(offset, offset + 250),
      );
      if (pendingDocs.length)
        await request(base + ":commit", {
          method: "POST",
          body: JSON.stringify({
            writes: pendingDocs.map((document) => ({
              update: {
                name: firestoreName(document.path),
                fields: Object.fromEntries(
                  Object.entries(document.data).map(([key, value]) => [
                    key,
                    encode(value),
                  ]),
                ),
              },
              currentDocument: { exists: false },
            })),
          }),
        });
    }
  };
  const listCollectionIds = async (path: string) => {
    const ids: string[] = [];
    let pageToken = "";
    do {
      const page = (await (
        await request(
          "https://firestore.googleapis.com/v1/" +
            firestoreName(path) +
            ":listCollectionIds",
          {
            method: "POST",
            body: JSON.stringify({
              pageSize: 1000,
              ...(pageToken ? { pageToken } : {}),
            }),
          },
        )
      ).json()) as { collectionIds?: string[]; nextPageToken?: string };
      ids.push(...(page.collectionIds ?? []));
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return ids;
  };
  const listCollection = async (path: string) => {
    const documents: SourceDocument[] = [];
    let pageToken = "";
    do {
      const page = (await (
        await request(
          base +
            "/" +
            path +
            "?pageSize=1000" +
            (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""),
        )
      ).json()) as { documents?: SourceDocument[]; nextPageToken?: string };
      documents.push(...(page.documents ?? []));
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return documents;
  };
  const activationRequest = async (
    plan: CategorySupplementPlan,
    verificationDocument: ReleaseDocument,
  ) => {
    const active = activation(plan),
      expected = pointer(root(plan).data);
    const begin = (await (
      await request(base + ":beginTransaction", { method: "POST", body: "{}" })
    ).json()) as { transaction?: string };
    if (!begin.transaction)
      throw new Error("Activation transaction unavailable.");
    const guardPaths = [
      "runtime/activeRelease",
      root(plan).path,
      verificationDocument.path,
      ...plan.approvalDocuments.map((document) => document.path),
      active.path,
    ];
    const response = await request(base + ":batchGet", {
      method: "POST",
      body: JSON.stringify({
        transaction: begin.transaction,
        documents: guardPaths.map(firestoreName),
      }),
    });
    const found = new Map(
      rows(await response.text())
        .filter((row) => row.found)
        .map((row) => [pathOf(row.found!.name), row.found!]),
    );
    const [old, releaseRoot, verified, ...authorityAndPrior] = guardPaths.map(
      (path) => found.get(path),
    );
    const prior = authorityAndPrior.at(-1);
    const authority = authorityAndPrior.slice(0, -1);
    if (
      !old ||
      !releaseRoot ||
      !verified ||
      authority.some(
        (document, index) =>
          !document ||
          !same(
            decodeSourceDocument(document).data,
            plan.approvalDocuments[index]!.data,
          ),
      ) ||
      !same(decodeSourceDocument(releaseRoot).data, root(plan).data) ||
      !same(decodeSourceDocument(verified).data, verificationDocument.data)
    )
      throw new Error("Activation authority or release identity drifted.");
    if (prior) {
      if (
        same(decodeSourceDocument(old).data, expected) &&
        same(decodeSourceDocument(prior).data, active.data)
      )
        return;
      throw new Error("Activation retry conflicts with active pointer.");
    }
    if (!same(decodeSourceDocument(old).data, plan.base.pointer))
      throw new Error("Activation pointer changed.");
    const writes = [
      active,
      { path: "runtime/activeRelease", data: expected },
    ].map((document) => ({
      update: {
        name: firestoreName(document.path),
        fields: Object.fromEntries(
          Object.entries(document.data).map(([key, value]) => [
            key,
            encode(value),
          ]),
        ),
      },
      currentDocument:
        document.path === "runtime/activeRelease"
          ? { updateTime: old.updateTime }
          : { exists: false },
    }));
    await request(base + ":commit", {
      method: "POST",
      body: JSON.stringify({ transaction: begin.transaction, writes }),
    });
  };
  const rollback = async (
    plan: CategorySupplementPlan,
    receipt: ReleaseDocument,
  ) => {
    const expected = pointer(root(plan).data);
    const begin = (await (
      await request(base + ":beginTransaction", { method: "POST", body: "{}" })
    ).json()) as { transaction?: string };
    if (!begin.transaction)
      throw new Error("Rollback transaction unavailable.");
    const guardPaths = [
      "runtime/activeRelease",
      root(plan).path,
      verification(plan).path,
      activation(plan).path,
      receipt.path,
    ];
    const response = await request(base + ":batchGet", {
      method: "POST",
      body: JSON.stringify({
        transaction: begin.transaction,
        documents: guardPaths.map(firestoreName),
      }),
    });
    const found = new Map(
      rows(await response.text())
        .filter((row) => row.found)
        .map((row) => [pathOf(row.found!.name), row.found!]),
    );
    const current = guardPaths.map((path) => found.get(path));
    if (
      !current[0] ||
      !current[1] ||
      !current[2] ||
      !current[3] ||
      current[4] ||
      !same(decodeSourceDocument(current[0]).data, expected) ||
      !same(decodeSourceDocument(current[1]).data, root(plan).data) ||
      !same(decodeSourceDocument(current[2]).data, verification(plan).data) ||
      !same(decodeSourceDocument(current[3]).data, activation(plan).data)
    )
      throw new Error("Rollback CAS rejects altered active identity.");
    const writes = [
      {
        update: {
          name: firestoreName("runtime/activeRelease"),
          fields: Object.fromEntries(
            Object.entries(plan.base.pointer).map(([key, value]) => [
              key,
              encode(value),
            ]),
          ),
        },
        currentDocument: { updateTime: current[0].updateTime },
      },
      {
        update: {
          name: firestoreName(receipt.path),
          fields: Object.fromEntries(
            Object.entries(receipt.data).map(([key, value]) => [
              key,
              encode(value),
            ]),
          ),
        },
        currentDocument: { exists: false },
      },
    ];
    await request(base + ":commit", {
      method: "POST",
      body: JSON.stringify({ transaction: begin.transaction, writes }),
    });
  };
  const reactivate = async (
    plan: CategorySupplementPlan,
    rollbackDocument: ReleaseDocument,
    reactivationDocument: ReleaseDocument,
  ) => {
    const expected = pointer(root(plan).data);
    const begin = (await (
      await request(base + ":beginTransaction", { method: "POST", body: "{}" })
    ).json()) as { transaction?: string };
    if (!begin.transaction)
      throw new Error("Reactivation transaction unavailable.");
    const guardPaths = [
      "runtime/activeRelease",
      root(plan).path,
      verification(plan).path,
      activation(plan).path,
      ...plan.approvalDocuments.map((document) => document.path),
      rollbackDocument.path,
      reactivationDocument.path,
    ];
    const response = await request(base + ":batchGet", {
      method: "POST",
      body: JSON.stringify({
        transaction: begin.transaction,
        documents: guardPaths.map(firestoreName),
      }),
    });
    const found = new Map(
      rows(await response.text())
        .filter((row) => row.found)
        .map((row) => [pathOf(row.found!.name), row.found!]),
    );
    const [old, releaseRoot, verified, originalActivation, ...rest] =
      guardPaths.map((path) => found.get(path));
    const prior = rest.at(-1);
    const rollback = rest.at(-2);
    const authority = rest.slice(0, -2);
    if (
      !old ||
      !releaseRoot ||
      !verified ||
      !originalActivation ||
      !rollback ||
      authority.some(
        (document, index) =>
          !document ||
          !same(
            decodeSourceDocument(document).data,
            plan.approvalDocuments[index]!.data,
          ),
      ) ||
      !same(decodeSourceDocument(releaseRoot).data, root(plan).data) ||
      !same(decodeSourceDocument(verified).data, verification(plan).data) ||
      !same(
        decodeSourceDocument(originalActivation).data,
        activation(plan).data,
      ) ||
      !same(decodeSourceDocument(rollback).data, rollbackDocument.data)
    )
      throw new Error(
        "Reactivation authority, activation, or rollback evidence drifted.",
      );
    if (prior) {
      if (
        same(decodeSourceDocument(old).data, expected) &&
        same(decodeSourceDocument(prior).data, reactivationDocument.data)
      )
        return;
      throw new Error("Reactivation retry conflicts with active pointer.");
    }
    if (!same(decodeSourceDocument(old).data, plan.base.pointer))
      throw new Error("Reactivation pointer changed.");
    const writes = [
      {
        update: {
          name: firestoreName("runtime/activeRelease"),
          fields: Object.fromEntries(
            Object.entries(expected).map(([key, value]) => [
              key,
              encode(value),
            ]),
          ),
        },
        currentDocument: { updateTime: old.updateTime },
      },
      {
        update: {
          name: firestoreName(reactivationDocument.path),
          fields: Object.fromEntries(
            Object.entries(reactivationDocument.data).map(([key, value]) => [
              key,
              encode(value),
            ]),
          ),
        },
        currentDocument: { exists: false },
      },
    ];
    await request(base + ":commit", {
      method: "POST",
      body: JSON.stringify({ transaction: begin.transaction, writes }),
    });
  };
  return {
    target: async () => {
      const value = (await (
        await request(
          "https://firestore.googleapis.com/v1/projects/huroof-a3ee7/databases/(default)",
        )
      ).json()) as { locationId?: string; type?: string };
      return {
        projectId: "huroof-a3ee7",
        databaseId: "(default)",
        locationId: value.locationId ?? "",
        type: value.type ?? "",
      };
    },
    read,
    create,
    listCollectionIds,
    listCollection,
    activate: activationRequest,
    rollback,
    reactivate,
  };
}

// The CLI deliberately requires a live M04 snapshot; it never discovers a base or writes by default.
async function main() {
  const [operation, ...args] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1] || flags[args[i]!.slice(2)])
      throw new Error("Use unique --name value flags.");
    flags[args[i]!.slice(2)] = args[i + 1]!;
  }
  if (
    !operation ||
    !flags["base-snapshot"] ||
    !flags.sqlite ||
    !flags["source-hashes"] ||
    !(operation === "prepare" ? flags.out : flags.plan)
  )
    throw new Error(
      "Usage: owner-category-supplement <prepare|apply|verify|rollback|reactivate> --base-snapshot PATH --sqlite PATH --source-hashes PATH --out PATH | --plan PATH [--operation-reference REF] [--rollback-operation-reference REF]",
    );
  const input = {
    base: JSON.parse(
      await readFile(flags["base-snapshot"]!, "utf8"),
    ) as CapturedBase,
    sqlitePath: flags.sqlite!,
    sourceHashes: JSON.parse(
      await readFile(flags["source-hashes"]!, "utf8"),
    ) as SourceHashManifest,
  };
  const built = await buildOwnerCategorySupplementPlan(input);
  if (operation === "prepare") {
    await writeFile(resolve(flags.out!), JSON.stringify(built, null, 2) + "\n");
    console.log(
      JSON.stringify(
        {
          operation,
          releaseId: built.releaseId,
          approvedCount: built.approvedCount,
          categories: 83,
          media: 489,
          productionWrite: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!same(built, JSON.parse(await readFile(flags.plan!, "utf8"))))
    throw new Error(
      "Stored supplement plan differs from deterministic rebuild.",
    );
  const api = await createProductionOwnerCategorySupplementApi();
  if (operation === "apply") {
    await applyOwnerCategorySupplement(built, api, () =>
      buildOwnerCategorySupplementPlan(input),
    );
    console.log(
      JSON.stringify(
        { operation, releaseId: built.releaseId, activated: true },
        null,
        2,
      ),
    );
    return;
  }
  if (operation === "verify") {
    console.log(
      JSON.stringify(
        { operation, ...(await verifyOwnerCategorySupplement(built, api)) },
        null,
        2,
      ),
    );
    return;
  }
  if (operation === "rollback" && flags["operation-reference"]) {
    await rollbackOwnerCategorySupplement(
      built,
      api,
      flags["operation-reference"],
    );
    console.log(
      JSON.stringify(
        { operation, restoredReleaseId: MEDIA_RELEASE_ID },
        null,
        2,
      ),
    );
    return;
  }
  if (
    operation === "reactivate" &&
    flags["rollback-operation-reference"] &&
    flags["operation-reference"]
  ) {
    await reactivateOwnerCategorySupplement(
      built,
      api,
      flags["rollback-operation-reference"],
      flags["operation-reference"],
    );
    console.log(
      JSON.stringify(
        {
          operation,
          releaseId: built.releaseId,
          reactivatedFrom: MEDIA_RELEASE_ID,
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error("Unknown operation or missing rollback operation reference.");
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
