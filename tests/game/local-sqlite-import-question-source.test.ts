import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadLocalSqliteImportQuestionSource } from "../../server/local-sqlite-import-question-source.js";
import { AuthoritativeGameService } from "../../server/service.js";

const arabicLetters = [
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
];
type Source = {
  id: string;
  category_id: string;
  category_title: string;
  source_package: string;
  source_record_id: string;
  mode: string;
  question: string | null;
  instruction: null;
  answer: string;
  accepted_answers: string[];
  target_letter: string | null;
  letter_mode_eligible: boolean | null;
  source_content_sha256: string;
  difficulty: string;
};
const source = (
  id: string,
  category: string,
  title: string,
  answer: string,
  letter: string | null,
  eligible: boolean | null = true,
): Source => ({
  id,
  category_id: category,
  category_title: title,
  source_package: "fixture",
  source_record_id: id,
  mode: "trivia",
  question: `سؤال ${id}`,
  instruction: null,
  answer,
  accepted_answers: [answer],
  target_letter: letter,
  letter_mode_eligible: eligible,
  source_content_sha256: id.padEnd(64, "0").slice(0, 64),
  difficulty: "easy",
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "huroof-sqlite-source-")),
    dbPath = join(dir, "source.sqlite"),
    drafts = join(dir, "drafts.jsonl"),
    approved = join(dir, "approved.jsonl");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE local_admin_drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  const insert = db.prepare(
    "INSERT INTO local_admin_drafts(id,data,updated_at) VALUES (?,?,?)",
  );
  for (const [index, letter] of arabicLetters.entries()) {
    const row = source(
      `letter-${index}`,
      "tahadani-006",
      "معلومات عامة",
      `${letter}جواب`,
      letter,
      true,
    );
    insert.run(
      `sqlite-${index}`,
      JSON.stringify({ id: `sqlite-${index}`, importSource: row }),
      new Date().toISOString(),
    );
  }
  for (const category of ["tahadani-006", "tahadani-007"])
    for (let index = 0; index < 14; index++) {
      const row = source(
        `${category}-${index}`,
        category,
        category === "tahadani-006" ? "معلومات عامة" : "عالم الحيوان",
        `مفهوم${category}${index}`,
        null,
        false,
      );
      insert.run(
        `${category}-${index}`,
        JSON.stringify({ id: `${category}-${index}`, importSource: row }),
        new Date().toISOString(),
      );
    }
  const unknownEligibility = source(
    "unknown-letter-eligibility",
    "tahadani-006",
    "معلومات عامة",
    "بلا تصريح",
    "ب",
    null,
  );
  insert.run(
    "unknown-letter-eligibility",
    JSON.stringify({
      id: "unknown-letter-eligibility",
      importSource: unknownEligibility,
    }),
    new Date().toISOString(),
  );
  const sharedA = source(
      "shared-a",
      "tahadani-006",
      "معلومات عامة",
      "جواب مشترك",
      null,
      false,
    ),
    sharedB = source(
      "shared-b",
      "tahadani-007",
      "عالم الحيوان",
      "جواب مشترك",
      null,
      false,
    );
  insert.run(
    "shared-a",
    JSON.stringify({ id: "shared-a", importSource: sharedA }),
    new Date().toISOString(),
  );
  insert.run(
    "shared-b",
    JSON.stringify({ id: "shared-b", importSource: sharedB }),
    new Date().toISOString(),
  );
  const staged = source(
    "staged",
    "tahadani-006",
    "معلومات عامة",
    "جواب مرحل",
    "ا",
    true,
  );
  insert.run(
    "staged",
    JSON.stringify({
      id: "staged",
      stagingState: "identity_collision_preserved_existing",
      importSource: staged,
    }),
    new Date().toISOString(),
  );
  const unsupported = source(
    "unsupported",
    "tahadani-006",
    "معلومات عامة",
    "تمثيل",
    null,
    null,
  );
  unsupported.mode = "charades";
  insert.run(
    "unsupported",
    JSON.stringify({
      id: "unsupported",
      stagingState: "unsupported_mode:charades",
      importSource: unsupported,
    }),
    new Date().toISOString(),
  );
  const malformed = source(
    "malformed",
    "tahadani-006",
    "معلومات عامة",
    "جواب ناقص",
    null,
    false,
  );
  malformed.question = null;
  insert.run(
    "malformed",
    JSON.stringify({ id: "malformed", importSource: malformed }),
    new Date().toISOString(),
  );
  db.close();
  await writeFile(
    drafts,
    `${JSON.stringify({ id: "legacy-file", categoryId: "tahadani-006", headerAr: "معلومات عامة", promptAr: "سؤال محفوظ", canonicalAnswer: "إجابة محفوظة", acceptedAnswers: ["إجابة محفوظة"], targetLetter: "ا", status: "draft" })}\n`,
  );
  await writeFile(approved, "");
  return { dir, dbPath, drafts, approved };
}
const load = (x: Awaited<ReturnType<typeof fixture>>) =>
  loadLocalSqliteImportQuestionSource({
    dbPath: x.dbPath,
    fileDraftsPath: x.drafts,
    fileApprovedPath: x.approved,
  });
test("deterministic SQLite fixture holds staged, unsupported and malformed records while preserving valid test questions", async () => {
  const x = await fixture();
  try {
    const db = new DatabaseSync(x.dbPath);
    db.prepare("INSERT INTO local_admin_drafts(id,data,updated_at) VALUES (?,?,?)").run(
      "held-only-category",
      JSON.stringify({
        id: "held-only-category",
        stagingState: "unsupported_mode:charades",
        importSource: {
          ...source(
            "held-only-category",
            "tahadani-held-only",
            "فئة مؤجلة",
            "إجابة خاصة",
            null,
            null,
          ),
          mode: "charades",
        },
      }),
      new Date().toISOString(),
    );
    db.close();
    const imported = await load(x);
    assert.equal(imported.inventory.source, "local_sqlite_import");
    assert.equal(imported.inventory.boundedReadCount, 63);
    assert.equal(imported.inventory.heldQuestionCount, 4);
    assert.equal(
      imported.inventory.heldByReason?.[
        "staging_state:identity_collision_preserved_existing"
      ],
      1,
    );
    assert.equal(
      imported.inventory.heldByReason?.[
        "staging_state:unsupported_mode:charades"
      ],
      2,
    );
    assert.equal(
      imported.inventory.heldByReason?.malformed_supported_record,
      1,
    );
    assert.ok(imported.questions.some((q) => q.id === "file:legacy-file"));
    assert.ok(
      imported.questions.some(
        (q) => q.id === "sqlite:sqlite-0" && q.targetLetter === "ا",
      ),
    );
    assert.ok(
      imported.questions.some(
        (q) => q.id === "sqlite:tahadani-006-0" && !q.targetLetter,
      ),
    );
    assert.ok(
      imported.questions.some(
        (q) => q.id === "sqlite:unknown-letter-eligibility" && !q.targetLetter,
      ),
    );
    const [a, b] = imported.questions.filter(
      (q) => q.canonicalAnswer === "جواب مشترك",
    );
    assert.equal(a?.answerConceptId, b?.answerConceptId);
    // One concept per letter covers the board but cannot satisfy its three-concept reserve.
    assert.deepEqual(imported.inventory.recommendedHuroofCategoryIds, []);
    assert.deepEqual(
      imported.inventory.categories.find(
        (category) => category.id === "tahadani-held-only",
      ),
      {
        id: "tahadani-held-only",
        labelAr: "فئة مؤجلة",
        sourceOnly: true,
        questionCount: 0,
        heldQuestionCount: 1,
        classicQuestionCount: 0,
        huroofQuestionCount: 0,
        categoryGameEligible: false,
        availability: "held_only",
      },
    );
    const service = new AuthoritativeGameService({
      dbPath: x.dbPath,
      secret: "test",
      localFirestoreQuestionSource: imported,
    });
    try {
      const publicInventory = JSON.stringify(service.questionInventory());
      assert.equal(publicInventory.includes("إجابة خاصة"), false);
      assert.equal(publicInventory.includes("snapshotId"), false);
      assert.equal(publicInventory.includes("bundleSha256"), false);
      assert.equal(publicInventory.includes("heldByReason"), false);
      assert.equal(publicInventory.includes(x.dbPath), false);
    } finally {
      service.close();
    }
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
test("held-only SQLite imports still expose a category inventory without becoming playable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "huroof-held-only-source-"));
  const dbPath = join(dir, "source.sqlite");
  const drafts = join(dir, "drafts.jsonl");
  const approved = join(dir, "approved.jsonl");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE local_admin_drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO local_admin_drafts(id,data,updated_at) VALUES (?,?,?)").run(
      "held-only",
      JSON.stringify({
        id: "held-only",
        stagingState: "unsupported_mode:charades",
        importSource: {
          ...source(
            "held-only",
            "tahadani-held-only",
            "فئة مؤجلة",
            "إجابة لا تُنشر",
            null,
            null,
          ),
          mode: "charades",
        },
      }),
      new Date().toISOString(),
    );
    db.close();
    await writeFile(drafts, "");
    await writeFile(approved, "");
    const imported = await loadLocalSqliteImportQuestionSource({
      dbPath,
      fileDraftsPath: drafts,
      fileApprovedPath: approved,
    });
    assert.equal(imported.questions.length, 0);
    assert.equal(imported.inventory.huroofAvailable, false);
    assert.deepEqual(imported.inventory.categories.map((category) => ({
      id: category.id,
      labelAr: category.labelAr,
      questionCount: category.questionCount,
      heldQuestionCount: category.heldQuestionCount,
      availability: category.availability,
    })), [{
      id: "tahadani-held-only",
      labelAr: "فئة مؤجلة",
      questionCount: 0,
      heldQuestionCount: 1,
      availability: "held_only",
    }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a refreshed import updates new rooms while active rooms keep their pinned source", async () => {
  const x = await fixture();
  try {
    const initial = await load(x);
    const db = new DatabaseSync(x.dbPath);
    db.prepare("UPDATE local_admin_drafts SET data=? WHERE id=?").run(
      JSON.stringify({
        id: "sqlite-0",
        importSource: source(
          "changed",
          "tahadani-006",
          "معلومات عامة",
          "إجابة تغيرت",
          "ا",
          true,
        ),
      }),
      "sqlite-0",
    );
    db.close();
    const changed = await load(x);
    assert.notEqual(changed.snapshotId, initial.snapshotId);
    const service = new AuthoritativeGameService({
      dbPath: x.dbPath,
      secret: "test",
      localFirestoreQuestionSource: initial,
    });
    try {
      const oldRoom = service.create("host", true, {
        categories: initial.inventory.recommendedHuroofCategoryIds,
        gameKind: "huroof",
        modality: "classic",
        questionSeconds: 20,
        opponentSeconds: 10,
        teams: { horizontal: "أ", vertical: "ب" },
        difficulty: "mixed",
        mode: "classic",
      });
      service.replaceLocalQuestionSource(changed);
      assert.equal(service.questionInventory()?.categories.length, changed.inventory.categories.length);
      assert.doesNotThrow(() => service.metadata(oldRoom.roomId, oldRoom.token));
      const snapshots = service as unknown as {
        questionsSync: (
          demo: boolean,
          snapshot?: string,
        ) => Array<{ canonicalAnswer: string }>;
      };
      assert.equal(
        snapshots.questionsSync(true, initial.snapshotId).some(
          (question) => question.canonicalAnswer === "اجواب",
        ),
        true,
      );
      assert.equal(
        snapshots.questionsSync(true, initial.snapshotId).some(
          (question) => question.canonicalAnswer === "إجابة تغيرت",
        ),
        false,
      );
      const newRoom = service.create("host", true, {
        categories: changed.inventory.recommendedHuroofCategoryIds,
        gameKind: "huroof",
        modality: "classic",
        questionSeconds: 20,
        opponentSeconds: 10,
        teams: { horizontal: "أ", vertical: "ب" },
        difficulty: "mixed",
        mode: "classic",
      });
      assert.equal(
        service.store.load(newRoom.roomId)?.questionSourceSnapshot,
        changed.snapshotId,
      );
    } finally {
      service.close();
    }
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});

test("a pinned SQLite inventory supplies imported category labels and mixed video/image-capable category rooms", async () => {
  const x = await fixture();
  try {
    const db = new DatabaseSync(x.dbPath);
    const insert = db.prepare("INSERT INTO local_admin_drafts(id,data,updated_at) VALUES (?,?,?)");
    const promptSha256 = "761991311fd4d5ee4d9f27c703d867b6d9259b175ff7c3f0f55b91ad4b251d69";
    const answerSha256 = "18ff5ba7aa3ab152ac8b20f2210a9753e2e107a4c9e4db23667816ddffdda159";
    for (let index = 0; index < 14; index++) {
      const id = `goal-${index}`;
      insert.run(id, JSON.stringify({
        id,
        modality: "video",
        stagingState: "unsupported_mode:video",
        media: {
          promptMediaId: "goal-quiz-2026:001:blur",
          promptSha256,
          answerMediaId: "goal-quiz-2026:001:clean",
          answerSha256,
        },
        importSource: source(id, "goals-2026", "من سجل الهدف؟", `لاعب ${index}`, null, false),
      }), new Date().toISOString());
    }
    db.close();
    const imported = await load(x);
    assert.equal(imported.inventory.categories.find((item) => item.id === "goals-2026")?.labelAr, "من سجل الهدف؟");
    assert.equal(imported.questions.filter((item) => item.categoryId === "goals-2026" && item.modality === "video").length, 14);
    const service = new AuthoritativeGameService({ dbPath: x.dbPath, secret: "test", localFirestoreQuestionSource: imported });
    try {
      const host = service.create("host", true, { gameKind: "categories", categories: ["goals-2026", "tahadani-007"] });
      assert.deepEqual(service.store.load(host.roomId)?.config.categorySnapshot, [
        { id: "goals-2026", labelAr: "من سجل الهدف؟" },
        { id: "tahadani-007", labelAr: "عالم الحيوان" },
      ]);
      let revision = host.revision;
      for (const type of ["START_MATCH", "ROUND_READY"] as const) {
        const result = await service.intent(host.roomId, host.token, { type, intentId: `${type}-${revision}`, expectedRevision: revision, payload: {} });
        revision = result.revision;
      }
      const goalCell = service.metadata(host.roomId, host.token).projection.board!.find((cell) => cell.categoryId === "goals-2026")!;
      const opened = await service.intent(host.roomId, host.token, { type: "SELECT_CELL", intentId: `open-${revision}`, expectedRevision: revision, payload: { cellId: goalCell.id } });
      assert.equal(opened.projection.projection.question?.headerAr, "من سجل الهدف؟");
      assert.equal(service.store.load(host.roomId)?.activeQuestion?.modality, "video");
    } finally { service.close(); }
  } finally { await rm(x.dir, { recursive: true, force: true }); }
});

test("Huroof readiness and recommendations exclude image questions with letters", async () => {
  const x = await fixture();
  try {
    const manifest = JSON.parse(
      await readFile("content/question-media/v18-private-240/manifest.json", "utf8"),
    ) as { assets: Array<{ mediaId: string; assetSha256: string }> };
    const image = manifest.assets[0]!;
    const db = new DatabaseSync(x.dbPath);
    const update = db.prepare("UPDATE local_admin_drafts SET data=? WHERE id=?");
    for (const [index, letter] of arabicLetters.slice(16).entries()) {
      const id = `letter-${index + 16}`;
      update.run(
        JSON.stringify({
          id: `sqlite-${index + 16}`,
          media: image,
          importSource: source(id, "tahadani-006", "معلومات عامة", `${letter}صورة`, letter, true),
        }),
        `sqlite-${index + 16}`,
      );
    }
    db.close();
    const imported = await load(x);
    const category = imported.inventory.categories.find((item) => item.id === "tahadani-006");
    assert.equal(category?.huroofQuestionCount, 17); // 16 letter cells plus the fixture's duplicate legacy ا.
    assert.equal(
      new Set(
        imported.questions
          .filter((question) => question.modality === "classic" && question.targetLetter)
          .map((question) => question.targetLetter),
      ).size,
      16,
    );
    assert.equal(imported.inventory.huroofAvailable, false);
    assert.deepEqual(imported.inventory.recommendedHuroofCategoryIds, []);
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
