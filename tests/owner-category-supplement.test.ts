import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  applyOwnerCategorySupplement,
  buildOwnerCategorySupplementPlan,
  CATEGORY_IDS,
  createProductionOwnerCategorySupplementApi,
  MEDIA_RELEASE_ID,
  rollbackOwnerCategorySupplement,
  verifyOwnerCategorySupplement,
  type CapturedBase,
  type CategorySupplementApi,
  type CategorySupplementPlan,
  type ReleaseDocument,
  type SourceHashManifest,
} from "../scripts/owner-category-supplement.js";
import { canonicalJson } from "../scripts/firestore-release-canonical.js";
import type { SourceDocument } from "../scripts/owner-approved-release.js";
import {
  createCategoryQuestionSelection,
  createMatchQuestionSelection,
  type RuntimeQuestionV32,
} from "../src/features/game/runtime/question-selector.js";

const hash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const docHash = (documents: ReleaseDocument[]) =>
  hash(
    documents
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(({ path, data }) => ({ path, data })),
  );
const hashes: SourceHashManifest = {
  v19: {
    path: "output/v19-db-import-20260911",
    sha256: "8bbb7ace97272e8f37673633a05c36b3320ed26766b5a98df48cb774955adec5",
  },
  v191: {
    path: "output/v191-db-update-20260911",
    sha256: "ba4751006628b165ea64108e9f51913705fd3aa73a5e80c829418e238e7a4cf5",
  },
};
function base(): CapturedBase {
  const rootPath = "releases/" + MEDIA_RELEASE_ID,
    children: ReleaseDocument[] = [];
  for (let index = 0; index < 10838; index += 1)
    children.push({
      path: rootPath + "/questions/base-" + index,
      data: {
        id: "base-" + index,
        categoryId: "base-001",
        modality: "classic",
        targetLetter: "ا",
        answerConceptId: "base-" + index,
        promptAr: "س" + index,
        canonicalAnswer: "ا" + index,
        acceptedAnswers: ["ا" + index],
      },
    });
  for (let index = 0; index < 68; index += 1) {
    children.push({
      path: rootPath + "/catalogCategories/base-" + index,
      data: { id: "base-" + index, labelAr: "أساس" },
    });
    children.push({
      path: rootPath + "/inventory/base-" + index,
      data: { categoryId: "base-" + index, approvedCount: 1 },
    });
  }
  for (let index = 0; index < 489; index += 1)
    children.push({
      path: rootPath + "/media/media-" + index,
      data: { mediaId: "media-" + index, generation: "1", immutable: true },
    });
  const documentRootSha256 = docHash(children),
    root: ReleaseDocument = {
      path: rootPath,
      data: {
        releaseId: MEDIA_RELEASE_ID,
        immutable: true,
        approvedCount: 10838,
        catalogSha256: hash("catalog"),
        documentRootSha256,
        sourceManifestSha256: hash("source"),
        ownerApprovalPath: "contentOwnerApprovals/m04",
        publicationAuthority: "owner_approval_media_extension",
        baseReleaseId: "owner-release-3b46a28072ec92a4ed3be4941bf7a818",
      },
    };
  const pointer = {
    releaseId: root.data.releaseId,
    approvedCount: root.data.approvedCount,
    catalogSha256: root.data.catalogSha256,
    documentRootSha256,
    sourceManifestSha256: root.data.sourceManifestSha256,
    ownerApprovalPath: root.data.ownerApprovalPath,
    publicationAuthority: root.data.publicationAuthority,
    baseReleaseId: root.data.baseReleaseId,
  };
  return {
    capturedAt: "2026-09-12T00:00:00.000Z",
    projectId: "huroof-a3ee7",
    databaseId: "(default)",
    locationId: "me-central2",
    pointer,
    root,
    documents: [...children, root],
  };
}
const sqlite =
  process.env.LOCALAPPDATA + "/Temp/huroof-wa-oloof-local-game.sqlite";
const verifiedBaseSnapshot =
  "D:/projects/huroof_wa_oloof/output/media-live-20260911/M04-VERIFIED-BASE-SNAPSHOT.json";
const privateInputTests =
  process.env.RUN_PRIVATE_OWNER_CATEGORY_SUPPLEMENT_TESTS === "1" &&
  existsSync(sqlite) &&
  existsSync(verifiedBaseSnapshot);
const privateInputSkip = privateInputTests
  ? false
  : "set RUN_PRIVATE_OWNER_CATEGORY_SUPPLEMENT_TESTS=1 with the private SQLite and verified M04 snapshot";
test(
  "actual 4,500 local rows form an exact Category-only successor",
  { skip: privateInputSkip },
  async () => {
    const plan = await buildOwnerCategorySupplementPlan({
      base: base(),
      sqlitePath: sqlite,
      sourceHashes: hashes,
    });
    assert.equal(plan.approvedCount, 15338);
    assert.equal(plan.documents.length, 15994);
    assert.equal(
      plan.documents.filter((document) => document.path.includes("/media/"))
        .length,
      489,
    );
    assert.equal(Object.keys(plan.readiness).length, 15);
    const added = plan.documents.filter((document) =>
      document.path.includes("/questions/owner-category-"),
    );
    assert.equal(added.length, 4500);
    assert.ok(
      added.every(
        (document) =>
          document.data.targetLetter === "" &&
          document.data.letterModeEligible === false &&
          document.data.specialistReview === "not_claimed",
      ),
    );
    assert.deepEqual(
      Object.keys(plan.source.categories).sort(),
      [...CATEGORY_IDS].sort(),
    );
  },
);
test(
  "base and source state drift fail before an immutable plan exists",
  { skip: privateInputSkip },
  async () => {
    const changed = base();
    changed.pointer = { ...changed.pointer, releaseId: "later" };
    await assert.rejects(
      buildOwnerCategorySupplementPlan({
        base: changed,
        sqlitePath: sqlite,
        sourceHashes: hashes,
      }),
      /M04 base identity/i,
    );
    const changedHash = structuredClone(hashes);
    changedHash.v19.sha256 = "not-a-hash";
    // The actual record provenance cannot be represented by an arbitrary manifest hash.
    await assert.rejects(
      buildOwnerCategorySupplementPlan({
        base: base(),
        sqlitePath: sqlite,
        sourceHashes: changedHash,
      }),
      /source hash manifest/i,
    );
  },
);

test(
  "changed source review, letter eligibility, mode, and normalized duplicate rows fail closed",
  { skip: privateInputSkip },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "owner-category-supplement-"),
    );
    const copiedSqlite = join(directory, "local.sqlite");
    await copyFile(sqlite, copiedSqlite);
    const runChangedRow = async (
      mutate: (
        value: Record<string, unknown>,
        comparison: Record<string, unknown>,
      ) => void,
      expected: RegExp,
    ) => {
      const db = new DatabaseSync(copiedSqlite);
      const first = db
        .prepare("SELECT data FROM local_admin_drafts WHERE id = ?")
        .get("v19-huroof-063-001") as { data: string };
      const second = db
        .prepare("SELECT data FROM local_admin_drafts WHERE id = ?")
        .get("v19-huroof-063-002") as { data: string };
      const changed = JSON.parse(first.data) as Record<string, unknown>;
      mutate(changed, JSON.parse(second.data) as Record<string, unknown>);
      db.prepare("UPDATE local_admin_drafts SET data = ? WHERE id = ?").run(
        JSON.stringify(changed),
        "v19-huroof-063-001",
      );
      db.close();
      await assert.rejects(
        buildOwnerCategorySupplementPlan({
          base: base(),
          sqlitePath: copiedSqlite,
          sourceHashes: hashes,
        }),
        expected,
      );
      const restore = new DatabaseSync(copiedSqlite);
      restore
        .prepare("UPDATE local_admin_drafts SET data = ? WHERE id = ?")
        .run(first.data, "v19-huroof-063-001");
      restore.close();
    };
    try {
      await runChangedRow((value) => {
        value.status = "approved";
      }, /incomplete.*category-only/i);
      await runChangedRow((value) => {
        value.letterModeEligible = true;
      }, /incomplete.*category-only/i);
      await runChangedRow((value) => {
        (value.importSource as Record<string, unknown>).mode = "charades";
      }, /incomplete.*category-only/i);
      await runChangedRow((value, comparison) => {
        const source = value.importSource as Record<string, unknown>;
        const other = comparison.importSource as Record<string, unknown>;
        source.question = other.question;
        source.answer = other.answer;
        source.accepted_answers = other.accepted_answers;
      }, /collides with a captured M04 question/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "the verified M04 base plus additions passes all 83 Category selectors and additions stay out of Huroof",
  { skip: privateInputSkip },
  async () => {
    const actualBase = JSON.parse(
      await readFile(verifiedBaseSnapshot, "utf8"),
    ) as CapturedBase;
    const plan = await buildOwnerCategorySupplementPlan({
      base: actualBase,
      sqlitePath: sqlite,
      sourceHashes: hashes,
    });
    const questions = plan.documents
      .filter((document) => document.path.includes("/questions/"))
      .map((document) => document.data as RuntimeQuestionV32);
    const categories = plan.documents
      .filter((document) => document.path.includes("/catalogCategories/"))
      .map((document) => String(document.data.id))
      .sort();
    assert.equal(categories.length, 83);
    for (let index = 0; index < categories.length; index += 1) {
      const category = categories[index]!;
      const partner = categories[index === 0 ? 1 : 0]!;
      const selection = createCategoryQuestionSelection(questions, {
        categories: [category, partner],
        modality: "classic",
        seed: index + 1,
      });
      assert.ok(
        selection.queues[category].length > 0,
        category + " must have a Category queue",
      );
    }
    const additions = questions.filter((question) =>
      String(question.id).startsWith("owner-category-"),
    );
    assert.equal(additions.length, 4500);
    assert.throws(
      () =>
        createMatchQuestionSelection(additions, {
          categories: [...CATEGORY_IDS],
          modality: "classic",
          seed: 1,
        }),
      /letter coverage/i,
    );
  },
);

test(
  "production REST preserves an actual copied fractional media duration as doubleValue",
  { skip: privateInputSkip },
  async () => {
    const actualBase = JSON.parse(
      await readFile(verifiedBaseSnapshot, "utf8"),
    ) as CapturedBase;
    const plan = await buildOwnerCategorySupplementPlan({
      base: actualBase,
      sqlitePath: sqlite,
      sourceHashes: hashes,
    });
    const media = plan.documents.find(
      (document) =>
        document.path.includes("/media/") &&
        typeof document.data.durationSeconds === "number" &&
        !Number.isInteger(document.data.durationSeconds),
    )!;
    const duration = media.data.durationSeconds as number;
    const requests: Array<{ url: string; body: string }> = [];
    const api = await createProductionOwnerCategorySupplementApi({
      accessToken: async () => "test-token",
      fetch: async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? init.body : "";
        requests.push({ url, body });
        if (url.includes(":batchGet")) return new Response("[]");
        if (url.includes(":commit")) return Response.json({});
        throw new Error("Unexpected REST request: " + url);
      },
    });
    await api.create([media]);
    const commit = JSON.parse(
      requests.find((request) => request.url.includes(":commit"))!.body,
    ) as {
      writes: Array<{
        update: { fields: Record<string, Record<string, unknown>> };
      }>;
    };
    assert.deepEqual(commit.writes[0]!.update.fields.durationSeconds, {
      doubleValue: duration,
    });
  },
);

const releaseRoot = (plan: CategorySupplementPlan) =>
  plan.documents.find(
    (document) => document.path === "releases/" + plan.releaseId,
  )!;
const activePointer = (plan: CategorySupplementPlan) => {
  const root = releaseRoot(plan).data;
  return {
    releaseId: root.releaseId,
    approvedCount: root.approvedCount,
    catalogSha256: root.catalogSha256,
    documentRootSha256: root.documentRootSha256,
    sourceManifestSha256: root.sourceManifestSha256,
    ownerApprovalPath: root.ownerApprovalPath,
    publicationAuthority: root.publicationAuthority,
    baseReleaseId: root.baseReleaseId,
  };
};
function syntheticPlan(): CategorySupplementPlan {
  const baseRoot: ReleaseDocument = {
    path: "releases/" + MEDIA_RELEASE_ID,
    data: {
      releaseId: MEDIA_RELEASE_ID,
      approvedCount: 1,
      catalogSha256: hash("m04-catalog"),
      documentRootSha256: hash("m04-root"),
      sourceManifestSha256: hash("m04-source"),
      ownerApprovalPath: "contentOwnerApprovals/m04",
      publicationAuthority: "owner_approval_media_extension",
      baseReleaseId: "prior-release",
      immutable: true,
    },
  };
  const base: CapturedBase = {
    capturedAt: "2026-09-12T00:00:00.000Z",
    projectId: "huroof-a3ee7",
    databaseId: "(default)",
    locationId: "me-central2",
    pointer: {
      releaseId: MEDIA_RELEASE_ID,
      approvedCount: 1,
      catalogSha256: hash("m04-catalog"),
      documentRootSha256: hash("m04-root"),
      sourceManifestSha256: hash("m04-source"),
      ownerApprovalPath: "contentOwnerApprovals/m04",
      publicationAuthority: "owner_approval_media_extension",
      baseReleaseId: "prior-release",
    },
    root: baseRoot,
    documents: [baseRoot],
  };
  const releaseId = "owner-category-release-test";
  const children: ReleaseDocument[] = [
    {
      path: "releases/" + releaseId + "/questions/owner-category-test",
      data: {
        id: "owner-category-test",
        categoryId: "huroof-063",
        modality: "classic",
        targetLetter: "",
        letterModeEligible: false,
        answerConceptId: "test",
        promptAr: "سؤال",
        canonicalAnswer: "جواب",
        acceptedAnswers: ["جواب"],
        immutable: true,
      },
    },
    {
      path: "releases/" + releaseId + "/catalogCategories/huroof-063",
      data: { id: "huroof-063", labelAr: "فئة", immutable: true },
    },
    {
      path: "releases/" + releaseId + "/inventory/huroof-063",
      data: { categoryId: "huroof-063", approvedCount: 1, immutable: true },
    },
    {
      path: "releases/" + releaseId + "/media/media-test",
      data: { mediaId: "media-test", generation: "1", immutable: true },
    },
  ];
  const documentRootSha256 = docHash(children);
  const approvalPath = "contentOwnerApprovals/owner-category-supplement-test";
  const root: ReleaseDocument = {
    path: "releases/" + releaseId,
    data: {
      releaseId,
      approvedCount: 15338,
      catalogSha256: docHash(
        children.filter((document) =>
          document.path.includes("/catalogCategories/"),
        ),
      ),
      documentRootSha256,
      sourceManifestSha256: hash("supplement-source"),
      ownerApprovalPath: approvalPath,
      publicationAuthority: "owner_authorization_category_supplement",
      baseReleaseId: MEDIA_RELEASE_ID,
      immutable: true,
    },
  };
  const authority: ReleaseDocument = {
    path: approvalPath,
    data: {
      approvalState: "owner_approved",
      bindingSha256: hash("source-bindings"),
      immutable: true,
    },
  };
  return {
    schemaVersion: "owner-category-supplement-v1",
    releaseId,
    target: {
      projectId: "huroof-a3ee7",
      databaseId: "(default)",
      locationId: "me-central2",
    },
    base,
    source: {
      sqliteSha256: hash("private-sqlite"),
      hashes,
      recordCount: 4500,
      categories: { "huroof-063": 300 },
      bindingSha256: hash("source-bindings"),
    },
    ownerApproval: {
      path: approvalPath,
      runId: "owner-category-supplement-test",
      authority: "owner_approval",
      specialistReview: "not_claimed",
    },
    documents: [...children, root],
    approvalDocuments: [authority],
    approvedCount: 15338,
    catalogSha256: String(root.data.catalogSha256),
    documentRootSha256,
    sourceManifestSha256: String(root.data.sourceManifestSha256),
    readiness: {},
  };
}
const wireValue = (value: unknown): Record<string, unknown> => {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(wireValue) } };
  if (value && typeof value === "object")
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(
            ([key, child]) => [key, wireValue(child)],
          ),
        ),
      },
    };
  throw new Error("Test source document has an unsupported value.");
};
const sourceDocument = (
  path: string,
  data: Record<string, unknown>,
): SourceDocument => ({
  name: "projects/huroof-a3ee7/databases/(default)/documents/" + path,
  updateTime: "2026-09-12T00:00:00.000Z",
  fields: Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, wireValue(value)]),
  ),
});
const equal = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);
function verificationPath(plan: CategorySupplementPlan) {
  return (
    "ownerCategoryVerificationReceipts/" +
    plan.releaseId +
    "-" +
    plan.documentRootSha256
  );
}
function activationPath(plan: CategorySupplementPlan) {
  return "activationReceipts/" + plan.releaseId + "-owner-category";
}
class PersistentSupplementCloud implements CategorySupplementApi {
  readonly documents = new Map<string, SourceDocument>();
  failAfterCreates: number | undefined;
  dropPath: string | undefined;
  mismatchPath: string | undefined;
  private created = 0;
  constructor(captured: CapturedBase) {
    this.documents.set(
      "runtime/activeRelease",
      sourceDocument("runtime/activeRelease", captured.pointer),
    );
    for (const document of captured.documents)
      this.documents.set(
        document.path,
        sourceDocument(document.path, document.data),
      );
  }
  async target() {
    return {
      projectId: "huroof-a3ee7",
      databaseId: "(default)",
      locationId: "me-central2",
      type: "FIRESTORE_NATIVE",
    };
  }
  async read(paths: string[]) {
    return paths.map((path) => this.documents.get(path));
  }
  async create(documents: ReleaseDocument[]) {
    for (const document of documents) {
      const existing = this.documents.get(document.path);
      if (
        existing &&
        !equal(
          existing.fields,
          sourceDocument(document.path, document.data).fields,
        )
      )
        throw new Error("Create-only conflict.");
      if (!existing) {
        if (document.path === this.dropPath) continue;
        this.documents.set(
          document.path,
          sourceDocument(
            document.path,
            document.path === this.mismatchPath
              ? { ...document.data, gateInjectedMismatch: true }
              : document.data,
          ),
        );
        this.created += 1;
        if (
          this.failAfterCreates !== undefined &&
          this.created >= this.failAfterCreates
        )
          throw new Error("Injected partial write failure.");
      }
    }
  }
  async listCollectionIds(path: string) {
    const prefix = path + "/";
    return [
      ...new Set(
        [...this.documents.keys()]
          .filter((documentPath) => documentPath.startsWith(prefix))
          .map(
            (documentPath) => documentPath.slice(prefix.length).split("/")[0]!,
          ),
      ),
    ];
  }
  async listCollection(path: string) {
    const prefix = path + "/",
      depth = path.split("/").length + 1;
    return [...this.documents.entries()]
      .filter(
        ([documentPath]) =>
          documentPath.startsWith(prefix) &&
          documentPath.split("/").length === depth,
      )
      .map(([, document]) => document);
  }
  async activate(plan: CategorySupplementPlan, verification: ReleaseDocument) {
    const expected = activePointer(plan),
      activation = {
        releaseId: plan.releaseId,
        baseReleaseId: MEDIA_RELEASE_ID,
        activePointer: expected,
        ownerApprovalPath: plan.ownerApproval.path,
        immutable: true,
      };
    const required = [
      releaseRoot(plan),
      verification,
      ...plan.approvalDocuments,
    ];
    if (
      required.some(
        (document) =>
          !equal(
            this.documents.get(document.path)?.fields,
            sourceDocument(document.path, document.data).fields,
          ),
      )
    )
      throw new Error("Activation authority or release identity drifted.");
    const current = this.documents.get("runtime/activeRelease"),
      prior = this.documents.get(activationPath(plan));
    if (prior) {
      if (
        equal(
          current?.fields,
          sourceDocument("runtime/activeRelease", expected).fields,
        ) &&
        equal(
          prior.fields,
          sourceDocument(activationPath(plan), activation).fields,
        )
      )
        return;
      throw new Error("Activation retry conflicts with active pointer.");
    }
    if (
      !equal(
        current?.fields,
        sourceDocument("runtime/activeRelease", plan.base.pointer).fields,
      )
    )
      throw new Error("Activation pointer changed.");
    this.documents.set(
      activationPath(plan),
      sourceDocument(activationPath(plan), activation),
    );
    this.documents.set(
      "runtime/activeRelease",
      sourceDocument("runtime/activeRelease", expected),
    );
  }
  async rollback(plan: CategorySupplementPlan, receipt: ReleaseDocument) {
    const expected = activePointer(plan);
    const required = [
      ["runtime/activeRelease", expected],
      [releaseRoot(plan).path, releaseRoot(plan).data],
      [
        verificationPath(plan),
        {
          releaseId: plan.releaseId,
          baseReleaseId: MEDIA_RELEASE_ID,
          documentRootSha256: plan.documentRootSha256,
          ownerApprovalPath: plan.ownerApproval.path,
          verificationKind: "owner_category_exact_readback",
          immutable: true,
        },
      ],
      [
        activationPath(plan),
        {
          releaseId: plan.releaseId,
          baseReleaseId: MEDIA_RELEASE_ID,
          activePointer: expected,
          ownerApprovalPath: plan.ownerApproval.path,
          immutable: true,
        },
      ],
    ] as const;
    if (
      this.documents.has(receipt.path) ||
      required.some(
        ([path, data]) =>
          !equal(
            this.documents.get(path)?.fields,
            sourceDocument(path, data).fields,
          ),
      )
    )
      throw new Error("Rollback CAS rejects altered active identity.");
    this.documents.set(
      "runtime/activeRelease",
      sourceDocument("runtime/activeRelease", plan.base.pointer),
    );
    this.documents.set(
      receipt.path,
      sourceDocument(receipt.path, receipt.data),
    );
  }
}

test("persistent cloud retries partial creates, verifies exact authority, and rolls back with the M04 pointer", async () => {
  const plan = syntheticPlan();
  const cloud = new PersistentSupplementCloud(plan.base);
  cloud.failAfterCreates = 3;
  await assert.rejects(
    applyOwnerCategorySupplement(plan, cloud, async () => plan),
    /partial write/i,
  );
  cloud.failAfterCreates = undefined;
  await applyOwnerCategorySupplement(plan, cloud, async () => plan);
  assert.deepEqual(await verifyOwnerCategorySupplement(plan, cloud), {
    releaseId: plan.releaseId,
    active: true,
  });
  await applyOwnerCategorySupplement(plan, cloud, async () => plan);
  await rollbackOwnerCategorySupplement(
    plan,
    cloud,
    "restore-m04-after-review",
  );
  assert.equal(
    equal(
      cloud.documents.get("runtime/activeRelease")?.fields,
      sourceDocument("runtime/activeRelease", plan.base.pointer).fields,
    ),
    true,
  );
});

test("missing child aborts before the completion root, verification receipt, or pointer", async () => {
  const plan = syntheticPlan();
  const cloud = new PersistentSupplementCloud(plan.base);
  cloud.dropPath = plan.documents.find((document) =>
    document.path.includes("/questions/"),
  )!.path;
  await assert.rejects(
    applyOwnerCategorySupplement(plan, cloud, async () => plan),
    /child readback/i,
  );
  assert.equal(cloud.documents.has(releaseRoot(plan).path), false);
  assert.equal(cloud.documents.has(verificationPath(plan)), false);
  assert.equal(cloud.documents.has(activationPath(plan)), false);
  assert.equal(
    equal(
      cloud.documents.get("runtime/activeRelease")?.fields,
      sourceDocument("runtime/activeRelease", plan.base.pointer).fields,
    ),
    true,
  );
  cloud.dropPath = undefined;
  await applyOwnerCategorySupplement(plan, cloud, async () => plan);
  assert.deepEqual(await verifyOwnerCategorySupplement(plan, cloud), {
    releaseId: plan.releaseId,
    active: true,
  });
});

test("mismatched child aborts before the completion root, verification receipt, or pointer", async () => {
  const plan = syntheticPlan();
  const cloud = new PersistentSupplementCloud(plan.base);
  cloud.mismatchPath = plan.documents.find((document) =>
    document.path.includes("/questions/"),
  )!.path;
  await assert.rejects(
    applyOwnerCategorySupplement(plan, cloud, async () => plan),
    /child readback/i,
  );
  assert.equal(cloud.documents.has(releaseRoot(plan).path), false);
  assert.equal(cloud.documents.has(verificationPath(plan)), false);
  assert.equal(cloud.documents.has(activationPath(plan)), false);
  assert.equal(
    equal(
      cloud.documents.get("runtime/activeRelease")?.fields,
      sourceDocument("runtime/activeRelease", plan.base.pointer).fields,
    ),
    true,
  );
});

test("tampered authority, plan, and same-ID pointer drift fail closed", async () => {
  const plan = syntheticPlan();
  const cloud = new PersistentSupplementCloud(plan.base);
  const changedPlan = structuredClone(plan);
  changedPlan.documents.find((document) =>
    document.path.includes("/questions/owner-category-"),
  )!.data.promptAr = "tampered";
  await assert.rejects(
    applyOwnerCategorySupplement(changedPlan, cloud, async () => plan),
    /deterministic local authority/i,
  );
  await applyOwnerCategorySupplement(plan, cloud, async () => plan);
  const authority = plan.approvalDocuments.at(-1)!;
  cloud.documents.set(
    authority.path,
    sourceDocument(authority.path, { ...authority.data, immutable: false }),
  );
  await assert.rejects(
    verifyOwnerCategorySupplement(plan, cloud),
    /owner authority/i,
  );
  cloud.documents.set(
    authority.path,
    sourceDocument(authority.path, authority.data),
  );
  cloud.documents.set(
    "runtime/activeRelease",
    sourceDocument("runtime/activeRelease", {
      ...activePointer(plan),
      documentRootSha256: "altered",
    }),
  );
  await assert.rejects(
    rollbackOwnerCategorySupplement(plan, cloud, "reject-altered-same-id"),
    /Rollback CAS/i,
  );
});

test("production REST collection enumeration reads every pagination page", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const api = await createProductionOwnerCategorySupplementApi({
    accessToken: async () => "test-token",
    fetch: async (input, init) => {
      const url = String(input),
        body = typeof init?.body === "string" ? init.body : "";
      requests.push({ url, body });
      if (url.includes(":listCollectionIds")) {
        const payload = JSON.parse(body) as { pageToken?: string };
        return Response.json(
          payload.pageToken
            ? { collectionIds: ["media"] }
            : { collectionIds: ["questions"], nextPageToken: "collections-2" },
        );
      }
      if (url.includes("/questions?pageSize=1000"))
        return Response.json(
          url.includes("pageToken=questions-2")
            ? {
                documents: [
                  sourceDocument("releases/example/questions/two", {
                    id: "two",
                  }),
                ],
              }
            : {
                documents: [
                  sourceDocument("releases/example/questions/one", {
                    id: "one",
                  }),
                ],
                nextPageToken: "questions-2",
              },
        );
      throw new Error("Unexpected REST request: " + url);
    },
  });
  assert.deepEqual(await api.listCollectionIds("releases/example"), [
    "questions",
    "media",
  ]);
  assert.deepEqual(
    (await api.listCollection("releases/example/questions")).map((document) =>
      document.name.split("/").at(-1),
    ),
    ["one", "two"],
  );
  assert.equal(
    requests.filter((request) => request.url.includes(":listCollectionIds"))
      .length,
    2,
  );
  assert.match(
    requests.find((request) => request.body.includes("collections-2"))!.body,
    /pageToken/,
  );
  assert.equal(
    requests.filter((request) =>
      request.url.includes("/questions?pageSize=1000"),
    ).length,
    2,
  );
});
