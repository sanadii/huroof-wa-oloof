/**
 * M-MEDIA-10: additive, immutable, explicitly-public Impossible Goals 2026 successor.
 *
 * This publisher is deliberately separate from the private edge successor. It
 * copies the captured release losslessly, appends only this source-bound
 * package, and grants access only by per-object Firebase download tokens.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { canonicalJson } from "./firestore-release-canonical.js";
import { decodeSourceDocument, type FirestoreValue, type SourceDocument } from "./owner-approved-release.js";
import { FIRESTORE_LOCATION, FIRESTORE_PROJECT, PRIVATE_MEDIA_BUCKET, type ReleaseDocument } from "./goal-media-edge-successor.js";

export const PUBLIC_GOAL_SCHEMA = "public-impossible-goals-2026-reviewed-successor-v1";
export const PACKAGE_ROOT = "data/videos/100-impossible-goals-2026-final";
export const PUBLIC_GOAL_PREFIX = "public-impossible-goal-2026-reviewed";
export const CATEGORY_ID = "goals-2026";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => sha(canonicalJson(value));
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const rootPath = (releaseId: string) => `releases/${releaseId}`;
const pathOf = (name: string) => { const i = name.indexOf("/documents/"); if (i < 0) throw new Error("Invalid Firestore document name."); return name.slice(i + 11); };
const validHash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const fields = (doc: SourceDocument): Record<string, FirestoreValue> => { if (!doc.fields || typeof doc.fields !== "object" || Array.isArray(doc.fields)) throw new Error("Firestore document lacks lossless fields."); return JSON.parse(JSON.stringify(doc.fields)) as Record<string, FirestoreValue>; };
const captured = (doc: SourceDocument): ReleaseDocument => ({ path: pathOf(doc.name), data: decodeSourceDocument(doc).data, fields: fields(doc) });
const docIdentity = (doc: ReleaseDocument) => ({ path: doc.path, ...(doc.fields ? { fields: doc.fields } : { data: doc.data }) });
const docHash = (docs: ReleaseDocument[]) => hash(docs.slice().sort((a, b) => a.path.localeCompare(b.path)).map(docIdentity));
const releaseDocument = (data: Record<string, unknown>, path: string): ReleaseDocument => ({ path, data, fields: encodeFields(data) });
const normalizedAnswer = (answer: string) => answer.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
const answerConcept = (answer: string) => `source-caption-en:${sha(normalizedAnswer(answer))}`;
const stableToken = (assetSha256: string) => `${assetSha256.slice(0, 8)}-${assetSha256.slice(8, 12)}-4${assetSha256.slice(13, 16)}-8${assetSha256.slice(17, 20)}-${assetSha256.slice(20, 32)}`;

export type CapturedBase = { capturedAt: string; pointer: ReleaseDocument; root: ReleaseDocument; children: ReleaseDocument[] };
export type PublicGoalUpload = { mediaId: string; variant: "filtered" | "clear"; assetSha256: string; byteSize: number; width: number; height: number; durationSeconds: number; localFile: string; objectName: string; downloadToken: string };
export type PublicGoalPlan = { schemaVersion: typeof PUBLIC_GOAL_SCHEMA; releaseId: string; capturedAt: string; base: CapturedBase; packageSha256: string; uploads: PublicGoalUpload[]; additions: ReleaseDocument[]; root: ReleaseDocument; pointer: ReleaseDocument; documentRootSha256: string; finalized: boolean };
export type PublicGoalApi = { metadata(): Promise<{ projectId: string; databaseId: string; locationId: string; type: string }>; read(paths: string[]): Promise<Array<SourceDocument | undefined>>; listCollectionIds(path: string): Promise<string[]>; listCollection(path: string): Promise<SourceDocument[]>; create(documents: ReleaseDocument[]): Promise<void>; ensurePublicObject(upload: PublicGoalUpload): Promise<{ generation: string; url: string }>; verifyPublicObject(upload: PublicGoalUpload): Promise<{ generation: string; url: string }>; activate(plan: PublicGoalPlan, verification: ReleaseDocument): Promise<void>; rollback(plan: PublicGoalPlan, receipt: ReleaseDocument): Promise<void> };

async function mapBounded<T, U>(values: T[], limit: number, fn: (value: T) => Promise<U>): Promise<U[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid concurrency limit.");
  const output: U[] = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { for (;;) { const index = cursor++; if (index >= values.length) return; output[index] = await fn(values[index]!); } }));
  return output;
}
/** Complete traversal with bounded parallelism; missing ancestors are paths only. */
type GlobalLimiter = { run<T>(task: () => Promise<T>): Promise<T> };
const limiter = (limit: number): GlobalLimiter => { let active = 0; const queue: Array<() => void> = []; return { run: async <T>(task: () => Promise<T>) => { if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve)); active++; try { return await task(); } finally { active--; queue.shift()?.(); } } }; };
export async function recursiveChildrenBounded(api: Pick<PublicGoalApi, "listCollectionIds" | "listCollection">, parent: string, concurrency = 16, shared = limiter(concurrency)): Promise<ReleaseDocument[]> {
  const ids = (await shared.run(() => api.listCollectionIds(parent))).slice().sort();
  const collections = await mapBounded(ids, concurrency, async (id) => (await shared.run(() => api.listCollection(`${parent}/${id}`))).slice().sort((a, b) => pathOf(a.name).localeCompare(pathOf(b.name))));
  const nodes = collections.flat();
  const descendants = await mapBounded(nodes, concurrency, async (node) => recursiveChildrenBounded(api, pathOf(node.name), concurrency, shared));
  const own = nodes.filter((node) => typeof node.updateTime === "string" && node.updateTime).map(captured);
  return [...own, ...descendants.flat()].sort((a, b) => a.path.localeCompare(b.path));
}
export async function capturePublicGoalBase(api: PublicGoalApi, capturedAt: string): Promise<CapturedBase> {
  const [pointerSource] = await api.read(["runtime/activeRelease"]); if (!pointerSource) throw new Error("runtime/activeRelease is absent.");
  const pointer = captured(pointerSource), releaseId = pointer.data.releaseId;
  if (typeof releaseId !== "string" || !/^[A-Za-z0-9_-]{16,160}$/u.test(releaseId)) throw new Error("Active pointer has invalid immutable release ID.");
  const [rootSource] = await api.read([rootPath(releaseId)]); if (!rootSource) throw new Error("Active release root is absent.");
  const root = captured(rootSource); if (root.data.releaseId !== releaseId) throw new Error("Pointer/root release mismatch.");
  const children = await recursiveChildrenBounded(api, root.path);
  if (!children.length || new Set(children.map((child) => child.path)).size !== children.length) throw new Error("Release descendant capture is incomplete or duplicated.");
  return { capturedAt, pointer, root, children };
}

type ManifestClip = { timing?: { id?: unknown; answer?: unknown }; filtered?: Record<string, unknown>; clear?: Record<string, unknown>; pairDurationDeltaSeconds?: unknown };
const mp4 = (bytes: Uint8Array) => bytes.length > 12 && Buffer.from(bytes.subarray(4, 8)).equals(Buffer.from("ftyp"));
const number = (value: unknown, label: string) => { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${label}.`); return value; };
export async function readPublicGoalUploads(root = process.cwd()): Promise<PublicGoalUpload[]> {
  const packagePath = resolve(root, PACKAGE_ROOT), manifest = JSON.parse(await readFile(resolve(packagePath, "manifest.json"), "utf8")) as { clips?: unknown[]; review?: { status?: unknown }; settings?: Record<string, unknown>; source?: { sha256?: unknown } };
  if (manifest.review?.status !== "reviewed" || !Array.isArray(manifest.clips) || !manifest.clips.length) throw new Error("Impossible-goals package is not a non-empty reviewed clip manifest.");
  const timingBytes = await readFile(resolve(packagePath, "timings.json"));
  const timings = JSON.parse(timingBytes.toString("utf8")) as { clips?: unknown[]; review?: { status?: unknown } };
  if (timings.review?.status !== "reviewed" || !same(timings.clips, manifest.clips.map((entry) => (entry as ManifestClip).timing)) || manifest.settings?.timingManifestSha256 !== sha(timingBytes) || manifest.source?.sha256 !== "820941f8d8d2686e2d6d7ac24b7ec5dde84a38d8e8d4676cfb913a1fd81a8780" || manifest.settings?.filteredFilter !== "gblur=sigma=1,edgedetect=low=0.07:high=0.18:mode=colormix,hue=s=0,eq=contrast=1.3" || manifest.settings?.clearFilter !== "null") throw new Error("Reviewed source, timings, or exact filter binding differs.");
  const uploads = await Promise.all(manifest.clips.map(async (raw, index) => {
    const clip = raw as ManifestClip, ordinal = String(index + 1).padStart(3, "0"), timing = clip.timing;
    if (timing?.id !== `goal-${ordinal}` || typeof timing.answer !== "string" || !timing.answer.trim()) throw new Error(`Invalid source caption at goal ${ordinal}.`);
    // MP4 container rounding can differ by 1 ms while decoded frame PTS match.
    if (typeof clip.pairDurationDeltaSeconds !== "number" || clip.pairDurationDeltaSeconds < 0 || clip.pairDurationDeltaSeconds > 0.001 || Math.abs(Number(clip.filtered?.durationSeconds) - Number(clip.clear?.durationSeconds)) > 0.00101) throw new Error(`Public goal duration pair differs at ${ordinal}.`);
    const make = async (variant: "filtered" | "clear", record: Record<string, unknown>) => {
      const file = record.file, assetSha256 = record.sha256; if (typeof file !== "string" || !validHash(assetSha256) || record.fullDecode !== "passed" || record.audio !== "absent" || record.codec !== "h264" || record.pixelFormat !== "yuv420p") throw new Error(`Invalid ${variant} package entry ${ordinal}.`);
      const localFile = `${variant}/${file}`, local = resolve(packagePath, localFile), inside = relative(packagePath, local); if (isAbsolute(localFile) || inside.startsWith("..") || inside.split(sep).includes("..")) throw new Error("Unsafe local media path.");
      const bytes = await readFile(local); if (!mp4(bytes) || sha(bytes) !== assetSha256 || bytes.length !== number(record.bytes, "byte size") || bytes.length > 1_000_000) throw new Error(`Local ${variant} bytes drift or exceed the one-MiB runtime ceiling at ${ordinal}.`);
      const width = number(record.width, "width"), height = number(record.height, "height"), durationSeconds = number(record.durationSeconds, "duration"); if (!Number.isInteger(width) || !Number.isInteger(height) || width > 4_096 || height > 4_096) throw new Error(`Public-goal dimensions are outside runtime bounds at ${ordinal}.`);
      return { mediaId: `${PUBLIC_GOAL_PREFIX}:${ordinal}:${variant}`, variant, assetSha256, byteSize: bytes.length, width, height, durationSeconds, localFile, objectName: `question-media/goal-quiz-2026/assets/${assetSha256}.mp4`, downloadToken: stableToken(assetSha256) } as PublicGoalUpload;
    };
    return Promise.all([make("filtered", clip.filtered ?? {}), make("clear", clip.clear ?? {})]);
  }));
  const flat = uploads.flat().sort((a, b) => a.mediaId.localeCompare(b.mediaId));
  if (flat.length !== manifest.clips.length * 2 || new Set(flat.map((item) => item.mediaId)).size !== flat.length || new Set(flat.map((item) => item.objectName)).size !== flat.length) throw new Error("Impossible-goals package has duplicate media IDs or object names.");
  return flat;
}
export async function buildPublicGoalPlan(base: CapturedBase, root = process.cwd()): Promise<PublicGoalPlan> {
  const uploads = await readPublicGoalUploads(root), manifest = JSON.parse(await readFile(resolve(root, PACKAGE_ROOT, "manifest.json"), "utf8")) as { clips?: ManifestClip[] };
  const answers = manifest.clips?.map((clip) => ({ id: clip.timing?.id, answer: clip.timing?.answer })) ?? [];
  const goalCount = answers.length;
  if (!goalCount || base.pointer.data.releaseId !== base.root.data.releaseId) throw new Error("Impossible-goals inputs/base are inconsistent.");
  const category = base.children.find((doc) => doc.path === `${base.root.path}/catalogCategories/${CATEGORY_ID}`);
  if (!category || category.data.id !== CATEGORY_ID || !["owner-authorized-media-extension-v1", "owner_imports_public_release_v1"].includes(String(category.data.runtimeScope))) throw new Error("Existing goal category is incompatible; no category schema is invented.");
  const existing = new Set(base.children.map((doc) => doc.path));
  const existingQuestions = base.children.filter((doc) => doc.path.includes("/questions/"));
  const additions: ReleaseDocument[] = [];
  for (let i = 0; i < goalCount; i++) {
    const ordinal = String(i + 1).padStart(3, "0"), answer = answers[i], manifestAnswer = manifest.clips?.[i]?.timing?.answer; if (answer?.id !== `goal-${ordinal}` || typeof answer.answer !== "string" || !answer.answer.trim() || answer.answer !== manifestAnswer) throw new Error(`Answer captions drift from the reviewed manifest at ${ordinal}.`);
    const filtered = uploads.find((u) => u.mediaId === `${PUBLIC_GOAL_PREFIX}:${ordinal}:filtered`)!; const clear = uploads.find((u) => u.mediaId === `${PUBLIC_GOAL_PREFIX}:${ordinal}:clear`)!;
    const questionId = `${PUBLIC_GOAL_PREFIX}-${ordinal}`, questionPath = `${base.root.path}/questions/${questionId}`;
    if (existing.has(questionPath) || existing.has(`${base.root.path}/media/${filtered.mediaId}`) || existing.has(`${base.root.path}/media/${clear.mediaId}`)) throw new Error("New public-goal question or media ID collides with active release.");
    const inheritedConcept = existingQuestions.find((doc) => Array.isArray(doc.data.acceptedAnswers) && doc.data.acceptedAnswers.some((alias) => typeof alias === "string" && normalizedAnswer(alias) === normalizedAnswer(answer.answer as string)))?.data.answerConceptId;
    additions.push(releaseDocument({ id: questionId, categoryId: CATEGORY_ID, headerAr: "من سجل الهدف؟", promptAr: "من سجل هذا الهدف؟", canonicalAnswer: answer.answer, acceptedAnswers: [answer.answer], answerConceptId: typeof inheritedConcept === "string" ? inheritedConcept : answerConcept(answer.answer), targetLetter: "", modality: "video", sourceMode: "trivia", readOnly: true, immutable: true, media: { mediaId: filtered.mediaId, assetSha256: filtered.assetSha256, contentType: "video/mp4", type: "video", altAr: "مقطع هدف مموه" }, answerMedia: { mediaId: clear.mediaId, assetSha256: clear.assetSha256, contentType: "video/mp4", type: "video", altAr: "مقطع الإجابة" }, source: { package: "100-impossible-goals-2026-final", sourceCaptionEnglish: answer.answer, sourceId: answer.id, authority: "explicit_user_public_request" } }, questionPath));
  }
  for (const upload of uploads) additions.push(releaseDocument({ mediaId: upload.mediaId, assetSha256: upload.assetSha256, objectName: upload.objectName, contentType: "video/mp4", byteSize: upload.byteSize, width: upload.width, height: upload.height, durationSeconds: upload.durationSeconds, publicDownloadUrl: publicUrl(upload), generation: "PENDING_UPLOAD_READBACK", immutable: true }, `${base.root.path}/media/${upload.mediaId}`));
  if (new Set(additions.map((doc) => doc.path)).size !== goalCount * 3 || additions.filter((doc) => doc.path.includes("/questions/")).length !== goalCount) throw new Error("Impossible-goals additions are incomplete.");
  const releaseId = `public-impossible-goals-successor-${hash({ base: hash(base.pointer.fields), package: uploads.map((u) => [u.mediaId, u.assetSha256]), answers }).slice(0, 32)}`;
  // The immutable root commits to successor paths, never the captured base
  // paths.  Compute after translation so readback uses the same identity.
  const goalQuestions = [...existingQuestions.filter((doc) => doc.data.categoryId === CATEGORY_ID), ...additions.filter((doc) => doc.path.includes("/questions/"))];
  const goalInventoryPath = `${base.root.path}/inventory/${CATEGORY_ID}`;
  const preservedBase = base.children.map((doc) => {
    if (doc.path === category.path) {
      const readiness = { ...((doc.data.runtimeReadiness as Record<string, unknown> | undefined) ?? {}), categories: true };
      return { path: doc.path, data: { ...doc.data, runtimeReadiness: readiness }, fields: { ...(doc.fields ?? {}), ...encodeFields({ runtimeReadiness: readiness }) } };
    }
    if (doc.path !== goalInventoryPath) return doc;
    const data = { ...doc.data, approvedCount: goalQuestions.length, uniqueAnswerConceptCount: new Set(goalQuestions.map((question) => question.data.answerConceptId)).size, immutable: true };
    return { path: doc.path, data, fields: { ...(doc.fields ?? {}), ...encodeFields({ approvedCount: data.approvedCount, uniqueAnswerConceptCount: data.uniqueAnswerConceptCount, immutable: true }) } };
  });
  const translated = additions.map((doc) => ({ ...doc, path: doc.path.replace(base.root.path, rootPath(releaseId)) }));
  const preserved = preservedBase.map((doc) => ({ ...doc, path: doc.path.replace(base.root.path, rootPath(releaseId)) }));
  const successorChildren = [...preserved, ...translated].sort((a, b) => a.path.localeCompare(b.path)), documentRootSha256 = docHash(successorChildren);
  // Only the goal category readiness changes; commit the successor catalogue.
  const catalogSha256 = docHash(successorChildren.filter((doc) => doc.path.includes("/catalogCategories/")));
  const approvedJsonlSha256 = hash({ inherited: base.root.data.approvedJsonlSha256 ?? null, publicGoals: additions.filter((doc) => doc.path.includes("/questions/")).map((doc) => ({ id: doc.data.id, answer: doc.data.canonicalAnswer, source: (doc.data.source as Record<string, unknown>).sourceId })) });
  const sourceManifestSha256 = hash({ inherited: base.root.data.sourceManifestSha256 ?? null, publicGoalPackage: hash({ uploads: uploads.map((upload) => ({ mediaId: upload.mediaId, assetSha256: upload.assetSha256 })), answers }) });
  const inheritedAuthority = { ...(typeof base.root.data.publicationAuthority === "string" ? { basePublicationAuthority: base.root.data.publicationAuthority } : {}), ...(typeof base.root.data.ownerApprovalPath === "string" ? { baseOwnerApprovalPath: base.root.data.ownerApprovalPath } : {}) };
  const inheritedMediaCount = Number(base.root.data.mediaRecordCount); const inheritedCategoryOnly = Number(base.root.data.categoryModeOnlyCount);
  const rootData = { ...base.root.data, schemaVersion: PUBLIC_GOAL_SCHEMA, releaseId, baseReleaseId: String(base.root.data.releaseId), baseDocumentRootSha256: base.root.data.documentRootSha256, documentRootSha256, approvedCount: Number(base.root.data.approvedCount) + goalCount, approvedJsonlSha256, sourceManifestSha256, catalogSha256, mediaRecordCount: (Number.isSafeInteger(inheritedMediaCount) ? inheritedMediaCount : base.children.filter((doc) => doc.path.includes("/media/")).length) + uploads.length, categoryModeOnlyCount: (Number.isSafeInteger(inheritedCategoryOnly) ? inheritedCategoryOnly : base.children.filter((doc) => doc.data.targetLetter === "").length) + goalCount, ...inheritedAuthority, publicationAuthority: "explicit_user_public_impossible_goals_request", ownerApprovalPath: undefined, publicGoalPackage: { package: "100-impossible-goals-2026-final", questionCount: goalCount, mediaCount: uploads.length, categoryId: CATEGORY_ID, explicitUserPublicAccess: true, authority: "explicit_user_request_source_caption_only" }, immutable: true };
  delete rootData.ownerApprovalPath;
  // Keep every inherited root/pointer value in its captured REST type. Only
  // successor-owned values are encoded anew (integer vs double preservation).
  const rootFields = { ...(base.root.fields ?? {}) }; delete rootFields.ownerApprovalPath; const rootDoc: ReleaseDocument = { path: rootPath(releaseId), data: rootData, fields: { ...rootFields, ...encodeFields({ schemaVersion: PUBLIC_GOAL_SCHEMA, releaseId, baseReleaseId: String(base.root.data.releaseId), baseDocumentRootSha256: base.root.data.documentRootSha256, documentRootSha256, approvedCount: rootData.approvedCount, approvedJsonlSha256, sourceManifestSha256, catalogSha256, mediaRecordCount: rootData.mediaRecordCount, categoryModeOnlyCount: rootData.categoryModeOnlyCount, ...inheritedAuthority, publicationAuthority: rootData.publicationAuthority, publicGoalPackage: rootData.publicGoalPackage, immutable: true }) } };
  const pointerData: Record<string, unknown> = { ...base.pointer.data, releaseId, approvedCount: rootData.approvedCount, catalogSha256, documentRootSha256, approvedJsonlSha256, sourceManifestSha256, baseReleaseId: String(base.root.data.releaseId), publicationAuthority: "explicit_user_public_impossible_goals_request" };
  delete pointerData.ownerApprovalPath;
  const pointerFields = { ...(base.pointer.fields ?? {}) }; delete pointerFields.ownerApprovalPath; const pointerDoc: ReleaseDocument = { path: "runtime/activeRelease", data: pointerData, fields: { ...pointerFields, ...encodeFields({ releaseId, approvedCount: rootData.approvedCount, catalogSha256, documentRootSha256, approvedJsonlSha256, sourceManifestSha256, baseReleaseId: String(base.root.data.releaseId), publicationAuthority: pointerData.publicationAuthority }) } };
  const packageSha256 = hash({
    uploads: uploads.map((upload) => Object.fromEntries(
      Object.entries(upload).filter(([key]) => key !== "downloadToken"),
    )),
    answers,
  });
  return { schemaVersion: PUBLIC_GOAL_SCHEMA, releaseId, capturedAt: base.capturedAt, base, packageSha256, uploads, additions: successorChildren, root: rootDoc, pointer: pointerDoc, documentRootSha256, finalized: false };
}
export const publicUrl = (upload: PublicGoalUpload) => `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(PRIVATE_MEDIA_BUCKET)}/o/${encodeURIComponent(upload.objectName)}?alt=media&token=${encodeURIComponent(upload.downloadToken)}`;
/** Consumer-safe release receipt: exact English answer, stable paths, and scoped URLs. */
export function finalizedConsumerMap(plan: PublicGoalPlan) {
  if (!plan.finalized) throw new Error("Consumer mapping requires the generation-finalized plan.");
  const media = new Map(plan.additions.filter((doc) => doc.path.includes("/media/")).map((doc) => [String(doc.data.mediaId), doc]));
  const uploads = new Map(plan.uploads.map((upload) => [upload.mediaId, upload]));
  const goals = plan.additions.filter((doc) => doc.path.includes(`/questions/${PUBLIC_GOAL_PREFIX}-`)).sort((a, b) => a.path.localeCompare(b.path)).map((question) => {
    const questionId = String(question.data.id), answer = question.data.acceptedAnswers;
    if (!Array.isArray(answer) || answer.length !== 1 || typeof answer[0] !== "string") throw new Error("Consumer mapping has no exact English answer.");
    const variant = (kind: "filtered" | "clear") => {
      const binding = question.data[kind === "filtered" ? "media" : "answerMedia"] as Record<string, unknown> | undefined, mediaId = binding?.mediaId;
      if (typeof mediaId !== "string") throw new Error("Consumer mapping lacks media binding.");
      const upload = uploads.get(mediaId), document = media.get(mediaId), generation = document?.data.generation;
      if (!upload || !document || typeof generation !== "string" || !/^\d{1,32}$/u.test(generation)) throw new Error("Consumer mapping lacks finalized public media.");
      return { publicUrl: publicUrl(upload), firestoreDocumentPath: document.path, generation, mediaId };
    };
    return { questionId, exactEnglishAnswer: answer[0], firestoreDocumentPath: question.path, filtered: variant("filtered"), clear: variant("clear") };
  });
  if (goals.length * 2 !== plan.uploads.length) throw new Error("Consumer mapping lacks a complete paired-question set.");
  return { schemaVersion: "public-impossible-goals-consumer-map-v1", releaseId: plan.releaseId, documentRootSha256: plan.documentRootSha256, goals };
}
const verification = (plan: PublicGoalPlan): ReleaseDocument => releaseDocument({ releaseId: plan.releaseId, baseReleaseId: plan.base.root.data.releaseId, packageSha256: plan.packageSha256, documentRootSha256: plan.documentRootSha256, publicObjectCount: plan.uploads.length, explicitUserPublicAccess: true, immutable: true }, `verificationReceipts/${plan.releaseId}-public-goals`);
const activation = (plan: PublicGoalPlan): ReleaseDocument => releaseDocument({ ...verification(plan).data, activePointer: plan.pointer.data, finalized: plan.finalized, immutable: true }, `activationReceipts/${plan.releaseId}-public-goals`);
async function pending(api: PublicGoalApi, docs: ReleaseDocument[]) { const result: ReleaseDocument[] = []; for (let i = 0; i < docs.length; i += 250) { const part = docs.slice(i, i + 250), found = await api.read(part.map((doc) => doc.path)); for (let j = 0; j < part.length; j++) { const source = found[j]; if (!source) result.push(part[j]!); else if (!same(fields(source), part[j]!.fields ?? encodeFields(part[j]!.data))) throw new Error("Create-only immutable document conflict."); } } return result; }
const encode = (v: unknown): FirestoreValue => v === null ? { nullValue: null } : typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { booleanValue: v } : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : Array.isArray(v) ? { arrayValue: { values: v.map(encode) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encode(x)])) } };
const encodeFields = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)]));
/** Bind Storage generations after authenticated + anonymous byte readback. */
export function finalizePublicGoalPlan(plan: PublicGoalPlan, readback: Array<{ mediaId: string; generation: string; url: string }>): PublicGoalPlan {
  if (readback.length !== plan.uploads.length || new Set(readback.map((item) => item.mediaId)).size !== plan.uploads.length) throw new Error("Finalization requires every unique public object generation.");
  const actual = new Map(readback.map((item) => [item.mediaId, item]));
  const additions = plan.additions.map((document) => {
    if (!document.path.includes("/media/") || !String(document.data.mediaId).startsWith(`${PUBLIC_GOAL_PREFIX}:`)) return document;
    const mediaId = document.data.mediaId, item = typeof mediaId === "string" ? actual.get(mediaId) : undefined;
    if (!item || !/^\d{1,32}$/u.test(item.generation) || item.url !== publicUrl(plan.uploads.find((upload) => upload.mediaId === mediaId)!)) throw new Error("Finalized public media generation/readback differs.");
    const data = { ...document.data, generation: item.generation };
    return { path: document.path, data, fields: { ...(document.fields ?? {}), ...encodeFields({ generation: item.generation }) } };
  });
  const documentRootSha256 = docHash(additions), rootData = { ...plan.root.data, documentRootSha256, immutable: true }, root = { path: plan.root.path, data: rootData, fields: { ...(plan.root.fields ?? {}), ...encodeFields({ documentRootSha256, immutable: true }) } };
  const pointerData = { ...plan.pointer.data, documentRootSha256 }, pointer = { path: plan.pointer.path, data: pointerData, fields: { ...(plan.pointer.fields ?? {}), ...encodeFields({ documentRootSha256 }) } };
  return { ...plan, additions, root, pointer, documentRootSha256, finalized: true };
}
const finalizedGeneration = (plan: PublicGoalPlan, upload: PublicGoalUpload) => {
  if (!plan.finalized) return undefined;
  const generation = plan.additions.find((doc) => doc.path.includes("/media/") && doc.data.mediaId === upload.mediaId)?.data.generation;
  if (typeof generation !== "string" || !/^\d{1,32}$/u.test(generation)) throw new Error("Finalized plan lacks an exact public object generation.");
  return generation;
};
export function derivePersistedFinalPlan(preUpload: PublicGoalPlan, persisted: PublicGoalPlan): PublicGoalPlan {
  const readback = persisted.additions.filter((doc) => doc.path.includes("/media/") && String(doc.data.mediaId).startsWith(`${PUBLIC_GOAL_PREFIX}:`)).map((doc) => {
    const mediaId = String(doc.data.mediaId), upload = preUpload.uploads.find((item) => item.mediaId === mediaId);
    if (!upload) throw new Error("Persisted finalized plan has an unknown public media ID.");
    return { mediaId, generation: String(doc.data.generation), url: publicUrl(upload) };
  });
  const derived = finalizePublicGoalPlan(preUpload, readback);
  if (!same(persisted, derived)) throw new Error("Persisted finalized plan does not derive exactly from the Gate-bound pre-upload plan.");
  return derived;
}
export async function applyPublicGoalPlan(plan: PublicGoalPlan, api: PublicGoalApi, rebuild: () => Promise<PublicGoalPlan>, persistFinalized?: (value: PublicGoalPlan) => Promise<void>) {
  if (!same(plan, await rebuild())) throw new Error("Public-goal plan differs from deterministic local rebuild.");
  const target = await api.metadata(); if (target.projectId !== FIRESTORE_PROJECT || target.databaseId !== "(default)" || target.locationId !== FIRESTORE_LOCATION || target.type !== "FIRESTORE_NATIVE") throw new Error("Public-goal target is not pinned production Firestore.");
  const [active, root] = await api.read(["runtime/activeRelease", plan.base.root.path]);
  if (active && decodeSourceDocument(active).data.releaseId === plan.releaseId) {
    if (!plan.finalized) throw new Error("Activated retry requires the persisted generation-finalized plan.");
    const [successorRoot, receipt, activationReceipt] = await api.read([plan.root.path, verification(plan).path, activation(plan).path]);
    if (!successorRoot || !receipt || !activationReceipt || !same(fields(active), plan.pointer.fields) || !same(fields(successorRoot), plan.root.fields) || !same(fields(receipt), verification(plan).fields) || !same(fields(activationReceipt), activation(plan).fields)) throw new Error("Activated retry identity differs.");
    const complete = await recursiveChildrenBounded(api, plan.root.path); if (complete.length !== plan.additions.length || docHash(complete) !== plan.documentRootSha256) throw new Error("Activated retry child identity differs.");
    await mapBounded(plan.uploads, 8, async (upload) => { const stored = await api.verifyPublicObject(upload); if (stored.url !== publicUrl(upload) || stored.generation !== finalizedGeneration(plan, upload)) throw new Error("Activated retry public object differs."); });
    return;
  }
  if (!active || !root || !same(fields(active), plan.base.pointer.fields) || !same(fields(root), plan.base.root.fields)) throw new Error("Captured active pointer/root is stale; zero writes.");
  const current = await recursiveChildrenBounded(api, plan.base.root.path); if (docHash(current) !== docHash(plan.base.children)) throw new Error("Captured descendant release drifted; zero writes.");
  const readback = await mapBounded(plan.uploads, 8, async (upload) => { const stored = await api.ensurePublicObject(upload), expected = finalizedGeneration(plan, upload); if (!stored.url || stored.url !== publicUrl(upload) || (expected && stored.generation !== expected)) throw new Error("Scoped public URL/generation readback differs."); return stored; });
  const readbackGenerations = new Map(readback.map((item, index) => [plan.uploads[index]!.mediaId, item.generation]));
  await mapBounded(plan.uploads, 8, async (upload) => { const stored = await api.verifyPublicObject(upload), expected = finalizedGeneration(plan, upload) ?? readbackGenerations.get(upload.mediaId); if (!stored.url || stored.url !== publicUrl(upload) || stored.generation !== expected) throw new Error("Anonymous public byte/generation verification differs."); });
  const finalPlan = plan.finalized ? plan : finalizePublicGoalPlan(plan, readback.map((item, index) => ({ ...item, mediaId: plan.uploads[index]!.mediaId })));
  if (persistFinalized && !plan.finalized) await persistFinalized(finalPlan);
  const creates = await pending(api, finalPlan.additions); if (creates.length) await api.create(creates);
  const finalChildren = await recursiveChildrenBounded(api, finalPlan.root.path); if (docHash(finalChildren) !== finalPlan.documentRootSha256 || finalChildren.length !== finalPlan.additions.length) throw new Error("Full successor readback differs.");
  const roots = await pending(api, [finalPlan.root, verification(finalPlan)]); if (roots.length) await api.create(roots);
  const [storedRoot, storedVerification] = await api.read([finalPlan.root.path, verification(finalPlan).path]); if (!storedRoot || !storedVerification || !same(fields(storedRoot), finalPlan.root.fields) || !same(fields(storedVerification), encodeFields(verification(finalPlan).data))) throw new Error("Successor root/verification readback differs.");
  await api.activate(finalPlan, verification(finalPlan));
  return finalPlan;
}
export async function rollbackPublicGoalPlan(plan: PublicGoalPlan, api: PublicGoalApi, operationReference: string) { if (!plan.finalized || !/^[A-Za-z0-9._:-]{3,160}$/u.test(operationReference)) throw new Error("Rollback requires a finalized plan and valid operation reference."); const [active, activationReceipt] = await api.read(["runtime/activeRelease", activation(plan).path]); if (!active || !activationReceipt || !same(fields(active), plan.pointer.fields) || !same(fields(activationReceipt), activation(plan).fields)) throw new Error("Rollback CAS refused stale successor or activation identity."); await api.rollback(plan, releaseDocument({ releaseId: plan.releaseId, restorePointer: plan.base.pointer.data, expectedActivation: activation(plan).data, operationReference, immutable: true }, `rollbackReceipts/${plan.releaseId}-${sha(operationReference).slice(0, 32)}`)); }
/** Read-only post-apply proof: pointer, complete release tree, and all public bytes. */
export async function verifyPublicGoalPlan(plan: PublicGoalPlan, api: PublicGoalApi) {
  const target = await api.metadata(); if (target.projectId !== FIRESTORE_PROJECT || target.databaseId !== "(default)" || target.locationId !== FIRESTORE_LOCATION || target.type !== "FIRESTORE_NATIVE") throw new Error("Public-goal target is not pinned production Firestore.");
  const [active, root, receipt] = await api.read(["runtime/activeRelease", plan.root.path, verification(plan).path]);
  if (!active || !root || !receipt || !same(fields(active), plan.pointer.fields) || !same(fields(root), plan.root.fields) || !same(fields(receipt), encodeFields(verification(plan).data))) throw new Error("Public-goal release identity/readback differs.");
  const children = await recursiveChildrenBounded(api, plan.root.path); if (children.length !== plan.additions.length || docHash(children) !== plan.documentRootSha256) throw new Error("Public-goal full release readback differs.");
  await mapBounded(plan.uploads, 8, async (upload) => { const stored = await api.verifyPublicObject(upload); if (stored.url !== publicUrl(upload) || stored.generation !== finalizedGeneration(plan, upload)) throw new Error("Public-goal anonymous object verification differs."); });
}

// Production REST adapter. The download token is metadata on these exact new
// objects only; no IAM policy, Storage rule, or Firestore rule is changed.
export async function createProductionPublicGoalApi(root = process.cwd(), transport: { fetch?: typeof fetch; accessToken?: () => Promise<string> } = {}): Promise<PublicGoalApi> {
  const require = createRequire(import.meta.url), auth = require("firebase-tools/lib/auth.js") as { getGlobalDefaultAccount(): { tokens?: { refresh_token?: string } } | undefined; getAccessToken(token: string, scopes: string[]): Promise<{ access_token?: string }> };
  const fetcher = transport.fetch ?? fetch;
  const token = async () => { if (transport.accessToken) return transport.accessToken(); const refresh = auth.getGlobalDefaultAccount()?.tokens?.refresh_token; const value = refresh ? await auth.getAccessToken(refresh, ["https://www.googleapis.com/auth/cloud-platform"]) : {}; if (!value.access_token) throw new Error("Firebase CLI authentication is required (firebase login --reauth)."); return value.access_token; };
  const request = async (url: string, init: RequestInit = {}) => { const response = await fetcher(url, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } }); if (!response.ok) throw new Error(`Firebase REST ${init.method ?? "GET"} ${response.status}`); return response; };
  const firestore = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`, name = (path: string) => `projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}`;
  const read = async (paths: string[]) => { const response = await request(`${firestore}:batchGet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documents: paths.map(name) }) }); const text = (await response.text()).trim(), rows = (text.startsWith("[") ? JSON.parse(text) : text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))) as Array<{ found?: SourceDocument }>; const found = new Map(rows.filter((row) => row.found).map((row) => [pathOf(row.found!.name), row.found!])); return paths.map((path) => found.get(path)); };
  const listCollectionIds = async (path: string) => { const ids: string[] = []; let page = ""; do { const response = await request(`https://firestore.googleapis.com/v1/${name(path)}:listCollectionIds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageSize: 1000, ...(page ? { pageToken: page } : {}) }) }); const body = await response.json() as { collectionIds?: string[]; nextPageToken?: string }; ids.push(...(body.collectionIds ?? [])); page = body.nextPageToken ?? ""; } while (page); return ids; };
  const listCollection = async (path: string) => { const docs: SourceDocument[] = []; let page = ""; do { const response = await request(`${firestore}/${path}?pageSize=1000&showMissing=true${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`); const body = await response.json() as { documents?: SourceDocument[]; nextPageToken?: string }; docs.push(...(body.documents ?? [])); page = body.nextPageToken ?? ""; } while (page); return docs; };
  const create = async (docs: ReleaseDocument[]) => { for (let i = 0; i < docs.length; i += 250) { const part = docs.slice(i, i + 250); await request(`${firestore}:commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ writes: part.map((doc) => ({ update: { name: name(doc.path), fields: doc.fields ?? encodeFields(doc.data) }, currentDocument: { exists: false } })) }) }); } };
  const objectUrl = (object: string) => `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(PRIVATE_MEDIA_BUCKET)}/o/${encodeURIComponent(object)}`;
  const verify = async (upload: PublicGoalUpload) => { const response = await fetcher(publicUrl(upload), { headers: { "Cache-Control": "no-store" } }); if (!response.ok) throw new Error(`Anonymous scoped download failed with ${response.status}.`); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length !== upload.byteSize || sha(bytes) !== upload.assetSha256) throw new Error("Anonymous scoped bytes hash differs."); const meta = await request(objectUrl(upload.objectName)); const value = await meta.json() as { generation?: string; size?: string; contentType?: string; metadata?: Record<string, string> }; if (!value.generation || !/^\d{1,32}$/u.test(value.generation) || value.size !== String(upload.byteSize) || value.contentType !== "video/mp4" || value.metadata?.firebaseStorageDownloadTokens !== upload.downloadToken || value.metadata?.assetSha256 !== upload.assetSha256 || value.metadata?.mediaId !== upload.mediaId || value.metadata?.byteSize !== String(upload.byteSize) || value.metadata?.width !== String(upload.width) || value.metadata?.height !== String(upload.height) || value.metadata?.durationSeconds !== String(upload.durationSeconds)) throw new Error("Exact-object public metadata differs."); return { generation: value.generation, url: publicUrl(upload) }; };
  const ensurePublicObject = async (upload: PublicGoalUpload) => { const found = await fetcher(objectUrl(upload.objectName), { headers: { Authorization: `Bearer ${await token()}` } }); if (found.status === 404) { const local = resolve(root, PACKAGE_ROOT, upload.localFile), bytes = await readFile(local); if (sha(bytes) !== upload.assetSha256 || bytes.length !== upload.byteSize) throw new Error("Local public-goal bytes drifted."); const boundary = `public-goal-${upload.assetSha256.slice(0, 24)}`, metadata = canonicalJson({ name: upload.objectName, contentType: "video/mp4", metadata: { assetSha256: upload.assetSha256, mediaId: upload.mediaId, byteSize: String(upload.byteSize), width: String(upload.width), height: String(upload.height), durationSeconds: String(upload.durationSeconds), firebaseStorageDownloadTokens: upload.downloadToken } }), start = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`), end = Buffer.from(`\r\n--${boundary}--\r\n`); const uploaded = await fetcher(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(PRIVATE_MEDIA_BUCKET)}/o?uploadType=multipart&ifGenerationMatch=0`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body: Buffer.concat([start, bytes, end]) }); if (!uploaded.ok && uploaded.status !== 412) throw new Error(`Create-only public upload failed with ${uploaded.status}.`); } else if (!found.ok) throw new Error(`Public object lookup failed with ${found.status}.`); return verify(upload); };
  const transactionRead = async (id: string, paths: string[]) => { const response = await request(`${firestore}:batchGet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: id, documents: paths.map(name) }) }); const text = (await response.text()).trim(), rows = (text.startsWith("[") ? JSON.parse(text) : text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))) as Array<{ found?: SourceDocument }>; return new Map(rows.filter((row) => row.found).map((row) => [pathOf(row.found!.name), row.found!])); };
  const activate = async (plan: PublicGoalPlan, receipt: ReleaseDocument) => { if (!plan.finalized) throw new Error("Activation requires a generation-finalized plan."); const begin = await request(`${firestore}:beginTransaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), id = (await begin.json() as { transaction?: string }).transaction; if (!id) throw new Error("Firebase transaction is unavailable."); const activationReceipt = activation(plan), found = await transactionRead(id, ["runtime/activeRelease", plan.root.path, receipt.path, activationReceipt.path]), current = found.get("runtime/activeRelease"); if (!current || found.has(activationReceipt.path) || !same(fields(current), plan.base.pointer.fields) || !same(fields(found.get(plan.root.path)!), plan.root.fields) || !same(fields(found.get(receipt.path)!), receipt.fields)) throw new Error("Activation CAS refused stale or incomplete successor."); await request(`${firestore}:commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: id, writes: [{ update: { name: name(activationReceipt.path), fields: activationReceipt.fields }, currentDocument: { exists: false } }, { update: { name: name("runtime/activeRelease"), fields: plan.pointer.fields }, currentDocument: { updateTime: current.updateTime } }] }) }); };
  const rollback = async (plan: PublicGoalPlan, receipt: ReleaseDocument) => { const begin = await request(`${firestore}:beginTransaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), id = (await begin.json() as { transaction?: string }).transaction; if (!id) throw new Error("Firebase transaction is unavailable."); const expectedActivation = activation(plan), found = await transactionRead(id, ["runtime/activeRelease", expectedActivation.path, receipt.path]), current = found.get("runtime/activeRelease"); if (!current || found.has(receipt.path) || !same(fields(current), plan.pointer.fields) || !same(fields(found.get(expectedActivation.path)!), expectedActivation.fields)) throw new Error("Rollback CAS refused stale successor or activation identity."); await request(`${firestore}:commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: id, writes: [{ update: { name: name(receipt.path), fields: encodeFields(receipt.data) }, currentDocument: { exists: false } }, { update: { name: name("runtime/activeRelease"), fields: plan.base.pointer.fields }, currentDocument: { updateTime: current.updateTime } }] }) }); };
  return { metadata: async () => { const r = await request(`https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)`), v = await r.json() as { locationId?: string; type?: string }; return { projectId: FIRESTORE_PROJECT, databaseId: "(default)", locationId: v.locationId ?? "", type: v.type ?? "" }; }, read, listCollectionIds, listCollection, create, ensurePublicObject, verifyPublicObject: verify, activate, rollback };
}
export async function prepareGateBoundPlan(planBytes: Uint8Array, receiptBytes: Uint8Array, runnerSourceBytes: Uint8Array, rebuild: (base: CapturedBase) => Promise<PublicGoalPlan>) {
  const receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8")) as Record<string, unknown>, planSha256 = sha(planBytes), plan = JSON.parse(Buffer.from(planBytes).toString("utf8")) as PublicGoalPlan;
  if (receipt.status !== "PASS" || receipt.planSha256 !== planSha256 || receipt.sourceSha256 !== sha(runnerSourceBytes) || receipt.releaseId !== plan.releaseId) throw new Error("Gate receipt must be PASS and bind exact pre-upload plan, runner source, and release.");
  const fresh = await rebuild(plan.base);
  if (!same(plan, fresh)) throw new Error("Gate-bound plan differs from deterministic local package rebuild; zero network writes.");
  return fresh;
}
export function parseGuardedPublicationArguments(args: string[]) {
  const [operation, planPath, gateReceiptPath, operationReference] = args;
  if ((operation !== "apply" && operation !== "rollback") || !planPath || !gateReceiptPath) throw new Error("Apply/rollback require PREUPLOAD_PLAN.json and hash-bound Gate receipt.");
  if (operation === "rollback" && !operationReference) throw new Error("Rollback requires PREUPLOAD_PLAN.json GATE_RECEIPT.json operation-reference.");
  return { operation, planPath, gateReceiptPath, operationReference };
}
async function main() { const [op, value, extra] = process.argv.slice(2); if (!op || !value || !["capture", "prepare", "apply", "verify", "rollback"].includes(op)) throw new Error("Usage: capture OUT.json | prepare BASE.json OUT.json | verify PLAN.json | apply PLAN.json --root-apply-authorized | rollback PLAN.json REF --root-apply-authorized."); const api = await createProductionPublicGoalApi(); if (op === "capture") { const base = await capturePublicGoalBase(api, new Date().toISOString()); await writeFile(resolve(value), `${canonicalJson(base)}\n`); console.log(canonicalJson({ operation: op, releaseId: base.root.data.releaseId, childCount: base.children.length, cloudWrite: false })); return; } if (op === "prepare") { if (!extra) throw new Error("prepare requires BASE.json OUT.json."); const base = JSON.parse(await readFile(resolve(value), "utf8")) as CapturedBase, plan = await buildPublicGoalPlan(base); await writeFile(resolve(extra), `${canonicalJson(plan)}\n`); console.log(canonicalJson({ operation: op, releaseId: plan.releaseId, uploadCount: plan.uploads.length, questionCount: plan.uploads.length / 2, cloudWrite: false })); return; } const plan = JSON.parse(await readFile(resolve(value), "utf8")) as PublicGoalPlan; if (op === "verify") { await verifyPublicGoalPlan(plan, api); console.log(canonicalJson({ operation: op, releaseId: plan.releaseId, verified: true, cloudWrite: false })); return; } if (process.argv[4] !== "--root-apply-authorized") throw new Error(`${op} is root-only and requires --root-apply-authorized after Gate.`); if (op === "apply") { await applyPublicGoalPlan(plan, api, () => buildPublicGoalPlan(plan.base)); console.log(canonicalJson({ operation: op, releaseId: plan.releaseId, cloudWrite: true })); return; } if (!extra) throw new Error("rollback requires PLAN.json operation-reference --root-apply-authorized."); await rollbackPublicGoalPlan(plan, api, extra); console.log(canonicalJson({ operation: op, releaseId: plan.releaseId, cloudWrite: true })); }
async function guardedMain() {
  const raw = process.argv.slice(2);
  if (!raw[0] || !raw[1] || (raw[0] !== "apply" && raw[0] !== "rollback")) return main();
  const { operation, planPath, gateReceiptPath, operationReference } = parseGuardedPublicationArguments(raw);
  const runnerPath = fileURLToPath(import.meta.url), [planBytes, receiptBytes, runnerSourceBytes] = await Promise.all([readFile(resolve(planPath)), readFile(resolve(gateReceiptPath)), readFile(runnerPath)]);
  const preUpload = await prepareGateBoundPlan(planBytes, receiptBytes, runnerSourceBytes, (base) => buildPublicGoalPlan(base));
  const finalPath = resolve(`${planPath}.finalized.json`), consumerMapPath = resolve(`${planPath}.consumer-map.json`);
  let persisted: PublicGoalPlan | undefined;
  try { persisted = JSON.parse(await readFile(finalPath, "utf8")) as PublicGoalPlan; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const applying = persisted ? derivePersistedFinalPlan(preUpload, persisted) : preUpload;
  const rebuild = async () => { const fresh = await buildPublicGoalPlan(preUpload.base); if (!same(fresh, preUpload)) throw new Error("Local package changed after Gate validation; zero network writes."); return applying.finalized ? derivePersistedFinalPlan(fresh, applying) : fresh; };
  if (operation === "apply") {
    const api = await createProductionPublicGoalApi();
    const final = await applyPublicGoalPlan(applying, api, rebuild, async (value) => { await writeFile(finalPath, `${canonicalJson(value)}\n`); await writeFile(consumerMapPath, `${canonicalJson(finalizedConsumerMap(value))}\n`); });
    const finalized = final ?? applying;
    if (!finalized.finalized) throw new Error("Apply did not yield a generation-finalized immutable plan.");
    await writeFile(consumerMapPath, `${canonicalJson(finalizedConsumerMap(finalized))}\n`);
    const finalizedPlanSha256 = sha(await readFile(finalPath));
    await writeFile(resolve(`${planPath}.activation-receipt.json`), `${canonicalJson({ releaseId: finalized.releaseId, planSha256: finalizedPlanSha256, gateReceiptSha256: sha(receiptBytes), consumerMapSha256: sha(await readFile(consumerMapPath)), activated: true })}\n`);
  } else {
    const reference = operationReference!;
    if (!applying.finalized) throw new Error("Rollback requires the persisted generation-finalized plan beside the Gate-bound pre-upload plan.");
    await rollbackPublicGoalPlan(applying, await createProductionPublicGoalApi(), reference);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) guardedMain().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
