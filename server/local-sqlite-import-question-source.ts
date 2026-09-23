/** Read-only runtime projection for the local T16 SQLite intake test source. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { relative, resolve } from "node:path";
import { createMatchQuestionSelection } from "../src/features/game/runtime/question-selector.js";
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
type CategoryIdentity = { id: string; labelAr: string };
type MediaBinding = { mediaId: string; assetSha256: string; altAr: string; type: "image" | "video"; contentType: string };
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
const goalMedia = (row: Row): { media?: MediaBinding; answerMedia?: MediaBinding } | undefined => {
  if (row.modality !== "video" || !row.media || typeof row.media !== "object") return undefined;
  const value = row.media as Record<string, unknown>;
  const bind = (id: unknown, sha: unknown): MediaBinding | undefined =>
    typeof id === "string" && /^goal-quiz-2026:\d{3}:(blur|clean)$/u.test(id) && typeof sha === "string" && /^[a-f0-9]{64}$/u.test(sha)
      ? { mediaId: id, assetSha256: sha, altAr: "مقطع السؤال", type: "video", contentType: "video/mp4" }
      : undefined;
  const media = bind(value.promptMediaId, value.promptSha256), answerMedia = bind(value.answerMediaId, value.answerSha256);
  return media && answerMedia ? { media, answerMedia } : undefined;
};
const imageMedia = (row: Row, verified: Map<string, MediaBinding>): { media?: MediaBinding } | undefined => {
  if (row.modality === "video" || !row.media || typeof row.media !== "object") return undefined;
  const value = row.media as Record<string, unknown>;
  if (typeof value.mediaId !== "string" || typeof value.assetSha256 !== "string") return undefined;
  const binding = verified.get(`${value.mediaId}\0${value.assetSha256}`);
  return binding ? { media: binding } : undefined;
};
const verifiedImageMedia = async (): Promise<Map<string, MediaBinding>> => {
  const packages = [
    { directory: "v18-private-240", manifest: "manifest.json", localFile: /^originals\/[a-f0-9]{64}\.png$/u, contentType: "image/png" },
    { directory: "guess-picture-rebuild-v2", manifest: "manifest.json", localFile: /^images\/\d{3}-\d{3}\.jpg$/u, contentType: "image/jpeg" },
  ] as const;
  const bindings = new Map<string, MediaBinding>();
  for (const item of packages) {
    const root = resolve(process.cwd(), "content", "question-media", item.directory);
    const manifest = JSON.parse(await readFile(resolve(root, item.manifest), "utf8")) as { assets?: unknown[] };
    for (const raw of manifest.assets ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const asset = raw as Record<string, unknown>;
      if (typeof asset.mediaId !== "string" || typeof asset.assetSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.assetSha256) || typeof asset.localFile !== "string" || !item.localFile.test(asset.localFile)) continue;
      const path = resolve(root, asset.localFile);
      if (relative(root, path).startsWith("..")) continue;
      try {
        const bytes = await readFile(path);
        if (createHash("sha256").update(bytes).digest("hex") !== asset.assetSha256) continue;
      } catch { continue; }
      const binding: MediaBinding = { mediaId: asset.mediaId, assetSha256: asset.assetSha256, altAr: typeof asset.altAr === "string" ? asset.altAr : "صورة السؤال", type: "image", contentType: item.contentType };
      bindings.set(`${binding.mediaId}\0${binding.assetSha256}`, binding);
    }
  }
  return bindings;
};
const sourceRow = (row: Row, source: "sqlite" | "file") =>
  source === "sqlite" && row.importSource && typeof row.importSource === "object"
    ? (row.importSource as Row)
    : row;
const categoryIdentity = (
  row: Row,
  source: "sqlite" | "file",
): CategoryIdentity | undefined => {
  const raw = sourceRow(row, source);
  const id = clean(raw.category_id ?? row.categoryId);
  const labelAr = clean(raw.category_title ?? row.headerAr);
  return id && labelAr ? { id, labelAr } : undefined;
};
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
  verifiedImages: Map<string, MediaBinding>,
): ImportedQuestion | undefined => {
  const raw =
    sourceRow(row, source);
  const mode = clean(
    raw.mode ?? raw.sourceMode ?? row.sourceMode,
  ).toLowerCase();
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
  const videoMedia = goalMedia(row);
  const media = videoMedia ?? imageMedia(row, verifiedImages);
  if (source === "sqlite" && !["trivia", "identity"].includes(mode) && !media)
    return undefined;
  if (source === "sqlite" && clean(row.stagingState) && !((row.stagingState === "unsupported_mode:video" && videoMedia) || (clean(row.stagingState).startsWith("unsupported_mode:") && media?.media))) return undefined;
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
    modality: videoMedia ? "video" : media?.media ? "image" : "classic",
    ...(targetLetter ? { targetLetter } : {}),
    answerConceptId: hash(norm(canonicalAnswer)),
    headerAr,
    promptAr,
    canonicalAnswer,
    acceptedAnswers,
    difficulty: clean(raw.difficulty ?? row.difficulty) || "unspecified",
    status: "draft_test_import",
    sourceContentHash,
    ...(media ?? {}),
  };
};
const huroofAvailable = (questions: ImportedQuestion[]) => {
  const categories = [...new Set(questions.map((question) => question.categoryId))];
  try {
    createMatchQuestionSelection(questions, { categories, modality: "classic", seed: 1 });
    return true;
  } catch {
    return false;
  }
};
const recommendedHuroof = (questions: ImportedQuestion[]) => {
  const byCategory = new Map<string, ImportedQuestion[]>();
  for (const q of questions)
    byCategory.set(q.categoryId, [...(byCategory.get(q.categoryId) ?? []), q]);
  const picked: string[] = [];
  const score = (ids: string[]) => {
    const concepts = new Map<string, Set<string>>();
    for (const question of questions)
      if (ids.includes(question.categoryId) && question.modality === "classic" && question.targetLetter)
        concepts.set(question.targetLetter, new Set([...(concepts.get(question.targetLetter) ?? []), question.answerConceptId]));
    return [...concepts.values()].reduce((total, values) => total + Math.min(values.size, 3), 0);
  };
  while (picked.length < 10) {
    const next = [...byCategory.entries()]
      .filter(([id]) => !picked.includes(id))
      .map(([id, items]) => ({
        id,
        importedGain: items.filter((q) => q.modality === "classic" && q.id.startsWith("sqlite:") && q.targetLetter).length,
        gain: score([...picked, id]),
      }))
        .sort(
          (a, b) =>
          b.gain - a.gain ||
          b.importedGain - a.importedGain ||
          a.id.localeCompare(b.id),
      )[0];
    if (!next || !next.gain) break;
    picked.push(next.id);
    if (huroofAvailable(questions.filter((q) => picked.includes(q.categoryId))))
      return picked;
  }
  return [];
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
  const verifiedImages = await verifiedImageMedia();
  const heldByReason: Record<string, number> = {};
  const heldByCategory = new Map<string, number>();
  const categoryIdentities = new Map<string, CategoryIdentity>();
  for (const candidate of candidates) {
    const identity = categoryIdentity(candidate.row, candidate.source);
    if (identity && !categoryIdentities.has(identity.id))
      categoryIdentities.set(identity.id, identity);
  }
  const hold = (reason: string) => {
    heldByReason[reason] = (heldByReason[reason] ?? 0) + 1;
  };
  const dedup = new Map<string, ImportedQuestion>();
  for (const candidate of candidates) {
    const q = normalizeRow(candidate.row, candidate.source, verifiedImages);
    if (!q) {
      const raw = sourceRow(candidate.row, candidate.source);
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
      const identity = categoryIdentity(candidate.row, candidate.source);
      if (identity)
        heldByCategory.set(
          identity.id,
          (heldByCategory.get(identity.id) ?? 0) + 1,
        );
      continue;
    }
    // Immutable image/video occurrences remain distinct even when their text
    // answer repeats; collapsing them would silently discard verified assets.
    const key = (q.modality === "video" || q.modality === "image")
      ? q.id
      : `${q.categoryId}\0${norm(q.promptAr)}\0${norm(q.canonicalAnswer)}`;
    if (dedup.has(key)) {
      hold("duplicate_logical_question");
      heldByCategory.set(
        q.categoryId,
        (heldByCategory.get(q.categoryId) ?? 0) + 1,
      );
      continue;
    }
    dedup.set(key, q);
  }
  const questions = [...dedup.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const recommendedHuroofCategoryIds = recommendedHuroof(questions);
  const categories: LocalQuestionInventory["categories"] = [...categoryIdentities.keys()]
    .map((id) => {
      const records = questions.filter((q) => q.categoryId === id),
        concepts = new Set(records.map((q) => q.answerConceptId));
      const categoryGameEligible = concepts.size >= 14;
      const heldQuestionCount = heldByCategory.get(id) ?? 0;
      return {
        id,
        labelAr: records[0]?.headerAr ?? categoryIdentities.get(id)!.labelAr,
        sourceOnly: !files.some((r) => clean(r.categoryId) === id),
        questionCount: records.length,
        heldQuestionCount,
        classicQuestionCount: records.length,
        huroofQuestionCount: records.filter(
          (q) => q.modality === "classic" && q.targetLetter,
        ).length,
        categoryGameEligible,
        availability:
          records.length === 0
            ? ("held_only" as const)
            : categoryGameEligible
              ? ("ready" as const)
              : ("insufficient_questions" as const),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const snapshotId = hash(
    JSON.stringify({
      source: "sqlite-import-v1",
      dbPath,
      questions: questions.map(canonical),
      categories,
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
