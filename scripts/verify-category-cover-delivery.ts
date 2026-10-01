import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { preview } from "vite";
import sourceCoverMapping from "../src/data/tahadani-games-category-covers.public.json" with { type: "json" };
import { catalogCategoryCovers } from "../src/data/local-question-inventory.js";

type LiveCategoryFixture = {
  schemaVersion: number;
  source: string;
  sourceSha256: string;
  categoryCount: number;
  categories: Array<{ id: string; labelAr: string }>;
};

const root = process.cwd();
const publicRoot = path.resolve(root, "public");
const distRoot = path.resolve(root, "dist");
const fixturePath = path.resolve(root, "tests/fixtures/t44-live-category-catalog.json");
const mimeByExtension: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function confinedPath(base: string, relative: string): string {
  assert.match(relative, /^assets\/categories\//, `unexpected cover path: ${relative}`);
  assert(!relative.includes("\\"), `backslash in cover path: ${relative}`);
  const resolved = path.resolve(base, relative);
  assert(resolved.startsWith(`${base}${path.sep}`), `cover path escapes root: ${relative}`);
  return resolved;
}

function imageMagicMatches(file: string, bytes: Buffer): boolean {
  switch (path.extname(file).toLowerCase()) {
    case ".webp":
      return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    case ".png":
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case ".jpg":
    case ".jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
    default:
      return false;
  }
}

async function decode(file: string, bytes: Buffer): Promise<void> {
  const result = await sharp(bytes, { failOn: "error" }).metadata();
  assert(result.width && result.height, `missing image dimensions: ${file}`);
  assert(mimeByExtension[path.extname(file).toLowerCase()], `unsupported cover type: ${file}`);
  await sharp(bytes, { failOn: "error" }).toBuffer();
}

async function main(): Promise<void> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as LiveCategoryFixture;
  assert.equal(fixture.schemaVersion, 1);
  assert.match(fixture.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(fixture.categoryCount, 530);
  assert.equal(fixture.categories.length, fixture.categoryCount);
  assert.equal(new Set(fixture.categories.map((category) => category.id)).size, 530);

  const sourceCategories = sourceCoverMapping.categories.filter((category) => category.cover !== null);
  assert.equal(sourceCoverMapping.categories.length, 558);
  assert.equal(sourceCategories.length, 558, "a source category has no mapped cover");
  assert.equal(new Set(sourceCategories.map((category) => category.categoryId)).size, 558);

  const liveCovers = catalogCategoryCovers(fixture.categories);
  assert.equal(liveCovers.length, 530);
  assert.equal(new Set(liveCovers.map((category) => category.id)).size, 530);
  const paths = new Set<string>();
  for (const category of liveCovers) {
    assert(!category.cover.altAr.includes("افتراضية"), `live category used generic fallback: ${category.id}`);
    paths.add(category.cover.web320);
  }
  for (const category of sourceCategories) {
    paths.add(category.cover!.web320);
    paths.add(category.cover!.web640);
  }

  const sortedPaths = [...paths].sort();
  const sourcePaths = new Set(sourceCategories.flatMap((category) => [category.cover!.web320, category.cover!.web640]));
  assert.equal(sourcePaths.size, 1088, "unexpected unique source delivery-path total");
  assert(sortedPaths.length >= sourcePaths.size);
  const buildStat = await stat(distRoot).catch(() => null);
  assert(buildStat?.isDirectory(), "dist output missing; run npm run build first");
  const publicBytes = new Map<string, Buffer>();
  for (const relative of sortedPaths) {
    const file = confinedPath(publicRoot, relative);
    const bytes = await readFile(file);
    assert(imageMagicMatches(file, bytes), `wrong file signature in public: ${relative}`);
    await decode(file, bytes);
    publicBytes.set(relative, bytes);
  }

  for (const relative of sortedPaths) {
    const file = confinedPath(distRoot, relative);
    const bytes = await readFile(file);
    assert(imageMagicMatches(file, bytes), `wrong file signature in dist: ${relative}`);
    await decode(file, bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), createHash("sha256").update(publicBytes.get(relative)!).digest("hex"), `public/dist bytes differ: ${relative}`);
  }

  const server = await preview({ preview: { host: "127.0.0.1", port: 0, strictPort: false } });
  try {
    const address = server.httpServer.address();
    assert(address && typeof address !== "string", "Vite preview did not bind a TCP port");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    for (let start = 0; start < sortedPaths.length; start += 16) {
      const batch = sortedPaths.slice(start, start + 16);
      await Promise.all(batch.map(async (relative) => {
      const response = await fetch(`${baseUrl}/${relative}`);
      assert.equal(response.status, 200, `preview returned ${response.status}: ${relative}`);
      assert.equal(response.headers.get("content-type")?.split(";")[0], mimeByExtension[path.extname(relative).toLowerCase()], `preview MIME mismatch: ${relative}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(imageMagicMatches(relative, bytes), `preview did not return image bytes: ${relative}`);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), createHash("sha256").update(publicBytes.get(relative)!).digest("hex"), `preview bytes differ: ${relative}`);
      }));
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
  }

  const sourceRights = sourceCategories.reduce<Record<string, number>>((counts, category) => {
    const key = `${category.cover!.source}:${category.cover!.publishable}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({ liveCategories: liveCovers.length, liveUnverifiedRights: liveCovers.filter((category) => !category.cover.publishable).length, sourceCategories: sourceCategories.length, sourceRights, uniqueSourcePaths: sourcePaths.size, uniqueLiveAndSourcePaths: sortedPaths.length, publicDecoded: sortedPaths.length, distDecoded: sortedPaths.length, previewMimeAndMagic: sortedPaths.length, fixtureSourceSha256: fixture.sourceSha256 }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
