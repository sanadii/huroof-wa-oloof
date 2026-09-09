import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalFirestoreQuestionSource, normalizeImportedQuestion } from "../../server/local-firestore-question-source.js";

const loadFixture = async () => {
  const reconciliation = JSON.parse(await readFile("tmp/bundle-import-20260908/t14.3-mapping-reconciliation-v1.json", "utf8")) as { dispositions: Array<{ contentHash: string; disposition: string; technicalEligibility: string }> };
  const candidates = new Set(reconciliation.dispositions.filter((entry) => entry.disposition === "effective_candidate" && entry.technicalEligibility === "candidate").map((entry) => entry.contentHash));
  return (await readFile("tmp/bundle-import-20260908/bundle-question-import.documents.jsonl", "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.path.includes("/questions/") && candidates.has(entry.data.contentHash)).sort((left, right) => left.path.localeCompare(right.path));
};

test("local DB normalizer recomputes pinned raw identity and ignores diagnostic semantic text", async () => {
  const [fixture] = await loadFixture();
  const semanticTamper = structuredClone(fixture);
  semanticTamper.data.semantic = { ...semanticTamper.data.semantic, questionText: "نص غير موثوق", answerText: "جواب غير موثوق", acceptedAnswers: ["جواب غير موثوق"] };
  const normalized = normalizeImportedQuestion({ path: fixture.path, exists: true, data: semanticTamper.data }, fixture);
  assert.ok(normalized);
  assert.notEqual(normalized.promptAr, "نص غير موثوق");
  assert.notDeepEqual(normalized.acceptedAnswers, ["جواب غير موثوق"]);
  const rawTamper = structuredClone(fixture);
  rawTamper.data.raw.question = "تغيير خام غير موثوق";
  assert.equal(normalizeImportedQuestion({ path: fixture.path, exists: true, data: rawTamper.data }, fixture), undefined);
});

test("bounded DB loading rejects an unrequested pinned-document substitution", async () => {
  const [first, second] = await loadFixture();
  const dir = await mkdtemp(join(tmpdir(), "huroof-firestore-source-"));
  try {
    const reconciliationPath = join(dir, "reconciliation.json");
    const intakePath = join(dir, "intake.jsonl");
    await writeFile(reconciliationPath, JSON.stringify({ dispositions: [first, second].map((entry) => ({ contentHash: entry.data.contentHash, disposition: "effective_candidate", technicalEligibility: "candidate" })) }));
    await writeFile(intakePath, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    await assert.rejects(() => loadLocalFirestoreQuestionSource({ reconciliationPath, intakePath, maxReads: 1, reader: { read: async () => [{ path: second.path, exists: true, data: second.data }] } }), /LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
