import { createHash } from 'node:crypto';
import { normalizeArabic, SUPPORTED_LETTERS, type Difficulty, type Letter } from './question-bank.js';

export const AUTHORING_VERSION = '2.0.0';
export const CLASSIC_STANDALONE_THRESHOLD = 224;
export type Modality = 'classic' | 'image' | 'charades';
export type SlotState = 'unfilled' | 'blocked_source' | 'blocked_media' | 'needs_asset';

export type CategorySummary = { id: string; displayNameAr: string; sourceMode: string; sourcePolicy: string; classicCompatibility: string };
export type AuthoringSlot = {
  slotId: string; planVersion: typeof AUTHORING_VERSION; categoryId: string; modality: Modality;
  difficulty: Difficulty; ordinal: number; state: SlotState; targetLetter?: Letter; blocker?: string;
};
export type CategoryPolicy = {
  categoryId: string; policyVersion: typeof AUTHORING_VERSION; modality: Modality; sourcePolicy: string;
  allowedFacets: string[]; prohibitedFacets: string[];
  temporal: { class: 'stable' | 'dated' | 'religious'; recheckDays: number | null; recheckOnWordingChange: boolean };
  review: { fact: boolean; arabic: boolean; specialist: boolean; rights: boolean; minimumSourcePackets: number };
  readiness: { classicEligible: boolean; standaloneThreshold: number | null; behavior: string };
  sourceRegistryIds: string[];
};
export type V2Draft = {
  id: string; schemaVersion: typeof AUTHORING_VERSION; locale: 'ar-KW'; categoryId: string; targetLetter: Letter;
  headerAr: string; promptAr: string; canonicalAnswer: string; acceptedAnswers: string[]; acceptDefiniteArticle: boolean;
  difficulty: Difficulty; questionType: 'text' | 'identity' | 'puzzle'; explanationAr: string | null; status: 'draft';
  sourcePacketIds: string[]; temporal: { kind: 'stable' | 'dated' | 'religious'; checkedAt: string; validUntil: string | null };
  provenance: { runId: string; attemptId: string; templateVersion: string; method: 'human' | 'model_assisted'; model: string | null };
};
export type ReviewReceipt = { receiptId: string; itemId: string; kind: 'fact' | 'arabic' | 'relevance' | 'duplicate' | 'temporal' | 'specialist' | 'rights'; reviewer: string; reviewedAt: string; policyVersion: string; verdict: 'pass' | 'fail'; evidence: string };
export type RuntimeItem = { id: string; categoryId: string; targetLetter: Letter; modality: 'classic' | 'image' | 'charades'; status: 'approved'; validUntil: string | null; policyVersion: string; schemaValid: boolean; policyValid: boolean };

const SHA = (value: string) => createHash('sha256').update(value).digest('hex');
export const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export const stableJson = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export const stableJsonl = (values: unknown[]) => values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : '');
export const contentHash = (value: unknown) => SHA(typeof value === 'string' ? value : stableJson(value));

function sourceIdsFor(category: CategorySummary): string[] {
  if (category.id === 'tahadani-056' || category.id === 'tahadani-057') return ['quran-complex'];
  if (category.id === 'tahadani-062') return ['fifa-world-cup-2026'];
  if (category.sourcePolicy === 'dated_sports_facts') return ['fifa-world-cup-2026', 'ifab-laws'];
  if (category.id === 'tahadani-047') return ['six-iso-4217'];
  if (['tahadani-045', 'tahadani-046', 'tahadani-059', 'tahadani-020'].includes(category.id)) return ['un-member-states'];
  if (category.id === 'tahadani-044') return ['un-member-states', 'us-copyright-fair-use'];
  if (category.sourceMode === 'image') return ['us-copyright-fair-use', 'us-copyright-facts-expression'];
  if (category.id === 'tahadani-036') return ['one-piece-official'];
  if (category.id === 'tahadani-042') return ['minecraft-official'];
  if (category.id === 'tahadani-021') return ['real-madrid-history'];
  if (category.id === 'tahadani-006' || category.id === 'tahadani-008') return ['nasa-science'];
  return ['unesco-world-heritage'];
}

function allowedFacets(category: CategorySummary): string[] {
  const byId: Record<string, string[]> = {
    'tahadani-056': ['قرآني موثق', 'قصص الأنبياء بنص مرجعي'], 'tahadani-057': ['نص القرآن', 'معلومات مصحف موثقة'],
    'tahadani-058': ['معلومات محلية مؤرخة ومصدرها رسمي'], 'tahadani-062': ['جدول بطولة 2026 المؤرخ رسمياً'],
    'tahadani-044': ['تعرف علم بصري مرخّص'], 'tahadani-061': ['تشكيل بصري مرخّص ومحدد التاريخ'],
  };
  if (byId[category.id]) return byId[category.id];
  if (category.sourceMode === 'charades') return ['عبارة تمثيلية منفصلة غير كلاسيكية'];
  if (category.sourceMode === 'image') return ['سؤال بصري مع أصل إعلام محلي'];
  return [`معلومة محددة ضمن فئة ${category.displayNameAr}`];
}

export function modalityFor(category: CategorySummary): Modality {
  if (category.classicCompatibility === 'image_pending') return 'image';
  if (category.classicCompatibility === 'separate_mode') return 'charades';
  return 'classic';
}

export function makePolicies(categories: CategorySummary[]): CategoryPolicy[] {
  return [...categories].sort((a, b) => a.id.localeCompare(b.id)).map((category) => {
    const modality = modalityFor(category);
    const religious = ['tahadani-056', 'tahadani-057'].includes(category.id);
    const dated = category.sourcePolicy === 'dated_sports_facts' || category.sourcePolicy === 'dated_local_facts' || category.id === 'tahadani-062';
    const image = modality === 'image';
    return {
      categoryId: category.id, policyVersion: AUTHORING_VERSION, modality, sourcePolicy: category.sourcePolicy,
      allowedFacets: allowedFacets(category),
      prohibitedFacets: [
        'صياغة عامة لا تخص الفئة', 'ادعاء غير موثق', 'سؤال متعدد الإجابات في الوضع الكلاسيكي',
        ...(religious ? ['تفسير مولد غير مراجَع', 'فتوى أو حكم ديني'] : []),
        ...(image ? ['رابط صورة خارجي', 'وسيط بلا حقوق نشر صريحة'] : []),
        ...(modality === 'charades' ? ['targetLetter', 'المخزون الكلاسيكي'] : []),
      ],
      temporal: { class: religious ? 'religious' : dated ? 'dated' : 'stable', recheckDays: religious ? null : dated ? 30 : 730, recheckOnWordingChange: religious },
      review: { fact: modality !== 'charades', arabic: true, specialist: religious, rights: image, minimumSourcePackets: religious || dated ? 2 : modality === 'charades' ? 0 : 1 },
      readiness: modality === 'classic'
        ? { classicEligible: true, standaloneThreshold: CLASSIC_STANDALONE_THRESHOLD, behavior: 'approved non-expired policy-valid items only; combined pack is evaluated independently' }
        : modality === 'image'
          ? { classicEligible: false, standaloneThreshold: null, behavior: 'blocked until question-specific media is local and explicitly publishable' }
          : { classicEligible: false, standaloneThreshold: null, behavior: 'separate mode only; never enters classic inventory' },
      sourceRegistryIds: sourceIdsFor(category),
    };
  });
}

export function makeSlots(categories: CategorySummary[]): AuthoringSlot[] {
  const slots: AuthoringSlot[] = [];
  for (const category of [...categories].sort((a, b) => a.id.localeCompare(b.id))) {
    const modality = modalityFor(category);
    if (modality === 'charades') {
      for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) for (let ordinal = 1; ordinal <= 112; ordinal++) slots.push({ slotId: `slot-v2-charades-${category.id}-${difficulty}-${String(ordinal).padStart(3, '0')}`, planVersion: AUTHORING_VERSION, categoryId: category.id, modality, difficulty, ordinal, state: 'unfilled' });
      continue;
    }
    for (const targetLetter of SUPPORTED_LETTERS) for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) for (let ordinal = 1; ordinal <= 4; ordinal++) {
      const blocked = modality === 'image';
      slots.push({ slotId: `slot-v2-${modality}-${category.id}-${targetLetter}-${difficulty}-${ordinal}`, planVersion: AUTHORING_VERSION, categoryId: category.id, modality, targetLetter, difficulty, ordinal, state: blocked ? 'blocked_media' : 'unfilled', ...(blocked ? { blocker: 'question_specific_publishable_media_required' } : {}) });
    }
  }
  return slots;
}

export function partitionSlots(slots: AuthoringSlot[]) { return { classic: slots.filter((slot) => slot.modality === 'classic'), image: slots.filter((slot) => slot.modality === 'image'), charades: slots.filter((slot) => slot.modality === 'charades') }; }

export function validateSlots(slots: AuthoringSlot[], policies: CategoryPolicy[]): string[] {
  const issues: string[] = []; const policyById = new Map(policies.map((policy) => [policy.categoryId, policy])); const ids = new Set<string>();
  for (const slot of slots) {
    if (ids.has(slot.slotId)) issues.push(`duplicate slot id ${slot.slotId}`); ids.add(slot.slotId);
    const policy = policyById.get(slot.categoryId); if (!policy || policy.modality !== slot.modality) issues.push(`policy mismatch for ${slot.slotId}`);
    if (slot.modality === 'charades' && slot.targetLetter) issues.push(`charades slot contains target letter ${slot.slotId}`);
    if (slot.modality !== 'charades' && !slot.targetLetter) issues.push(`classic/image slot lacks target letter ${slot.slotId}`);
    if (slot.modality === 'image' && !['blocked_media', 'needs_asset'].includes(slot.state)) issues.push(`image slot not blocked ${slot.slotId}`);
    if (Object.keys(slot).some((key) => ['promptAr', 'canonicalAnswer', 'sources', 'review', 'approval', 'media'].includes(key))) issues.push(`slot contains question field ${slot.slotId}`);
  }
  if (policies.length !== 62 || new Set(policies.map((policy) => policy.categoryId)).size !== 62) issues.push('policies must cover 62 unique category ids');
  return issues;
}

export function indexedDuplicateClusters(items: Array<Pick<V2Draft, 'id' | 'promptAr' | 'canonicalAnswer'>>): { exact: string[][]; candidates: Array<[string, string]> } {
  const exact = new Map<string, string[]>(); const index = new Map<string, string[]>(); const pairs = new Set<string>();
  for (const item of items) {
    const normalized = `${normalizeArabic(item.promptAr)}|${normalizeArabic(item.canonicalAnswer)}`; exact.set(SHA(normalized), [...(exact.get(SHA(normalized)) ?? []), item.id]);
    const words = normalizeArabic(item.promptAr).split(/\s+/).filter(Boolean); const grams = new Set(words.length < 3 ? [words.join(' ')] : words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(' ')));
    // Very common n-grams are stop-grams. Skipping their unbounded buckets keeps
    // candidate generation sub-quadratic; rarer shared shingles still surface
    // pairs for human review before any similarity scoring.
    for (const gram of grams) {
      const prior = index.get(gram) ?? [];
      if (prior.length < 50) for (const id of prior) pairs.add([id, item.id].sort().join('|'));
    }
    for (const gram of grams) index.set(gram, [...(index.get(gram) ?? []), item.id]);
  }
  return { exact: [...exact.values()].filter((ids) => ids.length > 1), candidates: [...pairs].map((pair) => pair.split('|') as [string, string]) };
}

export function runtimeInventoryForPack(items: RuntimeItem[], selectedCategoryIds: string[], asOf: string): RuntimeItem[] {
  if (!isIsoDate(asOf)) throw new Error(`Invalid --as-of date: ${asOf}`);
  const selected = new Set(selectedCategoryIds);
  return items.filter((item) => selected.has(item.categoryId) && item.modality === 'classic' && item.status === 'approved' && item.schemaValid && item.policyValid && (!item.validUntil || item.validUntil >= asOf));
}

export function readinessForPack(items: RuntimeItem[], selectedCategoryIds: string[], asOf: string, reserve = 8) {
  const inventory = runtimeInventoryForPack(items, selectedCategoryIds, asOf); const byLetter = Object.fromEntries(SUPPORTED_LETTERS.map((letter) => [letter, inventory.filter((item) => item.targetLetter === letter).length]));
  return { selectedCategoryIds: [...selectedCategoryIds].sort(), reserve, byLetter, playable: Object.values(byLetter).every((count) => count >= reserve), approvedCount: inventory.length };
}

export function promoteDraft(draft: V2Draft, policy: CategoryPolicy, packets: Array<{ packetId: string; checkedAt: string }>, receipts: ReviewReceipt[], asOf: string): { approved: Omit<V2Draft, 'status'> & { status: 'approved'; approvedAt: string; reviewReceiptIds: string[] } } {
  if (!isIsoDate(asOf)) throw new Error(`Invalid --as-of date: ${asOf}`);
  if (draft.status !== 'draft') throw new Error('Only draft records may be promoted.');
  if (policy.modality !== 'classic') throw new Error('Only classic drafts may be promoted through classic promotion.');
  if (draft.temporal.validUntil && draft.temporal.validUntil < asOf) throw new Error('Draft has expired.');
  if (draft.sourcePacketIds.length < policy.review.minimumSourcePackets) throw new Error('Missing source packets.');
  const packetById = new Map(packets.map((packet) => [packet.packetId, packet]));
  for (const id of draft.sourcePacketIds) { const packet = packetById.get(id); if (!packet) throw new Error(`Missing source packet ${id}.`); if (packet.checkedAt > asOf) throw new Error(`Source packet ${id} is not valid as-of.`); }
  const needed: ReviewReceipt['kind'][] = ['fact', 'arabic', 'relevance', 'duplicate', 'temporal', ...(policy.review.specialist ? ['specialist' as const] : []), ...(policy.review.rights ? ['rights' as const] : [])];
  const matched = receipts.filter((receipt) => receipt.itemId === draft.id && receipt.policyVersion === policy.policyVersion && receipt.verdict === 'pass' && receipt.reviewedAt <= asOf);
  for (const kind of needed) if (!matched.some((receipt) => receipt.kind === kind)) throw new Error(`Missing required ${kind} receipt.`);
  return { approved: { ...draft, status: 'approved', approvedAt: asOf, reviewReceiptIds: matched.map((receipt) => receipt.receiptId).sort() } };
}

export function createReleaseManifest(items: RuntimeItem[], policies: CategoryPolicy[], unresolvedHighConfidenceClusters: number, asOf: string) {
  if (!isIsoDate(asOf)) throw new Error(`Invalid --as-of date: ${asOf}`);
  if (unresolvedHighConfidenceClusters > 0) throw new Error('Release blocked by unresolved high-confidence duplicate clusters.');
  const eligible = items.filter((item) => item.modality === 'classic' && item.status === 'approved' && item.schemaValid && item.policyValid && (!item.validUntil || item.validUntil >= asOf));
  if (eligible.length !== items.length) throw new Error('Release contains an ineligible record.');
  const categoryIds = [...new Set(eligible.map((item) => item.categoryId))].sort();
  const releaseId = `release-v2-${asOf}-${contentHash(eligible.map((item) => item.id).sort()).slice(0, 12)}`;
  return { releaseId, asOf, policyVersion: AUTHORING_VERSION, categoryIds, counts: { approved: eligible.length, plannedSlotsExcluded: true }, approvedContentHash: contentHash(eligible.map((item) => item.id).sort()), policyRegistryHash: contentHash(policies), immutable: true };
}
