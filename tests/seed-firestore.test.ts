import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildDemoDraftSeed } from '../scripts/seed-firestore.js';

test('demo emulator seed adds only required legacy runtime identity fields', async () => {
  const root = process.cwd();
  const source = (await readFile(resolve(root, 'content/questions/drafts/questions.jsonl'), 'utf8'))
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const plan = await buildDemoDraftSeed();
  assert.equal(plan.documents.length, source.length);

  for (const [index, document] of plan.documents.entries()) {
    const original = source[index];
    const seeded = document.data as Record<string, unknown>;
    assert.equal(seeded.id, original.id);
    assert.equal(seeded.targetLetter, original.targetLetter);
    assert.equal(seeded.status, original.status);
    assert.equal(seeded.categoryId, original.categoryId);
    assert.equal(seeded.promptAr, original.promptAr);
    assert.equal(seeded.demoUnreviewed, true);
    assert.equal(seeded.modality, original.modality ?? 'classic');
    assert.equal(seeded.answerConceptId, original.answerConceptId ?? `legacy:${original.id}`);
  }
});
