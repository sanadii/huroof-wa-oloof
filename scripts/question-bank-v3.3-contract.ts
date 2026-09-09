import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJsonV32 } from '../src/question-bank-v3.2.js';
import { createScopeManifestV33, generateSlotsV33, policyHashV33, type V33CategoryPolicy } from '../src/question-bank-v3.3.js';

const ROOT = process.cwd();
const V33 = resolve(ROOT, 'content/question-bank-v3/v3.3');
const writeCanonical = async (path: string, value: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${canonicalJsonV32(value)}\n`); };

/** Writes only shared contract artifacts; it never creates category questions, evidence, or approvals. */
export async function writeScopeManifestV33(path = resolve(V33, 'scope.manifest.v3.3.json')) {
  const manifest = createScopeManifestV33(); await writeCanonical(path, manifest); return manifest;
}
export async function writeSlotLedgerV33(policyPath: string, outputPath: string) {
  const policy = JSON.parse(await readFile(policyPath, 'utf8')) as V33CategoryPolicy;
  if (policy.policyHash !== policyHashV33(policy)) throw new Error('Refusing to generate a ledger from a stale policy hash.');
  const slots = generateSlotsV33(policy); await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${slots.map(canonicalJsonV32).join('\n')}\n`); return slots;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'scope' && args.length === 0) { const manifest = await writeScopeManifestV33(); console.log(JSON.stringify(manifest, null, 2)); return; }
  if (command === 'ledger' && args.length === 2) { const slots = await writeSlotLedgerV33(resolve(args[0]), resolve(args[1])); console.log(JSON.stringify({ slots: slots.length, output: resolve(args[1]) }, null, 2)); return; }
  throw new Error('Usage: question-bank-v3.3-contract <scope|ledger POLICY.json OUTPUT.jsonl>.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
