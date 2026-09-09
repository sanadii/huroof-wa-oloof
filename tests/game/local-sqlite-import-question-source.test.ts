import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    const imported = await load(x);
    assert.equal(imported.inventory.source, "local_sqlite_import");
    assert.equal(imported.inventory.boundedReadCount, 62);
    assert.equal(imported.inventory.heldQuestionCount, 3);
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
      1,
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
    assert.deepEqual(imported.inventory.recommendedHuroofCategoryIds, [
      "tahadani-006",
    ]);
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
test("both game kinds pin a snapshot and fail closed when fixture questions change", async () => {
  const x = await fixture();
  try {
    const initial = await load(x);
    const service = new AuthoritativeGameService({
      dbPath: x.dbPath,
      secret: "test",
      localFirestoreQuestionSource: initial,
    });
    const huroof = service.create("host", true, {
      categories: initial.inventory.recommendedHuroofCategoryIds,
      gameKind: "huroof",
      modality: "classic",
      questionSeconds: 20,
      opponentSeconds: 10,
      teams: { horizontal: "أ", vertical: "ب" },
      difficulty: "mixed",
      mode: "classic",
    });
    const category = service.create("host", true, {
      categories: ["tahadani-006", "tahadani-007"],
      gameKind: "categories",
      modality: "classic",
      questionSeconds: 20,
      opponentSeconds: 10,
      teams: { horizontal: "أ", vertical: "ب" },
      difficulty: "mixed",
      mode: "classic",
    });
    service.close();
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
    const restored = new AuthoritativeGameService({
      dbPath: x.dbPath,
      secret: "test",
      localFirestoreQuestionSource: changed,
    });
    try {
      assert.throws(
        () => restored.metadata(huroof.roomId, huroof.token),
        /QUESTION_SOURCE_SNAPSHOT_UNAVAILABLE/,
      );
      assert.throws(
        () => restored.metadata(category.roomId, category.token),
        /QUESTION_SOURCE_SNAPSHOT_UNAVAILABLE/,
      );
    } finally {
      restored.close();
    }
  } finally {
    await rm(x.dir, { recursive: true, force: true });
  }
});
