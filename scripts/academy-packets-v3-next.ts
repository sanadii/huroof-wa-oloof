import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Candidate } from './question-bank-v3-review.js';

const ROOT = process.cwd();
const BASE = 'https://www.arabicacademy.gov.eg/ar/%D9%85%D8%AD%D8%B1%D9%83-%D8%A7%D9%84%D8%A8%D8%AD%D8%AB/%D9%85%D8%B9%D8%AC%D9%85/dic-19/';
const PACKET_PATH = 'content/question-bank-v3/source-packets/academy-dic-19.v3.jsonl';
const COHORT_CATEGORY_IDS = new Set(['tahadani-006', 'tahadani-013']);

/**
 * `sourceExcerptBase64` is a compact, exact UTF-8 extraction from the fetched
 * page.  It is deliberately retained instead of a raw-page cache: the former
 * makes offline packet verification possible without retaining third-party
 * boilerplate, cookies, or dynamic tokens.
 */
export type AcademyPacket = { packetId: string; candidateId: string; answer: string; publisher: 'مجمع اللغة العربية بالقاهرة'; title: string; description: string; canonicalUrl: string; locator: string; supportAr: string; evidenceType: 'dictionary_entry_snapshot'; sourceTier: 'authoritative'; retrievedAt: string; httpStatus: number; responseUrl: string; responseContentType: string | null; responseBytes: number; remoteBodySha256: string; sourceExcerptBase64: string; sourceExcerptSha256: string; normalizedEvidenceSha256: string; temporal: { class: 'stable'; validUntil: null }; humanSenseSelectionRequired: true };

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const normalize = (value: string) => value.normalize('NFC').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06EDـ]/g, '').replace(/[أإآٱ]/g, 'ا');
const text = (html: string, expression: RegExp) => html.match(expression)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
const packetId = (candidate: Candidate) => `academy-v3-${candidate.candidateId}`;
const canonicalUrl = (answer: string) => `${BASE}${encodeURIComponent(answer)}`;
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const support = (candidate: Candidate) => `يربط المدخل المعجمي معنى «${String(candidate.playable.canonicalAnswer)}» بالمفهوم المطلوب في السؤال المراجع؛ يلزم اختيار المعنى البشري عند تعدد الدلالات.`;
const normalizedHash = (packet: Omit<AcademyPacket, 'normalizedEvidenceSha256'>) => sha(JSON.stringify({ candidateId: packet.candidateId, answer: packet.answer, canonicalUrl: packet.canonicalUrl, publisher: packet.publisher, title: packet.title, description: packet.description, locator: packet.locator, supportAr: packet.supportAr, retrievedAt: packet.retrievedAt, httpStatus: packet.httpStatus, remoteBodySha256: packet.remoteBodySha256, sourceExcerptSha256: packet.sourceExcerptSha256, temporal: packet.temporal }));
const excerpt = (html: string, answer: string) => {
  const at = normalize(html).indexOf(normalize(answer));
  if (at < 0) return null;
  // Keep an exact decoded passage surrounding the lemma; this is bounded and
  // does not reproduce the remote document.
  return html.slice(Math.max(0, at - 360), Math.min(html.length, at + answer.length + 360));
};

async function readPackets(): Promise<Map<string, AcademyPacket>> { try { return new Map((await readFile(join(ROOT, PACKET_PATH), 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => { const packet = JSON.parse(line) as AcademyPacket; return [packet.candidateId, packet] as const; })); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map(); throw error; } }

function compactExisting(existing: Record<string, unknown> | undefined, candidate: Candidate, asOf: string): AcademyPacket | null {
  if (!existing) return null;
  const answer = String(candidate.playable.canonicalAnswer); if (String(existing.answer) !== answer || String(existing.canonicalUrl) !== canonicalUrl(answer)) return null;
  const packet = { packetId: packetId(candidate), candidateId: candidate.candidateId, answer, publisher: 'مجمع اللغة العربية بالقاهرة' as const, title: String(existing.title ?? ''), description: String(existing.description ?? ''), canonicalUrl: canonicalUrl(answer), locator: `مطابق: ${answer}`, supportAr: support(candidate), evidenceType: 'dictionary_entry_snapshot' as const, sourceTier: 'authoritative' as const, retrievedAt: asOf, httpStatus: Number(existing.httpStatus), responseUrl: String(existing.responseUrl ?? existing.canonicalUrl ?? ''), responseContentType: existing.responseContentType === null ? null : String(existing.responseContentType ?? ''), responseBytes: Number(existing.responseBytes ?? existing.contentLength), remoteBodySha256: String(existing.remoteBodySha256 ?? existing.sha256 ?? ''), sourceExcerptBase64: String(existing.sourceExcerptBase64 ?? ''), sourceExcerptSha256: String(existing.sourceExcerptSha256 ?? ''), temporal: { class: 'stable' as const, validUntil: null }, humanSenseSelectionRequired: true as const };
  return packet.title && packet.description && /^[a-f0-9]{64}$/.test(packet.remoteBodySha256) && /^[a-f0-9]{64}$/.test(packet.sourceExcerptSha256) && packet.sourceExcerptBase64 ? { ...packet, normalizedEvidenceSha256: normalizedHash(packet) } : null;
}

async function fetchPacket(candidate: Candidate, asOf: string): Promise<AcademyPacket> {
  const answer = String(candidate.playable.canonicalAnswer); const url = canonicalUrl(answer); const response = await fetch(url, { headers: { 'user-agent': 'HuroofV3Evidence/1.0' } }); const bytes = new Uint8Array(await response.arrayBuffer()); const html = new TextDecoder().decode(bytes);
  const title = text(html, /<title[^>]*>([\s\S]*?)<\/title>/i); const description = text(html, /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']*)/i) || text(html, /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name=["']description["']|property=["']og:description["'])/i);
  const sourceExcerpt = excerpt(html, answer);
  if (!response.ok || !title || !description || !sourceExcerpt) throw new Error(`Academy evidence check failed for ${candidate.candidateId}`);
  const excerptBytes = Buffer.from(sourceExcerpt, 'utf8');
  const packet = { packetId: packetId(candidate), candidateId: candidate.candidateId, answer, publisher: 'مجمع اللغة العربية بالقاهرة' as const, title, description, canonicalUrl: url, locator: `مطابق: ${answer}`, supportAr: support(candidate), evidenceType: 'dictionary_entry_snapshot' as const, sourceTier: 'authoritative' as const, retrievedAt: asOf, httpStatus: response.status, responseUrl: response.url, responseContentType: response.headers.get('content-type'), responseBytes: bytes.length, remoteBodySha256: sha(bytes), sourceExcerptBase64: excerptBytes.toString('base64'), sourceExcerptSha256: sha(excerptBytes), temporal: { class: 'stable' as const, validUntil: null }, humanSenseSelectionRequired: true as const };
  return { ...packet, normalizedEvidenceSha256: normalizedHash(packet) };
}

export async function validateAcademyPackets(candidates: Candidate[], packets: AcademyPacket[], asOf: string): Promise<string[]> {
  const issues: string[] = []; const cohort = candidates.filter((candidate) => COHORT_CATEGORY_IDS.has(String(candidate.playable.categoryId))); const byId = new Map(cohort.map((candidate) => [candidate.candidateId, candidate])); const seen = new Set<string>(); const ids = new Set<string>(); if (!isDate(asOf)) issues.push('invalid Academy as-of date');
  for (const packet of packets) { const candidate = byId.get(packet.candidateId); const answer = String(candidate?.playable.canonicalAnswer ?? ''); if (seen.has(packet.candidateId) || ids.has(packet.packetId)) issues.push(`duplicate Academy packet ${packet.packetId}`); seen.add(packet.candidateId); ids.add(packet.packetId); const { normalizedEvidenceSha256: actualHash, ...unsigned } = packet; let excerptText = ''; let excerptHash = ''; try { const decoded = Buffer.from(packet.sourceExcerptBase64, 'base64'); excerptText = decoded.toString('utf8'); excerptHash = sha(decoded); } catch { /* invalid base64 is handled below */ } if (!candidate || packet.packetId !== packetId(candidate) || packet.answer !== answer || packet.canonicalUrl !== canonicalUrl(answer) || packet.locator !== `مطابق: ${answer}` || packet.publisher !== 'مجمع اللغة العربية بالقاهرة' || packet.evidenceType !== 'dictionary_entry_snapshot' || packet.sourceTier !== 'authoritative' || packet.retrievedAt !== asOf || packet.httpStatus < 200 || packet.httpStatus >= 300 || !packet.responseUrl || !packet.title || !packet.description || !packet.supportAr || !normalize(excerptText).includes(normalize(answer)) || excerptHash !== packet.sourceExcerptSha256 || !/^[a-f0-9]{64}$/.test(packet.remoteBodySha256) || !/^[a-f0-9]{64}$/.test(actualHash) || actualHash !== normalizedHash(unsigned) || packet.responseBytes <= 0 || packet.temporal.class !== 'stable' || packet.temporal.validUntil !== null || packet.humanSenseSelectionRequired !== true) issues.push(`invalid Academy packet ${packet.packetId}`); }
  for (const candidate of cohort) if (!seen.has(candidate.candidateId)) issues.push(`missing Academy packet ${candidate.candidateId}`); if (packets.length !== cohort.length) issues.push(`Academy packet count ${packets.length} does not match cohort ${cohort.length}`); return issues;
}

export async function materializeAcademyPackets(candidates: Candidate[], asOf = '2026-09-04'): Promise<AcademyPacket[]> {
  const cohort = candidates.filter((candidate) => COHORT_CATEGORY_IDS.has(String(candidate.playable.categoryId))); await mkdir(join(ROOT, 'content/question-bank-v3/source-packets'), { recursive: true }); const prior = await readPackets(); let cursor = 0; const packets: AcademyPacket[] = [];
  const worker = async () => { while (cursor < cohort.length) { const candidate = cohort[cursor++]; const compact = compactExisting(prior.get(candidate.candidateId) as unknown as Record<string, unknown> | undefined, candidate, asOf); packets.push(compact ?? await fetchPacket(candidate, asOf)); } }; await Promise.all(Array.from({ length: 6 }, worker)); packets.sort((left, right) => left.candidateId.localeCompare(right.candidateId)); await writeFile(join(ROOT, PACKET_PATH), packets.map((packet) => JSON.stringify(packet)).join('\n') + '\n'); const issues = await validateAcademyPackets(candidates, packets, asOf); if (issues.length) throw new Error(`Academy packet validation failed: ${issues.join('; ')}`); return packets;
}
export async function readAcademyPackets() { return [...(await readPackets()).values()]; }
