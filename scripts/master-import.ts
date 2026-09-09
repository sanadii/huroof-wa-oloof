/** Local-only reconciler for the validated T16 master bundle. */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const MASTER_INPUT_SHA256 =
  "1177eff4bb7081c2d6cbe8850fceffe365899b51048ff2c2fd77c6cb85d73e91";
export const MASTER_ZIP_SHA256 =
  "e9202fdcfd1b544f70564484eb2a2080df07a0ab8d9e06e9c51ab94c76ddc287";
export const unsupportedModes = new Set([
  "charades",
  "image",
  "puzzle",
  "image_puzzle",
  "lineup",
]);
export type Incoming = {
  id: string;
  category_id: string;
  category_title: string;
  source_package: string;
  source_record_id: string;
  mode: string;
  points: number;
  difficulty: string;
  question: string | null;
  instruction: string | null;
  answer: string;
  accepted_answers: string[];
  target_letter: string | null;
  letter_mode_eligible: boolean | null;
  letter_rule: string | null;
  media: { path: string; sha256: string } | null;
  source_content_sha256: string;
  record_type: string;
  [key: string]: unknown;
};
export type Existing = Record<string, unknown>;
export type Outcome = "inserted" | "already_present" | "staged" | "rejected";
export type LedgerEntry = {
  incomingId: string;
  storageId?: string;
  outcome: Outcome;
  reason: string;
  categoryId: string;
  sourcePackage: string;
  mode: string;
  physicalRow: boolean;
  matchedExistingId?: string;
  source?: Incoming;
  duplicateReview?: { group: number; action: string; categories: string[] };
};
export type ImportReport = {
  schemaVersion: 2;
  runKind: "dry-run" | "apply" | "check";
  runState: "planned" | "prepared";
  inputSha256: string;
  bundleZipEvidence: { sha256: string; verification: string };
  metadataEvidence: string;
  targetDb: string;
  targetManifest: string;
  inputCount: number;
  baseline: Record<string, number>;
  after: Record<string, number>;
  outcomes: Record<string, number>;
  byCategory: Record<string, Record<string, number>>;
  byPackage: Record<string, Record<string, number>>;
  media: { incoming: number; registryMatched: number };
  duplicateReview: { groups: number; records: number };
  entries: LedgerEntry[];
};
export type TargetManifest = {
  schemaVersion: 1;
  targetDb: string;
  backupManifest: string;
  backupManifestSha256: string;
  initialLocalAdminDrafts: { count: number; digest: string };
  verifiedBackupLocalAdminDrafts: { count: number; digest: string };
  questionBaseline: { draftsSha256: string; approvedSha256: string };
  createdUtc: string;
};
const sha = (v: Buffer | string) =>
  createHash("sha256").update(v).digest("hex");
const normalize = (v: unknown) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/gu, "")
    .replace(/[أإآ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
const importedSource = (r: Existing) =>
  r.importSource && typeof r.importSource === "object"
    ? (r.importSource as Record<string, unknown>)
    : undefined;
const identityKey = (s: Incoming) =>
  [
    s.id,
    s.source_package,
    s.category_id,
    s.source_record_id,
    s.source_content_sha256,
  ].join("\0");
const stagingBase = (s: Incoming) =>
  `master-import-staged:${sha(identityKey(s))}`;
const sourceIdentityMatches = (
  s: Incoming,
  p: Record<string, unknown> | undefined,
) =>
  Boolean(
    p &&
    p.id === s.id &&
    p.source_package === s.source_package &&
    p.category_id === s.category_id &&
    p.source_record_id === s.source_record_id &&
    p.source_content_sha256 === s.source_content_sha256,
  );
const promptFor = (r: Incoming | Existing) =>
  "question" in r ? (r.question ?? r.instruction ?? "") : (r.promptAr ?? "");
const answerFor = (r: Incoming | Existing) =>
  "answer" in r ? r.answer : r.canonicalAnswer;
const categoryFor = (r: Incoming | Existing) =>
  "category_id" in r ? r.category_id : r.categoryId;
const mediaHash = (v: unknown) =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Record<string, unknown>).assetSha256 === "string"
    ? String((v as Record<string, unknown>).assetSha256)
    : null;
const contentMatch = (s: Incoming, c: Existing) => {
  if (s.mode === "charades" || s.media) return false;
  if (sourceIdentityMatches(s, importedSource(c))) return true;
  return (
    String(categoryFor(c)) === s.category_id &&
    normalize(promptFor(c)) === normalize(promptFor(s)) &&
    normalize(answerFor(c)) === normalize(answerFor(s)) &&
    mediaHash(c) === null
  );
};
const counts = (entries: LedgerEntry[], key: "categoryId" | "sourcePackage") =>
  Object.fromEntries(
    [...new Set(entries.map((e) => e[key]))]
      .sort()
      .map((value) => [
        value,
        Object.fromEntries(
          [
            ...new Set(
              entries.filter((e) => e[key] === value).map((e) => e.outcome),
            ),
          ]
            .sort()
            .map((outcome) => [
              outcome,
              entries.filter((e) => e[key] === value && e.outcome === outcome)
                .length,
            ]),
        ),
      ]),
  );
export const allocateStorageIds = (
  entries: LedgerEntry[],
  incoming: Incoming[],
  existing: Existing[],
) => {
  const occupied = new Set(existing.map((r) => String(r.id)));
  return entries.map((e, i) => {
    if (
      !e.physicalRow ||
      e.outcome === "already_present" ||
      e.outcome === "rejected"
    )
      return e;
    const s = incoming[i]!;
    let id = e.storageId ?? s.id;
    if (id === s.id && occupied.has(id)) id = stagingBase(s);
    if (id.startsWith("master-import-staged:")) {
      const base = id;
      let n = 0;
      while (occupied.has(id)) id = `${base}:${++n}`;
    }
    occupied.add(id);
    return { ...e, storageId: id };
  });
};
export function classifyIncoming(
  incoming: Incoming[],
  existing: Existing[],
): LedgerEntry[] {
  const entries = incoming.map((s) => {
    const prior = existing.filter((c) => importedSource(c)?.id === s.id);
    const exact = prior.find((c) =>
      sourceIdentityMatches(s, importedSource(c)),
    );
    if (exact)
      return {
        incomingId: s.id,
        storageId: String(exact.id),
        outcome: "already_present" as const,
        reason: "prior_import_source_identity",
        categoryId: s.category_id,
        sourcePackage: s.source_package,
        mode: s.mode,
        physicalRow: true,
        matchedExistingId: String(exact.id),
      };
    if (prior.length)
      return {
        incomingId: s.id,
        storageId: stagingBase(s),
        outcome: "staged" as const,
        reason: "incoming_revision_conflicts_with_prior_import",
        categoryId: s.category_id,
        sourcePackage: s.source_package,
        mode: s.mode,
        physicalRow: true,
        matchedExistingId: String(prior[0]!.id),
      };
    const same = existing.filter((c) => String(c.id) === s.id);
    if (same.length) {
      const match = same.find((c) => contentMatch(s, c));
      if (match)
        return {
          incomingId: s.id,
          outcome: "already_present" as const,
          reason: "exact_source_identity",
          categoryId: s.category_id,
          sourcePackage: s.source_package,
          mode: s.mode,
          physicalRow: false,
          matchedExistingId: String(match.id),
        };
      return {
        incomingId: s.id,
        storageId: stagingBase(s),
        outcome: "staged" as const,
        reason: "identity_collision_preserved_existing",
        categoryId: s.category_id,
        sourcePackage: s.source_package,
        mode: s.mode,
        physicalRow: true,
        matchedExistingId: String(same[0]!.id),
      };
    }
    const match = existing.find((c) => contentMatch(s, c));
    if (match)
      return {
        incomingId: s.id,
        outcome: "already_present" as const,
        reason: "category_qualified_content_match",
        categoryId: s.category_id,
        sourcePackage: s.source_package,
        mode: s.mode,
        physicalRow: false,
        matchedExistingId: String(match.id),
      };
    if (unsupportedModes.has(s.mode))
      return {
        incomingId: s.id,
        storageId: s.id,
        outcome: "staged" as const,
        reason: `unsupported_mode:${s.mode}`,
        categoryId: s.category_id,
        sourcePackage: s.source_package,
        mode: s.mode,
        physicalRow: true,
      };
    if (!["trivia", "identity"].includes(s.mode) || !s.question || !s.answer)
      return {
        incomingId: s.id,
        outcome: "rejected" as const,
        reason: "invalid_supported_record",
        categoryId: s.category_id,
        sourcePackage: s.source_package,
        mode: s.mode,
        physicalRow: false,
      };
    return {
      incomingId: s.id,
      storageId: s.id,
      outcome: "inserted" as const,
      reason: "draft_needs_review",
      categoryId: s.category_id,
      sourcePackage: s.source_package,
      mode: s.mode,
      physicalRow: true,
    };
  });
  return allocateStorageIds(entries, incoming, existing);
}
export function toStoredRecord(
  s: Incoming,
  e: LedgerEntry,
  registry: Map<string, Record<string, unknown>>,
) {
  const binding = s.media ? registry.get(s.media.sha256) : undefined;
  if (s.media && !binding) throw new Error(`MEDIA_REGISTRY_MISMATCH:${s.id}`);
  return {
    id: e.storageId!,
    categoryId: s.category_id,
    modality: "classic",
    targetLetter: s.target_letter ?? undefined,
    answerConceptId: `master-import:${s.id}`,
    headerAr: s.category_title,
    promptAr: s.question ?? s.instruction ?? "",
    canonicalAnswer: s.answer ?? "",
    acceptedAnswers: s.accepted_answers ?? [],
    status: "draft",
    readOnly: true,
    importedAt: new Date().toISOString(),
    sourceMode: s.mode,
    stagingState: e.outcome === "staged" ? e.reason : undefined,
    letterModeEligible: s.letter_mode_eligible,
    letterRule: s.letter_rule,
    duplicateReview: e.duplicateReview,
    importSource: s,
    ...(binding
      ? {
          media: {
            mediaId: binding.mediaId,
            assetSha256: binding.assetSha256,
            altAr: binding.altAr,
          },
          importMediaAssociation: {
            sourcePath: s.media!.path,
            sourceSha256: s.media!.sha256,
            registry: binding,
          },
        }
      : {}),
  };
}
const rows = (db: DatabaseSync): Existing[] =>
  (
    db.prepare("SELECT data FROM local_admin_drafts ORDER BY id").all() as {
      data: string;
    }[]
  ).map((r) => JSON.parse(r.data) as Existing);
const snap = (r: Existing[]) => ({
  count: r.length,
  digest: sha(r.map((x) => JSON.stringify(x)).join("\n")),
});
const stats = (drafts: Existing[], approved: Existing[], db: Existing[]) => {
  const all = [...drafts, ...approved, ...db];
  return {
    stored: all.length,
    sqliteRows: db.length,
    drafts: all.filter((r) => r.status === "draft").length,
    approved: all.filter((r) => r.status === "approved").length,
    normalApprovedGameplayPool: approved.filter(
      (r) =>
        r.status === "approved" &&
        r.readOnly !== true &&
        (r.modality === undefined || r.modality === "classic"),
    ).length,
    categories: new Set(all.map((r) => String(r.categoryId))).size,
  };
};
export async function loadJsonl(path: string): Promise<Incoming[]> {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/gu)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Incoming);
}
type Backup = {
  sqlitePath: string;
  sqliteIntegrity: string;
  sqliteBackup: string;
  backupFiles: { path: string; sha256: string }[];
};
const verifyBackup = async (path: string) => {
  const m = JSON.parse(await readFile(path, "utf8")) as Backup;
  if (m.sqliteIntegrity !== "ok" || !Array.isArray(m.backupFiles))
    throw new Error("BACKUP_MANIFEST_INVALID");
  for (const f of m.backupFiles)
    if (sha(await readFile(resolve(dirname(path), f.path))) !== f.sha256)
      throw new Error(`BACKUP_FILE_HASH_MISMATCH:${f.path}`);
  return m;
};
const questionHashes = (backup: Backup) => {
  const drafts = backup.backupFiles.find((x) =>
      x.path.endsWith("content/questions/drafts/questions.jsonl"),
    )?.sha256,
    approved = backup.backupFiles.find((x) =>
      x.path.endsWith("content/questions/approved/questions.jsonl"),
    )?.sha256;
  if (!drafts || !approved) throw new Error("BACKUP_QUESTION_BASELINE_MISSING");
  return { draftsSha256: drafts, approvedSha256: approved };
};
const verifyQuestionBaseline = async (
  target: TargetManifest,
  drafts: string,
  approved: string,
) => {
  if (
    sha(await readFile(drafts)) !== target.questionBaseline.draftsSha256 ||
    sha(await readFile(approved)) !== target.questionBaseline.approvedSha256
  )
    throw new Error("QUESTION_BASELINE_HASH_MISMATCH");
};
const verifyMap = async (path: string, incoming: Incoming[]) => {
  const lines = (await readFile(path, "utf8")).trim().split(/\r?\n/gu);
  if (
    lines.shift() !==
    "id\tsource_package\tcategory_id\tsource_record_id\tsource_file\tsource_line_or_locator"
  )
    throw new Error("SOURCE_ID_MAP_SCHEMA_MISMATCH");
  const map = new Map(
    lines.map((l) => {
      const [id, source_package, category_id, source_record_id] = l.split("\t");
      return [id, { source_package, category_id, source_record_id }];
    }),
  );
  for (const s of incoming.filter((x) => x.id.startsWith("legacy-v14-"))) {
    const m = map.get(s.id);
    if (
      !m ||
      m.source_package !== s.source_package ||
      m.category_id !== s.category_id ||
      m.source_record_id !== s.source_record_id
    )
      throw new Error(`SOURCE_ID_MAP_MISMATCH:${s.id}`);
  }
};
const verifyRegistry = async (
  reg: { assets: Record<string, unknown>[] },
  incoming: Incoming[],
  root: string,
) => {
  if (
    reg.assets.length !== 240 ||
    incoming.filter((s) => s.media).length !== 240
  )
    throw new Error("MEDIA_REGISTRY_COUNT_MISMATCH");
  const by = new Map(reg.assets.map((a) => [String(a.assetSha256), a]));
  for (const s of incoming.filter((s) => s.media)) {
    const a = by.get(s.media!.sha256);
    const file = `originals/${s.media!.sha256}.png`;
    if (
      !a ||
      a.localFile !== file ||
      !s.media!.path.endsWith(String(a.sourceArchiveMember))
    )
      throw new Error(`MEDIA_REGISTRY_MISMATCH:${s.id}`);
    if (sha(await readFile(resolve(root, file))) !== s.media!.sha256)
      throw new Error(`MEDIA_BINARY_HASH_MISMATCH:${s.id}`);
  }
};
export async function bindImportTarget(o: {
  dbPath: string;
  backupManifestPath: string;
  targetManifestPath: string;
  fileDraftsPath?: string;
  fileApprovedPath?: string;
}): Promise<TargetManifest> {
  const targetDb = resolve(o.dbPath),
    backupManifest = resolve(o.backupManifestPath),
    backup = await verifyBackup(backupManifest),
    questionBaseline = questionHashes(backup);
  if (
    backup.backupFiles.some(
      (f) => resolve(dirname(backupManifest), f.path) === targetDb,
    )
  )
    throw new Error("BACKUP_ARTIFACT_CANNOT_BE_IMPORT_TARGET");
  if (resolve(backup.sqlitePath) !== targetDb)
    throw new Error("TARGET_NOT_CANONICAL_BACKUP_TARGET");
  const drafts = o.fileDraftsPath ?? "content/questions/drafts/questions.jsonl",
    approved =
      o.fileApprovedPath ?? "content/questions/approved/questions.jsonl";
  if (
    sha(await readFile(drafts)) !== questionBaseline.draftsSha256 ||
    sha(await readFile(approved)) !== questionBaseline.approvedSha256
  )
    throw new Error("QUESTION_BASELINE_HASH_MISMATCH");
  const backupDb = new DatabaseSync(
    resolve(dirname(backupManifest), backup.sqliteBackup),
    { readOnly: true },
  );
  let verifiedBackupLocalAdminDrafts: { count: number; digest: string };
  try {
    verifiedBackupLocalAdminDrafts = snap(rows(backupDb));
  } finally {
    backupDb.close();
  }
  const db = new DatabaseSync(targetDb, { readOnly: true });
  try {
    const initialLocalAdminDrafts = snap(rows(db));
    if (
      JSON.stringify(initialLocalAdminDrafts) !==
      JSON.stringify(verifiedBackupLocalAdminDrafts)
    )
      throw new Error("TARGET_LOCAL_DRAFTS_DO_NOT_MATCH_BACKUP");
    const m: TargetManifest = {
      schemaVersion: 1,
      targetDb,
      backupManifest,
      backupManifestSha256: sha(await readFile(backupManifest)),
      initialLocalAdminDrafts,
      verifiedBackupLocalAdminDrafts,
      questionBaseline,
      createdUtc: new Date().toISOString(),
    };
    await writeFile(
      resolve(o.targetManifestPath),
      `${JSON.stringify(m, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return m;
  } finally {
    db.close();
  }
}
const loadTarget = async (path: string, dbPath: string) => {
  const t = JSON.parse(await readFile(path, "utf8")) as TargetManifest;
  if (t.schemaVersion !== 1 || resolve(t.targetDb) !== resolve(dbPath))
    throw new Error("TARGET_MANIFEST_DB_MISMATCH");
  const backup = await verifyBackup(t.backupManifest);
  if (sha(await readFile(t.backupManifest)) !== t.backupManifestSha256)
    throw new Error("TARGET_MANIFEST_BACKUP_MISMATCH");
  if (resolve(backup.sqlitePath) !== resolve(dbPath))
    throw new Error("TARGET_NOT_CANONICAL_BACKUP_TARGET");
  if (
    backup.backupFiles.some(
      (f) => resolve(dirname(t.backupManifest), f.path) === resolve(dbPath),
    )
  )
    throw new Error("BACKUP_ARTIFACT_CANNOT_BE_IMPORT_TARGET");
  const backupDb = new DatabaseSync(
    resolve(dirname(t.backupManifest), backup.sqliteBackup),
    { readOnly: true },
  );
  try {
    if (
      JSON.stringify(snap(rows(backupDb))) !==
        JSON.stringify(t.verifiedBackupLocalAdminDrafts) ||
      JSON.stringify(t.initialLocalAdminDrafts) !==
        JSON.stringify(t.verifiedBackupLocalAdminDrafts)
    )
      throw new Error("TARGET_MANIFEST_BACKUP_SNAPSHOT_MISMATCH");
  } finally {
    backupDb.close();
  }
  return t;
};
const guard = (r: Existing[], t: TargetManifest, expected: Set<string>) => {
  const imported = r.filter((x) => Boolean(importedSource(x))),
    ordinary = r.filter((x) => !importedSource(x));
  if (!imported.length) {
    if (
      JSON.stringify(snap(ordinary)) !==
      JSON.stringify(t.initialLocalAdminDrafts)
    )
      throw new Error("TARGET_LOCAL_DRAFT_BASELINE_CHANGED");
    return;
  }
  const present = new Set<string>();
  for (const row of imported) {
    const s = importedSource(row);
    const key = s
      ? [
          s.id,
          s.source_package,
          s.category_id,
          s.source_record_id,
          s.source_content_sha256,
        ].join("\0")
      : "";
    if (!s || !expected.has(key) || present.has(key))
      throw new Error("TARGET_IMPORT_PARTIAL_OR_FOREIGN_STATE");
    present.add(key);
  }
  if (present.size !== expected.size)
    throw new Error("TARGET_IMPORT_PARTIAL_OR_FOREIGN_STATE");
  if (
    JSON.stringify(snap(ordinary)) !== JSON.stringify(t.initialLocalAdminDrafts)
  )
    throw new Error("TARGET_LOCAL_DRAFT_BASELINE_CHANGED");
};
const totals = (entries: LedgerEntry[]) =>
  Object.fromEntries(
    [...new Set(entries.map((e) => e.outcome))]
      .sort()
      .map((o) => [o, entries.filter((e) => e.outcome === o).length]),
  );
const report = (
  kind: ImportReport["runKind"],
  targetPath: string,
  dbPath: string,
  input: Incoming[],
  drafts: Existing[],
  approved: Existing[],
  db: Existing[],
  entries: LedgerEntry[],
  dupes: { ids: string[] }[],
): ImportReport => ({
  schemaVersion: 2,
  runKind: kind,
  runState: kind === "apply" ? "prepared" : "planned",
  inputSha256: MASTER_INPUT_SHA256,
  bundleZipEvidence: {
    sha256: MASTER_ZIP_SHA256,
    verification:
      "Previously validated bundle evidence; this CLI does not rehash the ZIP.",
  },
  metadataEvidence:
    "SOURCE_ID_MAP and DUPLICATE_REVIEW are structurally validated here; immutable metadata hashes are prior bundle evidence.",
  targetDb: resolve(dbPath),
  targetManifest: resolve(targetPath),
  inputCount: input.length,
  baseline: stats(drafts, approved, db),
  after: stats(drafts, approved, db),
  outcomes: totals(entries),
  byCategory: counts(entries, "categoryId"),
  byPackage: counts(entries, "sourcePackage"),
  media: {
    incoming: input.filter((x) => x.media).length,
    registryMatched: input.filter((x) => x.media).length,
  },
  duplicateReview: {
    groups: dupes.length,
    records: entries.filter((e) => e.duplicateReview).length,
  },
  entries,
});
export async function createImportReport(o: {
  dbPath: string;
  inputPath: string;
  fileDraftsPath: string;
  fileApprovedPath?: string;
  registryPath: string;
  sourceIdMapPath?: string;
  duplicateReviewPath?: string;
  targetManifestPath?: string;
  apply?: boolean;
  runKind?: ImportReport["runKind"];
  reportPath?: string;
  failAfter?: number;
}): Promise<ImportReport> {
  const bytes = await readFile(o.inputPath);
  if (sha(bytes) !== MASTER_INPUT_SHA256)
    throw new Error("MASTER_INPUT_HASH_MISMATCH");
  const input = bytes
    .toString()
    .split(/\r?\n/gu)
    .filter(Boolean)
    .map((x) => JSON.parse(x) as Incoming);
  if (input.length !== 6540 || new Set(input.map((x) => x.id)).size !== 6540)
    throw new Error("MASTER_INPUT_COUNT_MISMATCH");
  await verifyMap(
    o.sourceIdMapPath ?? resolve(dirname(o.inputPath), "SOURCE_ID_MAP.tsv"),
    input,
  );
  const draftsPath = o.fileDraftsPath,
    approvedPath =
      o.fileApprovedPath ?? "content/questions/approved/questions.jsonl";
  const drafts = (await loadJsonl(draftsPath)) as unknown as Existing[],
    approved = (await loadJsonl(approvedPath)) as unknown as Existing[];
  const dupes = JSON.parse(
    await readFile(
      o.duplicateReviewPath ??
        resolve(dirname(o.inputPath), "..", "qa", "DUPLICATE_REVIEW.json"),
      "utf8",
    ),
  ) as { ids: string[]; action: string; categories: string[] }[];
  if (
    !Array.isArray(dupes) ||
    dupes.length !== 100 ||
    dupes.reduce((n, x) => n + x.ids.length, 0) !== 200
  )
    throw new Error("DUPLICATE_REVIEW_INVALID");
  const byId = new Map(
    dupes.flatMap((x, g) =>
      x.ids.map(
        (id) =>
          [
            id,
            { group: g + 1, action: x.action, categories: x.categories },
          ] as const,
      ),
    ),
  );
  const reg = JSON.parse(await readFile(o.registryPath, "utf8")) as {
    assets: Record<string, unknown>[];
  };
  await verifyRegistry(reg, input, dirname(o.registryPath));
  const registry = new Map(reg.assets.map((x) => [String(x.assetSha256), x]));
  if (!o.targetManifestPath) throw new Error("TARGET_MANIFEST_REQUIRED");
  const target = await loadTarget(o.targetManifestPath, o.dbPath);
  await verifyQuestionBaseline(target, draftsPath, approvedPath);
  const writable = o.apply === true,
    db = new DatabaseSync(resolve(o.dbPath), { readOnly: !writable });
  try {
    const decide = (before: Existing[], kind: ImportReport["runKind"]) => {
      const ordinary = before.filter((row) => !importedSource(row));
      const expectedEntries = classifyIncoming(input, [
        ...drafts,
        ...approved,
        ...ordinary,
      ]);
      guard(
        before,
        target,
        new Set(
          expectedEntries.flatMap((entry, index) =>
            entry.physicalRow ? [identityKey(input[index]!)] : [],
          ),
        ),
      );
      const entries = classifyIncoming(input, [
        ...drafts,
        ...approved,
        ...before,
      ]).map((e, i) => ({
        ...e,
        source: input[i],
        ...(byId.has(e.incomingId)
          ? { duplicateReview: byId.get(e.incomingId) }
          : {}),
      }));
      if (
        entries.length !== 6540 ||
        new Set(entries.map((e) => e.incomingId)).size !== 6540
      )
        throw new Error("LEDGER_NOT_ONE_TO_ONE");
      return {
        entries,
        value: report(
          kind,
          o.targetManifestPath!,
          o.dbPath,
          input,
          drafts,
          approved,
          before,
          entries,
          dupes,
        ),
      };
    };
    if (!writable) {
      const before = rows(db),
        result = decide(before, o.runKind ?? "dry-run");
      result.value.after = stats(drafts, approved, before);
      return result.value;
    }
    if (!o.reportPath) throw new Error("RUN_LEDGER_PATH_REQUIRED");
    db.exec("BEGIN IMMEDIATE");
    try {
      const before = rows(db),
        result = decide(before, o.runKind ?? "apply");
      await writeFile(
        resolve(o.reportPath),
        `${JSON.stringify(result.value, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      const ins = db.prepare(
        "INSERT INTO local_admin_drafts(id,data,updated_at) VALUES (?,?,?)",
      );
      let n = 0;
      for (const e of result.entries.filter(
        (x) =>
          x.physicalRow && (x.outcome === "inserted" || x.outcome === "staged"),
      )) {
        if (o.failAfter !== undefined && n === o.failAfter)
          throw new Error("INJECTED_PARTIAL_FAILURE");
        const s = input.find((x) => x.id === e.incomingId)!;
        ins.run(
          e.storageId!,
          JSON.stringify(toStoredRecord(s, e, registry)),
          new Date().toISOString(),
        );
        n++;
      }
      db.exec("COMMIT");
      result.value.after = stats(drafts, approved, rows(db));
      await writeFile(
        `${resolve(o.reportPath)}.completion.json`,
        `${JSON.stringify({ schemaVersion: 1, state: "committed", reportPath: resolve(o.reportPath), completedUtc: new Date().toISOString(), after: result.value.after }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      return result.value;
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* prepared ledger supports receipt recovery if commit succeeded */
      }
      throw e;
    }
  } finally {
    db.close();
  }
}
export async function recoverImportReceipt(o: {
  dbPath: string;
  targetManifestPath: string;
  reportPath: string;
}) {
  const r = JSON.parse(await readFile(o.reportPath, "utf8")) as ImportReport;
  if (
    r.runKind !== "apply" ||
    r.runState !== "prepared" ||
    resolve(r.targetDb) !== resolve(o.dbPath) ||
    resolve(r.targetManifest) !== resolve(o.targetManifestPath)
  )
    throw new Error("IMPORT_RECOVERY_TARGET_MISMATCH");
  const checked = await createImportReport({
    dbPath: o.dbPath,
    targetManifestPath: o.targetManifestPath,
    inputPath:
      "output/master-import-20260909/bundle/huroof_master_all_saved/import/questions.jsonl",
    fileDraftsPath: "content/questions/drafts/questions.jsonl",
    registryPath: "content/question-media/v18-private-240/manifest.json",
    runKind: "check",
  });
  if (
    checked.outcomes.already_present !== 6540 ||
    r.entries.length !== checked.entries.length ||
    r.entries.some((entry, index) => {
      const current = checked.entries[index];
      return (
        !current ||
        entry.incomingId !== current.incomingId ||
        entry.storageId !== current.storageId ||
        !entry.source ||
        !current.source ||
        identityKey(entry.source) !== identityKey(current.source)
      );
    })
  )
    throw new Error("IMPORT_RECOVERY_STATE_NOT_IDEMPOTENT");
  await writeFile(
    `${resolve(o.reportPath)}.completion.json`,
    `${JSON.stringify({ schemaVersion: 1, state: "committed-recovered", reportPath: resolve(o.reportPath), completedUtc: new Date().toISOString(), after: checked.after }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return checked;
}
async function main() {
  const [command, ...args] = process.argv.slice(2),
    value = (f: string) => {
      const i = args.indexOf(f);
      return i < 0 ? undefined : args[i + 1];
    },
    dbPath = value("--db"),
    targetManifestPath = value("--target-manifest");
  if (command === "bind-target") {
    if (!dbPath || !targetManifestPath)
      throw new Error(
        "Usage: master-import bind-target --db <sqlite> --target-manifest <json>",
      );
    process.stdout.write(
      `${JSON.stringify(await bindImportTarget({ dbPath, targetManifestPath, backupManifestPath: value("--backup-manifest") ?? "output/master-import-20260909/baseline-backup-manifest.json" }), null, 2)}\n`,
    );
    return;
  }
  if (command === "recover") {
    if (!dbPath || !targetManifestPath || !value("--report"))
      throw new Error(
        "Usage: master-import recover --db <sqlite> --target-manifest <json> --report <prepared-ledger>",
      );
    await recoverImportReceipt({
      dbPath,
      targetManifestPath,
      reportPath: value("--report")!,
    });
    return;
  }
  if (
    !["dry-run", "apply", "check"].includes(command ?? "") ||
    !dbPath ||
    !targetManifestPath
  )
    throw new Error(
      "Usage: master-import <dry-run|apply|check> --db <sqlite> --target-manifest <json>",
    );
  const reportPath = value("--report");
  if (command === "apply" && !reportPath)
    throw new Error("RUN_LEDGER_PATH_REQUIRED");
  const r = await createImportReport({
    dbPath,
    targetManifestPath,
    inputPath:
      value("--input") ??
      "output/master-import-20260909/bundle/huroof_master_all_saved/import/questions.jsonl",
    fileDraftsPath:
      value("--file-drafts") ?? "content/questions/drafts/questions.jsonl",
    fileApprovedPath:
      value("--file-approved") ?? "content/questions/approved/questions.jsonl",
    registryPath:
      value("--registry") ??
      "content/question-media/v18-private-240/manifest.json",
    sourceIdMapPath: value("--source-id-map"),
    reportPath,
    apply: command === "apply",
    runKind: command as ImportReport["runKind"],
    ...(value("--fail-after")
      ? { failAfter: Number(value("--fail-after")) }
      : {}),
  });
  if (reportPath && command !== "apply")
    await writeFile(resolve(reportPath), `${JSON.stringify(r, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  process.stdout.write(
    `${JSON.stringify({ command, inputCount: r.inputCount, outcomes: r.outcomes, baseline: r.baseline, after: r.after, media: r.media, duplicateReview: r.duplicateReview, report: reportPath }, null, 2)}\n`,
  );
}
if (process.argv[1] && process.argv[1].endsWith("master-import.ts"))
  void main();
