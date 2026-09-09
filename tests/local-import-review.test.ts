import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindImportTarget,
  createImportReport,
} from "../scripts/master-import.js";
import {
  isTrustedImportReviewRequest,
  loadImportLedger,
  localImportReviewDetail,
  localImportReviewPage,
  readLocalImportReviewMedia,
} from "../server/local-import-review.js";
import { AuthoritativeGameService } from "../server/service.js";
const root = process.cwd(),
  input = join(
    root,
    "output/master-import-20260909/bundle/huroof_master_all_saved/import/questions.jsonl",
  ),
  baseline = join(
    root,
    "output/master-import-20260909/backup-before/local-game.sqlite",
  ),
  drafts = join(root, "content/questions/drafts/questions.jsonl"),
  approved = join(root, "content/questions/approved/questions.jsonl"),
  registry = join(root, "content/question-media/v18-private-240/manifest.json");
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
async function applied() {
  const dir = await mkdtemp(join(tmpdir(), "huroof-review-")),
    backup = join(dir, "backup"),
    db = join(dir, "target.sqlite"),
    target = join(dir, "target.json"),
    ledger = join(dir, "apply.json");
  await mkdir(join(backup, "content/questions/drafts"), { recursive: true });
  await mkdir(join(backup, "content/questions/approved"), { recursive: true });
  await cp(baseline, join(backup, "local.sqlite"));
  await cp(join(backup, "local.sqlite"), db);
  const localDrafts = join(backup, "content/questions/drafts/questions.jsonl"),
    localApproved = join(backup, "content/questions/approved/questions.jsonl");
  await cp(drafts, localDrafts);
  await cp(approved, localApproved);
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
          sha256: hash(await readFile(join(backup, "local.sqlite"))),
        },
        {
          path: "backup/content/questions/drafts/questions.jsonl",
          sha256: hash(await readFile(localDrafts)),
        },
        {
          path: "backup/content/questions/approved/questions.jsonl",
          sha256: hash(await readFile(localApproved)),
        },
      ],
    }),
  );
  await bindImportTarget({
    dbPath: db,
    backupManifestPath: manifest,
    targetManifestPath: target,
    fileDraftsPath: localDrafts,
    fileApprovedPath: localApproved,
  });
  const report = await createImportReport({
    dbPath: db,
    targetManifestPath: target,
    inputPath: input,
    fileDraftsPath: localDrafts,
    fileApprovedPath: localApproved,
    registryPath: registry,
    apply: true,
    reportPath: ledger,
  });
  return {
    dir,
    db,
    target,
    ledger,
    report,
    drafts: localDrafts,
    approved: localApproved,
  };
}
test("review guard accepts browser same-origin GET without Origin but rejects hostile origin and host", () => {
  const good = {
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "127.0.0.1:8787", "sec-fetch-site": "same-origin" },
  };
  assert.equal(isTrustedImportReviewRequest(good), true);
  assert.equal(
    isTrustedImportReviewRequest({
      ...good,
      headers: { ...good.headers, origin: "https://evil.test" },
    }),
    false,
  );
  assert.equal(
    isTrustedImportReviewRequest({
      ...good,
      headers: { ...good.headers, host: "evil.test" },
    }),
    false,
  );
});
test("review joins committed ledger to current SQLite and makes missing data explicit", async () => {
  const x = await applied();
  try {
    const image = x.report.entries.find((e) => e.source?.media)!;
    const page = await localImportReviewPage(
      new URL("http://local/api/local-import-review?limit=40&offset=40"),
      {
        ledgerPath: x.ledger,
        dbPath: x.db,
        fileDraftsPath: x.drafts,
        fileApprovedPath: x.approved,
      },
    );
    assert.equal(page.offset, 40);
    assert.equal(page.items.length, 40);
    assert.equal(page.after.sqliteRows, 6533);
    const detail = await localImportReviewDetail(image.incomingId, {
      ledgerPath: x.ledger,
      dbPath: x.db,
      fileDraftsPath: x.drafts,
      fileApprovedPath: x.approved,
    });
    assert.equal(detail.storageState, "present");
    const bytes = await readLocalImportReviewMedia(
      image.incomingId,
      image.source!.media!.sha256,
      { ledgerPath: x.ledger, dbPath: x.db },
    );
    assert.ok(bytes.length > 100);
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(x.db);
    db.prepare("DELETE FROM local_admin_drafts WHERE id=?").run(
      image.storageId!,
    );
    db.close();
    const missing = await localImportReviewDetail(image.incomingId, {
      ledgerPath: x.ledger,
      dbPath: x.db,
      fileDraftsPath: x.drafts,
      fileApprovedPath: x.approved,
    });
    assert.equal(missing.storageState, "missing");
    await assert.rejects(
      () =>
        readLocalImportReviewMedia(
          image.incomingId,
          image.source!.media!.sha256,
          { ledgerPath: x.ledger, dbPath: x.db },
        ),
      /IMPORT_MEDIA_STORAGE_NOT_PRESENT/,
    );
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
test("ordinary drafts remain editable and imported drafts reject mutation", () => {
  const service = new AuthoritativeGameService({
    dbPath: ":memory:",
    secret: "test",
  });
  try {
    service.store.saveAdminDraft(
      "ordinary",
      { id: "ordinary", status: "draft" },
      new Date().toISOString(),
    );
    assert.equal(
      service.saveAdminDraft({ id: "ordinary", headerAr: "تعديل" }).id,
      "ordinary",
    );
    service.store.saveAdminDraft(
      "imported",
      { id: "imported", status: "draft", readOnly: true },
      new Date().toISOString(),
    );
    assert.throws(
      () => service.saveAdminDraft({ id: "imported" }),
      /IMPORTED_DRAFT_READ_ONLY/,
    );
  } finally {
    service.close();
  }
});
test("HTTP private review and legacy admin reject hostile reads while trusted browser review reveals media", async () => {
  const x = await applied(),
    port = 9400 + Math.floor(Math.random() * 300);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        GAME_DB_PATH: x.db,
        LOCAL_IMPORT_LEDGER_PATH: x.ledger,
        LOCAL_IMPORT_REVIEW_ORIGINS: `http://127.0.0.1:${port}`,
      },
      stdio: "ignore",
    },
  );
  try {
    for (let n = 0; n < 40; n++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
      } catch {
        /* boot pending */
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    const same = { "sec-fetch-site": "same-origin" };
    const list = await fetch(
      `http://127.0.0.1:${port}/api/local-import-review`,
      { headers: same },
    );
    assert.equal(list.status, 200);
    const image = x.report.entries.find((e) => e.source?.media)!;
    const detail = await fetch(
      `http://127.0.0.1:${port}/api/local-import-review/entries/${image.incomingId}`,
      { headers: same },
    );
    assert.equal(detail.status, 200);
    const media = await fetch(
      `http://127.0.0.1:${port}/api/local-import-review/entries/${image.incomingId}/media?sha=${image.source!.media!.sha256}`,
      { headers: same },
    );
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/png");
    const hostile = await fetch(
      `http://127.0.0.1:${port}/api/local-import-review`,
      { headers: { origin: "https://evil.test" } },
    );
    assert.equal(hostile.status, 403);
    assert.equal(hostile.headers.get("access-control-allow-origin"), null);
    const legacy = await fetch(
      `http://127.0.0.1:${port}/api/admin/questions/${image.storageId}`,
      { headers: { origin: "https://evil.test" } },
    );
    assert.equal(legacy.status, 403);
    assert.equal(legacy.headers.get("access-control-allow-origin"), null);
    const trustedLegacy = await fetch(
      `http://127.0.0.1:${port}/api/admin/questions`,
      { headers: same },
    );
    assert.equal(trustedLegacy.status, 200);
    assert.equal(
      (await trustedLegacy.text()).includes(image.source!.answer),
      false,
    );
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once("exit", () => r()));
    await rm(x.dir, { recursive: true, force: true });
  }
});
test("a dry-run or uncompleted ledger cannot be used as a review source", async () => {
  const x = await applied();
  try {
    const dry = await createImportReport({
      dbPath: x.db,
      targetManifestPath: join(x.dir, "target.json"),
      inputPath: input,
      fileDraftsPath: x.drafts,
      fileApprovedPath: x.approved,
      registryPath: registry,
      runKind: "dry-run",
    });
    const dryPath = join(x.dir, "dry.json");
    await writeFile(dryPath, JSON.stringify(dry));
    await assert.rejects(
      () => loadImportLedger(dryPath),
      /IMPORT_LEDGER_NOT_COMMITTED_APPLY/,
    );
    await rm(`${x.ledger}.completion.json`);
    await assert.rejects(
      () => loadImportLedger(x.ledger),
      /IMPORT_LEDGER_COMPLETION_MISSING/,
    );
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
