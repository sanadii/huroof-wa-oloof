import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  canonicalApprovedJsonl,
  canonicalJson,
  SAFE_DOCUMENT_ID,
} from "./firestore-release-canonical.js";
import {
  DEFAULT_VALIDATION_AS_OF,
  isStrictIsoDate,
  validateQuestions,
  type Issue,
} from "./validate-question-bank.js";
import type { Question } from "../src/question-bank.js";
import {
  assertReleaseReportV32,
  bankContentHashV32,
  canonicalJsonV32,
  validateQuestionBankV32,
  type CategoryPolicyV32,
  type QuestionV32,
  type ValidationReportV32,
} from "../src/question-bank-v3.2.js";
import {
  assertCanonicalAggregateEqualsV33,
  assertReleaseReadyV33,
  deriveAggregateFromCanonicalFilesV33,
  deriveReleaseIdentityV33,
  projectRuntimeQuestionV33,
  validateCorpusV33,
  type V33CategoryApprovedFile,
  type V33Corpus,
  type V33TrustRoot,
  type V33ValidationReport,
} from "../src/question-bank-v3.3.js";

const ROOT = process.cwd();
const APPROVED_PATH = join(ROOT, "content/questions/approved/questions.jsonl");
const MANIFEST_PATH = join(
  ROOT,
  "content/questions/reports/release-manifest.json",
);
const CATEGORIES_PATH = join(ROOT, "content/categories/categories.json");

export { canonicalApprovedJsonl } from "./firestore-release-canonical.js";
export type ReleaseDocument = { path: string; data: Record<string, unknown> };
export type ReleaseWriteMode = "create" | "set";
export type FirestoreReleasePlan = {
  releaseId: string;
  approvedCount: number;
  approvedJsonlSha256: string;
  catalogSha256: string;
  documentRootSha256: string;
  sourceManifestSha256: string;
  asOf: string;
  documents: ReleaseDocument[];
  /** SHA-256 commitments to authenticated review-request nonces; raw nonces never enter release documents. */
  reviewNonceClaimHashes?: string[];
};
export type V18MediaUploadPlan = {
  dryRun: true;
  assetCount: number;
  manifestSha256: string;
  uploads: Array<{ mediaId: string; assetSha256: string; localFile: string; objectName: string; createOnly: true; metadata: { assetSha256: string; mediaId: string } }>;
};
type V18ManifestAsset = { mediaId: string; assetSha256: string; sourceCategory: string; mediaType: string; altAr: string; width: number; height: number; privateObject: string; localFile: string };

/**
 * This is intentionally a local-only plan. It commits every extracted asset to
 * one create-only private object name but cannot invent a Cloud Storage
 * generation; that immutable generation is supplied only after T-14.5 upload
 * readback before a release media document may be written.
 */
export async function buildV18MediaUploadPlan(manifestPath = join(ROOT, "content/question-media/v18-private-240/manifest.json")): Promise<V18MediaUploadPlan> {
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8")) as { assetCount?: unknown; assets?: unknown[] };
  if (manifest.assetCount !== 240 || !Array.isArray(manifest.assets) || manifest.assets.length !== 240) throw new Error("v18 media manifest must contain exactly 240 assets.");
  const ids = new Set<string>(), hashes = new Set<string>();
  const uploads = manifest.assets.map((value, index) => {
    const asset = value as Partial<V18ManifestAsset>;
    if (typeof asset.mediaId !== "string" || !/^v18-(?:tahadani-)?(011|012|014|061)-\d{3}$/.test(asset.mediaId) || ids.has(asset.mediaId)) throw new Error(`Invalid or duplicate v18 mediaId at row ${index + 1}.`);
    if (typeof asset.assetSha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.assetSha256) || hashes.has(asset.assetSha256)) throw new Error(`Invalid or duplicate v18 media hash at row ${index + 1}.`);
    if (asset.mediaType !== "image/png" || asset.altAr !== "صورة السؤال" || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width! < 1 || asset.height! < 1 || asset.width! > 4096 || asset.height! > 4096) throw new Error(`Invalid v18 image metadata at row ${index + 1}.`);
    const objectName = `question-media/v18/${asset.assetSha256}.png`;
    if (asset.privateObject !== objectName || asset.localFile !== `originals/${asset.assetSha256}.png`) throw new Error(`Unsafe v18 media path at row ${index + 1}.`);
    ids.add(asset.mediaId); hashes.add(asset.assetSha256);
    return { mediaId: asset.mediaId, assetSha256: asset.assetSha256, localFile: asset.localFile, objectName, createOnly: true as const, metadata: { assetSha256: asset.assetSha256, mediaId: asset.mediaId } };
  }).sort((left, right) => left.mediaId.localeCompare(right.mediaId));
  for (const category of ["011", "012", "014", "061"]) if (manifest.assets.filter((value) => (value as Partial<V18ManifestAsset>).sourceCategory === category).length !== 60) throw new Error(`v18 source category ${category} must contain exactly 60 assets.`);
  return { dryRun: true, assetCount: uploads.length, manifestSha256: createHash("sha256").update(bytes).digest("hex"), uploads };
}

/** Creates immutable release associations only from verified post-upload generations. */
export function buildV18ReleaseMediaDocuments(releaseId: string, uploaded: Array<{ mediaId: string; assetSha256: string; objectName: string; generation: string }>): ReleaseDocument[] {
  if (!/^release-[a-f0-9-]{16,128}$/.test(releaseId)) throw new Error("Invalid immutable release ID.");
  const ids = new Set<string>();
  const documents = uploaded.map((item) => {
    if (!/^v18-(?:tahadani-)?(011|012|014|061)-\d{3}$/.test(item.mediaId) || ids.has(item.mediaId) || !/^[a-f0-9]{64}$/.test(item.assetSha256) || item.objectName !== `question-media/v18/${item.assetSha256}.png` || !/^\d{1,32}$/.test(item.generation)) throw new Error("Invalid immutable v18 media upload readback.");
    ids.add(item.mediaId);
    return { path: `releases/${releaseId}/media/${item.mediaId}`, data: { mediaId: item.mediaId, assetSha256: item.assetSha256, objectName: item.objectName, generation: item.generation, contentType: "image/png", immutable: true } };
  }).sort(byPath);
  assertUniqueReleaseDocuments(documents);
  return documents;
}

const hash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const byPath = (left: ReleaseDocument, right: ReleaseDocument) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
const documentsHash = (documents: ReleaseDocument[]): string =>
  hash(
    canonicalJson(
      documents
        .slice()
        .sort(byPath)
        .map(({ path, data }) => ({ path, data })),
    ),
  );

/** Only the emulator demo plan carries an active pointer; production preparation never does. */
export function releaseDocumentWriteMode(path: string): ReleaseWriteMode {
  return path === "runtime/activeRelease" ? "set" : "create";
}

/** Firestore document paths have an even number of non-empty, safe segments. */
export function assertFirestoreDocumentPath(path: string): void {
  const segments = path.split("/");
  if (
    segments.length === 0 ||
    segments.length % 2 !== 0 ||
    segments.some((segment) => !SAFE_DOCUMENT_ID.test(segment))
  )
    throw new Error(`Invalid Firestore document path: ${path}`);
}

export function assertUniqueReleaseDocuments(
  documents: ReleaseDocument[],
): void {
  const paths = new Set<string>();
  for (const document of documents) {
    assertFirestoreDocumentPath(document.path);
    if (paths.has(document.path))
      throw new Error(
        `Release plan contains duplicate document path: ${document.path}`,
      );
    paths.add(document.path);
  }
}

/** Evidence blobs are authoring-only and may never cross a release boundary. */
export function assertReleaseValueExcludesEvidencePayload(
  value: unknown,
  label = "Release value",
): void {
  const inspect = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (
        /(?:^|[\\/])evidence-bodies(?:[\\/]|$)|(?:^|[\\/])evidenceBodies(?:[\\/]|$)|\.bin(?:$|[?#])/i.test(
          value,
        )
      )
        throw new Error(
          `${label} contains a forbidden evidence-body path at ${path}.`,
        );
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspect(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (
        normalized === "responsebodybase64" ||
        normalized === "responsebody" ||
        normalized === "evidencebodies" ||
        normalized.includes("sourcebody") ||
        normalized.includes("evidencebody")
      )
        throw new Error(
          `${label} contains a forbidden evidence-body field at ${path}.${key}.`,
        );
      inspect(child, `${path}.${key}`);
    }
  };
  inspect(value, label);
}

export function assertReleaseDocumentsExcludeEvidencePayload(
  documents: ReleaseDocument[],
): void {
  for (const document of documents)
    assertReleaseValueExcludesEvidencePayload(
      document.data,
      `Release document ${document.path}`,
    );
}

export function assertProductionReleaseAcceptance(
  questions: Question[],
  issues: Issue[],
  v32?: { report: ValidationReportV32; contentHash: string },
): void {
  for (const question of questions) {
    const review = question.review;
    if (
      !review?.factReviewer?.trim() ||
      !review.languageReviewer?.trim() ||
      !review.reviewedAt?.trim()
    )
      throw new Error(
        `Approved question ${question.id} requires non-empty factReviewer, languageReviewer, and reviewedAt.`,
      );
  }
  if (issues.some((issue) => issue.severity === "error"))
    throw new Error(
      `Production release validation has errors: ${issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  if (!v32)
    throw new Error(
      "Production releases require a canonical, hash-bound v3.2 validation report.",
    );
  if (v32) assertReleaseReportV32(v32.report, v32.contentHash);
}

/** Recompute over the exact approved records; report-declared counts/findings are never trusted. */
export function assertExactV32ProductionRelease(
  questions: QuestionV32[],
  policyDocument: { categories: CategoryPolicyV32[] },
  metadata: {
    report?: ValidationReportV32;
    contentHash?: string;
    dispositions?: unknown;
  },
): void {
  if (
    !Array.isArray(policyDocument.categories) ||
    policyDocument.categories.length !== 66 ||
    new Set(policyDocument.categories.map((policy) => policy.categoryId))
      .size !== 66
  )
    throw new Error(
      "Production release requires the exact 66-policy v3.2 registry.",
    );
  if (
    !metadata.report ||
    typeof metadata.contentHash !== "string" ||
    !Array.isArray(metadata.dispositions ?? [])
  )
    throw new Error(
      "Production release requires complete v3.2 report metadata.",
    );
  assertReleaseReportV32(metadata.report, metadata.contentHash);
  if (
    questions.some(
      (question) =>
        question.schemaVersion !== "3.2.0" ||
        question.state !== "approved" ||
        question.modality === "charades" ||
        !question.answerConceptId ||
        !question.facetId ||
        question.performanceFacetId,
    )
  )
    throw new Error(
      "Production release requires complete approved v3.2 classic/image question records.",
    );
  const recomputed = validateQuestionBankV32({
    questions,
    policies: policyDocument.categories,
    dispositions: metadata.dispositions as never,
  });
  if (
    canonicalJsonV32(recomputed) !== canonicalJsonV32(metadata.report) ||
    recomputed.contentHash !== metadata.contentHash
  )
    throw new Error(
      "Production v3.2 validation report is fabricated, stale, or does not match the exact approved bank.",
    );
  assertReleaseReportV32(recomputed, metadata.contentHash);
}
/** v3.3 production entrypoint: no hand-edited aggregate or 66-category authoring scope is accepted. */
export function assertExactV33ProductionRelease(
  files: V33CategoryApprovedFile[],
  corpus: V33Corpus,
  report: V33ValidationReport,
  trustRoot?: V33TrustRoot,
): {
  aggregate: ReturnType<typeof deriveAggregateFromCanonicalFilesV33>;
  releaseId: string;
} {
  if (!trustRoot)
    throw new Error(
      "v3.3 production release requires an external configured trust root.",
    );
  return assertTrustedV33ProductionRelease(files, corpus, report, trustRoot);
}
export function assertTrustedV33ProductionRelease(
  files: V33CategoryApprovedFile[],
  corpus: V33Corpus,
  report: V33ValidationReport,
  trustRoot: V33TrustRoot,
): {
  aggregate: ReturnType<typeof deriveAggregateFromCanonicalFilesV33>;
  releaseId: string;
} {
  const aggregate = deriveAggregateFromCanonicalFilesV33(files);
  assertCanonicalAggregateEqualsV33(files, corpus.questions);
  assertReleaseReadyV33(report, corpus, trustRoot);
  if (aggregate.length !== corpus.questions.length)
    throw new Error(
      "v3.3 canonical aggregate count differs from the validated corpus.",
    );
  return {
    aggregate,
    releaseId: deriveReleaseIdentityV33(corpus, report, trustRoot),
  };
}
export function buildV33FirestoreReleasePlan(input: {
  files: V33CategoryApprovedFile[];
  corpus: V33Corpus;
  report: V33ValidationReport;
  trustRoot: V33TrustRoot;
}): FirestoreReleasePlan {
  const verified = assertTrustedV33ProductionRelease(
    input.files,
    input.corpus,
    input.report,
    input.trustRoot,
  );
  const releaseId = verified.releaseId;
  const media = new Map(input.corpus.media.map((item) => [item.mediaId, item]));
  const labels = new Map(input.corpus.catalog.categories.map((category) => [category.id, category.labelAr]));
  const catalogDocuments = input.corpus.scope.categoryIds.map((id) => ({
    path: `releases/${releaseId}/catalogCategories/${id}`,
    data: { id, labelAr: labels.get(id), runtimeScope: "question-bank-v3.3-runtime-62" },
  }));
  const questionDocuments = verified.aggregate.map((question) => ({
    path: `releases/${releaseId}/questions/${question.candidateId}`,
    data: projectRuntimeQuestionV33(
      question,
      question.mediaId ? media.get(question.mediaId) : undefined,
    ) as Record<string, unknown>,
  }));
  const inventoryDocuments = input.corpus.scope.categoryIds.map(
    (categoryId) => ({
      path: `releases/${releaseId}/inventory/${categoryId}`,
      data: {
        categoryId,
        approvedCount: verified.aggregate.filter(
          (question) => question.categoryId === categoryId,
        ).length,
      },
    }),
  );
  const catalogSha256 = documentsHash(catalogDocuments);
  const documentRootSha256 = documentsHash([
    ...catalogDocuments,
    ...questionDocuments,
    ...inventoryDocuments,
  ]);
  const sourceManifestSha256 = hash(
    canonicalJson({
      scopeHash: input.corpus.scope.scopeHash,
      reportHash: input.report.reportHash,
    }),
  );
  const asOf = input.corpus.asOfArtifact.asOf;
  if (!isStrictIsoDate(asOf.slice(0, 10)))
    throw new Error("v3.3 production release requires an ISO asOf timestamp.");
  const root: ReleaseDocument = {
    path: `releases/${releaseId}`,
    data: {
      releaseId,
      asOf,
      approvedCount: verified.aggregate.length,
      catalogSha256,
      documentRootSha256,
      sourceManifestSha256,
      immutable: true,
      questionBankVersion: "3.3.0",
    },
  };
  const documents = [
    ...catalogDocuments,
    ...questionDocuments,
    ...inventoryDocuments,
    root,
  ].sort(byPath);
  assertUniqueReleaseDocuments(documents);
  assertReleaseDocumentsExcludeEvidencePayload(documents);
  const reviewNonceClaimHashes = [
    ...new Set(
      input.corpus.receipts.map((receipt) => hash(receipt.reviewRequestNonce)),
    ),
  ].sort();
  return {
    releaseId,
    asOf,
    approvedCount: verified.aggregate.length,
    approvedJsonlSha256: hash(
      canonicalJson(
        verified.aggregate.map((question) => ({
          id: question.candidateId,
          contentHash: question.contentHash,
        })),
      ),
    ),
    catalogSha256,
    documentRootSha256,
    sourceManifestSha256,
    documents,
    reviewNonceClaimHashes,
  };
}

export function classifyReleaseDocuments(documents: ReleaseDocument[]): {
  immutable: ReleaseDocument[];
  mutable: ReleaseDocument[];
} {
  const immutable = documents.filter(
    (document) => releaseDocumentWriteMode(document.path) === "create",
  );
  const mutable = documents.filter(
    (document) => releaseDocumentWriteMode(document.path) === "set",
  );
  if (
    mutable.length > 1 ||
    mutable.some((document) => document.path !== "runtime/activeRelease")
  )
    throw new Error(
      "A release plan may contain only the active-release pointer as a mutable document.",
    );
  return { immutable, mutable };
}

async function readApprovedBank(
  path: string,
): Promise<{ questions: Question[]; canonical: string }> {
  const raw = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? "" : Promise.reject(error),
  );
  const canonical = canonicalApprovedJsonl(raw);
  return {
    canonical,
    questions: canonical
      ? canonical.split("\n").map((line) => JSON.parse(line) as Question)
      : [],
  };
}

/** Canonical authoring JSONL is UTF-8 LF, one nonblank JSON object per line, and no BOM. */
const parseCanonicalJsonl = <T>(raw: string, label: string): T[] => {
  if (
    !raw ||
    raw.charCodeAt(0) === 0xfeff ||
    raw.includes("\r") ||
    !raw.endsWith("\n")
  )
    throw new Error(
      `${label} must be canonical UTF-8 LF JSONL with a final newline.`,
    );
  const lines = raw.slice(0, -1).split("\n");
  if (
    !lines.length ||
    lines.some((line) => !line.trim() || line !== line.trim())
  )
    throw new Error(`${label} contains blank or noncanonical JSONL rows.`);
  return lines.map((line, index) => {
    try {
      const parsed = JSON.parse(line) as T;
      if (canonicalJsonV32(parsed) !== line)
        throw new Error("noncanonical JSON");
      return parsed;
    } catch {
      throw new Error(`${label} has invalid JSON at row ${index + 1}.`);
    }
  });
};
const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;
export function assertExternalV33TrustRootPath(
  corpusRoot: string,
  trustRootPath: string,
): void {
  const relation = relative(corpusRoot, trustRootPath);
  if (
    relation === "" ||
    (!isAbsolute(relation) &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`))
  )
    throw new Error(
      "v3.3 trust root must be outside the caller-writable corpus directory.",
    );
}
type V33SchemaKind =
  | "catalog"
  | "candidate"
  | "question"
  | "policy"
  | "evidence"
  | "media"
  | "receipt"
  | "slot"
  | "report"
  | "manifest";
const V33_SCHEMA_FILES: Record<V33SchemaKind, string> = {
  catalog: "category-catalog.v3.3.schema.json",
  candidate: "candidate.v3.3.schema.json",
  question: "question.v3.3.schema.json",
  policy: "category-policy.v3.3.schema.json",
  evidence: "evidence.v3.3.schema.json",
  media: "media.v3.3.schema.json",
  receipt: "review-receipt.v3.3.schema.json",
  slot: "slot-ledger.v3.3.schema.json",
  report: "validation-report.v3.3.schema.json",
  manifest: "release-manifest.v3.3.schema.json",
};
/** Production loading applies the frozen JSON Schemas before any weaker semantic projection can erase presence errors. */
export async function assertV33ProductionSchemas(input: {
  scope: V33Corpus["scope"];
  catalog: V33Corpus["catalog"];
  policies: V33Corpus["policies"];
  slots: V33Corpus["slots"];
  candidates: V33Corpus["candidates"];
  files: V33CategoryApprovedFile[];
  evidence: V33Corpus["evidence"];
  media: V33Corpus["media"];
  receipts: V33Corpus["receipts"];
  report: V33ValidationReport;
}): Promise<void> {
  const Ajv = Ajv2020 as unknown as new (options?: object) => {
    compile(schema: object): {
      (value: unknown): boolean;
      errors?: Array<{ instancePath?: string; message?: string }>;
    };
  };
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  const schemaRoot = resolve(ROOT, "content/question-bank-v3/schemas");
  const validators = Object.fromEntries(
    await Promise.all(
      (Object.keys(V33_SCHEMA_FILES) as V33SchemaKind[]).map(async (kind) => [
        kind,
        ajv.compile(
          await readJson<object>(join(schemaRoot, V33_SCHEMA_FILES[kind])),
        ),
      ]),
    ),
  ) as Record<V33SchemaKind, ReturnType<typeof ajv.compile>>;
  const rows: Array<[V33SchemaKind, unknown, string]> = [
    ["manifest", input.scope, "scope"],
    ["catalog", input.catalog, "catalog"],
    ["report", input.report, "report"],
    ...input.policies.map(
      (item) =>
        ["policy", item, `policy:${item.categoryId}`] as [
          V33SchemaKind,
          unknown,
          string,
        ],
    ),
    ...input.slots.map(
      (item) =>
        ["slot", item, `slot:${item.slotId}`] as [
          V33SchemaKind,
          unknown,
          string,
        ],
    ),
    ...input.candidates.map(
      (item) =>
        ["candidate", item, `candidate:${item.candidateId}`] as [
          V33SchemaKind,
          unknown,
          string,
        ],
    ),
    ...input.files.flatMap((file) =>
      file.questions.map(
        (item) =>
          ["question", item, `question:${item.candidateId}`] as [
            V33SchemaKind,
            unknown,
            string,
          ],
      ),
    ),
    ...input.evidence.map(
      (item) =>
        ["evidence", item, `evidence:${item.evidenceId}`] as [
          V33SchemaKind,
          unknown,
          string,
        ],
    ),
    ...input.media.map(
      (item) =>
        ["media", item, `media:${item.mediaId}`] as [
          V33SchemaKind,
          unknown,
          string,
        ],
    ),
    ...input.receipts.map(
      (item) =>
        ["receipt", item, `receipt:${item.receiptId}`] as [
          V33SchemaKind,
          unknown,
          string,
        ],
    ),
  ];
  for (const [kind, value, label] of rows) {
    const validator = validators[kind];
    if (!validator(value))
      throw new Error(
        `v3.3 production ${kind} schema rejected ${label}: ${(validator.errors ?? []).map((error) => `${error.instancePath ?? ""}:${error.message ?? ""}`).join("|")}`,
      );
  }
  for (const file of input.files)
    if (
      Object.keys(file).sort().join(",") !==
      "canonicalFileHash,categoryId,questions"
    )
      throw new Error(
        `v3.3 canonical category file ${file.categoryId} has unvalidated fields.`,
      );
}
/** The only production v3.3 input layout.  It deliberately has no aggregate question file. */
const V33_TOP_LEVEL_ARTIFACTS = [
  "as-of.v3.3.json",
  "catalog.v3.3.json",
  "categories",
  "evidence-bodies.v3.3.json",
  "evidence.v3.3.jsonl",
  "media.v3.3.jsonl",
  "policies.v3.3.json",
  "receipts.v3.3.jsonl",
  "scope.manifest.v3.3.json",
  "slots.v3.3.jsonl",
  "source-policy-registry.v3.3.json",
  "validation-report.v3.3.json",
] as const;

export async function loadV33ProductionReleaseInput(
  options: {
    root?: string;
    trustRootPath?: string;
    trustRootSha256?: string;
  } = {},
): Promise<{
  files: V33CategoryApprovedFile[];
  corpus: V33Corpus;
  report: V33ValidationReport;
  trustRoot: V33TrustRoot;
}> {
  const root = await realpath(
    resolve(options.root ?? join(ROOT, "content/question-bank-v3/v3.3")),
  );
  if (
    !options.trustRootPath ||
    !/^[a-f0-9]{64}$/u.test(options.trustRootSha256 ?? "")
  )
    throw new Error(
      "v3.3 production requires an explicit external trust-root path and SHA-256 anchor.",
    );
  const trustRootPath = await realpath(resolve(options.trustRootPath));
  assertExternalV33TrustRootPath(root, trustRootPath);
  const topLevelEntries = await readdir(root, { withFileTypes: true });
  const topLevelNames = topLevelEntries
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (
    canonicalJsonV32(topLevelNames) !== canonicalJsonV32(V33_TOP_LEVEL_ARTIFACTS) ||
    topLevelEntries.some(
      (entry) =>
        entry.isSymbolicLink() ||
        (entry.name === "categories" ? !entry.isDirectory() : !entry.isFile()),
    )
  )
    throw new Error(
      "v3.3 production corpus has a noncanonical top-level artifact layout or link.",
    );
  const artifact = (name: string) => join(root, name);
  const scopePath = artifact("scope.manifest.v3.3.json");
  const catalogPath = artifact("catalog.v3.3.json");
  const policiesPath = artifact("policies.v3.3.json");
  const slotsPath = artifact("slots.v3.3.jsonl");
  const evidencePath = artifact("evidence.v3.3.jsonl");
  const mediaPath = artifact("media.v3.3.jsonl");
  const receiptsPath = artifact("receipts.v3.3.jsonl");
  const asOfPath = artifact("as-of.v3.3.json");
  const registryPath = artifact("source-policy-registry.v3.3.json");
  const bodiesPath = artifact("evidence-bodies.v3.3.json");
  const reportPath = artifact("validation-report.v3.3.json");
  const [
    scope,
    catalog,
    policies,
    slotsRaw,
    evidenceRaw,
    mediaRaw,
    receiptsRaw,
    asOfArtifact,
    sourcePolicyRegistry,
    bodyStrings,
    report,
    trustRootRaw,
  ] = await Promise.all([
    readJson<V33Corpus["scope"]>(scopePath),
    readJson<V33Corpus["catalog"]>(catalogPath),
    readJson<V33Corpus["policies"]>(policiesPath),
    readFile(slotsPath, "utf8"),
    readFile(evidencePath, "utf8"),
    readFile(mediaPath, "utf8"),
    readFile(receiptsPath, "utf8"),
    readJson<V33Corpus["asOfArtifact"]>(asOfPath),
    readJson<V33Corpus["sourcePolicyRegistry"]>(registryPath),
    readJson<Record<string, string>>(bodiesPath),
    readJson<V33ValidationReport>(reportPath),
    readFile(trustRootPath, "utf8"),
  ]);
  if (hash(trustRootRaw) !== options.trustRootSha256)
    throw new Error("v3.3 external trust-root SHA-256 anchor does not match.");
  const configuredTrustRoot = JSON.parse(trustRootRaw) as V33TrustRoot;
  // The build host's clock, not a corpus artifact, supplies trusted receipt time.
  const trustRoot: V33TrustRoot = {
    ...configuredTrustRoot,
    now: new Date().toISOString(),
  };
  const categoriesRoot = artifact("categories");
  const entries = await readdir(categoriesRoot, { withFileTypes: true });
  const actualCategoryIds = entries
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (
    canonicalJsonV32(actualCategoryIds) !==
      canonicalJsonV32(
        scope.categoryIds
          .slice()
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      ) ||
    entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())
  )
    throw new Error(
      "v3.3 candidate corpus must contain exactly the 62 canonical category directories and no links.",
    );
  const files = await Promise.all(
    scope.categoryIds
      .slice()
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map(async (categoryId) => {
        const folder = artifact(`categories/${categoryId}`);
        const [candidateStat, approvedStat, folderEntries] = await Promise.all([
          lstat(join(folder, "candidates.v3.3.jsonl")),
          lstat(join(folder, "approved.v3.3.json")),
          readdir(folder, { withFileTypes: true }),
        ]);
        if (
          !candidateStat.isFile() ||
          candidateStat.isSymbolicLink() ||
          !approvedStat.isFile() ||
          approvedStat.isSymbolicLink() ||
          folderEntries.some((entry) => entry.isSymbolicLink()) ||
          canonicalJsonV32(
            folderEntries
              .map((entry) => entry.name)
              .sort((left, right) =>
                left < right ? -1 : left > right ? 1 : 0,
              ),
          ) !==
            canonicalJsonV32(["approved.v3.3.json", "candidates.v3.3.jsonl"])
        )
          throw new Error(
            `v3.3 ${categoryId} has noncanonical candidate files or links.`,
          );
        return readJson<V33CategoryApprovedFile>(
          join(folder, "approved.v3.3.json"),
        );
      }),
  );
  const candidateRows = await Promise.all(
    scope.categoryIds
      .slice()
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map(async (categoryId) => {
        const raw = await readFile(
          artifact(`categories/${categoryId}/candidates.v3.3.jsonl`),
          "utf8",
        );
        const rows = parseCanonicalJsonl<V33Corpus["candidates"][number]>(
          raw,
          `candidates:${categoryId}`,
        );
        if (
          rows.length !== 336 ||
          rows.some((row) => row.categoryId !== categoryId)
        )
          throw new Error(
            `v3.3 ${categoryId} must contain exactly 336 candidate rows.`,
          );
        return rows;
      }),
  );
  const slots = parseCanonicalJsonl<V33Corpus["slots"][number]>(
    slotsRaw,
    "slots",
  );
  const evidence = parseCanonicalJsonl<V33Corpus["evidence"][number]>(
    evidenceRaw,
    "evidence",
  );
  const media = parseCanonicalJsonl<V33Corpus["media"][number]>(
    mediaRaw,
    "media",
  );
  const receipts = parseCanonicalJsonl<V33Corpus["receipts"][number]>(
    receiptsRaw,
    "receipts",
  );
  const evidenceBodies = Object.fromEntries(
    Object.entries(bodyStrings).map(([path, value]) => [
      path,
      Buffer.from(value, "base64"),
    ]),
  ) as Record<string, Uint8Array>;
  const candidates = candidateRows.flat();
  await assertV33ProductionSchemas({
    scope,
    catalog,
    policies,
    slots,
    candidates,
    files,
    evidence,
    media,
    receipts,
    report,
  });
  const corpus: V33Corpus = {
    scope,
    catalog,
    policies,
    slots,
    candidates,
    questions: deriveAggregateFromCanonicalFilesV33(files),
    evidence,
    media,
    receipts,
    asOfArtifact,
    sourcePolicyRegistry,
    evidenceBodies,
  };
  const recomputed = validateCorpusV33(corpus, trustRoot);
  if (canonicalJsonV32(recomputed) !== canonicalJsonV32(report))
    throw new Error(
      "v3.3 validation report is fabricated, stale, or does not bind deterministic artifacts and configured trust.",
    );
  return { files, corpus, report, trustRoot };
}

export async function buildFirestoreReleasePlan(
  options: {
    approvedPath?: string;
    manifestPath?: string;
    categoriesPath?: string;
    releaseId?: string;
    allowEmptyDemo?: boolean;
    demoFixture?: boolean;
    production?: boolean;
    v33?: {
      files: V33CategoryApprovedFile[];
      corpus: V33Corpus;
      report: V33ValidationReport;
      trustRoot: V33TrustRoot;
    };
  } = {},
): Promise<FirestoreReleasePlan> {
  if (options.production && options.v33)
    return buildV33FirestoreReleasePlan(options.v33);
  const approvedPath = options.approvedPath ?? APPROVED_PATH;
  if (options.production)
    throw new Error(
      "Production release requires explicit v3.3 canonical files, corpus, and validation report.",
    );
  if (options.production && resolve(approvedPath) !== resolve(APPROVED_PATH))
    throw new Error(
      "Production releases accept only content/questions/approved/questions.jsonl.",
    );
  const [bank, schema, manifest, categoriesWrapper, v32PolicyDocument] =
    await Promise.all([
      readApprovedBank(approvedPath),
      readFile(
        join(ROOT, "content/questions/question.schema.json"),
        "utf8",
      ).then(JSON.parse),
      readFile(options.manifestPath ?? MANIFEST_PATH, "utf8").then(JSON.parse),
      readFile(options.categoriesPath ?? CATEGORIES_PATH, "utf8").then(
        JSON.parse,
      ),
      readFile(
        join(ROOT, "content/question-bank-v3/v3.2/category-policies.v3.2.json"),
        "utf8",
      ).then(JSON.parse),
    ]);
  if (!Array.isArray(categoriesWrapper.categories))
    throw new Error(
      "Categories file must be a wrapper with a categories array.",
    );
  if (bank.questions.some((question) => question.status !== "approved"))
    throw new Error(
      "Approved JSONL may contain only status: approved records.",
    );
  if (!bank.questions.length && !options.allowEmptyDemo)
    throw new Error(
      "Refusing to build a normal Firestore release with zero approved questions.",
    );
  if (options.production && !isStrictIsoDate(manifest.asOf))
    throw new Error("Production release manifest requires a strict asOf date.");
  const asOf = options.production
    ? (manifest.asOf as string)
    : isStrictIsoDate(manifest.asOf)
      ? manifest.asOf
      : DEFAULT_VALIDATION_AS_OF;
  const validation = validateQuestions(bank.questions, schema, asOf);
  const errors = validation.issues.filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length)
    throw new Error(
      `Approved bank validation failed: ${errors.map((issue) => `${issue.code}${issue.id ? ` (${issue.id})` : ""}`).join(", ")}`,
    );
  const v32 = manifest.questionBankV32 as
    { report?: ValidationReportV32; contentHash?: string } | undefined;
  if (v32 && (!v32.report || typeof v32.contentHash !== "string"))
    throw new Error("Question-bank v3.2 release metadata is malformed.");
  if (
    v32 &&
    v32.contentHash !==
      bankContentHashV32(
        bank.questions as unknown as Array<Record<string, unknown>>,
      )
  )
    throw new Error(
      "Question-bank v3.2 report does not bind the approved bank content.",
    );
  const v32Acceptance =
    v32?.report && typeof v32.contentHash === "string"
      ? {
          report: v32.report as ValidationReportV32,
          contentHash: v32.contentHash,
        }
      : undefined;
  if (options.production) {
    assertProductionReleaseAcceptance(
      bank.questions,
      validation.issues,
      v32Acceptance,
    );
    assertExactV32ProductionRelease(
      bank.questions as unknown as QuestionV32[],
      v32PolicyDocument as { categories: CategoryPolicyV32[] },
      manifest.questionBankV32 ?? {},
    );
  }
  const approvedJsonlSha256 = hash(bank.canonical);
  if (manifest.approvedQuestionCount !== bank.questions.length)
    throw new Error(
      `Release manifest count mismatch: expected ${manifest.approvedQuestionCount}, found ${bank.questions.length}.`,
    );
  if (manifest.approvedBankSha256 !== approvedJsonlSha256)
    throw new Error(
      "Release manifest SHA-256 does not match the canonical approved JSONL.",
    );
  assertReleaseValueExcludesEvidencePayload(manifest, "Release manifest");
  const derivedReleaseId = options.demoFixture
    ? `demo-empty-${approvedJsonlSha256.slice(0, 16)}`
    : `release-${approvedJsonlSha256}`;
  if (
    !options.demoFixture &&
    options.releaseId &&
    options.releaseId !== derivedReleaseId
  )
    throw new Error(
      "Production release ID must be the full SHA-256-derived release ID.",
    );
  const releaseId = options.releaseId ?? derivedReleaseId;
  const categories = (
    categoriesWrapper.categories as Array<{
      id: string;
      [key: string]: unknown;
    }>
  )
    .slice()
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  for (const category of categories)
    if (typeof category.id !== "string" || !SAFE_DOCUMENT_ID.test(category.id))
      throw new Error("Categories contain a path-unsafe id.");
  const categoryIds = new Set(categories.map((category) => category.id));
  if (categoryIds.size !== categories.length)
    throw new Error("Categories contain duplicate IDs.");
  for (const question of bank.questions)
    if (
      typeof question.categoryId !== "string" ||
      !SAFE_DOCUMENT_ID.test(question.categoryId) ||
      !categoryIds.has(question.categoryId)
    )
      throw new Error(
        `Approved question ${question.id} has an unknown or path-unsafe categoryId.`,
      );
  const catalogDocuments = categories.map((category) => ({
    path: `releases/${releaseId}/catalogCategories/${category.id}`,
    data: category as Record<string, unknown>,
  }));
  const questionDocuments = bank.questions.map((question) => ({
    path: `releases/${releaseId}/questions/${question.id}`,
    data: question as unknown as Record<string, unknown>,
  }));
  const inventory = new Map<string, number>();
  for (const question of bank.questions)
    inventory.set(
      question.categoryId,
      (inventory.get(question.categoryId) ?? 0) + 1,
    );
  const inventoryDocuments = [...inventory.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([categoryId, approvedCount]) => ({
      path: `releases/${releaseId}/inventory/${categoryId}`,
      data: { categoryId, approvedCount },
    }));
  const catalogSha256 = documentsHash(catalogDocuments);
  const documentRootSha256 = documentsHash([
    ...catalogDocuments,
    ...questionDocuments,
    ...inventoryDocuments,
  ]);
  const sourceManifestSha256 = hash(canonicalJson(manifest));
  const releaseRoot: ReleaseDocument = {
    path: `releases/${releaseId}`,
    data: {
      releaseId,
      asOf,
      approvedCount: bank.questions.length,
      approvedJsonlSha256,
      catalogSha256,
      documentRootSha256,
      sourceManifestSha256,
      immutable: true,
      demoFixture: Boolean(options.demoFixture),
      sourceManifestSchemaVersion: manifest.schemaVersion ?? null,
    },
  };
  const documents = [
    ...catalogDocuments,
    ...questionDocuments,
    ...inventoryDocuments,
    releaseRoot,
  ].sort(byPath);
  if (options.demoFixture)
    documents.push({
      path: "runtime/activeRelease",
      data: {
        releaseId,
        approvedCount: bank.questions.length,
        approvedJsonlSha256,
        demoFixture: true,
      },
    });
  assertUniqueReleaseDocuments(documents);
  assertReleaseDocumentsExcludeEvidencePayload(documents);
  classifyReleaseDocuments(documents);
  return {
    releaseId,
    asOf,
    approvedCount: bank.questions.length,
    approvedJsonlSha256,
    catalogSha256,
    documentRootSha256,
    sourceManifestSha256,
    documents,
  };
}

export function assertDemoEmulatorTarget(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const projectId =
    environment.GCLOUD_PROJECT ?? environment.FIREBASE_PROJECT_ID;
  if (!environment.FIRESTORE_EMULATOR_HOST)
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is required; real Firestore access is disabled.",
    );
  if (!projectId?.startsWith("demo-"))
    throw new Error("A demo-* project ID is required for seeding.");
}

async function main() {
  const demo = process.argv.includes("--demo");
  const v33 = process.argv.includes("--v3.3");
  if (v33) {
    if (demo)
      throw new Error(
        "v3.3 production input cannot be combined with demo mode.",
      );
    const trustIndex = process.argv.indexOf("--trust-root");
    const hashIndex = process.argv.indexOf("--trust-root-sha256");
    const trustRootPath =
      trustIndex >= 0 ? process.argv[trustIndex + 1] : undefined;
    const trustRootSha256 =
      hashIndex >= 0 ? process.argv[hashIndex + 1] : undefined;
    const input = await loadV33ProductionReleaseInput({
      trustRootPath,
      trustRootSha256,
    });
    const plan = buildV33FirestoreReleasePlan(input);
    console.log(
      JSON.stringify(
        {
          releaseId: plan.releaseId,
          asOf: plan.asOf,
          approvedCount: plan.approvedCount,
          approvedJsonlSha256: plan.approvedJsonlSha256,
          catalogSha256: plan.catalogSha256,
          documentRootSha256: plan.documentRootSha256,
          sourceManifestSha256: plan.sourceManifestSha256,
          documentCount: plan.documents.length,
          dryRun: true,
          production: true,
          questionBankVersion: "3.3.0",
        },
        null,
        2,
      ),
    );
    return;
  }
  const plan = await buildFirestoreReleasePlan({
    allowEmptyDemo: demo,
    demoFixture: demo,
    production: !demo,
  });
  console.log(
    JSON.stringify(
      {
        releaseId: plan.releaseId,
        asOf: plan.asOf,
        approvedCount: plan.approvedCount,
        approvedJsonlSha256: plan.approvedJsonlSha256,
        catalogSha256: plan.catalogSha256,
        documentRootSha256: plan.documentRootSha256,
        sourceManifestSha256: plan.sourceManifestSha256,
        documentCount: plan.documents.length,
        dryRun: process.argv.includes("--dry-run"),
        production: !demo,
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes("--dry-run")) assertDemoEmulatorTarget();
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
