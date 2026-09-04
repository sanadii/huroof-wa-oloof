import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const SUPPORTED_LETTERS = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'] as const;
export type Letter = (typeof SUPPORTED_LETTERS)[number];
export type Difficulty = 'easy' | 'medium' | 'hard';
export type QuestionStatus = 'draft' | 'approved' | 'rejected';

export interface Source { title: string; publisher: string; url: string; accessedAt: string }
export interface Question {
  id: string; schemaVersion: 1; locale: 'ar-KW'; categoryId: string; targetLetter: Letter;
  headerAr: string; promptAr: string; canonicalAnswer: string; acceptedAnswers: string[]; acceptDefiniteArticle: boolean;
  difficulty: Difficulty; questionType: 'text' | 'identity' | 'puzzle' | 'image'; explanationAr: string | null;
  sources: Source[]; temporal: { kind: 'stable' | 'dated'; verifiedAt: string; validUntil: string | null };
  media: null | { assetId: string; altAr: string; sha256: string; rightsStatus: string };
  status: QuestionStatus;
  authoring: { method: 'human' | 'model_assisted'; model: string | null; createdAt: string };
  review: { factReviewer: string | null; languageReviewer: string | null; reviewedAt: string | null; notes: string | null };
}

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /ـ/g;
const HAMZA_ALEF = /[أإآٱ]/g;

/** Comparison-only Arabic normalization. It never changes stored display text. */
export function normalizeArabic(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').replace(DIACRITICS, '').replace(TATWEEL, '').replace(HAMZA_ALEF, 'ا');
}

export function answerInitial(answer: string, acceptDefiniteArticle = true): string {
  let normalized = normalizeArabic(answer);
  if (acceptDefiniteArticle && normalized.startsWith('ال') && normalized.length > 2) normalized = normalized.slice(2);
  return normalized.match(/[\u0621-\u064A]/)?.[0] ?? '';
}

export function answerMatchesLetter(answer: string, letter: string, acceptDefiniteArticle = true): boolean {
  return answerInitial(answer, acceptDefiniteArticle) === letter;
}

export function normalizedQuestionKey(question: Pick<Question, 'promptAr' | 'canonicalAnswer'>): string {
  return `${normalizeArabic(question.promptAr)}|${normalizeArabic(question.canonicalAnswer)}`;
}

export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(normalizeArabic(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalizeArabic(b).split(/\s+/).filter(Boolean));
  const union = new Set([...left, ...right]);
  let shared = 0; for (const token of left) if (right.has(token)) shared++;
  return union.size ? shared / union.size : 0;
}

export function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export async function sha256File(path: string): Promise<string> { return sha256(await readFile(path)); }

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function approvedInventory(questions: Question[]): Question[] { return questions.filter((q) => q.status === 'approved'); }

export function selectBoardLetters(questions: Question[], seed: number, reserve = 8, boardSize = 5): Letter[] {
  const approved = approvedInventory(questions);
  const eligible = SUPPORTED_LETTERS.filter((letter) => approved.filter((q) => q.targetLetter === letter).length >= reserve);
  if (eligible.length < boardSize) throw new Error(`Only ${eligible.length} letters meet the approved reserve of ${reserve}.`);
  const random = seededRandom(seed); const pool = [...eligible]; const selected: Letter[] = [];
  while (selected.length < boardSize) selected.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return selected;
}
