import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { sha256File } from '../src/question-bank.js';

const ROOT = process.cwd();
async function main() {
  const originals = join(ROOT, 'content/categories/originals'); const output = join(ROOT, 'public/assets/categories');
  const files = (await readdir(originals)).filter((file) => /^category-\d{3}\.png$/.test(file)).sort();
  if (files.length !== 62) throw new Error(`Expected 62 originals before derivative build, found ${files.length}.`);
  const rows: Record<string, unknown>[] = [];
  for (const file of files) {
    const original = join(originals, file); const meta = await sharp(original).metadata();
    if (!meta.width || !meta.height || meta.width !== meta.height) throw new Error(`${file} is not a square image.`);
    const derivatives: Record<string, unknown> = {};
    for (const size of [320, 640]) {
      const destination = join(output, String(size), file.replace('.png', '.webp')); await mkdir(join(output, String(size)), { recursive: true });
      await sharp(original).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(destination);
      const derivedMeta = await sharp(destination).metadata();
      if (!derivedMeta.width || derivedMeta.width > size || derivedMeta.height! > size || derivedMeta.width! > meta.width || derivedMeta.height! > meta.height) throw new Error(`Derivative upscale detected for ${file}.`);
      derivatives[String(size)] = { path: `assets/categories/${size}/${file.replace('.png', '.webp')}`, width: derivedMeta.width, height: derivedMeta.height, sha256: await sha256File(destination) };
    }
    rows.push({ file, originalSha256: await sha256File(original), width: meta.width, height: meta.height, derivatives });
  }
  await writeFile(join(ROOT, 'content/categories/asset-manifest.json'), JSON.stringify({ schemaVersion: 1, generatedFrom: 'content/categories/originals', assets: rows }, null, 2) + '\n');
  console.log(`Built ${files.length * 2} non-upscaled WebP derivatives.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
