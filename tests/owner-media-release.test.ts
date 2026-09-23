import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyOwnerMediaRelease, assertAnonymousPrivateReadbacks, assertOwnerMediaApproval, createProductionOwnerMediaApi, documentsStillToCreate, resolveValidatedMediaLocalFile, rollbackOwnerMediaRelease, verifyOwnerMediaRelease, type OwnerMediaApi, type OwnerMediaPlan } from "../scripts/owner-media-release.js";

const hash = (value: string) => value.repeat(64).slice(0, 64);
function plan(): OwnerMediaPlan {
  const releaseId = "owner-media-release-0123456789abcdef0123456789abcdef";
  const root = { path: "releases/" + releaseId, data: { releaseId, approvedCount: 10838, documentRootSha256: hash("a"), catalogSha256: hash("b"), sourceManifestSha256: hash("c") } };
  const child = { path: "releases/" + releaseId + "/questions/question-1", data: { id: "question-1", immutable: true } };
  const upload = { mediaId: "v18-tahadani-011-001", assetSha256: hash("d"), contentType: "image/png" as const, byteSize: 8, width: 10, height: 20, localFile: "originals/a.png", objectName: "question-media/v18/" + hash("d") + ".png", createOnly: true as const, metadata: { assetSha256: hash("d"), mediaId: "v18-tahadani-011-001", contentType: "image/png", byteSize: "8", width: "10", height: "20" } };
  return { schemaVersion: "owner-authorized-media-extension-v1", releaseId, capturedAt: "2026-09-12T00:00:00.000Z", base: { releaseId: "owner-release-3b46a28072ec92a4ed3be4941bf7a818", pointer: { releaseId: "owner-release-3b46a28072ec92a4ed3be4941bf7a818" }, root: { path: "releases/owner-release-3b46a28072ec92a4ed3be4941bf7a818", data: {} }, children: [] }, authority: { ownerApprovalPath: "contentOwnerApprovals/owner-approval-072dd09e41e2eaf652db75c9d5216d7515b5a7aff11fba180f864df118363180", userInstruction: "uploaded image questions to display images, goal-video category to appear and play, and all uploaded categories to work", sqliteSha256: hash("e"), sourceExportSha256: hash("f"), manifestHashes: {}, selectedSourceBindingsSha256: hash("1") }, approvedCount: 10838, catalogSha256: hash("b"), documentRootSha256: hash("a"), sourceManifestSha256: hash("c"), documents: [child, root], media: { dryRun: true, assetCount: 1, packageCounts: { v18: 1, rebuild: 0, goals: 0 }, manifestSha256: hash("2"), uploads: [upload] }, superseded: [], exclusions: {}, readiness: { categories: {}, globalHuroof: { playable: true, detail: "fixture" } } };
}
function api(events: string[], options: { stale?: boolean; badReadback?: boolean; failCreate?: boolean } = {}): OwnerMediaApi {
  return {
    metadata: async () => ({ projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" }),
    verifyBase: async () => { events.push("base"); if (options.stale) throw new Error("stale pointer"); },
    ensureObject: async (upload) => { events.push("object"); return { mediaId: upload.mediaId, assetSha256: options.badReadback ? hash("x") : upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, objectName: upload.objectName, generation: "7" }; },
    readObject: async (upload) => ({ mediaId: upload.mediaId, assetSha256: upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, objectName: upload.objectName, generation: "7" }),
    create: async (documents) => { events.push("create:" + String(documents.length)); if (options.failCreate) throw new Error("partial create failure"); },
    verifyRelease: async () => { events.push("audit"); },
    activate: async () => { events.push("activate"); },
    verifyActivation: async () => { events.push("verify-active"); },
    rollback: async () => { events.push("rollback"); },
  };
}

test("media publication creates objects, children, root receipt and CAS activation in order", async () => {
  const value = plan(), events: string[] = [];
  await applyOwnerMediaRelease(value, api(events), async () => structuredClone(value));
  assert.deepEqual(events, ["base", "object", "create:2", "audit", "create:1", "base", "create:1", "activate", "verify-active"]);
});
test("tampered prepared plan and stale base fail before upload", async () => {
  const value = plan(), events: string[] = [];
  const altered = structuredClone(value); altered.approvedCount = 1;
  await assert.rejects(applyOwnerMediaRelease(value, api(events), async () => altered), /deterministic source\/base rebuild/i);
  assert.deepEqual(events, []);
  await assert.rejects(applyOwnerMediaRelease(value, api(events, { stale: true }), async () => structuredClone(value)), /stale pointer/i);
  assert.deepEqual(events, ["base"]);
});
test("readback mismatch and partial failure never reach activation; retry remains available", async () => {
  const value = plan(), events: string[] = [];
  await assert.rejects(applyOwnerMediaRelease(value, api(events, { badReadback: true }), async () => structuredClone(value)), /Storage readback differs/i);
  assert.equal(events.includes("activate"), false);
  const failed: string[] = [];
  await assert.rejects(applyOwnerMediaRelease(value, api(failed, { failCreate: true }), async () => structuredClone(value)), /partial create failure/i);
  assert.equal(failed.includes("activate"), false);
  const retried: string[] = [];
  await applyOwnerMediaRelease(value, api(retried), async () => structuredClone(value));
  assert.equal(retried.at(-1), "verify-active");
});
test("rollback is conditional and retains an immutable restore receipt", async () => {
  const value = plan(), events: string[] = [];
  await rollbackOwnerMediaRelease(value, api(events), "media-rollback-001");
  assert.deepEqual(events, ["rollback"]);
  await assert.rejects(rollbackOwnerMediaRelease(value, api([]), "no"), /operation reference/i);
});


function firestoreDocument(path: string, data: Record<string, string>) {
  return {
    name: "projects/huroof-a3ee7/databases/(default)/documents/" + path,
    updateTime: "2026-09-12T00:00:00.000000Z",
    fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { stringValue: value }])),
  };
}

test("REST create-only retry skips exact immutable documents and rejects conflicting payloads", async () => {
  const path = "releases/test/questions/q1", document = { path, data: { value: "one" } };
  let existing: ReturnType<typeof firestoreDocument> | undefined;
  const calls: Array<{ url: string; body: unknown }> = [];
  const api = await createProductionOwnerMediaApi(process.cwd(), undefined, {
    accessToken: async () => "test-token",
    fetch: async (input, init) => {
      const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith(":batchGet")) return new Response(existing ? JSON.stringify([{ found: existing }]) : JSON.stringify([{ missing: "projects/huroof-a3ee7/databases/(default)/documents/" + path }]));
      if (url.endsWith(":commit")) return new Response("{}", { status: 200 });
      throw new Error("unexpected REST request " + url);
    },
  });
  await api.create([document]);
  assert.equal(calls.filter((call) => call.url.endsWith(":commit")).length, 1);
  const commit = calls.find((call) => call.url.endsWith(":commit"))?.body as { writes: Array<{ currentDocument: { exists: boolean } }> };
  assert.deepEqual(commit.writes.map((write) => write.currentDocument), [{ exists: false }]);

  calls.length = 0;
  existing = firestoreDocument(path, { value: "one" });
  await api.create([document]);
  assert.equal(calls.filter((call) => call.url.endsWith(":commit")).length, 0);

  existing = firestoreDocument(path, { value: "changed" });
  await assert.rejects(api.create([document]), /conflicts with an existing document/i);
});

test("private endpoint denial, owner authority, and allowlisted local paths fail closed", () => {
  assert.doesNotThrow(() => assertAnonymousPrivateReadbacks(401, 403));
  assert.throws(() => assertAnonymousPrivateReadbacks(500, 403), /401 or 403/i);
  assert.throws(() => assertAnonymousPrivateReadbacks(403, 200), /401 or 403/i);
  const approval = { approvalState: "owner_approved", manifestComplete: true, releaseActivated: false, sourceSnapshotSha256: "072dd09e41e2eaf652db75c9d5216d7515b5a7aff11fba180f864df118363180", sourceSnapshotDocumentCount: 18698, projectId: "huroof-a3ee7", databaseId: "(default)" };
  assert.doesNotThrow(() => assertOwnerMediaApproval(approval));
  assert.throws(() => assertOwnerMediaApproval({ ...approval, manifestComplete: false }), /authority/i);
  assert.throws(() => assertOwnerMediaApproval({ ...approval, sourceSnapshotDocumentCount: 1 }), /authority/i);
  const upload = plan().media.uploads[0]!;
  assert.match(resolveValidatedMediaLocalFile(process.cwd(), upload), /content[\\/]question-media[\\/]v18-private-240[\\/]originals[\\/]a\.png$/u);
  assert.throws(() => resolveValidatedMediaLocalFile(process.cwd(), { ...upload, localFile: "../escape.png" }), /escapes/i);
  assert.throws(() => resolveValidatedMediaLocalFile(process.cwd(), { ...upload, objectName: "question-media/other/object.png" }), /allowlisted/i);
});

test("first private object completes before any parallel remainder begins", async () => {
  const value = plan();
  const first = value.media.uploads[0]!;
  const second = { ...first, mediaId: "v18-tahadani-011-002", assetSha256: hash("9"), objectName: "question-media/v18/" + hash("9") + ".png", metadata: { ...first.metadata, mediaId: "v18-tahadani-011-002", assetSha256: hash("9") } };
  value.media.uploads.push(second); value.media.assetCount = 2; value.media.packageCounts.v18 = 2;
  let releaseFirst: (() => void) | undefined;
  const events: string[] = [];
  const gated: OwnerMediaApi = {
    ...api(events),
    ensureObject: async (upload) => {
      events.push("object:" + upload.mediaId);
      if (upload.mediaId === first.mediaId) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return { mediaId: upload.mediaId, assetSha256: upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, objectName: upload.objectName, generation: "7" };
    },
    readObject: async (upload) => ({ mediaId: upload.mediaId, assetSha256: upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, objectName: upload.objectName, generation: "7" }),
  };
  const running = applyOwnerMediaRelease(value, gated, async () => structuredClone(value));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["base", "object:" + first.mediaId]);
  releaseFirst?.();
  await running;
  assert.ok(events.includes("object:" + second.mediaId));
});

test("exact create classifier distinguishes missing, matching, and conflicting Firestore rows", () => {
  const document = { path: "releases/test/questions/q1", data: { value: "one" } };
  assert.deepEqual(documentsStillToCreate([document], [undefined]), [document]);
  assert.deepEqual(documentsStillToCreate([document], [firestoreDocument(document.path, { value: "one" })]), []);
  assert.throws(() => documentsStillToCreate([document], [firestoreDocument(document.path, { value: "changed" })]), /conflicts/i);
});



test("REST Storage adapter reads the manifest localFile and requires both anonymous byte denials", async () => {
  const root = await mkdtemp(join(tmpdir(), "owner-media-rest-"));
  const localFile = "images/011-001.jpg", bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
  const assetSha256 = createHash("sha256").update(bytes).digest("hex");
  const upload = {
    mediaId: "rebuild-v2-photo-011-001", assetSha256, contentType: "image/jpeg" as const, byteSize: bytes.length, width: 1, height: 1, localFile,
    objectName: "question-media/guess-picture-rebuild-v2/assets/" + assetSha256 + ".jpg", createOnly: true as const,
    metadata: { assetSha256, mediaId: "rebuild-v2-photo-011-001", contentType: "image/jpeg", byteSize: String(bytes.length), width: "1", height: "1" },
  };
  await mkdir(join(root, "content", "question-media", "guess-picture-rebuild-v2", "images"), { recursive: true });
  await writeFile(join(root, "content", "question-media", "guess-picture-rebuild-v2", localFile), bytes);
  const seen: Array<{ url: string; authorized: boolean }> = [];
  let metadataReads = 0;
  const api = await createProductionOwnerMediaApi(root, undefined, {
    accessToken: async () => "test-token",
    fetch: async (input, init) => {
      const url = String(input), headers = new Headers(init?.headers);
      const authorized = headers.has("Authorization"); seen.push({ url, authorized });
      if (url.includes("/upload/storage/")) {
        assert.match(url, /uploadType=multipart.*ifGenerationMatch=0/u);
        assert.doesNotMatch(url, /(?:[?&]name=|uploadType=media)/u);
        const contentType = headers.get("Content-Type") ?? "", boundary = /boundary=([^;\s]+)/u.exec(contentType)?.[1];
        assert.ok(boundary, "multipart upload requires a boundary");
        const body = Buffer.from(init?.body as Uint8Array), marker = Buffer.from("\r\n--" + boundary + "\r\nContent-Type: image/jpeg\r\n\r\n", "utf8");
        const metadataEnd = body.indexOf(marker), metadataStart = Buffer.byteLength("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n", "utf8");
        assert.ok(metadataEnd > metadataStart);
        assert.deepEqual(JSON.parse(body.subarray(metadataStart, metadataEnd).toString("utf8")), { name: upload.objectName, contentType: upload.contentType, metadata: upload.metadata });
        const payloadStart = metadataEnd + marker.length, payloadEnd = body.indexOf(Buffer.from("\r\n--" + boundary + "--\r\n", "utf8"), payloadStart);
        assert.deepEqual(body.subarray(payloadStart, payloadEnd), Buffer.from(bytes));
        return new Response("{}", { status: 200 });
      }
      if (url.includes("storage.googleapis.com/download/")) return authorized ? new Response(bytes, { status: 200 }) : new Response("denied", { status: 403 });
      if (url.includes("/storage/v1/")) {
        metadataReads += 1;
        if (metadataReads === 1) return new Response("missing", { status: 404 });
        return Response.json({ generation: "7", size: String(bytes.length), contentType: "image/jpeg", metadata: upload.metadata });
      }
      if (url.includes("firebasestorage.googleapis.com/")) return new Response("denied", { status: 401 });
      throw new Error("unexpected Storage request " + url);
    },
  });
  try {
    const readback = await api.ensureObject(upload);
    assert.equal(readback.generation, "7");
    assert.ok(seen.some((call) => call.authorized && call.url.includes("/upload/storage/")));
    assert.ok(seen.some((call) => !call.authorized && call.url.includes("storage.googleapis.com/download/")));
    assert.ok(seen.some((call) => !call.authorized && call.url.includes("firebasestorage.googleapis.com/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("REST Storage adapter rejects download-token metadata before release association", async () => {
  const root = await mkdtemp(join(tmpdir(), "owner-media-token-"));
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]), assetSha256 = createHash("sha256").update(bytes).digest("hex");
  const upload = { mediaId: "rebuild-v2-photo-011-001", assetSha256, contentType: "image/jpeg" as const, byteSize: bytes.length, width: 1, height: 1, localFile: "images/011-001.jpg", objectName: "question-media/guess-picture-rebuild-v2/assets/" + assetSha256 + ".jpg", createOnly: true as const, metadata: { assetSha256, mediaId: "rebuild-v2-photo-011-001", contentType: "image/jpeg", byteSize: String(bytes.length), width: "1", height: "1" } };
  const api = await createProductionOwnerMediaApi(root, undefined, {
    accessToken: async () => "test-token",
    fetch: async (input) => String(input).includes("/storage/v1/")
      ? Response.json({ generation: "7", size: String(bytes.length), contentType: "image/jpeg", metadata: { ...upload.metadata, firebaseStorageDownloadTokens: "must-not-be-present" } })
      : new Response("unexpected", { status: 500 }),
  });
  try {
    await assert.rejects(api.ensureObject(upload), /download-token metadata/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function firestoreFields(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreFields) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, firestoreFields(item)])) } };
}
function fromFirestore(value: Record<string, unknown>): unknown {
  if ("nullValue" in value) return null;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.booleanValue === "boolean") return value.booleanValue;
  if (typeof value.integerValue === "string") return Number(value.integerValue);
  if (value.arrayValue) return ((value.arrayValue as { values?: Record<string, unknown>[] }).values ?? []).map(fromFirestore);
  return Object.fromEntries(Object.entries(((value.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {})).map(([key, item]) => [key, fromFirestore(item)]));
}
function persistentTransport(initial: Record<string, Record<string, unknown>>, bytes: Uint8Array, upload: OwnerMediaPlan["media"]["uploads"][number]) {
  const documents = new Map(Object.entries(initial));
  let storedBytes: Uint8Array | undefined, storedMetadata: Record<string, string> | undefined, commits = 0; const generation = "7";
  const responseDocument = (path: string, data: Record<string, unknown>) => ({ name: "projects/huroof-a3ee7/databases/(default)/documents/" + path, updateTime: "2026-09-12T00:00:00.000000Z", fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreFields(value)])) });
  const directDocuments = (path: string) => [...documents.entries()].filter(([key]) => key.startsWith(path + "/") && key.slice(path.length + 1).split("/").length === 1).map(([key, value]) => responseDocument(key, value));
  const transport: typeof fetch = async (input, init) => {
    const url = String(input), request = new URL(url), body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.includes("/upload/storage/")) {
      const headers = new Headers(init?.headers), boundary = /boundary=([^;\s]+)/u.exec(headers.get("Content-Type") ?? "")?.[1];
      assert.match(url, /uploadType=multipart.*ifGenerationMatch=0/u); assert.ok(boundary);
      assert.equal(headers.has("x-goog-meta-assetSha256"), false);
      const raw = Buffer.from(init?.body as Uint8Array), prefix = Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n", "utf8"), marker = Buffer.from("\r\n--" + boundary + "\r\nContent-Type: " + upload.contentType + "\r\n\r\n", "utf8");
      const metadataEnd = raw.indexOf(marker), payloadStart = metadataEnd + marker.length, payloadEnd = raw.indexOf(Buffer.from("\r\n--" + boundary + "--\r\n", "utf8"), payloadStart);
      assert.ok(metadataEnd > prefix.length && payloadEnd >= payloadStart);
      const metadata = JSON.parse(raw.subarray(prefix.length, metadataEnd).toString("utf8")) as { name?: string; contentType?: string; metadata?: Record<string, string> };
      assert.deepEqual(metadata, { name: upload.objectName, contentType: upload.contentType, metadata: upload.metadata });
      storedMetadata = metadata.metadata; storedBytes = new Uint8Array(raw.subarray(payloadStart, payloadEnd)); assert.deepEqual(storedBytes, bytes);
      return Response.json({});
    }
    if (url.includes("storage.googleapis.com/download/")) return new Headers(init?.headers).has("Authorization") ? new Response(storedBytes as unknown as BodyInit, { status: 200 }) : new Response("denied", { status: 403 });
    if (url.includes("/storage/v1/")) return storedBytes ? Response.json({ generation, size: String(storedBytes.length), contentType: upload.contentType, metadata: storedMetadata }) : new Response("missing", { status: 404 });
    if (url.includes("firebasestorage.googleapis.com/")) return new Response("denied", { status: 401 });
    if (url.endsWith("/databases/(default)")) return Response.json({ locationId: "me-central2", type: "FIRESTORE_NATIVE" });
    if (url.endsWith(":beginTransaction")) return Response.json({ transaction: "tx-1" });
    if (url.endsWith(":batchGet")) {
      const rows = (body.documents as string[]).map((name) => {
        const path = name.split("/documents/")[1]!; const data = documents.get(path);
        return data ? { found: responseDocument(path, data) } : { missing: name };
      });
      return Response.json(rows);
    }
    if (url.endsWith(":commit")) {
      for (const write of body.writes as Array<{ update?: { name: string; fields: Record<string, Record<string, unknown>> }; currentDocument?: { exists?: boolean }; delete?: string }>) {
        if (write.delete) { documents.delete(write.delete.split("/documents/")[1]!); continue; }
        const path = write.update!.name.split("/documents/")[1]!;
        if (write.currentDocument?.exists === false && documents.has(path)) return new Response("already exists", { status: 409 });
        documents.set(path, Object.fromEntries(Object.entries(write.update!.fields).map(([key, value]) => [key, fromFirestore(value)])));
      }
      commits += 1; return Response.json({});
    }
    if (url.endsWith(":listCollectionIds")) {
      const path = url.split("/documents/")[1]!.replace(":listCollectionIds", "");
      const ids = [...new Set([...documents.keys()].filter((key) => key.startsWith(path + "/")).map((key) => key.slice(path.length + 1).split("/")[0]!))].sort();
      return Response.json({ collectionIds: ids });
    }
    if (url.includes("/documents/")) return Response.json({ documents: directDocuments(request.pathname.split("/documents/")[1]!) });
    throw new Error("unexpected persistent REST request " + url);
  };
  return { transport, documents, commits: () => commits };
}

test("persistent REST transport resumes an exact activation and rejects altered materialized identities", async () => {
  const value = plan(), root = value.documents.find((document) => document.path === "releases/" + value.releaseId)!;
  value.documents = [
    { path: "releases/" + value.releaseId + "/catalogCategories/tahadani-011", data: { id: "tahadani-011", immutable: true } },
    { path: "releases/" + value.releaseId + "/inventory/tahadani-011", data: { categoryId: "tahadani-011", immutable: true } },
    ...value.documents.filter((document) => document !== root), root,
  ];
  const baseRoot = value.base.root.path;
  value.base.children = [
    { path: baseRoot + "/catalogCategories/tahadani-011", data: { id: "tahadani-011" } },
    { path: baseRoot + "/inventory/tahadani-011", data: { categoryId: "tahadani-011" } },
    { path: baseRoot + "/questions/old", data: { id: "old" } },
  ];
  const mediaBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const assetSha256 = createHash("sha256").update(mediaBytes).digest("hex");
  const upload = value.media.uploads[0]!;
  upload.assetSha256 = assetSha256;
  upload.objectName = "question-media/v18/" + assetSha256 + ".png";
  upload.metadata = { ...upload.metadata, assetSha256 };
  const approval = { approvalState: "owner_approved", manifestComplete: true, releaseActivated: false, sourceSnapshotSha256: "072dd09e41e2eaf652db75c9d5216d7515b5a7aff11fba180f864df118363180", sourceSnapshotDocumentCount: 18698, projectId: "huroof-a3ee7", databaseId: "(default)" };
  const initial: Record<string, Record<string, unknown>> = {
    "runtime/activeRelease": value.base.pointer,
    [baseRoot]: value.base.root.data,
    "contentOwnerApprovals/owner-approval-072dd09e41e2eaf652db75c9d5216d7515b5a7aff11fba180f864df118363180": approval,
  };
  for (const document of value.base.children) initial[document.path] = document.data;
  const rootDir = await mkdtemp(join(tmpdir(), "owner-media-persistent-"));
  await mkdir(join(rootDir, "content", "question-media", "v18-private-240", "originals"), { recursive: true });
  await writeFile(join(rootDir, "content", "question-media", "v18-private-240", "originals", "a.png"), mediaBytes);
  const state = persistentTransport(initial, mediaBytes, upload);
  const api = await createProductionOwnerMediaApi(rootDir, undefined, { accessToken: async () => "test-token", fetch: state.transport });
  try {
    await applyOwnerMediaRelease(value, api, async () => structuredClone(value));
    const firstCommitCount = state.commits();
    await applyOwnerMediaRelease(value, api, async () => structuredClone(value));
    assert.equal(state.commits(), firstCommitCount, "an exact post-activation retry must be a verified no-op");
    await verifyOwnerMediaRelease(value, api);
    const materializedRootPath = "releases/" + value.releaseId, materializedRoot = state.documents.get(materializedRootPath)!;
    state.documents.set(materializedRootPath, { ...materializedRoot, documentRootSha256: hash("altered-root") });
    await assert.rejects(verifyOwnerMediaRelease(value, api), /materialized prepared release/i);
    state.documents.set(materializedRootPath, materializedRoot);
    const verificationPath = [...state.documents.keys()].find((path) => path.startsWith("ownerMediaReleaseVerificationReceipts/" + value.releaseId + "-"))!;
    const verification = state.documents.get(verificationPath)!;
    state.documents.set(verificationPath, { ...verification, documentRootSha256: hash("altered-receipt") });
    await assert.rejects(verifyOwnerMediaRelease(value, api), /materialized prepared release/i);
    state.documents.set(verificationPath, verification);
    const active = state.documents.get("runtime/activeRelease")!;
    state.documents.set("runtime/activeRelease", { ...active, documentRootSha256: hash("z") });
    await assert.rejects(rollbackOwnerMediaRelease(value, api, "persistent-rollback-001"), /materialized active media identity/i);
    state.documents.set("runtime/activeRelease", active);
    await rollbackOwnerMediaRelease(value, api, "persistent-rollback-002");
    assert.deepEqual(state.documents.get("runtime/activeRelease"), value.base.pointer);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
