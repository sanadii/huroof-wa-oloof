import { createHash } from 'node:crypto';

export const V3 = '3.0.0';
export type WorkflowState = 'slot' | 'draft' | 'evidence_ready' | 'ready_for_human' | 'approved' | 'rejected' | 'released';
export type RemediationDisposition = 'needs_evidence' | 'rewrite_required' | 'blocked_ambiguous' | 'blocked_specialist' | 'ready_for_human' | 'fixture_blocked' | 'cultural_review_blocked' | 'concept_corrected_blocked';
export type Candidate = { candidateId: string; sourceVersion: 'v1' | 'v2.1'; sourceId: string; playable: Record<string, unknown>; state: WorkflowState; disposition: RemediationDisposition; dispositionReason: string; evidencePacketId?: string; difficultyRationale?: { familiarity: number; clueDirectness: number; domainSpecificity: number; retrievalBurden: number; score: number; rationale: string }; provenance: { importedAt: string; sourcePath: string; sourceHash: string } };
export type ActorKind = 'ai' | 'automated' | 'human' | 'specialist' | 'rights';
export type ReviewReceipt = { receiptId: string; actorKind: ActorKind; principalId: string | null; itemId: string; state: WorkflowState; verdict: 'pass' | 'fail'; contentHash: string; sourceHash: string; policyHash: string; createdAt: string; evidence: string };
export type ReviewPolicy = { requiresSpecialist: boolean; requiresRights: boolean };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const contentHash = (candidate: Pick<Candidate, 'playable'>) => hash(candidate.playable);
export const policyHash = (policy: ReviewPolicy) => hash(policy);
export const sourceHash = (candidate: Pick<Candidate, 'playable'>) => hash((candidate.playable.sources as unknown) ?? []);
const transitions: Record<WorkflowState, WorkflowState[]> = { slot: ['draft'], draft: ['evidence_ready','rejected'], evidence_ready: ['ready_for_human','rejected'], ready_for_human: ['approved','rejected'], approved: ['released'], rejected: [], released: [] };
export function assertTransition(from: WorkflowState, to: WorkflowState) { if (!transitions[from].includes(to)) throw new Error(`Illegal v3 transition ${from} -> ${to}`); }
export function validateReceipt(receipt: ReviewReceipt) { if ((receipt.actorKind === 'ai' || receipt.actorKind === 'automated') && receipt.principalId !== null) throw new Error('AI/automated receipts may not claim a human principal.'); if (['human','specialist','rights'].includes(receipt.actorKind) && (!receipt.principalId?.trim() || !/^auth:[A-Za-z0-9_-]{8,}$/.test(receipt.principalId))) throw new Error('A genuine immutable authenticated principalId is required.'); if (!receipt.evidence.trim()) throw new Error('Review evidence is required.'); }
/** Deliberately fail closed: v3 has no trusted authentication/review adapter. */
export function approve(_candidate: Candidate, _policy: ReviewPolicy, _receipts: ReviewReceipt[]): never { void _candidate; void _policy; void _receipts; throw new Error('authenticated review adapter not configured'); }
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && (() => { const [year, month, day] = value.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day; })();
export function validateAutomatedReceipts(candidates: Candidate[], receipts: ReviewReceipt[], asOf: string): string[] { const issues: string[] = []; const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate])); const ids = new Set<string>(); if (!isIsoDate(asOf)) issues.push('invalid as-of date'); for (const receipt of receipts) { const candidate = byId.get(receipt.itemId); if (ids.has(receipt.receiptId)) issues.push(`duplicate receipt ${receipt.receiptId}`); ids.add(receipt.receiptId); if (receipt.actorKind !== 'automated' || receipt.principalId !== null || receipt.createdAt !== asOf || !isIsoDate(receipt.createdAt) || !candidate || receipt.contentHash !== contentHash(candidate) || receipt.sourceHash !== sourceHash(candidate) || receipt.policyHash !== 'automated-precheck-only') issues.push(`invalid automated receipt ${receipt.receiptId}`); } if (receipts.length !== candidates.length) issues.push('automated receipt count mismatch'); return issues; }
export function requiresSpecialist(candidate: Candidate) { return ['draft-180','draft-230'].includes(candidate.sourceId); }

/**
 * This is intentionally a readiness simulation, not a release simulation.
 * The corpus is entirely pre-approval, so a v3 candidate may never enter the
 * runtime inventory merely because it is sampled here.
 */
export function simulateNonApprovedInventory(candidates: Candidate[], rounds = 1000, seed = 0x6a09e667) {
  let state = seed >>> 0; let sampled = 0; let runtimeEligible = 0;
  for (let round = 0; round < rounds; round += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const candidate = candidates[state % candidates.length]; sampled += 1;
    if (candidate.state === 'approved' || candidate.state === 'released') runtimeEligible += 1;
  }
  return { rounds, sampled, runtimeEligible, seed };
}
