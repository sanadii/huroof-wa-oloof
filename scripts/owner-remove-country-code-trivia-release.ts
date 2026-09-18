/**
 * Immutable successor that removes only the audited, low-signal country-code
 * lookup prompts from category tahadani-001.  It never edits an existing
 * release or source intake; retained descendants are copied losslessly.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./firestore-release-canonical.js";
import { type FirestoreValue, type SourceDocument } from "./owner-approved-release.js";
import { capturePublicGoalBase, createProductionPublicGoalApi, recursiveChildrenBounded } from "./public-impossible-goals-successor.js";
import { createQ4800ProductionAdapter } from "./q4800-owner-approved-release.js";

export const COUNTRY_CODE_TRIVIA_SCHEMA = "active-release-country-code-trivia-removal-v1" as const;
export const TARGET = { projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" } as const;
export const TARGET_CATEGORY_ID = "tahadani-001" as const;
export const EXPECTED_REMOVAL_COUNT = 300 as const;
export const EXPECTED_REMOVALS_BY_TEMPLATE = { "iso-alpha-2": 100, "iso-alpha-2-3-numeric": 100, "iso-3166-1-alpha-3": 100 } as const;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => sha(canonicalJson(value));
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const rootPath = (releaseId: string) => `releases/${releaseId}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export type LosslessDocument = { path: string; data: Record<string, unknown>; fields?: Record<string, FirestoreValue> };
export type LosslessCapturedBase = { capturedAt: string; pointer: LosslessDocument; root: LosslessDocument; children: LosslessDocument[] };
export type GateReceipt = { status: "PASS"; planCanonicalSha256: string; runnerSha256: string; capturedPointerFieldsSha256: string };
export type Removal = { questionId: string; path: string; categoryId: typeof TARGET_CATEGORY_ID; template: string; beforePromptAr: string; beforePromptSha256: string };
export type Plan = { schemaVersion: typeof COUNTRY_CODE_TRIVIA_SCHEMA; target: typeof TARGET; base: LosslessCapturedBase; baseHashes: { pointerFieldsSha256: string; rootFieldsSha256: string; childrenSha256: string; catalogSha256: string; inventorySha256: string }; removals: Removal[]; removalsSha256: string; successor: { releaseId: string; children: LosslessDocument[]; root: LosslessDocument; pointer: LosslessDocument; documentRootSha256: string; catalogSha256: string; inventorySha256: string; sourceManifestSha256: string }; gateBinding: { planCanonicalSha256: string; runnerSha256: string; capturedPointerFieldsSha256: string } };

const encode = (value: unknown): FirestoreValue => value === null ? { nullValue: null } : typeof value === "string" ? { stringValue: value } : typeof value === "boolean" ? { booleanValue: value } : typeof value === "number" ? Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value } : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } } : { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, encode(child)])) } };
const encodeFields = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
const fieldsOf = (document: LosslessDocument | SourceDocument) => {
  const fields = (document as LosslessDocument).fields ?? (document as SourceDocument).fields;
  if (fields && typeof fields === "object" && !Array.isArray(fields)) return clone(fields) as Record<string, FirestoreValue>;
  const data = (document as LosslessDocument).data;
  if (data && typeof data === "object" && !Array.isArray(data)) return encodeFields(data);
  throw new Error("Lossless Firestore fields are required.");
};
const identity = (document: LosslessDocument) => ({ path: document.path, fields: fieldsOf(document) });
const pathOf = (name: string) => { const index = name.indexOf("/documents/"); if (index < 0) throw new Error("Firestore document name is invalid."); return name.slice(index + 11); };
const sourceIdentity = (document: SourceDocument) => ({ path: pathOf(document.name), fields: fieldsOf(document) });
const lossless = (documents: Array<{ path: string; data: Record<string, unknown>; fields?: Record<string, FirestoreValue> }>): LosslessDocument[] => documents.map((document) => ({ path: document.path, data: document.data, fields: fieldsOf(document) }));
export const documentHash = (documents: LosslessDocument[]) => hash(documents.slice().sort((left, right) => left.path.localeCompare(right.path)).map(identity));
export function coerceCapturedBase(value: unknown): LosslessCapturedBase {
  const input = value as { capturedAt?: unknown; pointer?: unknown; root?: unknown; children?: unknown };
  if (typeof input.capturedAt !== "string" || !input.pointer || !input.root || !Array.isArray(input.children)) throw new Error("Capture must contain a lossless pointer, root, and descendants.");
  return input as LosslessCapturedBase;
}

const templates = [
  { name: "iso-alpha-2", expression: /^أنا دولة أو إقليم يحمل الرمز الدولي الثنائي ([A-Z]{2})\. ما اسمي بالعربية؟$/u },
  { name: "iso-alpha-2-3-numeric", expression: /^رمزي ISO الثنائي ([A-Z]{2}) والثلاثي ([A-Z]{3}) والرقمي ([0-9]{3})\. حدّد اسمي بالعربية\.$/u },
  { name: "iso-3166-1-alpha-3", expression: /^في معيار ISO 3166-1، رمزي الثلاثي هو ([A-Z]{3})\. ما اسم الدولة أو الإقليم بالعربية؟$/u },
] as const;
export function countryCodeTriviaTemplate(promptAr: string): string | null { return templates.find((template) => template.expression.test(promptAr))?.name ?? null; }
const releaseQuestion = (base: LosslessCapturedBase, document: LosslessDocument) => new RegExp(`^${rootPath(String(base.root.data.releaseId)).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/questions/[^/]+$`, "u").test(document.path);
const isCatalog = (document: LosslessDocument) => /\/catalogCategories\/[^/]+$/u.test(document.path);
const isInventory = (document: LosslessDocument) => /\/inventory\/[^/]+$/u.test(document.path);
function removalFor(base: LosslessCapturedBase, document: LosslessDocument): Removal | null {
  if (!releaseQuestion(base, document) || document.data.categoryId !== TARGET_CATEGORY_ID || typeof document.data.promptAr !== "string") return null;
  const template = countryCodeTriviaTemplate(document.data.promptAr);
  if (!template) return null;
  const questionId = document.data.id;
  if (typeof questionId !== "string" || !document.path.endsWith(`/${questionId}`)) throw new Error(`Question ID/path mismatch at ${document.path}.`);
  return { questionId, path: document.path, categoryId: TARGET_CATEGORY_ID, template, beforePromptAr: document.data.promptAr, beforePromptSha256: sha(document.data.promptAr) };
}
function rebuildInventory(base: LosslessCapturedBase, retained: LosslessDocument[]) {
  const questions = retained.filter((document) => releaseQuestion(base, document));
  const byCategory = new Map<string, LosslessDocument[]>();
  for (const question of questions) { const categoryId = question.data.categoryId, answerConceptId = question.data.answerConceptId; if (typeof categoryId !== "string" || typeof answerConceptId !== "string") throw new Error(`Retained question lacks category/answer identity: ${question.path}`); byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), question]); }
  const inventoryCategoryIds = new Set(retained.filter(isInventory).map((document) => document.data.categoryId));
  if ([...byCategory.keys()].some((categoryId) => !inventoryCategoryIds.has(categoryId))) throw new Error("Captured release lacks inventory for a retained question category.");
  return retained.map((document) => {
    if (!isInventory(document)) return document;
    const categoryId = document.data.categoryId;
    if (typeof categoryId !== "string" || !document.path.endsWith(`/${categoryId}`)) throw new Error(`Inventory ID/path mismatch at ${document.path}.`);
    const categoryQuestions = byCategory.get(categoryId) ?? [];
    const data = { ...document.data, approvedCount: categoryQuestions.length, uniqueAnswerConceptCount: new Set(categoryQuestions.map((question) => question.data.answerConceptId)).size };
    return { ...document, data, fields: { ...fieldsOf(document), ...encodeFields({ approvedCount: data.approvedCount, uniqueAnswerConceptCount: data.uniqueAnswerConceptCount }) } };
  });
}
function planWithoutBinding(plan: Plan) { const draft = clone(plan) as Partial<Plan>; delete draft.gateBinding; return draft; }
export async function currentRunnerSha256() { return sha(await readFile(fileURLToPath(import.meta.url))); }
export function buildCountryCodeTriviaRemovalPlan(base: LosslessCapturedBase, runnerSha256: string): Plan {
  if (!same(base.pointer.data.releaseId, base.root.data.releaseId) || base.root.data.immutable !== true) throw new Error("Captured pointer/root is not an immutable active release.");
  const children = base.children.slice().sort((left, right) => left.path.localeCompare(right.path));
  if (!children.length || new Set(children.map((document) => document.path)).size !== children.length) throw new Error("Captured release descendants are incomplete or duplicated.");
  const removals = children.map((document) => removalFor(base, document)).filter((value): value is Removal => value !== null).sort((left, right) => left.questionId.localeCompare(right.questionId));
  if (removals.length !== EXPECTED_REMOVAL_COUNT) throw new Error(`Audited country-code removal count is ${EXPECTED_REMOVAL_COUNT}; captured release matched ${removals.length}.`);
  const templateCounts = Object.fromEntries(Object.keys(EXPECTED_REMOVALS_BY_TEMPLATE).map((template) => [template, removals.filter((removal) => removal.template === template).length]));
  if (!same(templateCounts, EXPECTED_REMOVALS_BY_TEMPLATE)) throw new Error("Audited country-code template counts do not match the captured release.");
  if (new Set(removals.map((removal) => removal.questionId)).size !== removals.length) throw new Error("Country-code removal IDs are duplicated.");
  const removalPaths = new Set(removals.map((removal) => removal.path));
  const retained = rebuildInventory(base, children.filter((document) => !removalPaths.has(document.path)).map((document) => ({ ...document, data: clone(document.data), fields: fieldsOf(document) })));
  const pointerFieldsSha256 = hash(fieldsOf(base.pointer)), rootFieldsSha256 = hash(fieldsOf(base.root)), childrenSha256 = documentHash(children), catalogSha256Before = documentHash(children.filter(isCatalog)), inventorySha256Before = documentHash(children.filter(isInventory));
  const removalsSha256 = hash(removals), releaseId = `country-code-trivia-removal-${hash({ schemaVersion: COUNTRY_CODE_TRIVIA_SCHEMA, pointerFieldsSha256, removalsSha256 }).slice(0, 32)}`;
  const successorChildren = retained.map((document) => ({ ...document, path: document.path.replace(rootPath(String(base.root.data.releaseId)), rootPath(releaseId)) })).sort((left, right) => left.path.localeCompare(right.path));
  const documentRootSha256 = documentHash(successorChildren), catalogSha256 = documentHash(successorChildren.filter(isCatalog)), inventorySha256 = documentHash(successorChildren.filter(isInventory));
  const remainingQuestions = successorChildren.filter((document) => /\/questions\/[^/]+$/u.test(document.path));
  const sourceManifestSha256 = hash({ inheritedSourceManifestSha256: base.root.data.sourceManifestSha256 ?? null, schemaVersion: COUNTRY_CODE_TRIVIA_SCHEMA, removalsSha256, pointerFieldsSha256 });
  const removalReceipt = { schemaVersion: COUNTRY_CODE_TRIVIA_SCHEMA, targetCategoryId: TARGET_CATEGORY_ID, removalCount: removals.length, removalsSha256, onlyMutation: "delete audited country-code-only question documents; recompute inventory and release identities", baseChildrenSha256: childrenSha256, successorInventorySha256: inventorySha256 };
  const rootData = { ...clone(base.root.data), schemaVersion: COUNTRY_CODE_TRIVIA_SCHEMA, releaseId, baseReleaseId: String(base.root.data.releaseId), baseDocumentRootSha256: base.root.data.documentRootSha256, documentRootSha256, catalogSha256, sourceManifestSha256, approvedCount: remainingQuestions.length, countryCodeTriviaRemoval: removalReceipt, immutable: true };
  const root: LosslessDocument = { path: rootPath(releaseId), data: rootData, fields: { ...fieldsOf(base.root), ...encodeFields({ schemaVersion: rootData.schemaVersion, releaseId, baseReleaseId: rootData.baseReleaseId, baseDocumentRootSha256: rootData.baseDocumentRootSha256, documentRootSha256, catalogSha256, sourceManifestSha256, approvedCount: rootData.approvedCount, countryCodeTriviaRemoval: removalReceipt, immutable: true }) } };
  const pointerData = { ...clone(base.pointer.data), releaseId, baseReleaseId: String(base.root.data.releaseId), documentRootSha256, catalogSha256, sourceManifestSha256, approvedCount: remainingQuestions.length };
  const pointer: LosslessDocument = { path: "runtime/activeRelease", data: pointerData, fields: { ...fieldsOf(base.pointer), ...encodeFields({ releaseId, baseReleaseId: pointerData.baseReleaseId, documentRootSha256, catalogSha256, sourceManifestSha256, approvedCount: pointerData.approvedCount }) } };
  const draft = { schemaVersion: COUNTRY_CODE_TRIVIA_SCHEMA, target: TARGET, base, baseHashes: { pointerFieldsSha256, rootFieldsSha256, childrenSha256, catalogSha256: catalogSha256Before, inventorySha256: inventorySha256Before }, removals, removalsSha256, successor: { releaseId, children: successorChildren, root, pointer, documentRootSha256, catalogSha256, inventorySha256, sourceManifestSha256 } };
  return { ...draft, gateBinding: { planCanonicalSha256: hash(draft), runnerSha256, capturedPointerFieldsSha256: pointerFieldsSha256 } };
}

type ApplyApi = Pick<Awaited<ReturnType<typeof createProductionPublicGoalApi>>, "metadata" | "read" | "listCollectionIds" | "listCollection" | "create"> & { activate(request: { expectedPointer: LosslessDocument; pointer: LosslessDocument; root: LosslessDocument; verification: LosslessDocument; activation: LosslessDocument }): Promise<void>; rollback(request: { expectedPointer: LosslessDocument; restorePointer: LosslessDocument; receipt: LosslessDocument }): Promise<void> };
const verificationFor = (plan: Plan): LosslessDocument => ({ path: `verificationReceipts/${plan.successor.releaseId}-country-code-trivia-removal`, data: { releaseId: plan.successor.releaseId, baseReleaseId: plan.base.root.data.releaseId, documentRootSha256: plan.successor.documentRootSha256, catalogSha256: plan.successor.catalogSha256, inventorySha256: plan.successor.inventorySha256, removalsSha256: plan.removalsSha256, immutable: true, verificationKind: "country_code_trivia_removal_exact_readback" }, fields: encodeFields({ releaseId: plan.successor.releaseId, baseReleaseId: plan.base.root.data.releaseId, documentRootSha256: plan.successor.documentRootSha256, catalogSha256: plan.successor.catalogSha256, inventorySha256: plan.successor.inventorySha256, removalsSha256: plan.removalsSha256, immutable: true, verificationKind: "country_code_trivia_removal_exact_readback" }) });
const activationFor = (plan: Plan, verification: LosslessDocument): LosslessDocument => ({ path: `activationReceipts/${plan.successor.releaseId}-country-code-trivia-removal`, data: { releaseId: plan.successor.releaseId, expectedPreviousPointerFieldsSha256: plan.baseHashes.pointerFieldsSha256, verificationReceiptPath: verification.path, immutable: true }, fields: encodeFields({ releaseId: plan.successor.releaseId, expectedPreviousPointerFieldsSha256: plan.baseHashes.pointerFieldsSha256, verificationReceiptPath: verification.path, immutable: true }) });
function assertGate(plan: Plan, gate: GateReceipt, runnerSha256: string) { if (gate.status !== "PASS" || runnerSha256 !== plan.gateBinding.runnerSha256 || gate.runnerSha256 !== runnerSha256 || gate.planCanonicalSha256 !== hash(planWithoutBinding(plan)) || gate.capturedPointerFieldsSha256 !== plan.baseHashes.pointerFieldsSha256 || !same(plan.gateBinding, { planCanonicalSha256: hash(planWithoutBinding(plan)), runnerSha256, capturedPointerFieldsSha256: plan.baseHashes.pointerFieldsSha256 })) throw new Error("Gate receipt does not bind the exact country-code-removal plan, runner, and captured pointer."); }
async function pending(api: ApplyApi, documents: LosslessDocument[]) { const output: LosslessDocument[] = []; for (let index = 0; index < documents.length; index += 250) { const batch = documents.slice(index, index + 250), found = await api.read(batch.map((document) => document.path)); for (let item = 0; item < batch.length; item++) { const existing = found[item], expected = batch[item]!; if (!existing) output.push(expected); else if (!same(sourceIdentity(existing), identity(expected))) throw new Error(`Immutable conflict at ${expected.path}.`); } } return output; }
export async function applyCountryCodeTriviaRemovalPlan(plan: Plan, gate: GateReceipt, runnerSha256: string, api: ApplyApi) {
  assertGate(plan, gate, runnerSha256); if (!same(await api.metadata(), TARGET)) throw new Error("Production Firestore target mismatch.");
  const verification = verificationFor(plan), activation = activationFor(plan, verification);
  const [active, baseRoot, successorRoot, storedVerification, storedActivation] = await api.read(["runtime/activeRelease", plan.base.root.path, plan.successor.root.path, verification.path, activation.path]);
  if (active && same(sourceIdentity(active), identity(plan.successor.pointer))) { const complete = lossless(await recursiveChildrenBounded(api, plan.successor.root.path)); if (!successorRoot || !storedVerification || !storedActivation || complete.length !== plan.successor.children.length || documentHash(complete) !== plan.successor.documentRootSha256 || !same(sourceIdentity(successorRoot), identity(plan.successor.root)) || !same(sourceIdentity(storedVerification), identity(verification)) || !same(sourceIdentity(storedActivation), identity(activation))) throw new Error("Activated retry differs from the immutable country-code-removal plan."); return { releaseId: plan.successor.releaseId, activated: true, idempotent: true }; }
  if (!active || !baseRoot || !same(sourceIdentity(active), identity(plan.base.pointer)) || !same(sourceIdentity(baseRoot), identity(plan.base.root))) throw new Error("Captured active pointer/root is stale; zero writes.");
  const baseChildren = lossless(await recursiveChildrenBounded(api, plan.base.root.path)); if (baseChildren.length !== plan.base.children.length || documentHash(baseChildren) !== plan.baseHashes.childrenSha256) throw new Error("Captured active release descendants changed; zero writes.");
  const initial = lossless(await recursiveChildrenBounded(api, plan.successor.root.path)); if (initial.some((document) => !plan.successor.children.some((expected) => same(identity(expected), identity(document))))) throw new Error("Unexpected successor descendants exist; zero writes.");
  const children = await pending(api, plan.successor.children); if (children.length) await api.create(children);
  const complete = lossless(await recursiveChildrenBounded(api, plan.successor.root.path)); if (complete.length !== plan.successor.children.length || documentHash(complete) !== plan.successor.documentRootSha256) throw new Error("Successor child exact readback failed.");
  const roots = await pending(api, [plan.successor.root, verification]); if (roots.length) await api.create(roots);
  const [storedRoot, verified] = await api.read([plan.successor.root.path, verification.path]); if (!storedRoot || !verified || !same(sourceIdentity(storedRoot), identity(plan.successor.root)) || !same(sourceIdentity(verified), identity(verification))) throw new Error("Successor root/verification exact readback failed.");
  await api.activate({ expectedPointer: plan.base.pointer, pointer: plan.successor.pointer, root: plan.successor.root, verification, activation }); return { releaseId: plan.successor.releaseId, activated: true, idempotent: false };
}
export async function rollbackCountryCodeTriviaRemovalPlan(plan: Plan, gate: GateReceipt, runnerSha256: string, operationReference: string, api: ApplyApi) { if (!/^[A-Za-z0-9._:-]{3,160}$/u.test(operationReference)) throw new Error("Rollback requires a valid operation reference."); assertGate(plan, gate, runnerSha256); const verification = verificationFor(plan), activation = activationFor(plan, verification), [active, storedActivation] = await api.read(["runtime/activeRelease", activation.path]); if (!active || !storedActivation || !same(sourceIdentity(active), identity(plan.successor.pointer)) || !same(sourceIdentity(storedActivation), identity(activation))) throw new Error("Rollback CAS refused a stale successor or activation receipt."); const receipt: LosslessDocument = { path: `rollbackReceipts/${plan.successor.releaseId}-country-code-trivia-removal-${sha(operationReference).slice(0, 32)}`, data: { releaseId: plan.successor.releaseId, restorePointer: plan.base.pointer.data, operationReference, immutable: true }, fields: encodeFields({ releaseId: plan.successor.releaseId, restorePointer: plan.base.pointer.data, operationReference, immutable: true }) }; await api.rollback({ expectedPointer: plan.successor.pointer, restorePointer: plan.base.pointer, receipt }); return { rolledBack: true, restoreReleaseId: plan.base.root.data.releaseId, receiptPath: receipt.path }; }
async function productionApi(): Promise<ApplyApi> { const [api, transaction] = await Promise.all([createProductionPublicGoalApi(), createQ4800ProductionAdapter()]); return { ...api, activate: async (request) => transaction.activateCapturedPointer({ expectedPointer: request.expectedPointer.data, pointer: request.pointer, releaseRoot: request.root, verificationReceipt: request.verification, activationReceipt: request.activation }), rollback: async (request) => transaction.rollbackCapturedPointer({ expectedPointer: request.expectedPointer.data, restorePointer: request.restorePointer, rollbackReceipt: request.receipt }) }; }
function flags(args: string[]) { const output: Record<string, string> = {}; for (let index = 0; index < args.length; index += 2) { const key = args[index], value = args[index + 1]; if (!key?.startsWith("--") || !value || value.startsWith("--") || output[key.slice(2)] !== undefined) throw new Error("Arguments must be unique --key value pairs."); output[key.slice(2)] = value; } return output; }
function manifest(plan: Plan) { return { schemaVersion: COUNTRY_CODE_TRIVIA_SCHEMA, cloudMutated: false, target: TARGET, base: { releaseId: plan.base.root.data.releaseId, pointerFieldsSha256: plan.baseHashes.pointerFieldsSha256, rootFieldsSha256: plan.baseHashes.rootFieldsSha256, childrenSha256: plan.baseHashes.childrenSha256, catalogSha256: plan.baseHashes.catalogSha256, inventorySha256: plan.baseHashes.inventorySha256, childCount: plan.base.children.length }, successor: { releaseId: plan.successor.releaseId, documentRootSha256: plan.successor.documentRootSha256, catalogSha256: plan.successor.catalogSha256, inventorySha256: plan.successor.inventorySha256, sourceManifestSha256: plan.successor.sourceManifestSha256, childCount: plan.successor.children.length }, removalCount: plan.removals.length, removalsSha256: plan.removalsSha256, removals: plan.removals }; }
async function main() { const [command, ...args] = process.argv.slice(2), input = flags(args);
  if (command === "capture") { if (!input.out) throw new Error("capture --out FILE"); const base = await capturePublicGoalBase(await createProductionPublicGoalApi(), new Date().toISOString()); await mkdir(resolve(input.out, ".."), { recursive: true }); await writeFile(input.out, `${canonicalJson(base)}\n`); console.log(canonicalJson({ command, releaseId: base.root.data.releaseId, childCount: base.children.length, cloudMutated: false })); return; }
  if (command === "prepare") { if (!input.base || !input.out) throw new Error("prepare --base CAPTURE.json --out DIRECTORY"); const [baseText, runner] = await Promise.all([readFile(input.base, "utf8"), readFile(fileURLToPath(import.meta.url))]); const plan = buildCountryCodeTriviaRemovalPlan(coerceCapturedBase(JSON.parse(baseText)), sha(runner)); await mkdir(input.out, { recursive: true }); await Promise.all([writeFile(resolve(input.out, "PLAN.json"), `${canonicalJson(plan)}\n`), writeFile(resolve(input.out, "MANIFEST.json"), `${canonicalJson(manifest(plan))}\n`), writeFile(resolve(input.out, "REPORT.md"), `# Country-code trivia removal — dry run\n\nCaptured release: \`${plan.base.root.data.releaseId}\` → successor: \`${plan.successor.releaseId}\`\n\n- Removed question documents: **${plan.removals.length}** from \`${TARGET_CATEGORY_ID}\` only.\n- Allowlist: three exact full-prompt country-code templates. ISO questions in every other category are retained.\n- The report contains each removed ID and original prompt; catalog, inventory, hashes, root, and pointer are rebuilt from the captured release.\n- No cloud mutation occurred.\n\nApply requires a fresh capture, deterministic rebuild, independent PASS Gate receipt binding this plan/runner/captured pointer, create-only writes, exact readback, and atomic pointer CAS. Conditional rollback never deletes immutable history.\n`), writeFile(resolve(input.out, "APPLY-REQUIREMENTS.md"), `# Root-only apply requirements\n\nFresh capture: \`node --use-system-ca --import tsx scripts/owner-remove-country-code-trivia-release.ts capture --out CAPTURE-FRESH.json\`\n\nPrepare: \`node --import tsx scripts/owner-remove-country-code-trivia-release.ts prepare --base CAPTURE-FRESH.json --out fresh\`\n\nGate receipt must exactly bind \`{ status: "PASS", planCanonicalSha256, runnerSha256, capturedPointerFieldsSha256 }\` to fresh \`PLAN.json\`.\n\nApply: \`$env:COUNTRY_CODE_TRIVIA_RELEASE_APPLY='1'\`; \`node --use-system-ca --import tsx scripts/owner-remove-country-code-trivia-release.ts apply --plan fresh/PLAN.json --gate GATE.json\`.\n\nRollback is conditional and pointer-only: \`... rollback --plan fresh/PLAN.json --gate GATE.json --reference REF\`.\n`)]); console.log(canonicalJson({ command, releaseId: plan.successor.releaseId, removalCount: plan.removals.length, cloudMutated: false })); return; }
  if (command === "apply" || command === "rollback") { if (process.env.COUNTRY_CODE_TRIVIA_RELEASE_APPLY !== "1" || !input.plan || !input.gate || !process.execArgv.includes("--use-system-ca")) throw new Error("Root-only operation requires COUNTRY_CODE_TRIVIA_RELEASE_APPLY=1, --use-system-ca, --plan, and --gate."); const [planText, gateText, runner] = await Promise.all([readFile(input.plan, "utf8"), readFile(input.gate, "utf8"), readFile(fileURLToPath(import.meta.url))]); const plan = JSON.parse(planText) as Plan, gate = JSON.parse(gateText) as GateReceipt, api = await productionApi(), result = command === "apply" ? await applyCountryCodeTriviaRemovalPlan(plan, gate, sha(runner), api) : await rollbackCountryCodeTriviaRemovalPlan(plan, gate, sha(runner), input.reference ?? "", api); console.log(canonicalJson({ command, ...result })); return; }
  throw new Error("capture --out FILE | prepare --base CAPTURE.json --out DIRECTORY | apply --plan PLAN.json --gate GATE.json | rollback --plan PLAN.json --gate GATE.json --reference REF");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
