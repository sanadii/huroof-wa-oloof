/** Publish one already reviewed, release-bound aggregate; never changes the active pointer. */
import { readFile } from "node:fs/promises";
import { assertProductionTarget, createAdminProductionAdapter, PRODUCTION_DATABASE, PRODUCTION_LOCATION, PRODUCTION_PROJECT } from "./firestore-release-publisher.js";
import { isQuestionTypeReleaseIndex, publishQuestionTypeReleaseIndex, questionTypeIndexDocument } from "./question-type-release-index.js";

function flags(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index], value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || result[key.slice(2)] !== undefined)
      throw new Error("Use unique --name value pairs.");
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const input = flags(process.argv.slice(2));
  const required = ["index", "index-sha256", "release-id", "root-sha256", "project", "database", "location", "apply"];
  if (Object.keys(input).length !== required.length || required.some((key) => !input[key]) || input.apply !== "yes")
    throw new Error(`Required flags: ${required.map((key) => `--${key}`).join(" ")}; --apply must equal yes.`);
  assertProductionTarget(input);
  const parsed = JSON.parse(await readFile(input.index, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid prepared index document.");
  if (Object.keys(parsed).length !== 2 || !Object.hasOwn(parsed, "path") || !Object.hasOwn(parsed, "data"))
    throw new Error("Prepared index document has unexpected fields.");
  const document = parsed as { path?: unknown; data?: unknown };
  if (!isQuestionTypeReleaseIndex(document.data)) throw new Error("Prepared question-type index failed validation.");
  const index = document.data;
  const expectedDocument = questionTypeIndexDocument(index);
  if (document.path !== expectedDocument.path ||
      index.indexSha256 !== input["index-sha256"] ||
      index.releaseId !== input["release-id"] ||
      index.releaseRootSha256 !== input["root-sha256"])
    throw new Error("Prepared index identity or reviewed digest mismatch.");
  const adapter = await createAdminProductionAdapter();
  if (await adapter.getProjectId() !== PRODUCTION_PROJECT)
    throw new Error("Production project identity mismatch.");
  const metadata = await adapter.getDatabaseMetadata(PRODUCTION_PROJECT, PRODUCTION_DATABASE);
  if (metadata.locationId !== PRODUCTION_LOCATION || metadata.type !== "FIRESTORE_NATIVE")
    throw new Error("Production database identity mismatch.");
  const result = await publishQuestionTypeReleaseIndex(index, adapter);
  console.log(JSON.stringify({ releaseId: index.releaseId, releaseRootSha256: index.releaseRootSha256, indexSha256: index.indexSha256, created: result.created, path: result.path }));
}

void main().catch((failure) => {
  console.error(failure instanceof Error ? failure.message : failure);
  process.exitCode = 1;
});
