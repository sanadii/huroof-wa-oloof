import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type SourceCatalog = {
  categories: Array<{ sourceCategoryId: string }>;
};

const sourcePath = resolve("content/source-catalog/huroof-everything-v1.json");
const destinationPath = resolve("src/data/source-category-ids.public.json");
const source = JSON.parse(await readFile(sourcePath, "utf8")) as SourceCatalog;
const sourceCategoryIds = source.categories.map(({ sourceCategoryId }) => sourceCategoryId);

if (sourceCategoryIds.length === 0 || new Set(sourceCategoryIds).size !== sourceCategoryIds.length || sourceCategoryIds.some((id) => !/^(?:tahadani|huroof)-\d{3}$/.test(id))) {
  throw new Error("Source category catalog has invalid public category identifiers.");
}

await writeFile(
  destinationPath,
  `${JSON.stringify({ schemaVersion: 1, sourceCategoryIds }, null, 2)}\n`,
  "utf8",
);
