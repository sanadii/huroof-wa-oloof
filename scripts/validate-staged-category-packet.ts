import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exactNormalizeV1, promptSimilarityV1 } from "../src/question-bank-v3.2.js";
import { policyHashV33 } from "../src/question-bank-v3.3.js";

/** Fail-closed screening for raw authoring packets. It deliberately is not a fact or playability approval. */
export const STAGED_CATEGORY_PACKET_ROWS = 336;
export const STAGED_CATEGORY_PACKET_LETTERS = [
  "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص",
  "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي",
] as const;

type RawRow = Record<string, unknown>;
export type StagedPacketFinding = {
  code: string;
  message: string;
  rows: number[];
};
export type StagedCategoryPacketReport = {
  schemaVersion: "staged-category-packet-quality.v1";
  path?: string;
  /** Present for filesystem validation only; binds the report to the exact JSONL bytes. */
  corpusSha256?: string;
  policyBinding: {
    supplied: boolean;
    valid: boolean;
    bytesSha256: string | null;
    policyHash: string | null;
    categoryId: string | null;
    reason: string | null;
    defaultReuseCap: 1;
  };
  rowCount: number;
  categoryIds: string[];
  modalityCounts: Record<string, number>;
  difficultyCounts: Record<string, number>;
  initialCounts: Record<string, number>;
  findings: StagedPacketFinding[];
  counts: { error: number };
  screening: {
    automatedCandidateScreeningOnly: true;
    humanReviewRequired: "Authenticated human factual, Arabic-language, source-link, and playability review remains required.";
  };
};

type CategoryPolicyBinding = StagedCategoryPacketReport["policyBinding"];
const CLOSED_DOMAIN_ALLOWLIST = new Set(["tahadani-001", "tahadani-045", "tahadani-046", "tahadani-059"]);

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const asArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const hasOwn = (row: RawRow, key: string) => Object.prototype.hasOwnProperty.call(row, key);
const rowId = (row: RawRow) => asText(row.rawCandidateId ?? row.candidateId ?? row.id);
const rowPolicyHash = (row: RawRow) => asText(row.categoryPolicyHash ?? row.policyHash);
const header = (row: RawRow) => asText(row.headerAr ?? row.categoryHeaderAr);
const cue = (row: RawRow) =>
  asText(row.promptAr ?? row.performerCuePrivateAr ?? row.privatePerformerCueAr ?? row.phraseAr);
const initial = (row: RawRow) => asText(row.targetLetter ?? row.normalizedArabicInitial ?? row.normalizedStartingLetter);
const variants = (row: RawRow) =>
  [asText(row.canonicalAnswer), ...asArray(row.acceptedAnswers ?? row.aliases)].filter(Boolean);
const answerKey = (row: RawRow) => exactNormalizeV1(asText(row.canonicalAnswer));
const sourceFor = (row: RawRow): RawRow => {
  const candidate = row.source ?? row.evidence ?? row.provenance;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as RawRow)
    : {};
};
const sourceSupport = (source: RawRow) =>
  asText(source.supportAr ?? source.supportNoteAr ?? source.claimEvidenceNote ?? source.description);
const stringSet = (value: unknown) => {
  if (!Array.isArray(value) || !value.length || !value.every((item) => typeof item === "string" && item.trim())) return null;
  const output = new Set(value.map((item) => item.trim()));
  return output.size === value.length ? output : null;
};
const disjoint = (left: Set<string> | null, right: Set<string> | null) =>
  Boolean(left && right && [...left].every((item) => !right.has(item)));
const objectFor = (value: unknown): RawRow =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RawRow : {};
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const blankPolicyBinding = (): CategoryPolicyBinding => ({ supplied: false, valid: false, bytesSha256: null, policyHash: null, categoryId: null, reason: "not_supplied", defaultReuseCap: 1 });
const policyHasV33Semantics = (policy: RawRow) =>
  asText(policy.policyVersion) === "question-bank-v3.3-weighted-slots-v1" &&
  /^tahadani-(?:0[0-5]\d|06[0-2])$/u.test(asText(policy.categoryId)) &&
  asText(policy.modality) === "classic" &&
  ["standalone", "combined_only", "charades_only"].includes(asText(policy.selectionMode)) &&
  Array.isArray(policy.supportedAnswerLetters) &&
  policy.minimumApproved === 300 && policy.preferredCandidates === 336 && policy.reservePerLetter === 3 &&
  Array.isArray(policy.conceptFacets) && Array.isArray(policy.performanceFacets) &&
  policy.closedDomainConceptReuseCap === 2 && Array.isArray(policy.slotQuotas) && policy.slotQuotas.length > 0 &&
  SHA256_HEX.test(asText(policy.policyHash)) && policy.policyHash === policyHashV33(policy as never);

async function readCategoryPolicyBinding(policyPath?: string): Promise<CategoryPolicyBinding> {
  if (!policyPath) return blankPolicyBinding();
  let bytes: Uint8Array;
  try { bytes = await readFile(resolve(policyPath)); }
  catch { return { ...blankPolicyBinding(), supplied: true, reason: "unreadable" }; }
  const bytesSha256 = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return { ...blankPolicyBinding(), supplied: true, bytesSha256, reason: "invalid_json" }; }
  const policy = objectFor(parsed);
  const categoryId = asText(policy.categoryId) || null;
  const policyHash = asText(policy.policyHash) || null;
  if (!policyHasV33Semantics(policy)) return { ...blankPolicyBinding(), supplied: true, bytesSha256, categoryId, policyHash, reason: "invalid_v33_semantics" };
  if (!categoryId || !CLOSED_DOMAIN_ALLOWLIST.has(categoryId)) return { ...blankPolicyBinding(), supplied: true, bytesSha256, categoryId, policyHash, reason: "category_not_allowlisted" };
  return { supplied: true, valid: true, bytesSha256, categoryId, policyHash, reason: null, defaultReuseCap: 1 };
}
const isAuthoredPuzzle = (row: RawRow, categoryId: string, modality: string) =>
  asText(row.evidenceKind) === "authored_puzzle" && categoryId === "tahadani-013" && modality === "classic";
const hasSubstantiveArabicSupport = (value: string) => {
  const arabicWords = value.match(/[\u0600-\u06FF]{2,}/gu)?.length ?? 0;
  const arabicLetters = value.match(/[\u0600-\u06FF]/gu)?.length ?? 0;
  const latinLetters = value.match(/[A-Za-z]/gu)?.length ?? 0;
  const arabicRatio = arabicLetters / Math.max(1, arabicLetters + latinLetters);
  return arabicWords >= 10 || (arabicWords >= 6 && arabicRatio >= 0.55);
};
const sortFindings = (findings: StagedPacketFinding[]) =>
  findings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.rows.join(",").localeCompare(right.rows.join(",")) ||
      left.message.localeCompare(right.message),
  );

function hasRepeatedNgram(value: string) {
  const tokens = exactNormalizeV1(value).split(" ").filter(Boolean);
  for (let size = 1; size <= Math.min(4, Math.floor(tokens.length / 2)); size += 1)
    for (let start = 0; start + size * 2 <= tokens.length; start += 1) {
      const part = tokens.slice(start, start + size).join(" ");
      let repeats = 1;
      while (
        tokens.slice(start + repeats * size, start + (repeats + 1) * size).join(" ") === part
      )
        repeats += 1;
      if (repeats >= 2) return part;
    }
  return "";
}

function containsBannedText(row: RawRow) {
  const banned = /يلزم\s+(?:التحقق|اختبار)|لا\s+يعتمد\s+قبل|أضف\s+حركة\s+ثانية\s+مختلفة|لا\s+تعتمد\s+الحزمة|ضمن\s+سجل\s+الفهرسة|في\s+السجل\s+الرسمي/iu;
  const visit = (value: unknown): boolean => {
    if (typeof value === "string") return banned.test(value);
    if (Array.isArray(value)) return value.some(visit);
    if (value && typeof value === "object") return Object.values(value).some(visit);
    return false;
  };
  return visit(row);
}

function containsApprovalField(row: RawRow) {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value as RawRow).some(
      ([key, child]) => /(?:approval|approved|receipt)/iu.test(key) || visit(child),
    );
  };
  return visit(row);
}

function directEvidenceUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (
      parsed.hostname.toLocaleLowerCase() === "whc.unesco.org" &&
      /^\/en\/list\/[1-9]\d*\/?$/u.test(parsed.pathname) &&
      !parsed.search &&
      !parsed.hash
    ) return true;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const genericWord = /^(?:search|home|index|list|api|filter)$/iu;
    const generic =
      !segments.length ||
      /^(?:api|search)\./iu.test(parsed.hostname) ||
      segments.some((segment) => genericWord.test(segment));
    return !generic;
  } catch {
    return false;
  }
}

function initialArabicLetter(value: string, acceptDefiniteArticle: boolean) {
  let normalized = exactNormalizeV1(value);
  if (acceptDefiniteArticle && /^ال(?=[\u0621-\u064A])/u.test(normalized)) normalized = normalized.slice(2);
  return normalized[0] ?? "";
}

function isTrivia(modality: string) {
  return modality === "trivia" || modality === "classic" || modality === "text" || modality === "identity" || modality === "puzzle";
}

function isSingleAnswerTrivia(prompt: string) {
  const normalized = exactNormalizeV1(prompt);
  return (
    /^(?:ما|من|اين|اي|كيف|متى|كم)(?:\s|$)/u.test(normalized) &&
    /[؟?]\s*$/u.test(prompt.trim()) &&
    !/(?:\s(?:او|أو)\s|\/|صح\s+ام\s+خطا|صواب\s+ام\s+خطا)/iu.test(prompt)
  );
}

function containsNormalizedPhrase(value: string, phrase: string) {
  const tokens = exactNormalizeV1(value).split(/\s+/u).filter(Boolean);
  const phraseTokens = exactNormalizeV1(phrase).split(/\s+/u).filter(Boolean);
  if (!phraseTokens.length) return false;
  return tokens.some((_, index) =>
    phraseTokens.every((token, offset) => tokens[index + offset] === token),
  );
}

function charadesCueLeaksAnswer(row: RawRow) {
  return variants(row).some((answer) => {
    const normalized = exactNormalizeV1(answer);
    const withoutDefiniteArticle = normalized.replace(/^ال(?=[\u0621-\u064A])/u, "");
    return (
      containsNormalizedPhrase(cue(row), normalized) ||
      (withoutDefiniteArticle !== normalized && containsNormalizedPhrase(cue(row), withoutDefiniteArticle))
    );
  });
}

function charadesReviewState(row: RawRow, key: "originality" | "suitability") {
  const review = row.charadesReview;
  const nested = review && typeof review === "object" && !Array.isArray(review) ? review as RawRow : {};
  return key === "originality"
    ? asText(row.originalityAudit ?? nested.originality)
    : asText(row.culturalSuitabilityAudit ?? nested.suitability ?? nested.culturalSuitability);
}

function authoredPuzzleContract(row: RawRow) {
  const puzzle = objectFor(row.authoredPuzzle);
  const ledger = objectFor(puzzle.ledger);
  const review = objectFor(puzzle.review);
  const formal = objectFor(puzzle.formal);
  const canonical = asText(row.canonicalAnswer);
  const workedSolution = asText(formal.workedSolutionAr);
  return {
    valid:
      asText(puzzle.origin) === "first_party_original" &&
      asText(ledger.identity).startsWith("puzzle-source-ledger.json#") &&
      SHA256_HEX.test(asText(ledger.sha256)) &&
      Array.isArray(formal.finiteConstraints) && formal.finiteConstraints.length > 0 &&
      asText(formal.verifierVersion) && SHA256_HEX.test(asText(formal.verifierInputSha256)) &&
      formal.solutionSetSize === 1 && asText(formal.canonicalAnswer) === canonical &&
      workedSolution && hasSubstantiveArabicSupport(workedSolution) && SHA256_HEX.test(asText(formal.workedSolutionSha256)),
    reviewsPending:
      asText(review.originality) === "pending_human_review" &&
      asText(review.copyright) === "pending_human_review",
  };
}

function authoredPuzzleLeaksAnswer(row: RawRow) {
  const prompt = cue(row);
  if (!/(?:الاجاب[ةه]|الحل)\s*(?:هو|هي|:)/u.test(prompt)) return false;
  return variants(row).some((answer) => containsNormalizedPhrase(prompt, answer));
}

function templateFor(row: RawRow) {
  // Mask quoted slot values before punctuation normalization removes the quote
  // delimiters; otherwise generated identifiers can disguise one repeated template.
  let value = exactNormalizeV1(
    cue(row).replace(/[«"“][^«"”]*[»"”]/gu, " حقل "),
  );
  for (const answer of variants(row).sort((left, right) => right.length - left.length)) {
    const normalized = exactNormalizeV1(answer);
    if (normalized) value = value.replaceAll(normalized, " #answer ");
  }
  value = value
    .replace(/\b\d{1,4}(?:\s*[-/]\s*\d{1,4})?\b/gu, " #number ")
    .replace(/(?:المطلوب\s+سرا|قرينة\s+الاداء|العاصمة)\s*:?\s*[^.؛،]+/gu, " #slot ")
    .replace(/(?:الايسر|الايمن|قليلا|بهدوء|قصيرة|صغيرتين|منخفضة|ثابتة|لثانيتين)/gu, " #modifier ");
  if (asText(row.modality) === "charades") {
    value = value
      .replace(/(?:ابدا|ابدأ)\s+[^.؛،]+/gu, " #opening ")
      .replace(/(?:ثم|و)\s+[^.؛،]+/gu, " #gesture ")
      .replace(/ممنوع\s+[^.؛،]+/gu, " #restriction ");
  }
  return value.replace(/\s+/g, " ").trim();
}

function addGroupedFindings(
  findings: StagedPacketFinding[],
  code: string,
  values: Map<string, number[]>,
  minimum: number,
  message: (value: string, rows: number[]) => string,
) {
  for (const [value, rows] of values)
    if (rows.length >= minimum) findings.push({ code, message: message(value, rows), rows: rows.slice().sort((a, b) => a - b) });
}

function validClosedDomainSecondUse(rows: RawRow[], binding: CategoryPolicyBinding) {
  if (rows.length !== 2) return false;
  const [first, second] = rows;
  const categoryId = asText(first.categoryId);
  if (!binding.valid || binding.categoryId !== categoryId || asText(second.categoryId) !== categoryId || !CLOSED_DOMAIN_ALLOWLIST.has(categoryId)) return false;
  if (asText(first.modality) !== "classic" || asText(second.modality) !== "classic") return false;
  if (rowPolicyHash(first) !== binding.policyHash || rowPolicyHash(second) !== binding.policyHash) return false;
  const firstFacet = asText(first.facetId), secondFacet = asText(second.facetId);
  return Boolean(firstFacet && secondFacet && firstFacet !== secondFacet && disjoint(stringSet(first.claimIds), stringSet(second.claimIds)) && disjoint(stringSet(first.evidenceIds), stringSet(second.evidenceIds)) && promptSimilarityV1(cue(first), cue(second)) < 0.82);
}

export function validateStagedCategoryPacketRows(rows: RawRow[], path?: string, policyBinding: CategoryPolicyBinding = blankPolicyBinding()): StagedCategoryPacketReport {
  const findings: StagedPacketFinding[] = [];
  const add = (code: string, message: string, row?: number) =>
    findings.push({ code, message, rows: row === undefined ? [] : [row] });
  if (policyBinding.supplied && !policyBinding.valid)
    add("category_policy_binding_invalid", `Supplied category policy binding is invalid: ${policyBinding.reason ?? "unknown"}.`);
  if (rows.length !== STAGED_CATEGORY_PACKET_ROWS)
    add("row_count_invalid", `Expected exactly ${STAGED_CATEGORY_PACKET_ROWS} rows; found ${rows.length}.`);

  const ids = new Map<string, number[]>();
  const prompts = new Map<string, number[]>();
  const answers = new Map<string, number[]>();
  const authoredPuzzleFamilies = new Map<string, number[]>();
  const answerBasesWithQualifier = new Map<string, number[]>();
  const templates = new Map<string, number[]>();
  const categoryIds = new Set<string>();
  const modalities = new Map<string, number>();
  const difficulties = new Map<string, number>();
  const initials = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    const id = rowId(row), categoryId = asText(row.categoryId), rowHeader = header(row), rowCue = cue(row);
    const modality = asText(row.modality), difficulty = asText(row.difficulty), target = initial(row);
    const authoredPuzzle = isAuthoredPuzzle(row, categoryId, modality);
    categoryIds.add(categoryId); modalities.set(modality, (modalities.get(modality) ?? 0) + 1);
    difficulties.set(difficulty, (difficulties.get(difficulty) ?? 0) + 1);
    const collect = (map: Map<string, number[]>, key: string) => map.set(key, [...(map.get(key) ?? []), rowNumber]);
    collect(ids, id); collect(prompts, exactNormalizeV1(rowCue)); collect(answers, answerKey(row)); collect(templates, templateFor(row));
    const rawAnswer = asText(row.canonicalAnswer);
    if (/[،,]/u.test(rawAnswer))
      collect(answerBasesWithQualifier, exactNormalizeV1(rawAnswer.split(/[،,]/u)[0] ?? ""));
    if (!id) add("missing_id", "Each row needs a nonempty immutable candidate ID.", rowNumber);
    if (!categoryId) add("missing_category_id", "Each row needs categoryId.", rowNumber);
    if (!rowHeader || !rowCue || exactNormalizeV1(rowHeader) === exactNormalizeV1(rowCue))
      add("header_or_content_invalid", "A separate nonempty category header and prompt/cue are required.", rowNumber);
    const firstCategoryWord = exactNormalizeV1(rowHeader).split(" ")[0] ?? "";
    if (
      (firstCategoryWord && new RegExp(`^(?:ل?فئة\\s+|لعبة\\s+|ل)${firstCategoryWord}(?:\\s|$)`, "u").test(exactNormalizeV1(rowCue))) ||
      /^(?:لفئة|لكرتون|لعبة|التصنيف)(?:\s|$)/u.test(exactNormalizeV1(rowCue))
    ) add("category_preamble_in_content", "Prompt/cue must not begin with a category preamble.", rowNumber);
    if (containsBannedText(row)) add("placeholder_or_review_boilerplate", "Row contains placeholder or review boilerplate rather than playable content.", rowNumber);
    if (containsApprovalField(row)) add("approval_or_receipt_field", "Raw authoring packets cannot contain approval or receipt fields.", rowNumber);
    const repeated = hasRepeatedNgram(`${rowCue} ${asText(row.canonicalAnswer)}`);
    if (repeated) add("malformed_repeated_ngram", `Repeated n-gram «${repeated}» is malformed.`, rowNumber);
    if (modality === "charades") {
      const classicBoardFields = [
        "targetLetter",
        "normalizedArabicInitial",
        "normalizedStartingLetter",
        "acceptDefiniteArticle",
        "facetId",
      ].filter((field) => hasOwn(row, field));
      if (classicBoardFields.length)
        add("charades_classic_board_fields_forbidden", `Charades is a separate mode and cannot contain classic board fields: ${classicBoardFields.join(", ")}.`, rowNumber);
      if (!asText(row.performanceFacetId))
        add("charades_performance_facet_missing", "Charades requires a nonempty separate-mode performanceFacetId.", rowNumber);
      if (
        charadesReviewState(row, "originality") !== "pending_human_review" ||
        charadesReviewState(row, "suitability") !== "pending_human_review"
      )
        add("charades_review_state_invalid", "Charades requires pending_human_review originality and cultural-suitability review states; pending review is not approval.", rowNumber);
      if (charadesCueLeaksAnswer(row))
        add("charades_answer_leak", "Charades cue literally or by definite-article normalization reveals an accepted answer.", rowNumber);
    } else {
      if (!STAGED_CATEGORY_PACKET_LETTERS.includes(target as (typeof STAGED_CATEGORY_PACKET_LETTERS)[number]))
        add("invalid_initial", "Initial must be one of the 28 Arabic board letters.", rowNumber);
      else initials.add(target);
      if (typeof row.acceptDefiniteArticle !== "boolean")
        add("definite_article_semantics_missing", "Each row must explicitly set acceptDefiniteArticle.", rowNumber);
      else if (variants(row).length === 0 || variants(row).some((answer) => initialArabicLetter(answer, row.acceptDefiniteArticle as boolean) !== target))
        add("answer_initial_mismatch", "Canonical and every accepted variant must share the target initial under the row's article rule.", rowNumber);
    }
    if (asText(row.evidenceKind) === "authored_puzzle" && !authoredPuzzle)
      add("authored_puzzle_scope_invalid", "authored_puzzle evidence is allowed only for tahadani-013 classic rows.", rowNumber);
    if (authoredPuzzle) {
      const contract = authoredPuzzleContract(row);
      if (!contract.valid)
        add("authored_puzzle_contract_invalid", "Authored puzzles require a hashed local ledger identity, first_party_original origin, finite formal constraints, verifier hashes, one canonical solution, and hashed worked Arabic solution.", rowNumber);
      if (!contract.reviewsPending)
        add("authored_puzzle_review_state_invalid", "Authored puzzles require pending_human_review originality and copyright states; pending review is not approval.", rowNumber);
      if (authoredPuzzleLeaksAnswer(row))
        add("authored_puzzle_answer_leak", "Authored puzzle prompt directly states the answer as its solution.", rowNumber);
      const family = asText(objectFor(row.authoredPuzzle).familyId);
      if (!family) add("authored_puzzle_family_missing", "Authored puzzle requires a nonempty distinct familyId.", rowNumber);
      else collect(authoredPuzzleFamilies, family);
    }
    if (!["easy", "medium", "hard"].includes(difficulty)) add("difficulty_invalid", "Difficulty must be easy, medium, or hard.", rowNumber);
    if (!modality) add("modality_missing", "Each row needs modality.", rowNumber);
    if (isTrivia(modality) && !isSingleAnswerTrivia(rowCue)) add("trivia_question_form_invalid", "Trivia must be a single-answer interrogative question.", rowNumber);
    if (modality === "charades") {
      if (!rowCue || row.forbiddenSpeech !== true || row.forbiddenProps !== true || !asArray(row.allowedGestures).length)
        add("charades_silent_no_props_invalid", "Charades require a cue, forbiddenSpeech=true, forbiddenProps=true, and allowedGestures.", rowNumber);
      if (!/(?:ارفع|اخفض|حر(?:ك|ّك)|امش|خط|استدر|افتح|اغلق|اشر|اجلس|قف|انحن|مد|كو(?:ن|ّن)|ثب(?:ت|ّت)|ص(?:ف|ّف)ق|لو(?:ح|ّح))/u.test(rowCue))
        add("charades_concrete_gesture_missing", "Charades cue must contain a concrete gesture verb.", rowNumber);
    }
    if (!authoredPuzzle) {
      const source = sourceFor(row), url = asText(source.url), locator = asText(source.locator), support = sourceSupport(source);
      if (!asText(source.publisher) || !asText(source.title) || !url || !locator || !support)
        add("source_metadata_incomplete", "Each row needs HTTPS source URL, publisher, title, exact locator, and support text.", rowNumber);
      else if (!directEvidenceUrl(url))
        add("source_url_not_direct_evidence", "Search/home/index/list/API-collection URL lacks a record-specific locator.", rowNumber);
      if (support && !hasSubstantiveArabicSupport(support))
        add("source_support_not_arabic", "Row-level source support must be a substantive Arabic statement, not English with an Arabic name inserted.", rowNumber);
    }
  }
  if (categoryIds.size !== 1 || categoryIds.has("")) add("category_scope_invalid", "Packet must contain exactly one nonempty category.");
  else if (policyBinding.supplied && policyBinding.valid && policyBinding.categoryId !== [...categoryIds][0])
    add("category_policy_binding_category_mismatch", `Supplied category policy is for «${policyBinding.categoryId ?? "unknown"}», not packet category «${[...categoryIds][0]}».`);
  for (const difficulty of ["easy", "medium", "hard"])
    if ((difficulties.get(difficulty) ?? 0) !== 112)
      add("difficulty_distribution_invalid", `Expected 112 ${difficulty} rows; found ${difficulties.get(difficulty) ?? 0}.`);
  addGroupedFindings(findings, "duplicate_id", ids, 2, (value) => `Duplicate row ID «${value}».`);
  addGroupedFindings(findings, "duplicate_prompt_or_cue", prompts, 2, () => "Duplicate prompt/cue after Arabic normalization.");
  for (const [answer, rowNumbers] of answers) {
    if (rowNumbers.length < 2) continue;
    const conceptRows = rowNumbers.map((rowNumber) => rows[rowNumber - 1]);
    if (rowNumbers.length === 2 && validClosedDomainSecondUse(conceptRows, policyBinding)) continue;
    findings.push({ code: rowNumbers.length > 2 ? "closed_domain_concept_reuse_invalid" : "duplicate_answer_concept", message: rowNumbers.length > 2 ? `Canonical answer concept «${answer}» is used ${rowNumbers.length} times; a third use always fails.` : "Duplicate canonical answer concept after Arabic normalization; second use requires a bound closed-domain policy and all independent-use conditions.", rows: rowNumbers.slice().sort((a, b) => a - b) });
  }
  addGroupedFindings(findings, "excessive_answer_reuse", answers, 3, (_value, grouped) => `Canonical answer is reused ${grouped.length} times (cap: 2).`);
  addGroupedFindings(findings, "answer_qualifier_padding", answerBasesWithQualifier, 3, (value) => `Repeated answer base «${value}» is disguised by comma-delimited qualifiers.`);
  addGroupedFindings(findings, "template_collapse", templates, 3, () => "Three or more prompts/cues share the same masked template skeleton.");
  addGroupedFindings(findings, "authored_puzzle_family_duplicate", authoredPuzzleFamilies, 2, (value) => `Authored puzzle family «${value}» is reused; each seed must use a distinct puzzle family.`);
  const report: StagedCategoryPacketReport = {
    schemaVersion: "staged-category-packet-quality.v1",
    ...(path ? { path } : {}),
    policyBinding,
    rowCount: rows.length,
    categoryIds: [...categoryIds].filter(Boolean).sort(),
    modalityCounts: Object.fromEntries([...modalities].filter(([key]) => key).sort(([a], [b]) => a.localeCompare(b))),
    difficultyCounts: Object.fromEntries([...difficulties].filter(([key]) => key).sort(([a], [b]) => a.localeCompare(b))),
    initialCounts: Object.fromEntries(
      STAGED_CATEGORY_PACKET_LETTERS.map((letter) => [
        letter,
        rows.filter((row) => initial(row) === letter).length,
      ]),
    ),
    findings: sortFindings(findings),
    counts: { error: findings.length },
    screening: {
      automatedCandidateScreeningOnly: true,
      humanReviewRequired: "Authenticated human factual, Arabic-language, source-link, and playability review remains required.",
    },
  };
  return report;
}

export async function validateStagedCategoryPacketPath(path: string, categoryPolicyPath?: string) {
  const absolutePath = resolve(path);
  const bytes = await readFile(absolutePath);
  const corpusSha256 = createHash("sha256").update(bytes).digest("hex");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  const parseFindings: StagedPacketFinding[] = [];
  try { text = decoder.decode(bytes); } catch { parseFindings.push({ code: "invalid_utf8", message: "Packet is not valid UTF-8.", rows: [] }); }
  if (text.startsWith("\uFEFF") || text.includes("\r") || (text && !text.endsWith("\n")))
    parseFindings.push({ code: "noncanonical_jsonl", message: "Packet must be BOM-free UTF-8 JSONL with LF line endings and a final LF.", rows: [] });
  const rows: RawRow[] = [];
  if (!parseFindings.some((finding) => finding.code === "invalid_utf8")) for (const [index, line] of text.replace(/\n$/u, "").split("\n").entries()) {
    if (!line) { parseFindings.push({ code: "blank_jsonl_line", message: "JSONL cannot contain blank lines.", rows: [index + 1] }); continue; }
    try {
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
      rows.push(value as RawRow);
    } catch { parseFindings.push({ code: "invalid_jsonl_row", message: "Line is not a JSON object.", rows: [index + 1] }); }
  }
  const policyBinding = await readCategoryPolicyBinding(categoryPolicyPath);
  const report = validateStagedCategoryPacketRows(rows, absolutePath, policyBinding);
  report.corpusSha256 = corpusSha256;
  report.findings = sortFindings([...parseFindings, ...report.findings]);
  report.counts.error = report.findings.length;
  return report;
}

async function main() {
  const [path, policyFlag, categoryPolicyPath, ...extra] = process.argv.slice(2);
  if (!path) throw new Error("Usage: validate-staged-category-packet PATH.jsonl");
  if (policyFlag !== undefined && (policyFlag !== "--category-policy" || !categoryPolicyPath || extra.length))
    throw new Error("Usage: validate-staged-category-packet PATH.jsonl [--category-policy POLICY.json]");
  const report = await validateStagedCategoryPacketPath(path, categoryPolicyPath);
  console.log(JSON.stringify(report, null, 2));
  if (report.counts.error) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
