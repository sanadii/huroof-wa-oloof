import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crosswalkSourceCategories, reconcileBundleRevisions } from "../scripts/reconcile-bundle-question-revisions.js";

const h = (letter: string) => letter.repeat(64);
const q = (contentHash: string, raw: Record<string, unknown>, semantic: Record<string, unknown>, cats: string[], mediaRefs: unknown[] = []) => ({ path: `questionImports/b/questions/${contentHash}`, data: { contentHash, raw, semantic, sourceCategoryIdentifiers: cats, mediaRefs, sourceReviewState: "Needs Review" } });
const o = (contentHash: string, entry: string) => ({ path: `questionImports/b/occurrences/${contentHash}-${entry}`, data: { contentHash, entry, archive: "bundle.zip!/nested.zip", fileSha256: h("f") } });
async function run(rows: unknown[]) { const dir = await mkdtemp(join(tmpdir(), "reconcile-")); const input = join(dir, "source.jsonl"), output = join(dir, "out.json"); await writeFile(input, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`); return { dir, report: await reconcileBundleRevisions(input, output) }; }

test("uses semantic fields and holds filename-only patch order pending manifest confirmation", async () => {
  const old = h("a"), fresh = h("b"), filenameOnly = h("c"), base = { recordKey: "same", categoryId: "tahadani-001", mode: "classic", target_letter: "ج" };
  const { dir, report } = await run([
    q(old, { ...base, questionText: "س", answerText: "ج" }, { key: "same", questionText: "س", answerText: "ج", acceptedAnswers: ["ج"] }, ["tahadani-001"]), o(old, "patch-2-tahadani-001.md"),
    q(fresh, { ...base, questionText: "", answerText: "" }, { key: "same", questionText: "س مصحح", answerText: "ج مصحح", acceptedAnswers: ["ج مصحح"] }, ["tahadani-001"]), o(fresh, "patch-3-tahadani-001.md"),
    q(filenameOnly, { ...base, recordKey: "no-patch", question: "س", answer: "ج" }, { key: "no-patch", questionText: "س", answerText: "ج" }, ["tahadani-001"]), o(filenameOnly, "v99-looks-latest.md"),
  ]);
  try { const older = report.dispositions.find(x => x.contentHash === old)!; const newer = report.dispositions.find(x => x.contentHash === fresh)!; assert.equal(older.disposition, "held"); assert.equal(older.technicalReasons.includes("precedence_needs_manifest_confirmation"), true); assert.equal(newer.fields.questionText, "س مصحح"); assert.equal(report.patchPrecedence.filenameRankedRevisions, 2); } finally { await rm(dir, { recursive: true, force: true }); }
});

test("crosswalk recognizes source aliases and isolates charades from letter queues", async () => {
  assert.deepEqual(crosswalkSourceCategories(["huroof-063", "source-file-category:063"]).sourceIndexes, ["063"]);
  assert.equal(crosswalkSourceCategories(["huroof-063"]).runtimeCategoryId, undefined);
  const charade = h("d"), alias = h("e"); const { dir, report } = await run([
    q(charade, { recordKey: "charade", question: "مثل", answer: "نسر", mode: "charades", categoryId: "tahadani-001" }, { key: "charade", questionText: "مثل", answerText: "نسر", acceptedAnswers: ["نسر"] }, ["tahadani-001"]),
    q(alias, { recordKey: "alias", question: "س", answer: "ج", mode: "classic", target_letter: "ج", categoryId: "huroof-063" }, { key: "alias", questionText: "س", answerText: "ج" }, ["huroof-063", "source-file-category:063"]),
  ]);
  try { const c = report.dispositions.find(x => x.contentHash === charade)!; const a = report.dispositions.find(x => x.contentHash === alias)!; assert.equal(c.technicalEligibility, "candidate"); assert.equal(c.fields.targetLetter, undefined); assert.equal(a.source.sourceCategoryId, "huroof-063"); assert.equal(a.source.sourceTitleAr, "كرة السلة وNBA"); assert.equal(a.source.mappingDisposition, "resolved"); assert.equal(a.technicalReasons.includes("runtime_category_mapping_unresolved"), false); } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects contradictory category-shaped identifiers without accepting a matching source-file alias", () => {
  const wrongPrefix = crosswalkSourceCategories(["tahadani-063", "source-file-category:063"]);
  assert.equal(wrongPrefix.conflict, true);
  assert.deepEqual(wrongPrefix.contradictoryIdentifiers, ["tahadani-063"]);
  assert.equal(wrongPrefix.runtimeCategoryId, undefined);
  const wrongLegacy = crosswalkSourceCategories(["huroof-001", "tahadani-001"]);
  assert.equal(wrongLegacy.conflict, true);
  assert.deepEqual(wrongLegacy.contradictoryIdentifiers, ["huroof-001"]);
  assert.equal(crosswalkSourceCategories(["063"]).sourceCategoryIds.length, 0);
});

test("retains conflicted source candidates as evidence but withholds scalar source and runtime targets", async () => {
  const { dir, report } = await run([
    q(h("p"), { recordKey: "conflict", question: "س", answer: "ج", mode: "classic", target_letter: "ج" }, { key: "conflict", questionText: "س", answerText: "ج", acceptedAnswers: ["ج"] }, ["tahadani-063", "source-file-category:063"]),
  ]);
  try {
    const disposition = report.dispositions[0];
    assert.equal(disposition.source.mappingDisposition, "ambiguous");
    assert.equal(disposition.source.sourceCategoryId, undefined);
    assert.equal(disposition.source.runtimeCategoryId, undefined);
    assert.equal(disposition.technicalReasons.includes("source_category_identifier_conflict"), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("dedupe retains corrected media/evidence and output is deterministic for shuffled input", async () => {
  const a = h("f"), b = h("g"); const make = (id: string, proof: string) => q(id, { recordKey: id, question: "س", answer: "ج", mode: "classic", target_letter: "ج", category_id: "tahadani-001", source_urls: [proof] }, { key: id, questionText: "س", answerText: "ج", acceptedAnswers: ["ج"] }, ["tahadani-001"], [{ sha256: proof }]);
  const one = await run([make(a, "one"), make(b, "two")]), two = await run([make(b, "two"), make(a, "one")]);
  try { assert.equal(one.report.summary.dispositions.effective_candidate, 2); assert.deepEqual(one.report.dispositions, two.report.dispositions); assert.deepEqual(one.report.categoryCoverage, two.report.categoryCoverage); assert.deepEqual(one.report.selectorSimulations, two.report.selectorSimulations); assert.match(await readFile(join(one.dir, "t14.3-mapping-reconciliation-v1-summary.md"), "utf8"), /Actual selector simulations/); } finally { await rm(one.dir, { recursive: true, force: true }); await rm(two.dir, { recursive: true, force: true }); }
});

test("exact collisions dedupe while strict literal-answer, modality, and letter mismatch failures remain held", async () => {
  const a = h("h"), b = h("i"), broken = h("j"), mismatch = h("k"), canonicalOnly = h("n"); const base = { question: "س", answer: "ج", mode: "classic", target_letter: "ج", category_id: "tahadani-001" };
  const { dir, report } = await run([
    q(a, { ...base, recordKey: "one" }, { key: "one", questionText: "س", answerText: "ج", acceptedAnswers: ["ج"] }, ["tahadani-001"]),
    q(b, { ...base, recordKey: "two" }, { key: "two", questionText: "س", answerText: "ج", acceptedAnswers: ["ج"] }, ["tahadani-001"]),
    q(broken, { recordKey: "broken", question: "س", answer: "", category_id: "tahadani-001" }, { key: "broken", questionText: "س", answerText: "", acceptedAnswers: [] }, ["tahadani-001"]),
    q(mismatch, { ...base, recordKey: "mismatch", target_letter: "ب" }, { key: "mismatch", questionText: "س", answerText: "ج", acceptedAnswers: ["ج"] }, ["tahadani-001"]),
    q(canonicalOnly, { ...base, recordKey: "canonical-only" }, { key: "canonical-only", questionText: "س", answerText: "ج", acceptedAnswers: [] }, ["tahadani-001"]),
  ]);
  try { assert.equal(report.dispositions.find(x => x.contentHash === b)!.disposition, "duplicate"); const held = report.dispositions.find(x => x.contentHash === broken)!; const badLetter = report.dispositions.find(x => x.contentHash === mismatch)!; const canonical = report.dispositions.find(x => x.contentHash === canonicalOnly)!; assert.equal(held.disposition, "held"); assert.equal(held.technicalReasons.includes("missing_literal_answer"), true); assert.equal(held.technicalReasons.includes("modality_adaptation_unresolved"), true); assert.equal(badLetter.technicalReasons.includes("target_letter_literal_answer_mismatch"), true); assert.deepEqual(canonical.fields.acceptedAnswers, ["ج"]); assert.equal(canonical.fields.acceptedAnswerDerivation, "canonical_answer_only"); assert.match(report.sourceSha256, /^[a-f0-9]{64}$/); } finally { await rm(dir, { recursive: true, force: true }); }
});

test("category-board coverage calls legal two-category candidate packs", async () => {
  const a = h("l"), b = h("m"); const base = { question: "س", answer: "ج", mode: "classic", target_letter: "ج" };
  const { dir, report } = await run([
    q(a, { ...base, recordKey: "one", category_id: "tahadani-001" }, { key: "one", questionText: "س", answerText: "ج", acceptedAnswers: ["ج"] }, ["tahadani-001"]),
    q(b, { ...base, recordKey: "two", category_id: "tahadani-002" }, { key: "two", questionText: "س", answerText: "ج", acceptedAnswers: ["ج"] }, ["tahadani-002"]),
  ]);
  try { const boards = report.selectorSimulations.filter(x => x.selector === "category-board"); assert.ok(boards.length > 0); assert.equal(boards.some(x => x.detail.includes("two to ten categories")), false); assert.match(report.selectorSimulationScope, /every legal two-category pair/); } finally { await rm(dir, { recursive: true, force: true }); }
});
