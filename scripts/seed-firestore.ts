import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assertDemoEmulatorTarget } from './build-firestore-release.js';

const ROOT = process.cwd(); const RELEASE_ID = 'demo-unreviewed-drafts-v1'; const BATCH_LIMIT = 400;
type Draft = { id: string; targetLetter: string; status: string; [key: string]: unknown };
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
function chunks<T>(items: T[]): T[][] { return Array.from({ length: Math.ceil(items.length / BATCH_LIMIT) }, (_, index) => items.slice(index * BATCH_LIMIT, (index + 1) * BATCH_LIMIT)); }

/** Deliberately separate from the approved release pipeline: these are unreviewed emulator-only draft fixtures. */
export function normalizeDemoDraftForRuntime(draft: Draft) {
  return {
    ...draft,
    // Matches the legacy fixture compatibility used by server/service.ts. Invalid
    // supplied values still reach the runtime validator and fail closed.
    modality: draft.modality ?? 'classic',
    answerConceptId: draft.answerConceptId ?? `legacy:${draft.id}`,
    demoUnreviewed: true as const,
  };
}

export async function buildDemoDraftSeed() {
  const drafts = (await readFile(resolve(ROOT, 'content/questions/drafts/questions.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Draft);
  const letters = new Set(drafts.map((draft) => draft.targetLetter?.trim()).filter(Boolean));
  if (drafts.length < 25 || letters.size < 25 || drafts.some((draft) => draft.status !== 'draft')) throw new Error('Demo fixture requires at least 25 distinct-letter, explicitly unreviewed drafts.');
  const documentRootSha256 = hash(JSON.stringify(drafts.map((draft) => ({ id: draft.id, targetLetter: draft.targetLetter }))));
  return { releaseId: RELEASE_ID, documentRootSha256, letters: letters.size, documents: drafts.map((draft) => ({ path: `releases/${RELEASE_ID}/questions/${draft.id}`, data: normalizeDemoDraftForRuntime(draft) })) };
}
async function main() {
  if (!process.argv.includes('--demo')) throw new Error('Refusing to seed anything except the explicit --demo draft fixture.');
  const plan = await buildDemoDraftSeed();
  if (process.argv.includes('--dry-run')) { console.log(`Dry run: ${plan.documents.length} unreviewed demo draft questions across ${plan.letters} letters.`); return; }
  assertDemoEmulatorTarget();
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app'); const { getFirestore } = await import('firebase-admin/firestore'); const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT }); const database = getFirestore(app);
  const root = database.doc(`releases/${plan.releaseId}`); if ((await root.get()).exists) throw new Error(`Immutable demo fixture already exists: ${root.path}`);
  for (const group of chunks(plan.documents)) { const batch = database.batch(); for (const entry of group) batch.create(database.doc(entry.path), entry.data); await batch.commit(); }
  await root.create({ releaseId: plan.releaseId, immutable: true, demoFixture: true, unreviewed: true, approvedCount: plan.documents.length, documentRootSha256: plan.documentRootSha256, distinctLetters: plan.letters });
  await database.doc('runtime/activeRelease').set({ releaseId: plan.releaseId, demoFixture: true, unreviewed: true });
  console.log(`Seeded ${plan.documents.length} explicitly unreviewed draft questions to the demo emulator.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
