/**
 * M-MEDIA-08 immutable successor publisher.
 *
 * This intentionally does not reuse owner-media-release's historical base.
 * It snapshots the currently active immutable release and only replaces the
 * already-bound 99 goal question hashes and their 198 media records.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { canonicalJson } from "./firestore-release-canonical.js";
import { decodeSourceDocument, type FirestoreValue, type SourceDocument } from "./owner-approved-release.js";
import { buildGoalMediaSuccessorUploadPlan, type ImmutableMediaReadback, type PrivateMediaUpload, type PrivateMediaUploadPlan } from "./question-media-release-prep.js";

export const EDGE_SUCCESSOR_SCHEMA = "goal-media-edge-successor-v1";
export const FIRESTORE_PROJECT = "huroof-a3ee7";
export const FIRESTORE_LOCATION = "me-central2";
export const PRIVATE_MEDIA_BUCKET = "huroof-a3ee7.firebasestorage.app";

/**
 * `fields` is retained for documents captured through the REST API.  It avoids
 * re-serialising an inherited document through JavaScript (notably turning an
 * integerValue into a doubleValue, or rounding a 64-bit integer).
 */
export type ReleaseDocument = { path: string; data: Record<string, unknown>; fields?: Record<string, FirestoreValue> };
export type CapturedActiveRelease = {
  capturedAt: string;
  pointer: Record<string, unknown>;
  pointerFields?: RestFields;
  root: ReleaseDocument;
  children: ReleaseDocument[];
};
export type GoalBinding = { promptMediaId: string; promptSha256: string; answerMediaId: string; answerSha256: string; canonicalAnswer?: string; acceptedAnswers?: string[] };
export type GoalMediaEdgeSuccessorPlan = {
  schemaVersion: typeof EDGE_SUCCESSOR_SCHEMA;
  releaseId: string;
  capturedAt: string;
  base: CapturedActiveRelease;
  package: { manifestSha256: string; questionManifestSha256: string; uploadCount: 198; goalQuestionCount: 99; catalogSha256: string };
  uploads: PrivateMediaUploadPlan;
  /** Every copied child except changed media documents. */
  preservedChildren: ReleaseDocument[];
  questionReplacements: ReleaseDocument[];
  mediaReplacements: Array<{ path: string; original: ReleaseDocument; upload: PrivateMediaUpload }>;
};
export type GoalMediaEdgeSuccessorApi = {
  metadata(): Promise<{ projectId: string; databaseId: string; locationId: string; type: string }>;
  read(paths: string[]): Promise<Array<SourceDocument | undefined>>;
  listCollectionIds(path: string): Promise<string[]>;
  listCollection(path: string): Promise<SourceDocument[]>;
  ensureObject(upload: PrivateMediaUpload): Promise<ImmutableMediaReadback>;
  readObject(upload: PrivateMediaUpload): Promise<ImmutableMediaReadback>;
  create(documents: ReleaseDocument[]): Promise<void>;
  activate(plan: MaterializedGoalMediaEdgeSuccessorPlan, verification: ReleaseDocument): Promise<void>;
  rollback(plan: MaterializedGoalMediaEdgeSuccessorPlan, receipt: ReleaseDocument): Promise<void>;
};
export type MaterializedGoalMediaEdgeSuccessorPlan = GoalMediaEdgeSuccessorPlan & {
  root: ReleaseDocument;
  children: ReleaseDocument[];
  pointer: Record<string, unknown>;
  pointerFields: RestFields;
  documentRootSha256: string;
};

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => sha(canonicalJson(value));
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const pathOf = (name: string) => {
  const marker = "/documents/", index = name.indexOf(marker);
  if (index < 0) throw new Error("Firestore response has an invalid document path.");
  return name.slice(index + marker.length);
};
const docHash = (documents: ReleaseDocument[]) => hash(documents.slice().sort((a, b) => a.path.localeCompare(b.path)).map(documentIdentity));
const releaseRootPath = (releaseId: string) => `releases/${releaseId}`;
const rootOf = (plan: MaterializedGoalMediaEdgeSuccessorPlan) => plan.root;
const mediaBinding = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

type RestFields = Record<string, FirestoreValue>;
const cloneRest = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const restTags = ["nullValue", "booleanValue", "integerValue", "doubleValue", "timestampValue", "stringValue", "bytesValue", "referenceValue", "geoPointValue", "arrayValue", "mapValue"] as const;

/** Accept only losslessly copyable Firestore REST values. */
function assertRestValue(value: unknown): asserts value is FirestoreValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unsupported Firestore REST value in successor transport.");
  const record = value as Record<string, unknown>, tags = restTags.filter((tag) => Object.hasOwn(record, tag));
  if (tags.length !== 1) throw new Error("Firestore REST value must have exactly one supported type tag.");
  const tag = tags[0]!;
  if (tag === "nullValue" && record.nullValue !== null) throw new Error("Firestore nullValue is invalid.");
  if ((tag === "booleanValue" && typeof record.booleanValue !== "boolean") || ((tag === "integerValue" || tag === "timestampValue" || tag === "stringValue" || tag === "bytesValue" || tag === "referenceValue") && typeof record[tag] !== "string") || (tag === "doubleValue" && typeof record.doubleValue !== "number" && typeof record.doubleValue !== "string")) throw new Error("Firestore REST scalar type is invalid.");
  if (tag === "arrayValue") {
    const array = record.arrayValue;
    if (!array || typeof array !== "object" || Array.isArray(array)) throw new Error("Firestore arrayValue is invalid.");
    const values = (array as { values?: unknown }).values;
    if (values !== undefined && (!Array.isArray(values) || values.some((item) => { try { assertRestValue(item); return false; } catch { return true; } }))) throw new Error("Firestore arrayValue contains an unsupported value.");
  }
  if (tag === "mapValue") {
    const map = record.mapValue;
    if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("Firestore mapValue is invalid.");
    const fields = (map as { fields?: unknown }).fields;
    if (fields !== undefined && (!fields || typeof fields !== "object" || Array.isArray(fields))) throw new Error("Firestore mapValue fields are invalid.");
    for (const item of Object.values((fields ?? {}) as Record<string, unknown>)) assertRestValue(item);
  }
  if (tag === "geoPointValue") {
    const point = record.geoPointValue;
    if (!point || typeof point !== "object" || Array.isArray(point)) throw new Error("Firestore geoPointValue is invalid.");
    const { latitude, longitude } = point as Record<string, unknown>;
    if (typeof latitude !== "number" || typeof longitude !== "number") throw new Error("Firestore geoPointValue coordinates are invalid.");
  }
}
function capturedFields(document: SourceDocument): RestFields {
  if (!document.fields || typeof document.fields !== "object" || Array.isArray(document.fields)) throw new Error("Firestore source document fields are invalid.");
  for (const value of Object.values(document.fields)) assertRestValue(value);
  return cloneRest(document.fields);
}
function capturedDocument(document: SourceDocument): ReleaseDocument {
  return { path: pathOf(document.name), data: decodeSourceDocument(document).data, fields: capturedFields(document) };
}
const fieldsFor = (document: ReleaseDocument): RestFields => document.fields ? cloneRest(document.fields) : Object.fromEntries(Object.entries(document.data).map(([key, value]) => [key, encode(value) as FirestoreValue]));
const sameDocument = (source: SourceDocument | undefined, expected: ReleaseDocument) => !!source && pathOf(source.name) === expected.path && same(capturedFields(source), fieldsFor(expected));
const documentIdentity = ({ path, data, fields }: ReleaseDocument) => ({ path, ...(fields ? { fields } : { data }) });
function replaceFields(document: ReleaseDocument, data: Record<string, unknown>, changes: Record<string, FirestoreValue>): ReleaseDocument {
  return { path: document.path, data, fields: { ...fieldsFor(document), ...changes } };
}
function replaceMapString(document: ReleaseDocument, key: "media" | "answerMedia", assetSha256: string, data: Record<string, unknown>): ReleaseDocument {
  const field = fieldsFor(document)[key];
  if (!field || typeof field !== "object" || !Object.hasOwn(field, "mapValue")) throw new Error(`Captured ${key} binding is not a Firestore map.`);
  const map = field.mapValue as { fields?: Record<string, FirestoreValue> };
  if (!map?.fields || !map.fields.assetSha256 || map.fields.assetSha256.stringValue === undefined) throw new Error(`Captured ${key} hash is not a Firestore string.`);
  return replaceFields(document, data, { [key]: { mapValue: { ...cloneRest(map), fields: { ...cloneRest(map.fields), assetSha256: { stringValue: assetSha256 } } } } });
}

const RECURSIVE_READ_CONCURRENCY = 64;
type AsyncLimiter = { run<T>(operation: () => Promise<T>): Promise<T> };

/** A single shared limiter keeps large release walks fast without unbounded REST fan-out. */
function createAsyncLimiter(limit = RECURSIVE_READ_CONCURRENCY): AsyncLimiter {
  let active = 0;
  const queued: Array<() => void> = [];
  const release = () => {
    active -= 1;
    queued.shift()?.();
  };
  return {
    run: async <T>(operation: () => Promise<T>) => {
      if (active >= limit) await new Promise<void>((resolve) => queued.push(resolve));
      active += 1;
      try { return await operation(); } finally { release(); }
    },
  };
}

async function recursiveChildren(
  api: Pick<GoalMediaEdgeSuccessorApi, "listCollectionIds" | "listCollection">,
  parent: string,
  limiter: AsyncLimiter = createAsyncLimiter(),
): Promise<ReleaseDocument[]> {
  const collectionIds = (await limiter.run(() => api.listCollectionIds(parent))).slice().sort();
  const collections = await Promise.all(collectionIds.map(async (collectionId) =>
    (await limiter.run(() => api.listCollection(`${parent}/${collectionId}`))).slice().sort((a, b) => pathOf(a.name).localeCompare(pathOf(b.name))),
  ));
  const descendants = await Promise.all(collections.flat().map(async (document) => {
    const path = pathOf(document.name);
    // Firestore `showMissing=true` returns synthetic ancestor names without
    // fields/updateTime. They are traversal nodes only: never capture or
    // create placeholders for them, but do enumerate their descendants.
    const own = typeof document.updateTime === "string" && document.updateTime ? [capturedDocument(document)] : [];
    return [...own, ...await recursiveChildren(api, parent === path ? "" : path, limiter)];
  }));
  return descendants.flat();
}

/** Read-only capture of the exact active pointer, root, and every descendant. */
export async function captureActiveGoalMediaBase(api: GoalMediaEdgeSuccessorApi, capturedAt: string): Promise<CapturedActiveRelease> {
  const pointerDocument = (await api.read(["runtime/activeRelease"]))[0];
  if (!pointerDocument) throw new Error("runtime/activeRelease is absent.");
  const capturedPointer = capturedDocument(pointerDocument), pointer = capturedPointer.data;
  const releaseId = pointer.releaseId;
  if (typeof releaseId !== "string" || !/^[A-Za-z0-9_-]{16,160}$/u.test(releaseId)) throw new Error("Active pointer has an invalid immutable release ID.");
  const rootPath = releaseRootPath(releaseId);
  const rootDocument = (await api.read([rootPath]))[0];
  if (!rootDocument) throw new Error("Active release root is absent.");
  const root = capturedDocument(rootDocument);
  if (root.data.releaseId !== releaseId) throw new Error("Active pointer and release root disagree.");
  const children = await recursiveChildren(api, rootPath);
  if (!children.length || new Set(children.map((item) => item.path)).size !== children.length) throw new Error("Active release child capture is incomplete or duplicated.");
  return { capturedAt, pointer, pointerFields: capturedPointer.fields, root, children: children.sort((a, b) => a.path.localeCompare(b.path)) };
}

function requireGoalBindings(value: unknown): GoalBinding[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Goal successor question manifest is invalid.");
  const questions = (value as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length !== 99) throw new Error("Goal successor requires exactly 99 questions.");
  const bindings = questions.map((question) => {
    const record = question && typeof question === "object" ? question as Record<string, unknown> : {};
    const media = mediaBinding(record.media);
    const binding = { promptMediaId: media?.promptMediaId, promptSha256: media?.promptSha256, answerMediaId: media?.answerMediaId, answerSha256: media?.answerSha256, canonicalAnswer: record.canonicalAnswer, acceptedAnswers: Array.isArray(record.acceptedAnswers) ? record.acceptedAnswers : undefined };
    if (typeof binding.promptMediaId !== "string" || typeof binding.answerMediaId !== "string" || !/^goal-quiz-2026:\d{3}:blur$/u.test(binding.promptMediaId) || !/^goal-quiz-2026:\d{3}:clean$/u.test(binding.answerMediaId) || !validHash(binding.promptSha256) || !validHash(binding.answerSha256)) throw new Error("Goal successor has an unsafe stable media binding.");
    return binding as GoalBinding;
  });
  if (new Set(bindings.flatMap((item) => [item.promptMediaId, item.answerMediaId])).size !== 198) throw new Error("Goal successor media bindings are not one-to-one.");
  return bindings;
}

export function buildGoalMediaEdgeSuccessorPlan(input: { base: CapturedActiveRelease; uploads: PrivateMediaUploadPlan; questionManifest: unknown; questionManifestSha256: string }): GoalMediaEdgeSuccessorPlan {
  if (input.uploads.assetCount !== 198 || input.uploads.uploads.length !== 198 || !validHash(input.uploads.manifestSha256) || !validHash(input.questionManifestSha256)) throw new Error("Goal successor package is incomplete.");
  const bindings = requireGoalBindings(input.questionManifest);
  const uploads = new Map(input.uploads.uploads.map((upload) => [upload.mediaId, upload]));
  if (uploads.size !== 198 || [...uploads.values()].some((upload) => upload.contentType !== "video/mp4" || !upload.createOnly)) throw new Error("Goal successor uploads are not exact create-only MP4 bindings.");
  const baseReleaseId = String(input.base.root.data.releaseId ?? "");
  if (!baseReleaseId || input.base.pointer.releaseId !== baseReleaseId) throw new Error("Captured active base is internally inconsistent.");
  const byPrompt = new Map<string, ReleaseDocument>();
  for (const document of input.base.children) {
    const media = mediaBinding(document.data.media), answer = mediaBinding(document.data.answerMedia);
    if (typeof media?.mediaId === "string" && typeof answer?.mediaId === "string") byPrompt.set(`${media.mediaId}\0${answer.mediaId}`, document);
  }
  const questionPaths = new Set<string>(), mediaPaths = new Set<string>();
  const questionReplacements: ReleaseDocument[] = [], mediaReplacements: GoalMediaEdgeSuccessorPlan["mediaReplacements"] = [];
  for (const binding of bindings) {
    const promptUpload = uploads.get(binding.promptMediaId), answerUpload = uploads.get(binding.answerMediaId);
    const original = byPrompt.get(`${binding.promptMediaId}\0${binding.answerMediaId}`);
    if (!original || !promptUpload || !answerUpload || promptUpload.assetSha256 !== binding.promptSha256 || answerUpload.assetSha256 !== binding.answerSha256) throw new Error("Active release does not contain the exact stable goal media pair.");
    if (original.data.modality !== "video" || original.data.categoryId !== "goals-2026" || (binding.canonicalAnswer !== undefined && original.data.canonicalAnswer !== binding.canonicalAnswer) || (binding.acceptedAnswers !== undefined && !same(original.data.acceptedAnswers, binding.acceptedAnswers))) throw new Error("Goal successor would alter protected question content.");
    const oldPrompt = mediaBinding(original.data.media)!, oldAnswer = mediaBinding(original.data.answerMedia)!;
    questionPaths.add(original.path);
    const replacementData = { ...original.data, media: { ...oldPrompt, assetSha256: promptUpload.assetSha256 }, answerMedia: { ...oldAnswer, assetSha256: answerUpload.assetSha256 } };
    const promptReplacement = replaceMapString(original, "media", promptUpload.assetSha256, replacementData);
    const replacement = replaceMapString(promptReplacement, "answerMedia", answerUpload.assetSha256, replacementData);
    questionReplacements.push({ ...replacement, path: original.path.replace(releaseRootPath(baseReleaseId), releaseRootPath("__SUCCESSOR__")) });
    for (const [mediaId, upload] of [[binding.promptMediaId, promptUpload], [binding.answerMediaId, answerUpload]] as const) {
      const existing = input.base.children.find((document) => document.path === `${releaseRootPath(baseReleaseId)}/media/${mediaId}`);
      if (!existing || mediaPaths.has(existing.path)) throw new Error("Active release media records are incomplete or duplicated.");
      mediaPaths.add(existing.path);
      mediaReplacements.push({ path: existing.path.replace(releaseRootPath(baseReleaseId), releaseRootPath("__SUCCESSOR__")), original: existing, upload });
    }
  }
  if (questionReplacements.length !== 99 || questionPaths.size !== 99 || mediaReplacements.length !== 198 || mediaPaths.size !== 198) throw new Error("Goal successor must replace exactly 99 questions and 198 media records.");
  const preservedChildren = input.base.children.filter((document) => !questionPaths.has(document.path) && !mediaPaths.has(document.path)).map((document) => ({ ...document, path: document.path.replace(releaseRootPath(baseReleaseId), releaseRootPath("__SUCCESSOR__")) }));
  const identity = { schemaVersion: EDGE_SUCCESSOR_SCHEMA, baseReleaseId, basePointerSha256: hash(input.base.pointerFields ?? input.base.pointer), baseRootSha256: hash(input.base.root.fields ?? input.base.root.data), baseChildrenSha256: docHash(input.base.children), mediaManifestSha256: input.uploads.manifestSha256, questionManifestSha256: input.questionManifestSha256, replacements: questionReplacements.map((item) => item.data.media).concat(questionReplacements.map((item) => item.data.answerMedia)) };
  const releaseId = `goal-media-edge-successor-${hash(identity).slice(0, 32)}`;
  const replacePath = (path: string) => path.replace(releaseRootPath("__SUCCESSOR__"), releaseRootPath(releaseId));
  const relocatedPreservedChildren = preservedChildren.map((item) => ({ ...item, path: replacePath(item.path) }));
  const catalogSha256 = docHash(relocatedPreservedChildren.filter((document) => /\/catalogCategories\/[^/]+$/u.test(document.path)));
  return { schemaVersion: EDGE_SUCCESSOR_SCHEMA, releaseId, capturedAt: input.base.capturedAt, base: input.base, package: { manifestSha256: input.uploads.manifestSha256, questionManifestSha256: input.questionManifestSha256, uploadCount: 198, goalQuestionCount: 99, catalogSha256 }, uploads: input.uploads, preservedChildren: relocatedPreservedChildren, questionReplacements: questionReplacements.map((item) => ({ ...item, path: replacePath(item.path) })), mediaReplacements: mediaReplacements.map((item) => ({ ...item, path: replacePath(item.path) })) };
}

/** Loads the ignored 198-asset package and makes no cloud request. */
export async function buildGoalMediaEdgeSuccessorPlanFromPackage(base: CapturedActiveRelease, root = process.cwd()): Promise<GoalMediaEdgeSuccessorPlan> {
  const packageRoot = "content/question-media/goal-quiz-2026-edge-successor";
  const [uploads, questions] = await Promise.all([buildGoalMediaSuccessorUploadPlan(root), readFile(resolve(root, packageRoot, "questions.json"), "utf8")]);
  const questionManifest = JSON.parse(questions) as unknown;
  return buildGoalMediaEdgeSuccessorPlan({ base, uploads, questionManifest, questionManifestSha256: hash(questionManifest) });
}

function materialize(plan: GoalMediaEdgeSuccessorPlan, readback: ImmutableMediaReadback[]): MaterializedGoalMediaEdgeSuccessorPlan {
  if (readback.length !== 198) throw new Error("Every successor Storage object requires authenticated readback.");
  const actual = new Map(readback.map((item) => [item.mediaId, item]));
  const media = plan.mediaReplacements.map(({ path, original, upload }) => {
    const item = actual.get(upload.mediaId);
    if (!item || item.assetSha256 !== upload.assetSha256 || item.objectName !== upload.objectName || item.contentType !== upload.contentType || item.byteSize !== upload.byteSize || item.width !== upload.width || item.height !== upload.height || item.durationSeconds !== upload.durationSeconds || !/^\d{1,32}$/u.test(item.generation)) throw new Error(`Authenticated Storage readback differs for ${upload.mediaId}.`);
    const data = { ...original.data, mediaId: upload.mediaId, assetSha256: upload.assetSha256, objectName: upload.objectName, generation: item.generation, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, ...(upload.durationSeconds === undefined ? {} : { durationSeconds: upload.durationSeconds }), immutable: true };
    return replaceFields({ ...original, path }, data, {
      mediaId: { stringValue: upload.mediaId }, assetSha256: { stringValue: upload.assetSha256 }, objectName: { stringValue: upload.objectName }, generation: { stringValue: item.generation }, contentType: { stringValue: upload.contentType }, byteSize: encode(upload.byteSize) as FirestoreValue, width: encode(upload.width) as FirestoreValue, height: encode(upload.height) as FirestoreValue, immutable: { booleanValue: true }, ...(upload.durationSeconds === undefined ? {} : { durationSeconds: encode(upload.durationSeconds) as FirestoreValue }),
    });
  });
  if (actual.size !== 198) throw new Error("Authenticated Storage readback is incomplete or duplicated.");
  const children = [...plan.preservedChildren, ...plan.questionReplacements, ...media].sort((a, b) => a.path.localeCompare(b.path));
  const documentRootSha256 = docHash(children);
  // Catalog commitments hash lossless documents including their paths.  The
  // successor relocates every catalog document, so inheriting the base hash
  // would bind an obsolete release path even though its category data is kept.
  const catalogSha256 = docHash(children.filter((document) => /\/catalogCategories\/[^/]+$/u.test(document.path)));
  if (catalogSha256 !== plan.package.catalogSha256) throw new Error("Prepared successor catalog commitment drifted.");
  const rootData = { ...plan.base.root.data, schemaVersion: EDGE_SUCCESSOR_SCHEMA, releaseId: plan.releaseId, baseReleaseId: String(plan.base.root.data.releaseId), baseDocumentRootSha256: plan.base.root.data.documentRootSha256, catalogSha256, documentRootSha256, goalMediaEdgeSuccessor: { packageManifestSha256: plan.package.manifestSha256, questionManifestSha256: plan.package.questionManifestSha256, replacedQuestionCount: 99, replacedMediaCount: 198 }, immutable: true };
  const root = replaceFields({ ...plan.base.root, path: releaseRootPath(plan.releaseId) }, rootData, { schemaVersion: { stringValue: EDGE_SUCCESSOR_SCHEMA }, releaseId: { stringValue: plan.releaseId }, baseReleaseId: { stringValue: String(plan.base.root.data.releaseId) }, baseDocumentRootSha256: encode(plan.base.root.data.documentRootSha256) as FirestoreValue, catalogSha256: { stringValue: catalogSha256 }, documentRootSha256: { stringValue: documentRootSha256 }, goalMediaEdgeSuccessor: encode(rootData.goalMediaEdgeSuccessor) as FirestoreValue, immutable: { booleanValue: true } });
  const pointerChanges: Record<string, unknown> = { releaseId: plan.releaseId, approvedCount: root.data.approvedCount, catalogSha256, documentRootSha256, sourceManifestSha256: root.data.sourceManifestSha256, baseReleaseId: String(plan.base.root.data.releaseId), publicationAuthority: "goal_media_edge_successor" };
  const pointer: Record<string, unknown> = { ...plan.base.pointer, ...pointerChanges };
  const encodeFields = (record: Record<string, unknown>): RestFields => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, encode(value) as FirestoreValue]));
  const pointerFields: RestFields = { ...(plan.base.pointerFields ? cloneRest(plan.base.pointerFields) : encodeFields(plan.base.pointer)), ...encodeFields(pointerChanges) };
  // Preserve every inherited pointer field as REST-typed data, then replace only
  // the successor-owned fields.  The base pointer itself is not a release
  // document, so capture attaches its fields below when available.
  return { ...plan, root, children, pointer, pointerFields, documentRootSha256 };
}

const verification = (plan: MaterializedGoalMediaEdgeSuccessorPlan): ReleaseDocument => ({ path: `verificationReceipts/${plan.releaseId}-goal-media-edge`, data: { releaseId: plan.releaseId, baseReleaseId: plan.base.root.data.releaseId, activePointer: plan.pointer, documentRootSha256: plan.documentRootSha256, immutable: true }, fields: { releaseId: { stringValue: plan.releaseId }, baseReleaseId: { stringValue: String(plan.base.root.data.releaseId) }, activePointer: { mapValue: { fields: cloneRest(plan.pointerFields) } }, documentRootSha256: { stringValue: plan.documentRootSha256 }, immutable: { booleanValue: true } } });
const activation = (plan: MaterializedGoalMediaEdgeSuccessorPlan): ReleaseDocument => ({ path: `activationReceipts/${plan.releaseId}-goal-media-edge`, data: { releaseId: plan.releaseId, baseReleaseId: plan.base.root.data.releaseId, activePointer: plan.pointer, immutable: true }, fields: { releaseId: { stringValue: plan.releaseId }, baseReleaseId: { stringValue: String(plan.base.root.data.releaseId) }, activePointer: { mapValue: { fields: cloneRest(plan.pointerFields) } }, immutable: { booleanValue: true } } });

async function pending(api: GoalMediaEdgeSuccessorApi, documents: ReleaseDocument[]) {
  const result: ReleaseDocument[] = [];
  for (let offset = 0; offset < documents.length; offset += 300) {
    const part = documents.slice(offset, offset + 300), stored = await api.read(part.map((item) => item.path));
    for (let index = 0; index < part.length; index++) { const value = stored[index]; if (!value) result.push(part[index]!); else if (!sameDocument(value, part[index]!)) throw new Error("Create-only successor document conflicts with existing immutable data."); }
  }
  return result;
}
async function assertBaseCurrent(plan: GoalMediaEdgeSuccessorPlan, api: GoalMediaEdgeSuccessorApi) {
  const pointer = (await api.read(["runtime/activeRelease"]))[0];
  if (!pointer) throw new Error("Active pointer disappeared.");
  const value = decodeSourceDocument(pointer).data;
  if (value.releaseId === plan.releaseId && value.publicationAuthority === "goal_media_edge_successor") return "successor" as const;
  if (!same(capturedFields(pointer), plan.base.pointerFields ?? fieldsFor({ path: "runtime/activeRelease", data: plan.base.pointer }))) throw new Error("Captured active pointer is stale; successor publication refused.");
  const [root] = await api.read([plan.base.root.path]);
  if (!sameDocument(root, plan.base.root)) throw new Error("Captured active release root drifted.");
  const actual = await recursiveChildren(api, plan.base.root.path);
  if (actual.length !== plan.base.children.length || docHash(actual) !== docHash(plan.base.children)) throw new Error("Captured active release children drifted.");
  return "base" as const;
}
async function verifyMaterialized(plan: MaterializedGoalMediaEdgeSuccessorPlan, api: GoalMediaEdgeSuccessorApi, active = false) {
  const [root, verificationDoc, activeDoc] = await api.read([rootOf(plan).path, verification(plan).path, "runtime/activeRelease"]);
  if (!sameDocument(root, rootOf(plan))) throw new Error("Successor root readback differs.");
  const children = await recursiveChildren(api, rootOf(plan).path);
  if (children.length !== plan.children.length || docHash(children) !== plan.documentRootSha256 || !same(children, plan.children)) throw new Error("Full successor child readback differs before activation.");
  if (verificationDoc && !sameDocument(verificationDoc, verification(plan))) throw new Error("Successor verification receipt conflicts.");
  if (active && (!activeDoc || !same(capturedFields(activeDoc), plan.pointerFields))) throw new Error("Successor activation pointer differs.");
}
async function verifyChildren(plan: MaterializedGoalMediaEdgeSuccessorPlan, api: GoalMediaEdgeSuccessorApi) {
  const children = await recursiveChildren(api, rootOf(plan).path);
  if (children.length !== plan.children.length || docHash(children) !== plan.documentRootSha256 || !same(children, plan.children)) throw new Error("Full successor child readback differs before completion root.");
}
/** A retry is safe only when the entire immutable activation identity already exists. */
async function assertActivatedRetryIdentity(plan: MaterializedGoalMediaEdgeSuccessorPlan, api: GoalMediaEdgeSuccessorApi) {
  const [active, root, verificationDoc, activationDoc] = await api.read(["runtime/activeRelease", plan.root.path, verification(plan).path, activation(plan).path]);
  if (!active || !same(capturedFields(active), plan.pointerFields) || !sameDocument(root, plan.root) || !sameDocument(verificationDoc, verification(plan)) || !sameDocument(activationDoc, activation(plan))) throw new Error("Successor retry activation identity drifted.");
  await verifyChildren(plan, api);
}

export async function applyGoalMediaEdgeSuccessor(plan: GoalMediaEdgeSuccessorPlan, api: GoalMediaEdgeSuccessorApi, rebuild: () => Promise<GoalMediaEdgeSuccessorPlan>) {
  if (!same(plan, await rebuild())) throw new Error("Goal successor plan differs from the deterministic local rebuild.");
  const target = await api.metadata();
  if (target.projectId !== FIRESTORE_PROJECT || target.databaseId !== "(default)" || target.locationId !== FIRESTORE_LOCATION || target.type !== "FIRESTORE_NATIVE") throw new Error("Goal successor target is not pinned production Firestore.");
  const state = await assertBaseCurrent(plan, api);
  // A successor retry must prove its complete pointer/root/receipt identity
  // using read-only Storage readback before any Storage or Firestore write.
  const retryPlan = state === "successor" ? materialize(plan, await Promise.all(plan.uploads.uploads.map((upload) => api.readObject(upload)))) : undefined;
  if (retryPlan) { await assertActivatedRetryIdentity(retryPlan, api); return; }
  const first = await api.ensureObject(plan.uploads.uploads[0]!);
  const rest = await Promise.all(plan.uploads.uploads.slice(1).map((upload) => api.ensureObject(upload)));
  const finalPlan = retryPlan ?? materialize(plan, [first, ...rest]);
  if (state === "base" && await assertBaseCurrent(plan, api) !== "base") throw new Error("Active pointer changed to a successor during Storage readback.");
  const creates = await pending(api, finalPlan.children); if (creates.length) await api.create(creates);
  await verifyChildren(finalPlan, api);
  const rootCreates = await pending(api, [finalPlan.root]); if (rootCreates.length) await api.create(rootCreates);
  const verificationCreates = await pending(api, [verification(finalPlan)]); if (verificationCreates.length) await api.create(verificationCreates);
  await verifyMaterialized(finalPlan, api);
  await api.activate(finalPlan, verification(finalPlan));
  await verifyMaterialized(finalPlan, api, true);
}

export async function rollbackGoalMediaEdgeSuccessor(plan: GoalMediaEdgeSuccessorPlan, api: GoalMediaEdgeSuccessorApi, operationReference: string) {
  if (!/^[A-Za-z0-9._:-]{3,160}$/u.test(operationReference)) throw new Error("Rollback operation reference is invalid.");
  const finalPlan = materialize(plan, await Promise.all(plan.uploads.uploads.map((upload) => api.readObject(upload))));
  const receipt: ReleaseDocument = { path: `rollbackReceipts/${plan.releaseId}-${sha(operationReference).slice(0, 32)}`, data: { releaseId: plan.releaseId, expectedActivePointer: finalPlan.pointer, restorePointer: plan.base.pointer, operationReference, immutable: true } };
  await api.rollback(finalPlan, receipt);
}

/* Production REST adapter. It is deliberately not invoked by this task. */
type Transport = { fetch?: typeof fetch; accessToken?: () => Promise<string> };
type RestValue = Record<string, unknown>;
const firestoreName = (path: string) => `projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}`;
const encode = (value: unknown): RestValue => {
  if (value === null) return { nullValue: null }; if (typeof value === "string") return { stringValue: value }; if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }; if (value && typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encode(item)])) } }; throw new Error("Successor value is not Firestore serializable.");
};
const rows = (body: string): Array<{ found?: SourceDocument }> => body.trim() ? (body.trim().startsWith("[") ? JSON.parse(body) : body.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))) : [];
export async function createProductionGoalMediaEdgeSuccessorApi(mediaRoot: string, transport: Transport = {}): Promise<GoalMediaEdgeSuccessorApi> {
  const require = createRequire(import.meta.url), fetcher = transport.fetch ?? fetch, firestore = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;
  const token = async () => { if (transport.accessToken) return transport.accessToken(); const auth = require("firebase-tools/lib/auth.js") as { getGlobalDefaultAccount(): { tokens?: { refresh_token?: string } } | undefined; getAccessToken(value: string, scopes: string[]): Promise<{ access_token?: string }> }; const refresh = auth.getGlobalDefaultAccount()?.tokens?.refresh_token, access = refresh ? await auth.getAccessToken(refresh, ["https://www.googleapis.com/auth/cloud-platform"]) : undefined; if (!access?.access_token) throw new Error("Firebase CLI access token is unavailable."); return access.access_token; };
  const rawRequest = async (url: string, init: RequestInit = {}) => fetcher(url, { ...init, headers: { Authorization: `Bearer ${await token()}`, "Cache-Control": "no-store", ...(init.headers ?? {}) } });
  const request = async (url: string, init: RequestInit = {}) => { const response = await rawRequest(url, init); if (!response.ok) throw new Error(`Firebase REST ${init.method ?? "GET"} ${response.status}`); return response; };
  const read = async (paths: string[]) => { const response = await request(`${firestore}:batchGet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documents: paths.map(firestoreName) }) }); const found = new Map(rows(await response.text()).filter((row) => row.found).map((row) => [pathOf(row.found!.name), row.found!])); return paths.map((path) => found.get(path)); };
  const restWrite = (document: ReleaseDocument, currentDocument: Record<string, unknown>) => ({ update: { name: firestoreName(document.path), fields: fieldsFor(document) }, currentDocument });
  const create = async (documents: ReleaseDocument[]) => { for (let offset = 0; offset < documents.length; offset += 250) { const part = documents.slice(offset, offset + 250), missing = await pending({ read } as GoalMediaEdgeSuccessorApi, part); if (missing.length) await request(`${firestore}:commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ writes: missing.map((document) => restWrite(document, { exists: false })) }) }); } };
  const listCollectionIds = async (path: string) => { const ids: string[] = []; let pageToken = ""; do { const response = await request(`https://firestore.googleapis.com/v1/${firestoreName(path)}:listCollectionIds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) }) }); const page = await response.json() as { collectionIds?: string[]; nextPageToken?: string }; ids.push(...(page.collectionIds ?? [])); pageToken = page.nextPageToken ?? ""; } while (pageToken); return ids; };
  const listCollection = async (path: string) => { const documents: SourceDocument[] = []; let pageToken = ""; do { const response = await request(`${firestore}/${path}?pageSize=1000&showMissing=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`); const page = await response.json() as { documents?: SourceDocument[]; nextPageToken?: string }; documents.push(...(page.documents ?? [])); pageToken = page.nextPageToken ?? ""; } while (pageToken); return documents; };
  const localFile = (upload: PrivateMediaUpload) => { const packageRoot = resolve(mediaRoot, "content", "question-media", "goal-quiz-2026-edge-successor"), local = resolve(packageRoot, upload.localFile), inside = relative(packageRoot, local); if (isAbsolute(upload.localFile) || inside.startsWith("..") || inside.split(sep).includes("..")) throw new Error("Successor media local path escapes its allowlisted package."); return local; };
  const objectUrl = (name: string) => `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(PRIVATE_MEDIA_BUCKET)}/o/${encodeURIComponent(name)}`;
  const readObject = async (upload: PrivateMediaUpload): Promise<ImmutableMediaReadback> => { const metaResponse = await rawRequest(objectUrl(upload.objectName)); if (!metaResponse.ok) throw new Error("Successor private object is absent after create-only upload."); const meta = await metaResponse.json() as { generation?: string; size?: string; contentType?: string; metadata?: Record<string, string> }; const generation = meta.generation, custom = meta.metadata ?? {}; if (Object.hasOwn(custom, "firebaseStorageDownloadTokens")) throw new Error("Successor private object has forbidden download-token metadata."); if (typeof generation !== "string" || !/^[1-9]\d*$/u.test(generation) || meta.size !== String(upload.byteSize) || meta.contentType !== upload.contentType || custom.assetSha256 !== upload.assetSha256 || custom.mediaId !== upload.mediaId || custom.byteSize !== String(upload.byteSize) || custom.width !== String(upload.width) || custom.height !== String(upload.height) || custom.durationSeconds !== String(upload.durationSeconds)) throw new Error("Successor private object metadata differs from prepared binding."); const byteUrl = `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(PRIVATE_MEDIA_BUCKET)}/o/${encodeURIComponent(upload.objectName)}?alt=media&ifGenerationMatch=${generation}`; const bytesResponse = await rawRequest(byteUrl); if (!bytesResponse.ok) throw new Error("Successor authenticated byte readback failed."); const bytes = new Uint8Array(await bytesResponse.arrayBuffer()); if (bytes.length !== upload.byteSize || sha(bytes) !== upload.assetSha256) throw new Error("Successor authenticated byte hash differs."); const firebaseUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(PRIVATE_MEDIA_BUCKET)}/o/${encodeURIComponent(upload.objectName)}?alt=media&ifGenerationMatch=${generation}`; const [gcsAnonymous, firebaseAnonymous] = await Promise.all([fetcher(byteUrl, { headers: { "Cache-Control": "no-store" } }), fetcher(firebaseUrl, { headers: { "Cache-Control": "no-store" } })]); if (![401, 403].includes(gcsAnonymous.status) || ![401, 403].includes(firebaseAnonymous.status)) throw new Error("Successor private object permits anonymous reads."); await Promise.all([gcsAnonymous.arrayBuffer(), firebaseAnonymous.arrayBuffer()]); return { mediaId: upload.mediaId, assetSha256: upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, ...(upload.durationSeconds === undefined ? {} : { durationSeconds: upload.durationSeconds }), objectName: upload.objectName, generation }; };
  const ensureObject = async (upload: PrivateMediaUpload) => { const existing = await rawRequest(objectUrl(upload.objectName)); if (existing.status === 404) { const bytes = await readFile(localFile(upload)); if (sha(bytes) !== upload.assetSha256 || bytes.length !== upload.byteSize) throw new Error("Successor local media bytes drifted."); const boundary = `goal-edge-${upload.assetSha256.slice(0, 32)}`, meta = canonicalJson({ name: upload.objectName, contentType: upload.contentType, metadata: upload.metadata }), start = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${upload.contentType}\r\n\r\n`), end = Buffer.from(`\r\n--${boundary}--\r\n`), response = await rawRequest(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(PRIVATE_MEDIA_BUCKET)}/o?uploadType=multipart&ifGenerationMatch=0`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: Buffer.concat([start, bytes, end]) }); if (!response.ok && response.status !== 412) throw new Error(`Successor create-only Storage upload failed with ${response.status}.`); } else if (!existing.ok) throw new Error(`Successor Storage lookup failed with ${existing.status}.`); return readObject(upload); };
  const transaction = async (plan: MaterializedGoalMediaEdgeSuccessorPlan, receipt: ReleaseDocument, rollback = false) => {
    const started = await request(`${firestore}:beginTransaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const id = ((await started.json()) as { transaction?: string }).transaction; if (!id) throw new Error("Firebase transaction is unavailable.");
    const guards = rollback ? ["runtime/activeRelease", plan.root.path, verification(plan).path, activation(plan).path, receipt.path] : ["runtime/activeRelease", plan.root.path, verification(plan).path, activation(plan).path];
    const response = await request(`${firestore}:batchGet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: id, documents: guards.map(firestoreName) }) }); const found = new Map(rows(await response.text()).filter((row) => row.found).map((row) => [pathOf(row.found!.name), row.found!])); const active = found.get("runtime/activeRelease");
    const pointerDocument: ReleaseDocument = { path: "runtime/activeRelease", data: plan.pointer, fields: plan.pointerFields };
    const basePointerDocument: ReleaseDocument = { path: "runtime/activeRelease", data: plan.base.pointer, fields: plan.base.pointerFields };
    if (!active || !sameDocument(found.get(plan.root.path), plan.root) || !sameDocument(found.get(verification(plan).path), verification(plan))) throw new Error("CAS release identity drifted.");
    if (rollback) {
      if (found.has(receipt.path) || !sameDocument(found.get(activation(plan).path), activation(plan)) || !sameDocument(active, pointerDocument)) throw new Error("Rollback CAS refused stale successor.");
      await request(`${firestore}:commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: id, writes: [restWrite(basePointerDocument, { updateTime: active.updateTime }), restWrite(receipt, { exists: false })] }) });
      return;
    }
    const existing = found.get(activation(plan).path);
    if (existing) { if (sameDocument(active, pointerDocument) && sameDocument(existing, activation(plan))) return; throw new Error("Activation retry conflicts with active pointer."); }
    if (!sameDocument(active, basePointerDocument)) throw new Error("Activation CAS refused stale pointer.");
    await request(`${firestore}:commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: id, writes: [restWrite(activation(plan), { exists: false }), restWrite(pointerDocument, { updateTime: active.updateTime })] }) });
  };
  return { metadata: async () => { const response = await request(`https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)`); const value = await response.json() as { locationId?: string; type?: string }; return { projectId: FIRESTORE_PROJECT, databaseId: "(default)", locationId: value.locationId ?? "", type: value.type ?? "" }; }, read, listCollectionIds, listCollection, create, ensureObject, readObject, activate: (plan, receipt) => transaction(plan, receipt), rollback: (plan, receipt) => transaction(plan, receipt, true) };
}

const PREPARED_ARTIFACT_SCHEMA = "goal-media-edge-successor-prepared-v1";
const GATE_INPUT_SCHEMA = "goal-media-edge-successor-gate-input-v1";
type PublicCapture = { capturedAt: string; pointer: ReleaseDocument; root: ReleaseDocument; children: ReleaseDocument[] };
type PreparedArtifact = { schemaVersion: typeof PREPARED_ARTIFACT_SCHEMA; cloudMutated: false; planSha256: string; plan: GoalMediaEdgeSuccessorPlan };
type GateReceipt = { status?: unknown; planSha256?: unknown; releaseId?: unknown };

function assertReleaseDocument(value: unknown, label: string): asserts value is ReleaseDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is not a release document.`);
  const document = value as Partial<ReleaseDocument>;
  if (typeof document.path !== "string" || !document.path || !document.data || typeof document.data !== "object" || Array.isArray(document.data) || !document.fields || typeof document.fields !== "object" || Array.isArray(document.fields)) throw new Error(`${label} does not retain exact REST fields.`);
}

/** Converts the root capture's public pointer-document shape without re-encoding REST fields. */
export function capturedBaseFromPublicCapture(value: unknown): CapturedActiveRelease {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Capture is not an object.");
  const capture = value as Partial<PublicCapture>;
  if (typeof capture.capturedAt !== "string" || !capture.capturedAt || !Array.isArray(capture.children)) throw new Error("Capture is incomplete.");
  assertReleaseDocument(capture.pointer, "Capture pointer");
  assertReleaseDocument(capture.root, "Capture root");
  capture.children.forEach((child, index) => assertReleaseDocument(child, `Capture child ${index}`));
  if (capture.pointer.path !== "runtime/activeRelease") throw new Error("Capture pointer path is unsafe.");
  const releaseId = capture.pointer.data.releaseId;
  if (typeof releaseId !== "string" || capture.root.path !== releaseRootPath(releaseId) || capture.root.data.releaseId !== releaseId) throw new Error("Capture pointer and root disagree.");
  if (new Set(capture.children.map((child) => child.path)).size !== capture.children.length || capture.children.some((child) => !child.path.startsWith(`${capture.root!.path}/`))) throw new Error("Capture descendants are incomplete or escape the active root.");
  return { capturedAt: capture.capturedAt, pointer: capture.pointer.data, pointerFields: capture.pointer.fields, root: capture.root, children: capture.children };
}
function publicCapture(base: CapturedActiveRelease): PublicCapture {
  return { capturedAt: base.capturedAt, pointer: { path: "runtime/activeRelease", data: base.pointer, fields: base.pointerFields }, root: base.root, children: base.children } as PublicCapture;
}
function preparedArtifact(plan: GoalMediaEdgeSuccessorPlan): PreparedArtifact {
  return { schemaVersion: PREPARED_ARTIFACT_SCHEMA, cloudMutated: false, planSha256: hash(plan), plan };
}
function readPreparedArtifact(value: unknown): PreparedArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Prepared artifact is invalid.");
  const artifact = value as Partial<PreparedArtifact>;
  if (artifact.schemaVersion !== PREPARED_ARTIFACT_SCHEMA || artifact.cloudMutated !== false || typeof artifact.planSha256 !== "string" || !artifact.plan || hash(artifact.plan) !== artifact.planSha256) throw new Error("Prepared artifact identity differs.");
  return artifact as PreparedArtifact;
}
function gateInput(artifact: PreparedArtifact) {
  return { schemaVersion: GATE_INPUT_SCHEMA, planSha256: artifact.planSha256, releaseId: artifact.plan.releaseId, baseReleaseId: artifact.plan.base.root.data.releaseId, requiredChecks: ["fresh capture preservation", "198 authenticated private Storage readbacks", "full successor readback", "guarded active-pointer CAS", "guarded rollback CAS"] };
}
function assertGateReceipt(value: unknown, artifact: PreparedArtifact) {
  const receipt = value as GateReceipt;
  if (!receipt || receipt.status !== "PASS" || receipt.planSha256 !== artifact.planSha256 || receipt.releaseId !== artifact.plan.releaseId) throw new Error("Independent Gate receipt does not bind this exact prepared plan.");
}
async function readJson(path: string) { return JSON.parse(await readFile(resolve(path), "utf8")) as unknown; }
async function writeJson(path: string, value: unknown) { await writeFile(resolve(path), `${canonicalJson(value)}\n`, "utf8"); }

async function main() {
  const [operation, ...arguments_] = process.argv.slice(2);
  if (operation === "capture" && arguments_.length === 1) {
    const api = await createProductionGoalMediaEdgeSuccessorApi(process.cwd());
    const captured = await captureActiveGoalMediaBase(api, new Date().toISOString());
    await writeJson(arguments_[0]!, publicCapture(captured));
    console.log(canonicalJson({ operation, releaseId: captured.root.data.releaseId, childCount: captured.children.length, cloudWrite: false }));
    return;
  }
  if (operation === "prepare" && arguments_.length === 2) {
    const plan = await buildGoalMediaEdgeSuccessorPlanFromPackage(capturedBaseFromPublicCapture(await readJson(arguments_[0]!)));
    const artifact = preparedArtifact(plan);
    await writeJson(arguments_[1]!, artifact);
    console.log(canonicalJson({ operation, releaseId: plan.releaseId, planSha256: artifact.planSha256, cloudWrite: false }));
    return;
  }
  if (operation === "gate-input" && arguments_.length === 2) {
    const artifact = readPreparedArtifact(await readJson(arguments_[0]!));
    await writeJson(arguments_[1]!, gateInput(artifact));
    console.log(canonicalJson({ operation, releaseId: artifact.plan.releaseId, planSha256: artifact.planSha256, cloudWrite: false }));
    return;
  }
  if (operation === "apply" && arguments_.length === 2) {
    const artifact = readPreparedArtifact(await readJson(arguments_[0]!));
    assertGateReceipt(await readJson(arguments_[1]!), artifact);
    const rebuilt = await buildGoalMediaEdgeSuccessorPlanFromPackage(artifact.plan.base);
    if (!same(rebuilt, artifact.plan)) throw new Error("Fresh package rebuild differs from prepared plan.");
    await applyGoalMediaEdgeSuccessor(artifact.plan, await createProductionGoalMediaEdgeSuccessorApi(process.cwd()), async () => rebuilt);
    console.log(canonicalJson({ operation, releaseId: artifact.plan.releaseId, cloudWrite: true }));
    return;
  }
  if (operation === "rollback" && arguments_.length === 3) {
    const artifact = readPreparedArtifact(await readJson(arguments_[0]!));
    assertGateReceipt(await readJson(arguments_[1]!), artifact);
    const rebuilt = await buildGoalMediaEdgeSuccessorPlanFromPackage(artifact.plan.base);
    if (!same(rebuilt, artifact.plan)) throw new Error("Fresh package rebuild differs from prepared plan.");
    await rollbackGoalMediaEdgeSuccessor(artifact.plan, await createProductionGoalMediaEdgeSuccessorApi(process.cwd()), arguments_[2]!);
    console.log(canonicalJson({ operation, releaseId: artifact.plan.releaseId, cloudWrite: true }));
    return;
  }
  throw new Error("Usage: goal-media-edge-successor capture CAPTURE.json | prepare CAPTURE.json PREPARED.json | gate-input PREPARED.json GATE-INPUT.json | apply PREPARED.json GATE-RECEIPT.json | rollback PREPARED.json GATE-RECEIPT.json OPERATION-REFERENCE");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
