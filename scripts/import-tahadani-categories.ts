import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { sha256File } from '../src/question-bank.js';

const ROOT = process.cwd();
const SOURCE = 'D:/projects/tahadani';
const EXPECTED = {
  manifest: '5c787c9982eba35aaa95211edc571a20ab2ee692de0399b62a508fb3cf759318',
  mapping: 'e40af8f08f5095fa24c2c66f35d2b329cb285d6b60d02f3298dd6622f8cf213d'
};
export type LegacyCategory = { index: number; display_name: string; slug: string; mode: string; subtype_policy: string };
type Manifest = { version: number; categories: LegacyCategory[] };
export type CoverMapping = { displayName: string; imageName: string };

function compatibility(mode: string): 'text' | 'image_pending' | 'separate_mode' {
  return mode === 'image' ? 'image_pending' : mode === 'charades' ? 'separate_mode' : 'text';
}
export function assertMappingInventory(categories: LegacyCategory[], mappings: CoverMapping[]) {
  if (categories.length !== 62 || mappings.length !== 62) throw new Error('Expected exactly 62 categories and mappings.');
  for (let i = 0; i < 62; i++) if (categories[i].index !== i + 1 || categories[i].display_name !== mappings[i].displayName) throw new Error(`Non-contiguous or mismatched mapping at ${i + 1}.`);
}
export async function verifyCopiedAsset(sourcePath: string, destinationPath: string) {
  const [sourceHash, destinationHash] = await Promise.all([sha256File(sourcePath), sha256File(destinationPath)]);
  if (sourceHash !== destinationHash) throw new Error(`Destination hash mismatch for ${destinationPath}.`);
  return sourceHash;
}

async function main() {
  const manifestPath = join(SOURCE, 'category_manifest.json');
  const mapPath = join(SOURCE, 'top_50_categories.md');
  const [manifestHash, mappingHash, manifestText, mappingText] = await Promise.all([sha256File(manifestPath), sha256File(mapPath), readFile(manifestPath, 'utf8'), readFile(mapPath, 'utf8')]);
  if (manifestHash !== EXPECTED.manifest || mappingHash !== EXPECTED.mapping) throw new Error('Audited Tahadani manifest/mapping hash drift; import stopped.');
  const manifest = JSON.parse(manifestText) as Manifest;
  const mappings: CoverMapping[] = [...mappingText.matchAll(/\[([^\]]+)\]\(<images\/cropped\/([^>]+)>\)/g)].map((m) => ({ displayName: m[1], imageName: m[2] }));
  if (manifest.version !== 2) throw new Error('Expected manifest version 2.'); assertMappingInventory(manifest.categories, mappings);
  const originals = join(ROOT, 'content/categories/originals'); await mkdir(originals, { recursive: true });
  const receiptRows = [] as Record<string, unknown>[]; const categories = [] as Record<string, unknown>[];
  for (const [offset, category] of manifest.categories.entries()) {
    const mapping = mappings[offset]; const fileName = `category-${String(category.index).padStart(3, '0')}.png`;
    const sourcePath = join(SOURCE, 'images/cropped', mapping.imageName); const destination = join(originals, fileName);
    await copyFile(sourcePath, destination);
    const [sourceHash, metadata] = await Promise.all([verifyCopiedAsset(sourcePath, destination), sharp(destination).metadata()]);
    if (metadata.format !== 'png' || !metadata.width || metadata.width !== metadata.height) throw new Error(`Integrity failure for category ${category.index}.`);
    const runtimeOriginal = `content/categories/originals/${fileName}`;
    receiptRows.push({ legacyIndex: category.index, sourcePath: `images/cropped/${mapping.imageName}`, destinationPath: runtimeOriginal, sourceSha256: sourceHash, destinationSha256: sourceHash, width: metadata.width, height: metadata.height, copiedAt: new Date().toISOString() });
    categories.push({ id: `tahadani-${String(category.index).padStart(3, '0')}`, legacyIndex: category.index, displayNameAr: category.display_name, slug: category.slug, sourceMode: category.mode, sourcePolicy: category.subtype_policy, classicCompatibility: compatibility(category.mode), catalogStatus: 'imported', questionReadiness: 'empty', cover: { original: runtimeOriginal, web320: `assets/categories/320/category-${String(category.index).padStart(3, '0')}.webp`, web640: `assets/categories/640/category-${String(category.index).padStart(3, '0')}.webp`, width: metadata.width, height: metadata.height, sha256: sourceHash, altAr: `غلاف فئة ${category.display_name}`, rightsStatus: 'unverified_legacy_import', publishable: false }, provenance: { sourceRepository: 'D:/projects/tahadani', manifestVersion: 2, sourceImageName: mapping.imageName } });
  }
  const groups = new Map<string, number[]>(); for (const row of receiptRows) { const hash = row.sourceSha256 as string; groups.set(hash, [...(groups.get(hash) ?? []), row.legacyIndex as number]); }
  const duplicateByteGroups = [...groups.values()].filter((group) => group.length > 1);
  if (JSON.stringify(duplicateByteGroups) !== JSON.stringify([[1, 59]])) throw new Error(`Expected only duplicate cover group [1,59], got ${JSON.stringify(duplicateByteGroups)}.`);
  await mkdir(join(ROOT, 'content/categories'), { recursive: true });
  await writeFile(join(ROOT, 'content/categories/categories.json'), JSON.stringify({ schemaVersion: 1, categories }, null, 2) + '\n');
  await writeFile(join(ROOT, 'content/categories/import-receipt.json'), JSON.stringify({ schemaVersion: 1, source: { manifestSha256: manifestHash, mappingSha256: mappingHash, mappingRows: 62 }, copiedAssets: receiptRows, duplicateByteGroups }, null, 2) + '\n');
  console.log(`Imported ${categories.length} category covers; duplicate bytes: ${JSON.stringify(duplicateByteGroups)}.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error); process.exitCode = 1; });
