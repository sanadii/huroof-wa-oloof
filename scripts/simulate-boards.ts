import { SUPPORTED_LETTERS, selectBoardLetters, type Question } from '../src/question-bank.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function syntheticApprovedFixture(): Question[] {
  return SUPPORTED_LETTERS.flatMap((targetLetter, letterIndex) => Array.from({ length: 8 }, (_, index) => ({ id: `fixture-${letterIndex}-${index}`, schemaVersion: 1 as const, locale: 'ar-KW' as const, categoryId: 'tahadani-006', targetLetter, headerAr: 'بيانات اختبار', promptAr: 'سؤال تجريبي صالح لمحاكاة اختيار الحروف في لوحة اللعبة', canonicalAnswer: targetLetter, acceptedAnswers: [targetLetter], acceptDefiniteArticle: false, difficulty: 'easy' as const, questionType: 'text' as const, explanationAr: null, sources: [{ title: 'Fixture', publisher: 'Test', url: 'https://example.org/fixture', accessedAt: '2026-09-03' }], temporal: { kind: 'stable' as const, verifiedAt: '2026-09-03', validUntil: null }, media: null, status: 'approved' as const, authoring: { method: 'human' as const, model: null, createdAt: '2026-09-03T00:00:00Z' }, review: { factReviewer: 'fixture', languageReviewer: 'fixture', reviewedAt: '2026-09-03', notes: null } })));
}
export function simulateBoards(rounds = 1000) { const questions = syntheticApprovedFixture(); for (let seed = 0; seed < rounds; seed++) { const letters = selectBoardLetters(questions, seed, 8, 5); if (letters.some((letter) => questions.filter((q) => q.targetLetter === letter && q.status === 'approved').length < 8)) throw new Error(`Reserve violation for seed ${seed}`); } return { rounds, questionCount: questions.length }; }
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) console.log(`Simulated ${simulateBoards().rounds} deterministic boards with synthetic approved inventory.`);
