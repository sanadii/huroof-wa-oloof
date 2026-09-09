import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  STAGED_CATEGORY_PACKET_LETTERS,
  validateStagedCategoryPacketPath,
  validateStagedCategoryPacketRows,
} from "../scripts/validate-staged-category-packet.js";
import { policyHashV33 } from "../src/question-bank-v3.3.js";

const row = (index: number) => {
  const letter = STAGED_CATEGORY_PACKET_LETTERS[index % STAGED_CATEGORY_PACKET_LETTERS.length];
  const difficulty = ["easy", "medium", "hard"][index % 3];
  const token = `موضوع${STAGED_CATEGORY_PACKET_LETTERS[index % 28]}${STAGED_CATEGORY_PACKET_LETTERS[Math.floor(index / 28)]}`;
  return {
    rawCandidateId: `candidate-${String(index + 1).padStart(3, "0")}`,
    categoryId: "tahadani-001",
    modality: "trivia",
    headerAr: "معلومات عامة",
    promptAr: `ما ${token} الذي يميز السجل المعتمد؟`,
    canonicalAnswer: `${letter}جواب${token}`,
    acceptedAnswers: [`${letter}جواب${token}`],
    normalizedArabicInitial: letter,
    acceptDefiniteArticle: false,
    difficulty,
    source: {
      url: `https://evidence.example.org/records/record-${index + 1}`,
      publisher: "Publisher",
      title: `Record ${index + 1}`,
      locator: `record-${index + 1} exact selector`,
      supportAr: `يذكر السجل المؤسسي المحدد هذه المعلومة صراحة ويدعم الإجابة العربية المطلوبة ${token}`,
    },
  };
};
const packet = (): Array<Record<string, unknown>> => Array.from({ length: 336 }, (_, index) => row(index));
const closedDomainPolicy = (categoryId = "tahadani-001") => {
  const policy: Record<string, unknown> = {
    policyVersion: "question-bank-v3.3-weighted-slots-v1", categoryId, modality: "classic", selectionMode: "standalone",
    supportedAnswerLetters: ["م"], minimumApproved: 300, preferredCandidates: 336, reservePerLetter: 3,
    conceptFacets: ["facet-one", "facet-two", "facet-three"], performanceFacets: [], closedDomainConceptReuseCap: 2,
    slotQuotas: [{ targetLetter: "م", facetId: "facet-one", count: 336 }], policyHash: "",
  };
  policy.policyHash = policyHashV33(policy as never);
  return policy;
};
const closedDomainPacket = (policyHash: string) => {
  const rows = packet();
  for (const [index, promptAr, facetId, claimIds, evidenceIds] of [
    [0, "ما المدينة التي تطابق السجل الأول المختلف؟", "facet-one", ["claim-one"], ["evidence-one"]],
    [1, "ما الرمز الذي يطابق السجل الثاني المختلف؟", "facet-two", ["claim-two"], ["evidence-two"]],
  ] as const) rows[index] = { ...rows[index], promptAr, canonicalAnswer: "مفهوم مشترك", acceptedAnswers: ["مفهوم مشترك"], normalizedArabicInitial: "م", modality: "classic", facetId, claimIds, evidenceIds, categoryPolicyHash: policyHash };
  return rows;
};
const authoredPuzzleRow = (): Record<string, unknown> => ({
  ...row(0),
  rawCandidateId: "puzzle-001",
  categoryId: "tahadani-013",
  modality: "classic",
  headerAr: "ألغاز منطقية",
  promptAr: "ما لون البطاقة الأولى إذا كانت الزرقاء قبل الحمراء والحمراء قبل الخضراء؟",
  canonicalAnswer: "زرقاء",
  acceptedAnswers: ["زرقاء"],
  normalizedArabicInitial: "ز",
  evidenceKind: "authored_puzzle",
  authoredPuzzle: {
    familyId: "permutation_order",
    origin: "first_party_original",
    ledger: { identity: "puzzle-source-ledger.json#puzzle-001", sha256: "a".repeat(64) },
    review: { originality: "pending_human_review", copyright: "pending_human_review" },
    formal: {
      finiteConstraints: ["ثلاث بطاقات مرتبة في ثلاثة مواضع."],
      verifierVersion: "tahadani-013-enumerator.v1",
      verifierInputSha256: "b".repeat(64),
      solutionSetSize: 1,
      canonicalAnswer: "زرقاء",
      workedSolutionAr: "بفحص الترتيبات الثلاثة الممكنة تتقدم الزرقاء الحمراء، ثم تتقدم الحمراء الخضراء، فيبقى ترتيب واحد فقط.",
      workedSolutionSha256: "c".repeat(64),
    },
  },
});
const charadesPacket = (): Array<Record<string, unknown>> => packet().map((candidate, index) => {
  const token = `أداء${STAGED_CATEGORY_PACKET_LETTERS[index % 28]}${STAGED_CATEGORY_PACKET_LETTERS[Math.floor(index / 28)]}`;
  const charades: Record<string, unknown> = {
    ...candidate,
    rawCandidateId: `charades-${String(index + 1).padStart(3, "0")}`,
    categoryId: "tahadani-016",
    modality: "charades",
    headerAr: "حيوانات — ولا كلمة",
    promptAr: `ارفع ذراعيك أمامك لأداء حركة ${token}.`,
    canonicalAnswer: `حيوان${token}`,
    acceptedAnswers: [`حيوان${token}`],
    performanceFacetId: `animal-performance:${index + 1}`,
    forbiddenSpeech: true,
    forbiddenProps: true,
    allowedGestures: ["حركة جسدية صامتة وآمنة"],
    originalityAudit: "pending_human_review",
    culturalSuitabilityAudit: "pending_human_review",
  };
  delete charades.normalizedArabicInitial;
  delete charades.acceptDefiniteArticle;
  return charades;
});
const codes = (report: Awaited<ReturnType<typeof validateStagedCategoryPacketPath>> | ReturnType<typeof validateStagedCategoryPacketRows>) => report.findings.map((finding) => finding.code);

test("accepts a canonical, varied 336-row packet while retaining human review boundary", () => {
  const report = validateStagedCategoryPacketRows(packet());
  assert.equal(report.counts.error, 0);
  assert.equal(report.screening.automatedCandidateScreeningOnly, true);
  assert.match(report.screening.humanReviewRequired, /human/i);
});

test("accepts normalized hamza in the Arabic interrogative أي", () => {
  const rows = packet();
  rows[0] = { ...rows[0], promptAr: "أي جواب يطابق الحقيقة المحددة؟" };
  const report = validateStagedCategoryPacketRows(rows, "fixture.jsonl");
  assert.equal(report.findings.some((finding) => finding.code === "trivia_question_form_invalid" && finding.rows.includes(1)), false);
});

test("allows only tahadani-013 classic authored puzzles without weakening external-source rules", () => {
  const local = authoredPuzzleRow();
  const localReport = validateStagedCategoryPacketRows([local]);
  for (const code of ["source_metadata_incomplete", "authored_puzzle_scope_invalid", "authored_puzzle_contract_invalid", "authored_puzzle_review_state_invalid"])
    assert.equal(codes(localReport).includes(code), false, code);

  const outOfScope = { ...authoredPuzzleRow(), categoryId: "tahadani-001", source: undefined };
  const outOfScopeReport = validateStagedCategoryPacketRows([outOfScope]);
  assert.equal(codes(outOfScopeReport).includes("authored_puzzle_scope_invalid"), true);
  assert.equal(codes(outOfScopeReport).includes("source_metadata_incomplete"), true);

  const unreviewed = authoredPuzzleRow();
  (unreviewed.authoredPuzzle as Record<string, unknown>).review = { originality: "approved", copyright: "pending_human_review" };
  const unreviewedReport = validateStagedCategoryPacketRows([unreviewed]);
  assert.equal(codes(unreviewedReport).includes("authored_puzzle_review_state_invalid"), true);
});

test("reports natural initial coverage without requiring all letters in one category", () => {
  const rows = packet().map((candidate) => ({
    ...candidate,
    canonicalAnswer: `اجابة${candidate.rawCandidateId}`,
    acceptedAnswers: [`اجابة${candidate.rawCandidateId}`],
    normalizedArabicInitial: "ا",
  }));
  const report = validateStagedCategoryPacketRows(rows);
  assert.equal(report.findings.some((finding) => finding.code === "letter_coverage_missing"), false);
  assert.equal(report.initialCounts["ا"], 336);
  assert.equal(report.initialCounts["ب"], 0);
});

test("accepts boardless charades while preserving separate-mode quality checks", () => {
  const report = validateStagedCategoryPacketRows(charadesPacket());
  assert.equal(report.counts.error, 0);
  assert.equal(report.initialCounts["ا"], 0);
  assert.equal(report.initialCounts["ي"], 0);
});

test("rejects invented classic board fields and unsafe or unreviewed charades", () => {
  const rows = charadesPacket();
  rows[0].targetLetter = "ا";
  rows[1].normalizedArabicInitial = "ب";
  rows[2].acceptDefiniteArticle = false;
  rows[3].facetId = "classic-facet";
  delete rows[4].originalityAudit;
  rows[5].culturalSuitabilityAudit = "approved";
  rows[6].promptAr = `ارفع ذراعيك لتمثيل ${rows[6].canonicalAnswer}.`;
  rows[7].forbiddenSpeech = false;
  rows[8].performanceFacetId = "";
  const report = validateStagedCategoryPacketRows(rows);
  for (const rowNumber of [1, 2, 3, 4])
    assert.equal(report.findings.some((finding) => finding.code === "charades_classic_board_fields_forbidden" && finding.rows.includes(rowNumber)), true);
  for (const rowNumber of [5, 6])
    assert.equal(report.findings.some((finding) => finding.code === "charades_review_state_invalid" && finding.rows.includes(rowNumber)), true);
  assert.equal(report.findings.some((finding) => finding.code === "charades_answer_leak" && finding.rows.includes(7)), true);
  assert.equal(report.findings.some((finding) => finding.code === "charades_silent_no_props_invalid" && finding.rows.includes(8)), true);
  assert.equal(report.findings.some((finding) => finding.code === "charades_performance_facet_missing" && finding.rows.includes(9)), true);
});

test("detects repeated templates hidden by different quoted identifiers", () => {
  const rows = packet();
  rows[0] = { ...rows[0], promptAr: "ما العنصر الذي يطابق المعرّف «alpha»؟" };
  rows[1] = { ...rows[1], promptAr: "ما العنصر الذي يطابق المعرّف «beta»؟" };
  rows[2] = { ...rows[2], promptAr: "ما العنصر الذي يطابق المعرّف «gamma»؟" };
  const report = validateStagedCategoryPacketRows(rows);
  assert.equal(report.findings.some((finding) => finding.code === "template_collapse"), true);
});

test("rejects non-Arabic support and comma qualifiers used to disguise answer reuse", () => {
  const rows = packet();
  for (const [offset, year] of [1930, 1950, 2010].entries()) {
    rows[offset] = {
      ...rows[offset],
      canonicalAnswer: `البرازيل، البطل في ${year}`,
      acceptedAnswers: [`البرازيل، البطل في ${year}`],
      normalizedArabicInitial: "ب",
      source: { ...(rows[offset].source as Record<string, unknown>), supportAr: "English-only evidence support" },
    };
  }
  const report = validateStagedCategoryPacketRows(rows);
  assert.equal(report.findings.some((finding) => finding.code === "answer_qualifier_padding"), true);
  assert.equal(report.findings.filter((finding) => finding.code === "source_support_not_arabic").length, 3);
});

test("rejects opaque registry fingerprints and answer suffixes used as fake diversity", () => {
  const rows = packet();
  rows[0] = {
    ...rows[0],
    promptAr: "ما اسم العنصر ضمن سجل الفهرسة ec678d35e9d11571؟",
    canonicalAnswer: "بحر في السجل الرسمي",
    acceptedAnswers: ["بحر في السجل الرسمي"],
    normalizedArabicInitial: "ب",
  };
  const report = validateStagedCategoryPacketRows(rows);
  assert.equal(report.findings.some((finding) => finding.code === "placeholder_or_review_boilerplate" && finding.rows.includes(1)), true);
});

test("fails closed for malformed JSONL and common raw-packet quality failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "staged-packet-"));
  try {
    const path = join(directory, "bad.jsonl");
    await writeFile(path, "{bad}\r\n", "utf8");
    const report = await validateStagedCategoryPacketPath(path);
    assert.ok(codes(report).includes("noncanonical_jsonl"));
    assert.ok(codes(report).includes("invalid_jsonl_row"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("binds path validation reports to the exact raw JSONL bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "staged-packet-hash-"));
  try {
    const path = join(directory, "packet.jsonl");
    const bytes = Buffer.from(`${packet().map((candidate) => JSON.stringify(candidate)).join("\n")}\n`, "utf8");
    await writeFile(path, bytes);
    const report = await validateStagedCategoryPacketPath(path);
    assert.equal(report.corpusSha256, createHash("sha256").update(bytes).digest("hex"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("enforces the 11 closed-domain second-use policy regressions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "staged-closed-domain-"));
  try {
    const packetPath = join(directory, "packet.jsonl");
    const policyPath = join(directory, "policy.json");
    const run = async (rows: Array<Record<string, unknown>>, policy: Record<string, unknown> | null, withBinding = true) => {
      await writeFile(packetPath, `${rows.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`, "utf8");
      if (policy) await writeFile(policyPath, JSON.stringify(policy), "utf8");
      return validateStagedCategoryPacketPath(packetPath, withBinding ? policyPath : undefined);
    };
    const policy = closedDomainPolicy();
    const rows = closedDomainPacket(policy.policyHash as string);
    const duplicate = (report: Awaited<ReturnType<typeof validateStagedCategoryPacketPath>>) => codes(report).includes("duplicate_answer_concept");

    const defaultCap = await run(rows, policy, false);
    assert.equal(duplicate(defaultCap), true);
    assert.equal(defaultCap.policyBinding.valid, false);

    const valid = await run(rows, policy);
    assert.equal(duplicate(valid), false);
    assert.equal(valid.policyBinding.valid, true);
    assert.equal(valid.policyBinding.bytesSha256, createHash("sha256").update(await readFile(policyPath)).digest("hex"));

    const tampered = { ...policy, policyHash: "0".repeat(64) };
    assert.equal(duplicate(await run(rows, tampered)), true);
    assert.equal(duplicate(await run(rows, closedDomainPolicy("tahadani-002"))), true);
    assert.equal(duplicate(await run(rows, closedDomainPolicy("tahadani-045"))), true);

    const nonClassic = closedDomainPacket(policy.policyHash as string);
    nonClassic[1].modality = "trivia";
    assert.equal(duplicate(await run(nonClassic, policy)), true);

    const sameFacet = closedDomainPacket(policy.policyHash as string);
    sameFacet[1].facetId = sameFacet[0].facetId;
    assert.equal(duplicate(await run(sameFacet, policy)), true);

    const sharedClaim = closedDomainPacket(policy.policyHash as string);
    sharedClaim[1].claimIds = sharedClaim[0].claimIds;
    assert.equal(duplicate(await run(sharedClaim, policy)), true);

    const sharedEvidence = closedDomainPacket(policy.policyHash as string);
    sharedEvidence[1].evidenceIds = sharedEvidence[0].evidenceIds;
    assert.equal(duplicate(await run(sharedEvidence, policy)), true);

    const similar = closedDomainPacket(policy.policyHash as string);
    similar[1].promptAr = "ما المدينة التي تطابق السجل الأول المختلف تماماً؟";
    assert.equal(duplicate(await run(similar, policy)), true);

    const thirdUse = closedDomainPacket(policy.policyHash as string);
    thirdUse[2] = { ...thirdUse[2], promptAr: "ما العلامة التي تطابق السجل الثالث المختلف؟", canonicalAnswer: "مفهوم مشترك", acceptedAnswers: ["مفهوم مشترك"], normalizedArabicInitial: "م", modality: "classic", facetId: "facet-three", claimIds: ["claim-three"], evidenceIds: ["evidence-three"], categoryPolicyHash: policy.policyHash };
    const third = await run(thirdUse, policy);
    assert.equal(codes(third).includes("closed_domain_concept_reuse_invalid"), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("fails closed whenever a supplied category-policy binding is invalid", async () => {
  const directory = await mkdtemp(join(tmpdir(), "staged-policy-binding-"));
  try {
    const packetPath = join(directory, "unique.jsonl");
    const policyPath = join(directory, "policy.json");
    await writeFile(packetPath, `${packet().map((candidate) => JSON.stringify(candidate)).join("\n")}\n`, "utf8");

    const missing = await validateStagedCategoryPacketPath(packetPath, join(directory, "missing-policy.json"));
    assert.equal(missing.policyBinding.valid, false);
    assert.equal(missing.policyBinding.reason, "unreadable");
    assert.ok(codes(missing).includes("category_policy_binding_invalid"));

    await writeFile(policyPath, "{ malformed", "utf8");
    const malformed = await validateStagedCategoryPacketPath(packetPath, policyPath);
    assert.equal(malformed.policyBinding.valid, false);
    assert.equal(malformed.policyBinding.reason, "invalid_json");
    assert.ok(codes(malformed).includes("category_policy_binding_invalid"));

    const semanticHashInvalid = { ...closedDomainPolicy(), policyHash: "0".repeat(64) };
    await writeFile(policyPath, JSON.stringify(semanticHashInvalid), "utf8");
    const invalidSemanticHash = await validateStagedCategoryPacketPath(packetPath, policyPath);
    assert.equal(invalidSemanticHash.policyBinding.valid, false);
    assert.equal(invalidSemanticHash.policyBinding.reason, "invalid_v33_semantics");
    assert.ok(codes(invalidSemanticHash).includes("category_policy_binding_invalid"));

    const mismatchPolicy = closedDomainPolicy("tahadani-045");
    await writeFile(policyPath, JSON.stringify(mismatchPolicy), "utf8");
    const mismatch = await validateStagedCategoryPacketPath(packetPath, policyPath);
    assert.equal(mismatch.policyBinding.valid, true);
    assert.ok(codes(mismatch).includes("category_policy_binding_category_mismatch"));

    const partialPath = join(directory, "partial.jsonl");
    await writeFile(partialPath, `${packet().slice(0, 9).map((candidate) => JSON.stringify(candidate)).join("\n")}\n`, "utf8");
    const validPolicy = closedDomainPolicy();
    await writeFile(policyPath, JSON.stringify(validPolicy), "utf8");
    const partial = await validateStagedCategoryPacketPath(partialPath, policyPath);
    assert.equal(partial.policyBinding.valid, true);
    assert.deepEqual([...new Set(codes(partial))].sort(), ["difficulty_distribution_invalid", "row_count_invalid"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects preambles, placeholders, approval fields, repeated n-grams, API evidence, and collapsed templates", () => {
  const rows = packet();
  rows[0] = {
    ...rows[0],
    promptAr: "لفئة معلومات عامة: ما كأس أوروبا كأس أوروبا؟",
    canonicalAnswer: "كأس أوروبا كأس أوروبا",
    acceptedAnswers: ["كأس أوروبا كأس أوروبا"],
    normalizedArabicInitial: "ك",
    approvalReceipt: "forged",
    ambiguityNotesAr: "يلزم التحقق",
    source: { url: "https://api.example.org/v1/list", publisher: "P", title: "T", locator: "list exact selector", supportAr: "دعم محدد" },
  };
  rows[1] = { ...rows[1], promptAr: "ما القاعدة الثابتة التي تصف السجل؟" };
  rows[2] = { ...rows[2], promptAr: "ما القاعدة الثابتة التي تصف السجل؟" };
  rows[3] = { ...rows[3], promptAr: "ما القاعدة الثابتة التي تصف السجل؟" };
  const report = validateStagedCategoryPacketRows(rows);
  for (const code of ["category_preamble_in_content", "placeholder_or_review_boilerplate", "approval_or_receipt_field", "malformed_repeated_ngram", "source_url_not_direct_evidence", "template_collapse"])
    assert.ok(codes(report).includes(code), code);
});

test("accepts exact UNESCO World Heritage record routes but rejects list-like routes", () => {
  const accepted = packet();
  accepted[0] = {
    ...accepted[0],
    source: {
      ...(accepted[0].source as Record<string, unknown>),
      url: "https://whc.unesco.org/en/list/87/",
      locator: "Ancient Thebes with its Necropolis",
    },
  };
  assert.equal(
    validateStagedCategoryPacketRows(accepted).findings.some(
      (finding) => finding.code === "source_url_not_direct_evidence" && finding.rows.includes(1),
    ),
    false,
  );

  for (const { url, locator } of [
    { url: "https://whc.unesco.org/en/list/", locator: "World Heritage List" },
    { url: "https://whc.unesco.org/en/list/87/?search=thebes", locator: "Dossier: 87" },
    { url: "https://whc.unesco.org/en/search/thebes", locator: "Thebes exact record locator" },
    { url: "https://whc.unesco.org/en/index/thebes", locator: "Thebes exact record locator" },
    { url: "https://whc.unesco.org/en/filter/country", locator: "Country exact record locator" },
    { url: "https://whc.unesco.org/en/list/ancient-thebes/", locator: "Ancient Thebes exact record locator" },
  ]) {
    const rejected = packet();
    rejected[0] = {
      ...rejected[0],
      source: {
        ...(rejected[0].source as Record<string, unknown>),
        url,
        locator,
      },
    };
    assert.equal(
      validateStagedCategoryPacketRows(rejected).findings.some(
        (finding) => finding.code === "source_url_not_direct_evidence" && finding.rows.includes(1),
      ),
      true,
      url,
    );
  }
});

test("current rejected 019, 020, and 021 packets fail when their read-only fixtures are present", async () => {
  const fixtures = [
    "content/question-bank-v3/staging/tahadani-019/raw-candidates.jsonl",
    "content/question-bank-v3/staging/tahadani-020/raw-candidates.v1.jsonl",
    "content/question-bank-v3/staging/tahadani-021/raw-candidates.tahadani-021.v3.3.jsonl",
  ];
  for (const fixture of fixtures) {
    try {
      await readFile(fixture);
    } catch { continue; }
    const report = await validateStagedCategoryPacketPath(fixture);
    assert.ok(report.counts.error > 0, fixture);
  }
});
