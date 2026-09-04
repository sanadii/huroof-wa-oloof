import { AUTHORING_VERSION, readinessForPack, type RuntimeItem } from '../src/question-bank-v2.js';
import { SUPPORTED_LETTERS } from '../src/question-bank.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function classic(categoryId: string, reserve = 8): RuntimeItem[] {
  return SUPPORTED_LETTERS.flatMap((targetLetter, letterIndex) => Array.from({ length: reserve }, (_, ordinal) => ({ id: `${categoryId}-${letterIndex}-${ordinal}`, categoryId, targetLetter, modality: 'classic' as const, status: 'approved' as const, validUntil: null, policyVersion: AUTHORING_VERSION, schemaValid: true, policyValid: true })));
}

export function simulateAuthoringPacks(rounds = 1_000) {
  const standalone = classic('tahadani-006'); const combined = [...classic('tahadani-006', 4), ...classic('tahadani-007', 4)];
  const expired = classic('tahadani-008').map((item) => ({ ...item, validUntil: '2026-09-02' }));
  const blocked = classic('tahadani-009').map((item) => ({ ...item, policyValid: false }));
  const insufficient = classic('tahadani-010', 7); const charades = classic('tahadani-016').map((item) => ({ ...item, modality: 'charades' as const }));
  for (let seed = 0; seed < rounds; seed++) {
    if (!readinessForPack(standalone, ['tahadani-006'], '2026-09-03').playable) throw new Error(`standalone failed at ${seed}`);
    if (!readinessForPack(combined, ['tahadani-006', 'tahadani-007'], '2026-09-03').playable) throw new Error(`combined failed at ${seed}`);
    for (const [items, categoryId] of [[expired, 'tahadani-008'], [blocked, 'tahadani-009'], [insufficient, 'tahadani-010'], [charades, 'tahadani-016']] as const) if (readinessForPack(items, [categoryId], '2026-09-03').playable) throw new Error(`invalid inventory became playable at ${seed}`);
  }
  return { rounds, scenarios: ['standalone', 'combined-only', 'expired', 'blocked', 'insufficient-reserve', 'charades-excluded'] };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) console.log(JSON.stringify(simulateAuthoringPacks()));
