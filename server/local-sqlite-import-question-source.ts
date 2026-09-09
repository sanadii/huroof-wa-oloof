/** Read-only runtime projection for the local T16 SQLite intake test source. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import type {
  ImportedQuestion,
  LocalQuestionInventory,
  LocalRuntimeQuestionSource,
} from "./local-firestore-question-source.js";

const letters = new Set([
  "ا",
  "ب",
  "ت",
  "ث",
  "ج",
  "ح",
  "خ",
  "د",
  "ذ",
  "ر",
  "ز",
  "س",
  "ش",
  "ص",
  "ض",
  "ط",
  "ظ",
  "ع",
  "غ",
  "ف",
  "ق",
  "ك",
  "ل",
  "م",
  "ن",
  "ه",
  "و",
  "ي",
]);
type Row = Record<string, unknown>;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const norm = (v: unknown) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/gu, "")
    .replace(/[أإآ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/\s+/gu, " ")
    .trim();
const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const values = (v: unknown) =>
  Array.isArray(v)
    ? [
        ...new Set(
          v.filter(
            (x): x is string => typeof x === "string" && Boolean(norm(x)),
          ),
        ),
      ]
    : [];
const canonical = (question: ImportedQuestion) =>
  JSON.stringify({
    id: question.id,
    categoryId: question.categoryId,
    targetLetter: question.targetLetter,
    answerConceptId: question.answerConceptId,
    promptAr: question.promptAr,
    canonicalAnswer: question.canonicalAnswer,
    acceptedAnswers: question.acceptedAnswers,
  });
const fileRows = async (path: string) => {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/gu)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row);
  } catch {
    return [];
  }
};
const normalizeRow = (
  row: Row,
  source: "sqlite" | "file",
): ImportedQuestion | undefined => {
  const raw =
    source === "sqlite" &&
    row.importSource &&
    typeof row.importSource === "object"
      ? (row.importSource as Row)
      : row;
  const mode = clean(
    raw.mode ?? raw.sourceMode ?? row.sourceMode,
  ).toLowerCase();
  if (source === "sqlite" && !["trivia", "identity"].includes(mode))
    return undefined;
  const categoryId = clean(raw.category_id ?? row.categoryId),
    headerAr = clean(raw.category_title ?? row.headerAr),
    promptAr = clean(raw.question ?? raw.instruction ?? row.promptAr),
    canonicalAnswer = clean(raw.answer ?? row.canonicalAnswer);
  const acceptedAnswers = values(raw.accepted_answers ?? row.acceptedAnswers);
  if (
    !categoryId ||
    !headerAr ||
    !promptAr ||
    !canonicalAnswer ||
    !acceptedAnswers.length
  )
    return undefined;
  if (source === "sqlite" && clean(row.stagingState)) return undefined;
  const sourceEligible = source === "file" || raw.letter_mode_eligible === true;
  const declared = norm(raw.target_letter ?? row.targetLetter);
  const targetLetter =
    sourceEligible &&
    letters.has(declared) &&
    norm(canonicalAnswer).startsWith(declared)
      ? declared
      : undefined;
  const sourceId = clean(raw.id ?? row.id);
  const sourceContentHash =
    clean(raw.source_content_sha256 ?? row.sourceContentHash) ||
    hash(
      `${source}:${sourceId}:${categoryId}:${norm(promptAr)}:${norm(canonicalAnswer)}`,
    );
  return {
    id: `${source}:${clean(row.id) || sourceId}`,
    categoryId,
    modality: "classic",
    ...(targetLetter ? { targetLetter } : {}),
    answerConceptId: hash(norm(canonicalAnswer)),
    headerAr,
    promptAr,
    canonicalAnswer,
    acceptedAnswers,
    difficulty: clean(raw.difficulty ?? row.difficulty) || "unspecified",
    status: "draft_test_import",
    sourceContentHash,
  };
};
const huroofAvailable = (questions: ImportedQuestion[]) => {
  const covered = new Set(
    questions.flatMap((q) => (q.targetLetter ? [q.targetLetter] : [])),
  );
  return covered.size >= 25;
};
const recommendedHuroof = (questions: ImportedQuestion[]) => {
  const byCategory = new Map<string, ImportedQuestion[]>();
  for (const q of questions)
    byCategory.set(q.categoryId, [...(byCategory.get(q.categoryId) ?? []), q]);
  const picked: string[] = [];
  const covered = new Set<string>();
  while (picked.length < 10) {
    const next = [...byCategory.entries()]
      .filter(([id]) => !picked.includes(id))
      .map(([id, items]) => ({
        id,
        importedGain: new Set(
          items.flatMap((q) =>
            q.id.startsWith("sqlite:") &&
            q.targetLetter &&
            !covered.has(q.targetLetter)
              ? [q.targetLetter]
              : [],
          ),
        ).size,
        gain: new Set(
          items.flatMap((q) =>
            q.targetLetter && !covered.has(q.targetLetter)
              ? [q.targetLetter]
              : [],
          ),
        ).size,
      }))
      .sort(
        (a, b) =>
          b.importedGain - a.importedGain ||
          b.gain - a.gain ||
          a.id.localeCompare(b.id),
      )[0];
    if (!next || !next.gain) break;
    picked.push(next.id);
    for (const q of byCategory.get(next.id) ?? [])
      if (q.targetLetter) covered.add(q.targetLetter);
  }
  return huroofAvailable(questions.filter((q) => picked.includes(q.categoryId)))
    ? picked
    : [];
};
export async function loadLocalSqliteImportQuestionSource(
  options: {
    dbPath?: string;
    fileDraftsPath?: string;
    fileApprovedPath?: string;
  } = {},
): Promise<LocalRuntimeQuestionSource> {
  const dbPath = resolve(
    options.dbPath ??
      process.env.GAME_DB_PATH ??
      `${process.env.LOCALAPPDATA ?? ""}/Temp/huroof-wa-oloof-local-game.sqlite`,
  );
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let sqlite: Row[];
  try {
    sqlite = (
      db.prepare("SELECT data FROM local_admin_drafts ORDER BY id").all() as {
        data: string;
      }[]
    ).map((x) => JSON.parse(x.data) as Row);
  } finally {
    db.close();
  }
  const files = [
    ...(await fileRows(
      options.fileDraftsPath ?? "content/questions/drafts/questions.jsonl",
    )),
    ...(await fileRows(
      options.fileApprovedPath ?? "content/questions/approved/questions.jsonl",
    )),
  ];
  const candidates = [
    ...files.map((r) => ({ row: r, source: "file" as const })),
    ...sqlite.map((r) => ({ row: r, source: "sqlite" as const })),
  ];
  const heldByReason: Record<string, number> = {};
  const hold = (reason: string) => {
    heldByReason[reason] = (heldByReason[reason] ?? 0) + 1;
  };
  const dedup = new Map<string, ImportedQuestion>();
  for (const candidate of candidates) {
    const q = normalizeRow(candidate.row, candidate.source);
    if (!q) {
      const raw =
        candidate.source === "sqlite" &&
        candidate.row.importSource &&
        typeof candidate.row.importSource === "object"
          ? (candidate.row.importSource as Row)
          : candidate.row;
      const mode = clean(
        raw.mode ?? raw.sourceMode ?? candidate.row.sourceMode,
      ).toLowerCase();
      hold(
        candidate.source === "sqlite" && clean(candidate.row.stagingState)
          ? `staging_state:${clean(candidate.row.stagingState)}`
          : candidate.source === "sqlite" &&
              !["trivia", "identity"].includes(mode)
            ? `unsupported_mode:${mode || "unknown"}`
            : "malformed_supported_record",
      );
      continue;
    }
    const key = `${q.categoryId}\0${norm(q.promptAr)}\0${norm(q.canonicalAnswer)}`;
    if (dedup.has(key)) {
      hold("duplicate_logical_question");
      continue;
    }
    dedup.set(key, q);
  }
  const questions = [...dedup.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (!questions.length)
    throw new Error("LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE");
  const recommendedHuroofCategoryIds = recommendedHuroof(questions);
  const categories = [
    ...new Map(questions.map((q) => [q.categoryId, q.headerAr])).entries(),
  ]
    .map(([id, labelAr]) => {
      const records = questions.filter((q) => q.categoryId === id),
        concepts = new Set(records.map((q) => q.answerConceptId));
      return {
        id,
        labelAr,
        sourceOnly: !files.some((r) => clean(r.categoryId) === id),
        questionCount: records.length,
        classicQuestionCount: records.length,
        huroofQuestionCount: records.filter((q) => q.targetLetter).length,
        categoryGameEligible: concepts.size >= 14,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const snapshotId = hash(
    JSON.stringify({
      source: "sqlite-import-v1",
      dbPath,
      questions: questions.map(canonical),
    }),
  );
  const inventory: LocalQuestionInventory = {
    source: "local_sqlite_import",
    snapshotId,
    bundleSha256: "t16-local-sqlite",
    boundedReadCount: sqlite.length,
    sourceCandidateCount: candidates.length,
    usableQuestionCount: questions.length,
    heldQuestionCount: Object.values(heldByReason).reduce(
      (sum, count) => sum + count,
      0,
    ),
    heldByReason,
    huroofAvailable: recommendedHuroofCategoryIds.length > 0,
    recommendedHuroofCategoryIds,
    categories,
  };
  return { snapshotId, questions, inventory };
}
