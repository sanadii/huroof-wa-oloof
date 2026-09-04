import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJsonV32, exactNormalizeV1, type QuestionV32 } from '../src/question-bank-v3.2.js';

const ROOT = process.cwd(); const PILOTS = join(ROOT, 'content/question-bank-v3/v3.2/pilots'); const OUT = join(ROOT, 'content/question-bank-v3/v3.2/reports/alias-remediation.v3.2.json');
async function files(directory: string): Promise<string[]> { const values = await readdir(directory, { withFileTypes: true }); return (await Promise.all(values.map((value) => value.isDirectory() ? files(join(directory, value.name)) : [join(directory, value.name)]))).flat(); }
/** Non-mutating ownership inventory. It never edits the append-only migration snapshot. */
export async function reportV32AliasRemediation(source = PILOTS, output = OUT) {
  const questions = (await Promise.all((await files(source)).filter((path) => path.endsWith('.questions.jsonl')).map(async (path) => (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as QuestionV32)))).flat();
  const removals = questions.flatMap((question) => question.acceptedAnswers.flatMap((alias, index) => exactNormalizeV1(alias) === exactNormalizeV1(question.canonicalAnswer) ? [{ questionId: question.id, categoryId: question.categoryId, acceptedAnswerIndex: index, canonicalAnswer: question.canonicalAnswer, acceptedAnswer: alias, normalizedAnswer: exactNormalizeV1(alias), action: 'Remove only this redundant acceptedAnswers entry in a future category-owner authoring revision; retain this v3.2 migration record unchanged.' }] : []));
  const report = { schemaVersion: '3.2.0', policyVersion: 'question-bank-duplicate-v3.2', kind: 'non_mutating_alias_remediation_inventory', source: 'content/question-bank-v3/v3.2/pilots', questionCount: questions.length, duplicateCanonicalAcceptedAnswerCount: removals.length, records: removals.sort((left, right) => left.questionId.localeCompare(right.questionId) || left.acceptedAnswerIndex - right.acceptedAnswerIndex) }; await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, `${canonicalJsonV32(report)}\n`); return report;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) console.log(JSON.stringify(await reportV32AliasRemediation(), null, 2));
