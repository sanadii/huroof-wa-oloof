import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  evidenceContentHashV33,
  mediaContentHashV33,
} from "../src/question-bank-v3.3.js";
import { promoteStagingV33, validatePromotionFragment } from "../scripts/promote-staging-v3.3.js";

type Any = Record<string, any>;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const h = (char: string) => char.repeat(64);
const policyHash = h("a");
const concept = (seed: string) => `concept:${hash(seed)}`;
const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const evidence = (id: string, claimId: string): Any => {
  const record: Any = {
    evidenceId: id, sourceUrl: "https://example.test/frozen", sourceHash: h("b"), sourcePolicyHash: policyHash, sourceIdentityHash: h("c"),
    publisher: "Test archive", title: "Frozen record", sourceTier: "primary", claimIds: [claimId], retrievedAt: "2026-09-04T00:00:00.000Z", validUntil: "2027-09-04T00:00:00.000Z",
    responseBodySha256: h("d"), responseBodyBytes: 32, bodyStorePath: "content/evidence/frozen.txt", byteRange: { start: 0, end: 16 }, excerptBase64: "dGVzdA==", excerptSha256: h("e"), supportTokens: ["frozen"], contentHash: "",
  };
  record.contentHash = evidenceContentHashV33(record as never);
  return record;
};
const media = (id: string): Any => {
  const record: Any = { mediaId: id, localAssetPath: "content/question-media/test.webp", assetSha256: h("f"), altAr: "عنصر تجريبي", provenance: "first-party test fixture", licence: "test-only", rightsReceiptHash: h("1"), contentHash: "" };
  record.contentHash = mediaContentHashV33(record as never);
  return record;
};
const row = (ordinal: number, modality: "classic" | "image" = "image"): Any => {
  const claimId = `claim-${ordinal}`;
  return {
    rawCandidateId: `staged-${ordinal}`, categoryId: "tahadani-001", modality, difficulty: "easy", headerAr: "اختبار", promptAr: `ما الإجابة التجريبية ${ordinal}؟`, canonicalAnswer: `جواب${ordinal}`,
    acceptedAnswers: [`جواب${ordinal}`], acceptDefiniteArticle: false, answerConceptId: concept(`answer-${ordinal}`), targetLetter: "ج", facetId: `facet-${ordinal}`, claimIds: [claimId], evidenceIds: [`evidence-${ordinal}`], evidence: [evidence(`evidence-${ordinal}`, claimId)],
    ...(modality === "image" ? { media: media(`media-${ordinal}`) } : {}),
  };
};
const slot = (ordinal: number, modality: "classic" | "image" = "image"): Any => ({ slotId: `tahadani-001-${ordinal}`, categoryId: "tahadani-001", modality, ordinal, difficulty: "easy", state: "unfilled", targetLetter: "ج", facetId: `facet-${ordinal}` });

async function fixture(options: { rows?: Any[]; slots?: Any[]; audit?: Any; packetText?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "promotion-v33-"));
  const rows = options.rows ?? [row(1)]; const slots = options.slots ?? [slot(1)];
  const packetText = options.packetText ?? `${rows.map((item) => JSON.stringify(item)).join("\n")}\n`;
  const corpusSha256 = hash(packetText);
  const audit = options.audit ?? { result: "PASS", independent: true, auditorTaskIdentity: "independent-auditor-task", handoffHash: h("9"), corpusSha256, policyHash };
  const packet = join(root, "packet.jsonl"), auditPath = join(root, "audit.json"), slotsPath = join(root, "slots.json");
  await Promise.all([writeFile(packet, packetText), writeFile(auditPath, JSON.stringify(audit)), writeFile(slotsPath, JSON.stringify(slots))]);
  return { root, rows, slots, packetText, corpusSha256, audit, input: { stagingPacket: packet, batchAudit: auditPath, slots: slotsPath, authorUid: "writer-task", policyHash } };
}
const rejects = async (input: Parameters<typeof promoteStagingV33>[0], pattern: RegExp) => assert.rejects(() => promoteStagingV33(input), pattern);

test("promotion is deterministic, preserves wording, validates strict output records, and writes only explicitly", async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const first = await promoteStagingV33(f.input); const second = await promoteStagingV33(f.input);
  assert.deepEqual(first, second); assert.equal(first.dryRun, true); assert.equal(first.candidates[0].promptAr, f.rows[0].promptAr); assert.equal("approvals" in first, false);
  validatePromotionFragment(first);
  const output = join(f.root, "coordinator-output"); const written = await promoteStagingV33({ ...f.input, output });
  assert.equal(written.dryRun, false); assert.deepEqual(JSON.parse(await readFile(join(output, "promotion-fragment.json"), "utf8")), written);
});

test("audit identity, PASS, independence, policy binding, corpus binding, and text mutation fail closed", async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const change of [
    (audit: Any) => delete audit.auditorTaskIdentity,
    (audit: Any) => delete audit.handoffHash,
    (audit: Any) => { audit.result = "FAIL"; },
    (audit: Any) => { audit.independent = false; },
    (audit: Any) => { audit.auditorTaskIdentity = "writer-task"; },
    (audit: Any) => delete audit.policyHash,
    (audit: Any) => { audit.policyHash = h("0"); },
    (audit: Any) => { audit.corpusSha256 = h("0"); },
  ]) {
    const audit = deepCopy(f.audit); change(audit); await writeFile(f.input.batchAudit, JSON.stringify(audit)); await rejects(f.input, /audit|policy|corpus|PASS|independent/i);
  }
  await writeFile(f.input.batchAudit, JSON.stringify(f.audit)); await writeFile(f.input.stagingPacket, f.packetText.replace("اختبار", "تبديل"));
  await rejects(f.input, /corpus hash mismatch/i);
  await rejects({ ...f.input, policyHash: "not-a-hash" }, /policyHash/i);
});

test("candidate/category/slot and concept invariants reject malformed staging", async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const mutate of [
    (rows: Any[]) => { rows[0].rawCandidateId = ""; },
    (rows: Any[], slots: Any[]) => { rows[0].categoryId = "huroof-001"; slots[0].categoryId = "huroof-001"; },
    (rows: Any[], slots: Any[]) => { rows[0].categoryId = "tahadani-000"; slots[0].categoryId = "tahadani-000"; },
    (rows: Any[], slots: Any[]) => { rows[0].categoryId = "tahadani-063"; slots[0].categoryId = "tahadani-063"; },
    (_rows: Any[], slots: Any[]) => { slots[0].state = "blocked"; },
    (rows: Any[]) => { rows[0].categoryId = "tahadani-002"; },
    (rows: Any[]) => { rows[0].modality = "classic"; delete rows[0].media; },
    (rows: Any[]) => { rows[0].difficulty = "hard"; },
    (rows: Any[], slots: Any[]) => { rows[0].modality = "classic"; slots[0].modality = "classic"; rows[0].media = media("unexpected"); },
  ]) {
    const rows = deepCopy(f.rows), slots = deepCopy(f.slots); mutate(rows, slots); const next = await fixture({ rows, slots }); t.after(() => rm(next.root, { recursive: true, force: true })); await rejects(next.input, /candidateId|category|slot|difficulty|non-image/i);
  }
  const duplicateSlotRows = [row(1), row(2)], duplicateSlots = [slot(1), slot(2)]; duplicateSlots[1].slotId = duplicateSlots[0].slotId;
  const duplicateSlot = await fixture({ rows: duplicateSlotRows, slots: duplicateSlots }); t.after(() => rm(duplicateSlot.root, { recursive: true, force: true })); await rejects(duplicateSlot.input, /duplicate slot/i);
  const duplicateConceptRows = [row(1), row(2)]; duplicateConceptRows[1].answerConceptId = duplicateConceptRows[0].answerConceptId;
  const duplicateConcept = await fixture({ rows: duplicateConceptRows, slots: [slot(1), slot(2)] }); t.after(() => rm(duplicateConcept.root, { recursive: true, force: true })); await rejects(duplicateConcept.input, /duplicate answer concept/i);
  const duplicateCandidateRows = [row(1), row(2)]; duplicateCandidateRows[1].rawCandidateId = duplicateCandidateRows[0].rawCandidateId;
  const duplicateCandidate = await fixture({ rows: duplicateCandidateRows, slots: [slot(1), slot(2)] }); t.after(() => rm(duplicateCandidate.root, { recursive: true, force: true })); await rejects(duplicateCandidate.input, /duplicate output candidate/i);
});

test("approval-like nesting, evidence joins/hashes, and media modality rules reject", async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const cases: Array<[string, (rows: Any[]) => void, RegExp]> = [
    ["nested approval", (rows) => { rows[0].metadata = { humanReviewStatus: "approved" }; }, /forbidden/i],
    ["empty claims", (rows) => { rows[0].claimIds = []; }, /claimIds/i],
    ["empty evidence IDs", (rows) => { rows[0].evidenceIds = []; }, /evidenceIds/i],
    ["inconsistent claims", (rows) => { rows[0].evidence[0].claimIds = ["other"]; rows[0].evidence[0].contentHash = evidenceContentHashV33(rows[0].evidence[0]); }, /claimIds.*inconsistent/i],
    ["inconsistent evidence", (rows) => { rows[0].evidenceIds = ["other"]; }, /evidenceIds.*inconsistent/i],
    ["missing evidence hash", (rows) => { delete rows[0].evidence[0].sourceHash; }, /sourceHash/i],
    ["image without media", (rows) => { delete rows[0].media; }, /missing media/i],
    ["missing media hash", (rows) => { delete rows[0].media.assetSha256; }, /assetSha256/i],
  ];
  for (const [, mutate, pattern] of cases) { const rows = deepCopy(f.rows); mutate(rows); const next = await fixture({ rows }); t.after(() => rm(next.root, { recursive: true, force: true })); await rejects(next.input, pattern); }
  const duplicateEvidenceRows = [row(1), row(2)]; duplicateEvidenceRows[1].evidence[0].evidenceId = duplicateEvidenceRows[0].evidence[0].evidenceId; duplicateEvidenceRows[1].evidenceIds = [duplicateEvidenceRows[0].evidence[0].evidenceId]; duplicateEvidenceRows[1].evidence[0].contentHash = evidenceContentHashV33(duplicateEvidenceRows[1].evidence[0]);
  const duplicateEvidence = await fixture({ rows: duplicateEvidenceRows, slots: [slot(1), slot(2)] }); t.after(() => rm(duplicateEvidence.root, { recursive: true, force: true })); await rejects(duplicateEvidence.input, /duplicate evidence/i);
  const duplicateMediaRows = [row(1), row(2)]; duplicateMediaRows[1].media.mediaId = duplicateMediaRows[0].media.mediaId; duplicateMediaRows[1].media.contentHash = mediaContentHashV33(duplicateMediaRows[1].media);
  const duplicateMedia = await fixture({ rows: duplicateMediaRows, slots: [slot(1), slot(2)] }); t.after(() => rm(duplicateMedia.root, { recursive: true, force: true })); await rejects(duplicateMedia.input, /duplicate media/i);
});

test("canonical and symlink-resolved production outputs are rejected without writing", async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const canonical = resolve("content/question-bank-v3/v3.3");
  await rejects({ ...f.input, output: canonical }, /outside canonical/i);
  const link = join(f.root, "canonical-link");
  try { await symlink(canonical, link, "junction"); } catch (error) { t.skip(`junction unavailable in this environment: ${String(error)}`); return; }
  await rejects({ ...f.input, output: join(link, "nested") }, /canonical|symlink/i);
});
