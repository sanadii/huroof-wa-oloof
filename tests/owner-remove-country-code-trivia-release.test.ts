import assert from "node:assert/strict";
import test from "node:test";
import { applyCountryCodeTriviaRemovalPlan, buildCountryCodeTriviaRemovalPlan, countryCodeTriviaTemplate, documentHash, EXPECTED_REMOVAL_COUNT, TARGET, type Plan } from "../scripts/owner-remove-country-code-trivia-release.js";

const fields = (value: Record<string, unknown>): Record<string, any> => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? { stringValue: item } : typeof item === "boolean" ? { booleanValue: item } : typeof item === "number" ? { integerValue: String(item) } : Array.isArray(item) ? { arrayValue: { values: item.map((child) => ({ stringValue: String(child) })) } } : { mapValue: { fields: fields(item as Record<string, unknown>) } }]));
const document = (path: string, data: Record<string, unknown>) => ({ path, data, fields: fields(data) });
const alpha = (index: number, size: number) => Array.from({ length: size }, (_, offset) => String.fromCharCode(65 + ((index + offset * 7) % 26))).join("");
const targetPrompt = (index: number) => {
  const code2 = alpha(index, 2), code3 = alpha(index + 3, 3);
  switch (index % 3) {
    case 0: return `أنا دولة أو إقليم يحمل الرمز الدولي الثنائي ${code2}. ما اسمي بالعربية؟`;
    case 1: return `رمزي ISO الثنائي ${code2} والثلاثي ${code3} والرقمي ${String(index).padStart(3, "0")}. حدّد اسمي بالعربية.`;
    default: return `في معيار ISO 3166-1، رمزي الثلاثي هو ${code3}. ما اسم الدولة أو الإقليم بالعربية؟`;
  }
};
function base() {
  const root = document("releases/base", { releaseId: "base", immutable: true, approvedCount: EXPECTED_REMOVAL_COUNT + 2, catalogSha256: "catalog-old", documentRootSha256: "root-old", sourceManifestSha256: "source-old" });
  const pointer = document("runtime/activeRelease", { releaseId: "base", approvedCount: EXPECTED_REMOVAL_COUNT + 2, catalogSha256: "catalog-old", documentRootSha256: "root-old", sourceManifestSha256: "source-old" });
  const removals = Array.from({ length: EXPECTED_REMOVAL_COUNT }, (_, index) => document(`releases/base/questions/remove-${String(index).padStart(3, "0")}`, { id: `remove-${String(index).padStart(3, "0")}`, categoryId: "tahadani-001", answerConceptId: `target-${index}`, promptAr: targetPrompt(index), immutable: true }));
  return { capturedAt: "2026-09-18T00:00:00.000Z", pointer, root, children: [
    document("releases/base/catalogCategories/tahadani-001", { id: "tahadani-001", labelAr: "من أنا - دول", immutable: true }),
    document("releases/base/catalogCategories/other", { id: "other", labelAr: "دول", immutable: true }),
    document("releases/base/inventory/tahadani-001", { categoryId: "tahadani-001", approvedCount: EXPECTED_REMOVAL_COUNT + 1, uniqueAnswerConceptCount: EXPECTED_REMOVAL_COUNT + 1, immutable: true }),
    document("releases/base/inventory/other", { categoryId: "other", approvedCount: 1, uniqueAnswerConceptCount: 1, immutable: true }),
    ...removals,
    document("releases/base/questions/target-near-miss", { id: "target-near-miss", categoryId: "tahadani-001", answerConceptId: "meaningful", promptAr: "رمزي ISO الثنائي SY والثلاثي SYR والرقمي 760. حدّد اسمي بالعربية. ما هي عاصمة الدولة؟", immutable: true }),
    document("releases/base/questions/other-iso", { id: "other-iso", categoryId: "other", answerConceptId: "other", promptAr: "رمزي ISO الثنائي SY والثلاثي SYR والرقمي 760. حدّد اسمي بالعربية.", immutable: true }),
    document("releases/base/media/keep", { mediaId: "keep", url: "https://example.test/keep", immutable: true }),
  ] } as any;
}

test("matches only the three audited whole-prompt templates", () => {
  assert.equal(countryCodeTriviaTemplate("أنا دولة أو إقليم يحمل الرمز الدولي الثنائي SY. ما اسمي بالعربية؟"), "iso-alpha-2");
  assert.equal(countryCodeTriviaTemplate("رمزي ISO الثنائي SY والثلاثي SYR والرقمي 760. حدّد اسمي بالعربية."), "iso-alpha-2-3-numeric");
  assert.equal(countryCodeTriviaTemplate("في معيار ISO 3166-1، رمزي الثلاثي هو SYR. ما اسم الدولة أو الإقليم بالعربية؟"), "iso-3166-1-alpha-3");
  assert.equal(countryCodeTriviaTemplate("رمزي ISO الثنائي SY والثلاثي SYR والرقمي 760. حدّد اسمي بالعربية. ما هي عاصمة الدولة؟"), null);
  assert.equal(countryCodeTriviaTemplate("رمزي ISO الثنائي sy والثلاثي syr والرقمي 760. حدّد اسمي بالعربية."), null);
});

test("removes the audited 300 only, preserves near misses and rebuilds inventory", () => {
  const captured = base(), plan = buildCountryCodeTriviaRemovalPlan(captured, "runner");
  assert.equal(plan.removals.length, EXPECTED_REMOVAL_COUNT);
  assert.deepEqual(new Set(plan.removals.map((removal) => removal.template)), new Set(["iso-alpha-2", "iso-alpha-2-3-numeric", "iso-3166-1-alpha-3"]));
  assert.equal(plan.successor.children.filter((item) => item.path.includes("/questions/remove-")).length, 0);
  assert.equal(plan.successor.children.find((item) => item.path.endsWith("/questions/target-near-miss"))?.data.promptAr, "رمزي ISO الثنائي SY والثلاثي SYR والرقمي 760. حدّد اسمي بالعربية. ما هي عاصمة الدولة؟");
  assert.equal(plan.successor.children.find((item) => item.path.endsWith("/questions/other-iso"))?.data.categoryId, "other");
  assert.deepEqual(plan.successor.children.find((item) => item.path.endsWith("/inventory/tahadani-001"))?.data.approvedCount, 1);
  assert.deepEqual(plan.successor.children.find((item) => item.path.endsWith("/inventory/other"))?.data.approvedCount, 1);
  const originalMedia = captured.children.find((item: any) => item.path.endsWith("/media/keep"))!;
  const successorMedia = plan.successor.children.find((item) => item.path.endsWith("/media/keep"))!;
  assert.deepEqual(successorMedia.data, originalMedia.data);
  assert.equal(plan.successor.root.data.approvedCount, 2);
  assert.equal(plan.successor.documentRootSha256, documentHash(plan.successor.children));
});

test("tampered plan cannot reach Firebase writes", async () => {
  const plan = buildCountryCodeTriviaRemovalPlan(base(), "runner") as Plan;
  const tampered = structuredClone(plan); tampered.removals[0]!.questionId = "not-the-captured-question";
  let touched = false;
  const api = { metadata: async () => { touched = true; return TARGET; } };
  await assert.rejects(() => applyCountryCodeTriviaRemovalPlan(tampered, { status: "PASS", ...plan.gateBinding }, "runner", api as never), /Gate receipt/i);
  assert.equal(touched, false);
});

test("activation is after create-only exact readback and uses captured pointer CAS", async () => {
  const plan = buildCountryCodeTriviaRemovalPlan(base(), "runner"), stored = new Map<string, any>(), writes: string[] = [];
  const source = (item: any) => ({ name: `projects/p/databases/(default)/documents/${item.path}`, fields: item.fields, updateTime: "t" });
  for (const item of [plan.base.pointer, plan.base.root, ...plan.base.children]) stored.set(item.path, source(item));
  const api = {
    metadata: async () => TARGET,
    read: async (paths: string[]) => paths.map((path) => stored.get(path)),
    listCollectionIds: async (parent: string) => [...new Set([...stored.keys()].filter((path) => path.startsWith(`${parent}/`)).map((path) => path.slice(parent.length + 1).split("/")[0]!))],
    listCollection: async (collection: string) => [...stored.values()].filter((item) => { const path = item.name.split("/documents/")[1] as string; return path.startsWith(`${collection}/`) && path.slice(collection.length + 1).split("/").length === 1; }),
    create: async (documents: any[]) => { for (const item of documents) { assert.equal(stored.has(item.path), false); stored.set(item.path, source(item)); writes.push(item.path); } },
    activate: async (request: any) => { assert.deepEqual(request.expectedPointer.fields, plan.base.pointer.fields); assert.ok(stored.has(request.root.path)); assert.ok(stored.has(request.verification.path)); stored.set(request.activation.path, source(request.activation)); stored.set(request.pointer.path, source(request.pointer)); writes.push(request.activation.path, request.pointer.path); },
    rollback: async () => undefined,
  };
  const result = await applyCountryCodeTriviaRemovalPlan(plan, { status: "PASS", ...plan.gateBinding }, "runner", api as never);
  assert.equal(result.idempotent, false);
  assert.ok(writes.indexOf(plan.successor.root.path) > 0);
  assert.ok(writes.slice(0, writes.indexOf(plan.successor.root.path)).every((path) => path.startsWith(`${plan.successor.root.path}/`)));
  assert.deepEqual(stored.get("runtime/activeRelease").fields, plan.successor.pointer.fields);
});
