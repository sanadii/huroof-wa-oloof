/** Immutable successor that reconciles verified Q6000 with retained M05. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { normalizeArabic } from "../src/question-bank.js";
import {
  createCategoryQuestionSelection,
  createMatchQuestionSelection,
  type RuntimeQuestionV32,
} from "../src/features/game/runtime/question-selector.js";
import { canonicalJson } from "./firestore-release-canonical.js";
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
const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const RETAINED_M05_PLAN_SHA256 =
  "2d0200698a5471c309cc633165ec4fc83f02e4bf3009a47ae5d07811bf20ecb4";
const hash = (value: unknown) => sha(canonicalJson(value));
const same = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);
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
  /** Q6000 owner approval plus the Q4800/M04 root-and-approval lineage. */
  authorityDocuments?: ReleaseDocument[];
};
export type CategorySupplementPlan = {
  schemaVersion: "owner-category-reconciliation-v1";
  releaseId: string;
  target: {
    projectId: "huroof-a3ee7";
    databaseId: "(default)";
    locationId: "me-central2";
  };
  base: CapturedBase;
  source: {
    retainedM05PlanSha256: string;
    retainedM05RootSha256: string;
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
  retainedM05Documents: ReleaseDocument[];
  approvalDocuments: ReleaseDocument[];
  approvedCount: 25763;
  catalogSha256: string;
  documentRootSha256: string;
  sourceManifestSha256: string;
  readiness: Record<
    string,
    { selected: number; categoryMode: boolean; huroof: false; detail: string }
  >;
};
export type CategorySupplementApi = {
  target(): Promise<{ projectId: string; databaseId: string; locationId: string; type: string }>;
  read(paths: string[]): Promise<Array<SourceDocument | undefined>>;
  create(documents: ReleaseDocument[]): Promise<void>;
  listCollectionIds(path: string): Promise<string[]>;
  listCollection(path: string): Promise<SourceDocument[]>;
  activate(plan: CategorySupplementPlan, verification: ReleaseDocument): Promise<void>;
  rollback(plan: CategorySupplementPlan, receipt: ReleaseDocument): Promise<void>;
  reactivate(plan: CategorySupplementPlan, rollbackReceipt: ReleaseDocument, reactivationReceipt: ReleaseDocument): Promise<void>;
};

function pointer(root: Record<string, unknown>) {
  return {
    releaseId: root.releaseId,
    approvedCount: root.approvedCount,
    approvedJsonlSha256: root.approvedJsonlSha256,
    catalogSha256: root.catalogSha256,
    documentRootSha256: root.documentRootSha256,
    sourceManifestSha256: root.sourceManifestSha256,
    ownerApprovalPath: root.ownerApprovalPath,
    publicationAuthority: root.publicationAuthority,
  };
}
function assertUniquePaths(documents: ReleaseDocument[]) {
  if (
    new Set(documents.map((document) => document.path)).size !==
    documents.length
  )
    throw new Error("Supplement contains duplicate immutable document paths.");
}
export function assertNoQuestionOverlap(
  baseQuestions: Array<Record<string, unknown>>,
  additions: ReleaseDocument[],
) {
  const tuple = (question: Record<string, unknown>) =>
    `${question.categoryId}\0${normalizeArabic(String(question.promptAr))}\0${normalizeArabic(String(question.canonicalAnswer))}`;
  const ids = new Set(baseQuestions.map((question) => String(question.id)));
  const tuples = new Set(baseQuestions.map(tuple));
  for (const document of additions) {
    if (ids.has(String(document.data.id)) || tuples.has(tuple(document.data)))
      throw new Error("Retained M05 addition conflicts with Q6000 identity or normalized content.");
  }
}
export type Q6000Candidate = {
  release: { releaseId: string; approvedCount: number; documentRootSha256: string; documents: ReleaseDocument[] };
  approvalDocuments: ReleaseDocument[];
  ownerApproval: { runId: string };
};
export async function buildOwnerCategoryReconciliationPlan(input: {
  base: CapturedBase;
  q6000: Q6000Candidate;
  m05Plan: Omit<CategorySupplementPlan, "schemaVersion" | "approvedCount"> & { schemaVersion: string; approvedCount: number };
  m05Snapshot: CapturedBase;
  m05PlanSha256: string;
  allowCandidate?: boolean;
}): Promise<CategorySupplementPlan> {
  const baseRoot = input.base.root;
  const q6000 = input.q6000.release;
  if (
    input.base.projectId !== "huroof-a3ee7" || input.base.databaseId !== "(default)" ||
    input.base.locationId !== "me-central2" || baseRoot.path !== `releases/${q6000.releaseId}` ||
    baseRoot.data.releaseId !== q6000.releaseId || baseRoot.data.immutable !== true ||
    !same(input.base.pointer, pointer(baseRoot.data)) || baseRoot.data.documentRootSha256 !== q6000.documentRootSha256 ||
    baseRoot.data.approvedCount !== 21263 || q6000.approvedCount !== 21263 || q6000.documents.length !== 21915
  ) throw new Error("Fresh base is not the exact verified Q6000 release.");
  const baseChildren = input.base.documents.filter((document) => document.path !== baseRoot.path);
  if (baseChildren.length !== 21914 || docHash(baseChildren) !== q6000.documentRootSha256)
    throw new Error("Fresh Q6000 child inventory differs from its frozen candidate.");
  const m05Root = input.m05Plan.documents.find((document) => document.path === `releases/${input.m05Plan.releaseId}`);
  if (!m05Root || input.m05Plan.schemaVersion !== "owner-category-supplement-v1" || input.m05Plan.approvedCount !== 15338 || input.m05Plan.documents.length !== 15994)
    throw new Error("Retained M05 plan contract is invalid.");
  if (input.m05Snapshot.root.path !== m05Root.path || !same(input.m05Snapshot.root.data, m05Root.data) || input.m05Snapshot.documents.length !== 15994 ||
      input.m05Snapshot.documents.some((document) => !same(input.m05Plan.documents.find((candidate) => candidate.path === document.path)?.data, document.data)))
    throw new Error("Retained M05 snapshot differs from its immutable plan.");
  if (docHash(input.m05Snapshot.documents.filter((document) => document.path !== m05Root.path)) !== m05Root.data.documentRootSha256)
    throw new Error("Retained M05 child hash differs from immutable root.");
  const additions = input.m05Plan.documents.filter((document) => document.path.includes("/questions/") && document.data.categoryModeOnly === true);
  const categories = input.m05Plan.documents.filter((document) => document.path.includes("/catalogCategories/") && (CATEGORY_IDS as readonly string[]).includes(String(document.data.id)));
  const inventory = input.m05Plan.documents.filter((document) => document.path.includes("/inventory/") && (CATEGORY_IDS as readonly string[]).includes(String(document.data.categoryId)));
  if (additions.length !== 4500 || categories.length !== 15 || inventory.length !== 15 || new Set(additions.map((document) => String(document.data.id))).size !== 4500)
    throw new Error("Retained M05 additions are incomplete.");
  if (additions.some((document) => document.data.modality !== "classic" || document.data.targetLetter !== "" || document.data.letterModeEligible !== false || document.data.specialistReview !== "not_claimed" || document.data.publicationAuthority !== "owner_authorization_category_supplement"))
    throw new Error("Retained M05 additions are not exact Category-only authority payloads.");
  const baseQuestions = baseChildren.filter((document) => document.path.includes("/questions/")).map((document) => document.data as RuntimeQuestionV32 & Record<string, unknown>);
  const baseCategories = baseChildren.filter((document) => document.path.includes("/catalogCategories/"));
  const baseMedia = baseChildren.filter((document) => document.path.includes("/media/"));
  if (baseQuestions.length !== 21263 || baseCategories.length !== 81 || baseMedia.length !== 489)
    throw new Error("Fresh Q6000 counts do not preserve the expected release inventory.");
  assertNoQuestionOverlap(baseQuestions, additions);
  if (categories.some((document) => baseCategories.some((base) => base.data.id === document.data.id)))
    throw new Error("Retained M05 category overlaps Q6000.");
  const q6000Authority = input.base.authorityDocuments?.length
    ? input.base.authorityDocuments
    : input.q6000.approvalDocuments;
  if (!input.allowCandidate && !input.base.authorityDocuments?.length)
    throw new Error("Fresh Q6000 authority lineage capture is required.");
  const authorityByPath = new Map(q6000Authority.map((document) => [document.path, document]));
  const requireApproval = (value: unknown) => {
    if (
      typeof value !== "string" ||
      authorityByPath.get(value)?.data.approvalState !== "owner_approved"
    )
      throw new Error("Q6000 authority lineage approval is incomplete.");
  };
  requireApproval(baseRoot.data.ownerApprovalPath);
  if (!input.allowCandidate) {
    const seenAncestors = new Set<string>();
    let ancestor = baseRoot.data.baseReleaseId;
    while (typeof ancestor === "string" && ancestor) {
      if (seenAncestors.has(ancestor)) throw new Error("Q6000 authority lineage loops.");
      seenAncestors.add(ancestor);
      const document = authorityByPath.get(`releases/${ancestor}`);
      if (!document?.data.immutable) throw new Error("Q6000 authority lineage root is missing.");
      requireApproval(document.data.ownerApprovalPath);
      ancestor = document.data.baseReleaseId;
    }
    const approvalRoots = q6000Authority.filter(
      (document) =>
        document.path.startsWith("contentOwnerApprovals/") &&
        document.path.split("/").length === 2,
    );
    if (approvalRoots.length !== 3)
      throw new Error("Q6000 authority lineage approval roots are incomplete.");
    for (const approval of approvalRoots) {
      const declared = approval.data.sourceEntryChunkCount ?? approval.data.sourceRecordCount;
      const chunks = typeof declared === "number"
        ? approval.data.sourceEntryChunkCount === undefined
          ? declared / 100
          : declared
        : NaN;
      if (!Number.isSafeInteger(chunks) || chunks < 1)
        throw new Error("Q6000 authority approval chunk manifest is invalid.");
      const expected = Array.from(
        { length: chunks },
        (_, index) => `${approval.path}/entries/chunk-${String(index + 1).padStart(5, "0")}`,
      );
      const actual = q6000Authority
        .filter((document) => document.path.startsWith(approval.path + "/"))
        .map((document) => document.path)
        .sort();
      if (!same(actual, expected))
        throw new Error("Q6000 authority approval descendant inventory is incomplete or altered.");
    }
    const q6000CandidateAuthority = input.q6000.approvalDocuments
      .slice()
      .sort((left, right) => left.path.localeCompare(right.path));
    const capturedQ6000Authority = q6000Authority
      .filter((document) => document.path === baseRoot.data.ownerApprovalPath || document.path.startsWith(String(baseRoot.data.ownerApprovalPath) + "/"))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (!same(capturedQ6000Authority, q6000CandidateAuthority))
      throw new Error("Q6000 candidate authority differs from fresh lineage capture.");
  }
  const authorityDocuments = [...q6000Authority, ...input.m05Plan.approvalDocuments]
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    new Set(authorityDocuments.map((document) => document.path)).size !== authorityDocuments.length ||
    authorityDocuments.some((document) => !document.path)
  ) throw new Error("Q6000/M05 authority lineage is incomplete or duplicated.");
  const retainedAuthoritySha256 = docHash(authorityDocuments);
  if (input.m05PlanSha256 !== RETAINED_M05_PLAN_SHA256)
    throw new Error("Retained M05 plan byte hash differs from immutable evidence.");
  const retainedM05PlanSha256 = input.m05PlanSha256;
  const releaseId = "owner-category-reconciliation-" + hash({ q6000: q6000.documentRootSha256, m05: m05Root.data.documentRootSha256, additions: additions.map((document) => document.data.id).sort() }).slice(0, 32);
  const rebase = (document: ReleaseDocument) => ({ path: document.path.replace(`releases/${q6000.releaseId}/`, `releases/${releaseId}/`), data: document.data });
  const m05Rebase = (document: ReleaseDocument) => ({ path: document.path.replace(`releases/${input.m05Plan.releaseId}/`, `releases/${releaseId}/`), data: document.data });
  const children = [...baseChildren.map(rebase), ...additions.map(m05Rebase), ...categories.map(m05Rebase), ...inventory.map(m05Rebase)].sort((a,b) => a.path.localeCompare(b.path));
  assertUniquePaths(children);
  if (children.length !== 26444) throw new Error("Reconciliation child count is not 26,444.");
  const catalogSha256 = docHash(children.filter((document) => document.path.includes("/catalogCategories/")));
  const documentRootSha256 = docHash(children);
  const approvedJsonlSha256 = hash({
    q6000: baseRoot.data.approvedJsonlSha256,
    retainedM05: additions.map((document) => ({ id: document.data.id, sourceIdentity: document.data.sourceIdentity, sourceContentHash: document.data.sourceContentHash })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
  });
  const sourceManifestSha256 = hash({
    q6000: baseRoot.data.sourceManifestSha256,
    retainedM05PlanSha256,
    retainedM05RootSha256: m05Root.data.documentRootSha256,
    retainedAuthoritySha256,
  });
  const root: ReleaseDocument = { path: `releases/${releaseId}`, data: {
    schemaVersion: "owner-category-reconciliation-v1", releaseId, baseReleaseId: q6000.releaseId,
    baseDocumentRootSha256: q6000.documentRootSha256, capturedPointerSha256: hash(input.base.pointer),
    retainedM05ReleaseId: input.m05Plan.releaseId, retainedM05DocumentRootSha256: m05Root.data.documentRootSha256,
    retainedAuthorityPaths: authorityDocuments.map((document) => document.path), retainedAuthoritySha256, retainedAuthorityCount: authorityDocuments.length,
    ownerApprovalPath: input.m05Plan.ownerApproval.path, publicationAuthority: "owner_authorization_q6000_m05_reconciliation", specialistReview: "not_claimed",
    approvedCount: 25763, approvedJsonlSha256, catalogSha256, documentRootSha256, sourceManifestSha256, categoryModeOnlyCount: 4500, mediaRecordCount: 489, immutable: true,
  }};
  const allQuestions = [...baseQuestions, ...additions.map((document) => document.data as RuntimeQuestionV32)];
  const readiness: CategorySupplementPlan["readiness"] = {};
  const categoryIds = children.filter((document) => document.path.includes("/catalogCategories/")).map((document) => String(document.data.id)).sort();
  if (categoryIds.length !== 96 || new Set(categoryIds).size !== 96) throw new Error("Reconciliation does not contain 96 unique categories.");
  for (const categoryId of categoryIds) {
    const partner = categoryIds.find((id) => id !== categoryId && (() => { try { createCategoryQuestionSelection(allQuestions, { categories: [categoryId, id], modality: "classic", seed: 1 }); return true; } catch { return false; } })());
    if (!partner) throw new Error("Category selector is not playable: " + categoryId);
    readiness[categoryId] = { selected: allQuestions.filter((question) => question.categoryId === categoryId).length, categoryMode: true, huroof: false, detail: (CATEGORY_IDS as readonly string[]).includes(categoryId) ? "Retained M05 Category-only; excluded from Huroof." : "Q6000 category selector passed." };
  }
  try { createMatchQuestionSelection(additions.map((document) => document.data as RuntimeQuestionV32), { categories: [...CATEGORY_IDS], modality: "classic", seed: 1 }); throw new Error("M05 Category-only additions entered Huroof."); } catch (error) { if (error instanceof Error && error.message === "M05 Category-only additions entered Huroof.") throw error; }
  return {
    schemaVersion: "owner-category-reconciliation-v1", releaseId, target: { projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2" }, base: input.base,
    source: { retainedM05PlanSha256, retainedM05RootSha256: String(m05Root.data.documentRootSha256), recordCount: 4500, categories: Object.fromEntries(CATEGORY_IDS.map((id) => [id, 300])), bindingSha256: hash(additions.map((document) => ({ id: document.data.id, source: document.data.sourceIdentity, content: document.data.sourceContentHash }))) },
    ownerApproval: { path: input.m05Plan.ownerApproval.path, runId: input.m05Plan.ownerApproval.runId, authority: "owner_approval", specialistReview: "not_claimed" },
    documents: [...children, root].sort((a,b) => a.path.localeCompare(b.path)), retainedM05Documents: input.m05Snapshot.documents.slice().sort((a,b) => a.path.localeCompare(b.path)), approvalDocuments: authorityDocuments, approvedCount: 25763, catalogSha256, documentRootSha256, sourceManifestSha256, readiness,
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
      baseReleaseId: String(root(plan).data.baseReleaseId),
      documentRootSha256: plan.documentRootSha256,
      ownerApprovalPath: plan.ownerApproval.path,
      verificationKind: "owner_category_reconciliation_exact_readback",
      immutable: true,
    },
  };
}
function activation(plan: CategorySupplementPlan) {
  return {
    path: "activationReceipts/" + plan.releaseId + "-owner-category",
    data: {
      releaseId: plan.releaseId,
      baseReleaseId: String(root(plan).data.baseReleaseId),
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
      baseReleaseId: String(root(plan).data.baseReleaseId),
      originalActivationPath: activation(plan).path,
      originalActivationSha256: hash(activation(plan).data),
      rollbackReceiptPath: rollback.path,
      rollbackReceiptSha256: hash(rollback.data),
      expectedQ6000Pointer: plan.base.pointer,
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
  await verifyRetainedM05(plan, api);
  await verifyApproval(plan, api);
  for (const stage of [
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
    throw new Error("Captured Q6000 base pointer, root, or child changed.");
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
      throw new Error("Captured Q6000 base pointer, root, or child changed.");
  }
}
async function verifyApproval(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  const expected = new Map(
    plan.approvalDocuments.map(
      (document) =>
        [document.path, document.data] as [string, Record<string, unknown>],
    ),
  );
  const paths = [...expected.keys()];
  for (let offset = 0; offset < paths.length; offset += 300) {
    const part = paths.slice(offset, offset + 300);
    const actual = await api.read(part);
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
      throw new Error(
        "Supplement owner authority differs from the prepared payload.",
      );
  }
  const approvalRoots = paths.filter(
    (path) =>
      path.startsWith("contentOwnerApprovals/") && path.split("/").length === 2,
  );
  const actualPaths = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    actualPaths.add(path);
    for (const collectionId of await api.listCollectionIds(path))
      for (const document of await api.listCollection(path + "/" + collectionId)) {
        const childPath = pathOf(document.name);
        actualPaths.add(childPath);
        await visit(childPath);
      }
  };
  for (const approvalRoot of approvalRoots) await visit(approvalRoot);
  const expectedPaths = new Set(
    paths.filter((path) =>
      approvalRoots.some(
        (approvalRoot) =>
          path === approvalRoot || path.startsWith(approvalRoot + "/"),
      ),
    ),
  );
  if (
    actualPaths.size !== expectedPaths.size ||
    [...actualPaths].some((path) => !expectedPaths.has(path))
  )
    throw new Error(
      "Supplement owner authority subtree differs from the prepared payload.",
    );
}
async function verifyRetainedM05(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  if (plan.retainedM05Documents.length !== 15994)
    throw new Error("Retained M05 immutable snapshot is incomplete.");
  for (let offset = 0; offset < plan.retainedM05Documents.length; offset += 300) {
    const part = plan.retainedM05Documents.slice(offset, offset + 300);
    const actual = await api.read(part.map((document) => document.path));
    if (actual.some((document, index) => !document || !same(decodeSourceDocument(document).data, part[index]!.data)))
      throw new Error("Retained M05 release root or child differs from immutable evidence.");
  }
}
async function verifyPreparedChildren(
  plan: CategorySupplementPlan,
  api: CategorySupplementApi,
) {
  await verifyApproval(plan, api);
  await verifyRetainedM05(plan, api);
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
  await verifyRetainedM05(plan, api);
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
  await verifyRetainedM05(plan, api);
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

// This CLI never discovers a base or writes during prepare. Root supplies a fresh
// Q6000 snapshot only after the coordinated publisher stops pointer writes.
async function main() {
  const [operation, ...args] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1] || flags[args[i]!.slice(2)]) throw new Error("Use unique --name value flags.");
    flags[args[i]!.slice(2)] = args[i + 1]!;
  }
  if (!["prepare", "apply", "verify", "rollback"].includes(operation ?? "") || !flags["base-snapshot"] || !flags["q6000-plan"] || !flags["m05-plan"] || !flags["m05-snapshot"] || !(operation === "prepare" ? flags.out : flags.plan))
    throw new Error("Usage: owner-category-reconciliation <prepare|apply|verify|rollback> --base-snapshot PATH --q6000-plan PATH --m05-plan PATH --m05-snapshot PATH --out PATH | --plan PATH [--operation-reference REF]");
  const base = JSON.parse(await readFile(flags["base-snapshot"]!, "utf8")) as CapturedBase;
  const q6000 = JSON.parse(await readFile(flags["q6000-plan"]!, "utf8")) as Q6000Candidate;
  const m05Plan = JSON.parse(await readFile(flags["m05-plan"]!, "utf8"));
  const m05Snapshot = JSON.parse(await readFile(flags["m05-snapshot"]!, "utf8")) as CapturedBase;
  const m05PlanSha256 = sha(await readFile(flags["m05-plan"]!, "utf8"));
  const built = await buildOwnerCategoryReconciliationPlan({ base, q6000, m05Plan, m05Snapshot, m05PlanSha256 });
  if (operation === "prepare") { await writeFile(resolve(flags.out!), JSON.stringify(built, null, 2) + "\n"); console.log(JSON.stringify({ operation, releaseId: built.releaseId, approvedCount: built.approvedCount, categories: 96, media: 489, productionWrite: false }, null, 2)); return; }
  if (!same(built, JSON.parse(await readFile(flags.plan!, "utf8")))) throw new Error("Stored reconciliation plan differs from the deterministic fresh-base rebuild.");
  const api = await createProductionOwnerCategorySupplementApi();
  if (operation === "apply") { await applyOwnerCategorySupplement(built, api, () => buildOwnerCategoryReconciliationPlan({ base, q6000, m05Plan, m05Snapshot, m05PlanSha256 })); console.log(JSON.stringify({ operation, releaseId: built.releaseId, activated: true }, null, 2)); return; }
  if (operation === "verify") { console.log(JSON.stringify({ operation, ...(await verifyOwnerCategorySupplement(built, api)) }, null, 2)); return; }
  if (operation === "rollback" && flags["operation-reference"]) { await rollbackOwnerCategorySupplement(built, api, flags["operation-reference"]); console.log(JSON.stringify({ operation, restoredReleaseId: q6000.release.releaseId }, null, 2)); return; }
  throw new Error("Rollback requires --operation-reference.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
