import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  allocateStorageIds,
  bindImportTarget,
  classifyIncoming,
  createImportReport,
  recoverImportReceipt,
  type Incoming,
} from "../scripts/master-import.js";

const root = process.cwd(),
  input = join(
    root,
    "output/master-import-20260909/bundle/huroof_master_all_saved/import/questions.jsonl",
  ),
  sourceDrafts = join(root, "content/questions/drafts/questions.jsonl"),
  sourceApproved = join(root, "content/questions/approved/questions.jsonl"),
  registry = join(root, "content/question-media/v18-private-240/manifest.json"),
  baseline = join(
    root,
    "output/master-import-20260909/backup-before/local-game.sqlite",
  );
const hash = (s: Buffer | string) =>
  createHash("sha256").update(s).digest("hex");
async function disposable() {
  const dir = await mkdtemp(join(tmpdir(), "huroof-master-import-")),
    backup = join(dir, "backup"),
    content = join(backup, "content/questions");
  await mkdir(join(content, "drafts"), { recursive: true });
  await mkdir(join(content, "approved"), { recursive: true });
  await cp(baseline, join(backup, "local.sqlite"));
  await cp(sourceDrafts, join(content, "drafts/questions.jsonl"));
  await cp(sourceApproved, join(content, "approved/questions.jsonl"));
  const db = join(dir, "target.sqlite");
  await cp(join(backup, "local.sqlite"), db);
  const manifest = join(dir, "backup-manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      sqliteIntegrity: "ok",
      sqlitePath: db,
      sqliteBackup: "backup/local.sqlite",
      backupFiles: [
        {
          path: "backup/local.sqlite",
          sha256: hash(
            await (
              await import("node:fs/promises")
            ).readFile(join(backup, "local.sqlite")),
          ),
        },
        {
          path: "backup/content/questions/drafts/questions.jsonl",
          sha256: hash(
            await (
              await import("node:fs/promises")
            ).readFile(join(content, "drafts/questions.jsonl")),
          ),
        },
        {
          path: "backup/content/questions/approved/questions.jsonl",
          sha256: hash(
            await (
              await import("node:fs/promises")
            ).readFile(join(content, "approved/questions.jsonl")),
          ),
        },
      ],
    }),
  );
  const target = join(dir, "target-manifest.json");
  await bindImportTarget({
    dbPath: db,
    backupManifestPath: manifest,
    targetManifestPath: target,
    fileDraftsPath: join(content, "drafts/questions.jsonl"),
    fileApprovedPath: join(content, "approved/questions.jsonl"),
  });
  return {
    dir,
    db,
    target,
    manifest,
    drafts: join(content, "drafts/questions.jsonl"),
    approved: join(content, "approved/questions.jsonl"),
  };
}
const opts = (
  x: Awaited<ReturnType<typeof disposable>>,
  extra: Record<string, unknown> = {},
) => ({
  dbPath: x.db,
  targetManifestPath: x.target,
  inputPath: input,
  fileDraftsPath: x.drafts,
  fileApprovedPath: x.approved,
  registryPath: registry,
  ...extra,
});

test("dry run is read-only and proves all source outcomes including seven exact matches", async () => {
  const x = await disposable();
  try {
    const report = await createImportReport(opts(x));
    assert.deepEqual(report.outcomes, {
      already_present: 7,
      inserted: 5933,
      staged: 600,
    });
    assert.equal(report.entries.filter((e) => e.physicalRow).length, 6533);
    assert.equal(report.media.registryMatched, 240);
    assert.equal(report.after.normalApprovedGameplayPool, 0);
    const db = new DatabaseSync(x.db, { readOnly: true });
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM local_admin_drafts").get() as {
          count: number;
        }
      ).count,
      0,
    );
    db.close();
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
test("target binding rejects wrong and backup targets and detects changed draft baseline", async () => {
  const x = await disposable();
  try {
    await assert.rejects(
      () =>
        bindImportTarget({
          dbPath: join(x.dir, "backup/local.sqlite"),
          backupManifestPath: x.manifest,
          targetManifestPath: join(x.dir, "bad.json"),
          fileDraftsPath: x.drafts,
          fileApprovedPath: x.approved,
        }),
      /BACKUP_ARTIFACT_CANNOT_BE_IMPORT_TARGET/,
    );
    const other = join(x.dir, "other.sqlite");
    await cp(x.db, other);
    await assert.rejects(
      () => createImportReport({ ...opts(x), dbPath: other }),
      /TARGET_MANIFEST_DB_MISMATCH/,
    );
    await assert.rejects(
      () =>
        bindImportTarget({
          dbPath: other,
          backupManifestPath: x.manifest,
          targetManifestPath: join(x.dir, "other-target.json"),
          fileDraftsPath: x.drafts,
          fileApprovedPath: x.approved,
        }),
      /TARGET_NOT_CANONICAL_BACKUP_TARGET/,
    );
    const alteredDrafts = join(x.dir, "altered-drafts.jsonl");
    await writeFile(alteredDrafts, "changed");
    await assert.rejects(
      () =>
        bindImportTarget({
          dbPath: x.db,
          backupManifestPath: x.manifest,
          targetManifestPath: join(x.dir, "question-mismatch.json"),
          fileDraftsPath: alteredDrafts,
          fileApprovedPath: x.approved,
        }),
      /QUESTION_BASELINE_HASH_MISMATCH/,
    );
    const db = new DatabaseSync(x.db);
    db.prepare(
      "INSERT INTO local_admin_drafts(id,data,updated_at) VALUES (?,?,?)",
    ).run(
      "edit",
      JSON.stringify({ id: "edit", status: "draft" }),
      new Date().toISOString(),
    );
    db.close();
    await assert.rejects(
      () => createImportReport(opts(x)),
      /TARGET_LOCAL_DRAFT_BASELINE_CHANGED/,
    );
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
test("apply has prepared audit before transaction, rolls back failures, and reruns idempotently", async () => {
  const x = await disposable();
  try {
    const failedLedger = join(x.dir, "failed.json");
    await assert.rejects(
      () =>
        createImportReport(
          opts(x, { apply: true, reportPath: failedLedger, failAfter: 3 }),
        ),
      /INJECTED_PARTIAL_FAILURE/,
    );
    const db = new DatabaseSync(x.db, { readOnly: true });
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM local_admin_drafts").get() as {
          count: number;
        }
      ).count,
      0,
    );
    db.close();
    const first = await createImportReport(
      opts(x, { apply: true, reportPath: join(x.dir, "first.json") }),
    );
    assert.equal(first.after.sqliteRows, 6533);
    const rerun = await createImportReport(
      opts(x, { apply: true, reportPath: join(x.dir, "second.json") }),
    );
    assert.deepEqual(rerun.outcomes, { already_present: 6540 });
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
test("staging derives all provenance fields and resolves a preoccupied staging id", () => {
  const base = {
    id: "source-1",
    category_id: "cat-a",
    category_title: "فئة",
    source_package: "v16",
    source_record_id: "001",
    mode: "trivia",
    points: 200,
    difficulty: "easy",
    question: "سؤال",
    instruction: null,
    answer: "جواب",
    accepted_answers: ["جواب"],
    target_letter: null,
    letter_mode_eligible: false,
    letter_rule: null,
    media: null,
    source_content_sha256: "d".repeat(64),
    record_type: "question",
  } as Incoming;
  const old = {
    id: "source-1",
    importSource: { ...base, source_content_sha256: "e".repeat(64) },
  };
  const [first] = classifyIncoming([base], [old]);
  const changed = { ...base, category_id: "cat-b" };
  const [second] = classifyIncoming([changed], [old]);
  assert.notEqual(first.storageId, second.storageId);
  const occupied = [{ id: first.storageId! }];
  const [allocated] = allocateStorageIds(
    [{ ...first, storageId: first.storageId }],
    [base],
    occupied,
  );
  assert.match(allocated.storageId!, /:1$/);
});
test("an unavailable durable ledger destination rolls back before any import write", async () => {
  const x = await disposable();
  try {
    await assert.rejects(() =>
      createImportReport(opts(x, { apply: true, reportPath: x.dir })),
    );
    const db = new DatabaseSync(x.db, { readOnly: true });
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM local_admin_drafts").get() as {
          count: number;
        }
      ).count,
      0,
    );
    db.close();
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});

test("a partial imported state is rejected instead of being silently resumed", async () => {
  const x = await disposable();
  try {
    const source = JSON.parse(
      (await (await import("node:fs/promises")).readFile(input, "utf8")).split(
        /\r?\n/,
      )[0]!,
    ) as Incoming;
    const db = new DatabaseSync(x.db);
    db.prepare(
      "INSERT INTO local_admin_drafts(id,data,updated_at) VALUES (?,?,?)",
    ).run(
      "partial",
      JSON.stringify({ id: "partial", readOnly: true, importSource: source }),
      new Date().toISOString(),
    );
    db.close();
    await assert.rejects(
      () => createImportReport(opts(x)),
      /TARGET_IMPORT_PARTIAL_OR_FOREIGN_STATE/,
    );
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});

test("receipt recovery refuses a prepared ledger for another target and certifies only its bound target", async () => {
  const x = await disposable();
  try {
    const ledger = join(x.dir, "recovery.json");
    await createImportReport(opts(x, { apply: true, reportPath: ledger }));
    await rm(`${ledger}.completion.json`);
    const other = join(x.dir, "other.sqlite");
    await cp(x.db, other);
    await assert.rejects(
      () =>
        recoverImportReceipt({
          dbPath: other,
          targetManifestPath: x.target,
          reportPath: ledger,
        }),
      /IMPORT_RECOVERY_TARGET_MISMATCH/,
    );
    const recovered = await recoverImportReceipt({
      dbPath: x.db,
      targetManifestPath: x.target,
      reportPath: ledger,
    });
    assert.equal(recovered.outcomes.already_present, 6540);
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
