import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { normalizeArabic, seededRandom, SUPPORTED_LETTERS, type Difficulty, type Letter } from './question-bank.js';

/** V2.1 is an append-only authoring extension.  It intentionally never mutates v1/v2.0. */
export const AUTHORING_V21 = '2.1.0';
export const EXTENSION_CATEGORY_IDS = ['huroof-001', 'huroof-002', 'huroof-003', 'huroof-004'] as const;
export type Modality = 'classic' | 'image' | 'charades';
export type CatalogCategory = { id: string; slug: string; displayNameAr: string; sourceMode: string; sourcePolicy: string; classicCompatibility: string; catalogStatus?: string; questionReadiness?: string; legacyIndex?: number; activation?: 'runtime' | 'authoring_only'; runtimeVisibility?: boolean; origin?: string; sortOrder?: number; cover?: { state: 'proposed'; publishable: false }; publishable?: boolean };
export type CategoryPolicyV21 = { categoryId: string; policyVersion: typeof AUTHORING_V21; modality: Modality; sourcePolicy: string; sourceRegistryIds: string[]; allowedFacets: string[]; runtimeVisible: boolean; activation: 'runtime' | 'authoring_only'; temporal: { class: 'stable'; recheckDays: number }; review: { fact: true; arabic: true; relevance: true; duplicate: true; temporal: true; minimumSourcePackets: 1 } };
export type SlotV21 = { slotId: string; planVersion: typeof AUTHORING_V21; categoryId: string; modality: Modality; difficulty: Difficulty; ordinal: number; state: 'unfilled' | 'blocked_media'; targetLetter?: Letter; blocker?: string };
export type SourcePacketV21 = { packetId: string; schemaVersion: typeof AUTHORING_V21; categoryId: string; sourceRegistryId: string; sourceUrl: string; claimLocators: string[]; checkedAt: string; contentHash: string; validUntil: string | null };
export type DraftV21 = { id: string; schemaVersion: typeof AUTHORING_V21; locale: 'ar-KW'; categoryId: string; slotId: string; targetLetter: Letter; headerAr: string; promptAr: string; canonicalAnswer: string; acceptedAnswers: string[]; acceptDefiniteArticle: boolean; difficulty: Difficulty; questionType: 'text'; explanationAr: string | null; status: 'draft'; sourcePacketIds: string[]; sourceLocator: string; temporal: { kind: 'stable'; checkedAt: string; validUntil: null }; provenance: { method: 'human' | 'model_assisted'; model: string | null; createdAt: string } };
export type ReviewReceiptV21 = { receiptId: string; itemId: string; kind: 'fact' | 'arabic' | 'relevance' | 'duplicate' | 'temporal' | 'rights'; reviewer: string; reviewedAt: string; policyVersion: typeof AUTHORING_V21; verdict: 'pass' | 'fail'; evidence: string; contentHash: string };
export type RuntimeRecordV21 = { id: string; categoryId: string; slotId: string; targetLetter: Letter; modality: 'classic'; status: 'approved'; approvedAt: string; validUntil: string | null; policyVersion: typeof AUTHORING_V21; schemaValid: true; policyValid: true; contentHash: string; sourcePacketIds: string[]; reviewReceiptIds: string[] };
export type ImageMediaV21 = { assetId: string; localPath: string; sha256: string; altAr: string; rightsReceiptId: string; publishable: true };

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const stableJson = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export const stableJsonl = (values: unknown[]) => values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : '');
export const canonicalHash = (value: unknown) => sha(stableJson(value));
export const isRealDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export function resolveCatalogs(legacy: CatalogCategory[], extension: CatalogCategory[]) {
  const legacySnapshot = JSON.parse(JSON.stringify(legacy)) as CatalogCategory[];
  if (legacy.length !== 62 || legacy.some((category, index) => category.legacyIndex !== index + 1)) throw new Error('Legacy catalog must remain the ordered 62-category catalog.');
  if (extension.length !== 4 || extension.some((category) => !EXTENSION_CATEGORY_IDS.includes(category.id as typeof EXTENSION_CATEGORY_IDS[number]))) throw new Error('Unexpected extension category.');
  for (const category of extension) {
    if (category.legacyIndex !== undefined || category.publishable === true || category.activation !== 'authoring_only' || category.runtimeVisibility !== false || category.catalogStatus !== 'proposed' || category.origin !== 'v2.1_extension' || category.sortOrder !== 63 + extension.indexOf(category) || category.cover?.state !== 'proposed' || category.cover.publishable !== false) throw new Error(`Invalid proposed extension ${category.id}.`);
    if (!category.id.startsWith('huroof-') || !category.slug || !category.displayNameAr) throw new Error(`Malformed extension ${category.id}.`);
  }
  const authoring = [...legacySnapshot, ...extension.map((category) => ({ ...category }))];
  if (new Set(authoring.map((category) => category.id)).size !== authoring.length || new Set(authoring.map((category) => category.slug)).size !== authoring.length) throw new Error('Catalog IDs and slugs must be unique.');
  return { runtime: legacySnapshot, authoring, extension: extension.map((category) => ({ ...category })) };
}
export const runtimeCatalogV21 = (legacy: CatalogCategory[], extension: CatalogCategory[]) => resolveCatalogs(legacy, extension).runtime;

function modalityFor(category: CatalogCategory): Modality { return category.classicCompatibility === 'image_pending' ? 'image' : category.classicCompatibility === 'separate_mode' ? 'charades' : 'classic'; }
function registryFor(category: CatalogCategory): string[] {
  if (category.id === 'huroof-001') return ['nasa-solar-system', 'iau-nomenclature'];
  if (category.id === 'huroof-002') return ['usgs-earthquakes', 'noaa-ocean-service', 'wmo-weather'];
  if (category.id === 'huroof-003') return ['doha-historical-dictionary', 'arabic-academy-cairo'];
  if (category.id === 'huroof-004') return ['unesco-kuwait-diwaniya', 'unesco-kuwait-ich', 'nccal-kuwait'];
  return ['legacy-registry-placeholder'];
}

export function makePoliciesV21(categories: CatalogCategory[]): CategoryPolicyV21[] {
  return categories.map((category) => ({
    categoryId: category.id, policyVersion: AUTHORING_V21, modality: modalityFor(category), sourcePolicy: category.sourcePolicy,
    sourceRegistryIds: registryFor(category), allowedFacets: [`معلومة محددة ضمن فئة ${category.displayNameAr}`],
    runtimeVisible: category.activation !== 'authoring_only', activation: category.activation ?? 'runtime',
    temporal: { class: 'stable', recheckDays: 730 }, review: { fact: true, arabic: true, relevance: true, duplicate: true, temporal: true, minimumSourcePackets: 1 },
  }));
}

export function makeSlotsV21(categories: CatalogCategory[]): SlotV21[] {
  const slots: SlotV21[] = [];
  for (const category of categories) {
    const modality = modalityFor(category);
    if (modality === 'charades') {
      for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) for (let ordinal = 1; ordinal <= 112; ordinal++) slots.push({ slotId: `slot-v21-charades-${category.id}-${difficulty}-${String(ordinal).padStart(3, '0')}`, planVersion: AUTHORING_V21, categoryId: category.id, modality, difficulty, ordinal, state: 'unfilled' });
      continue;
    }
    for (const targetLetter of SUPPORTED_LETTERS) for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) for (let ordinal = 1; ordinal <= 4; ordinal++) slots.push({ slotId: `slot-v21-${modality}-${category.id}-${targetLetter}-${difficulty}-${ordinal}`, planVersion: AUTHORING_V21, categoryId: category.id, modality, targetLetter, difficulty, ordinal, state: modality === 'image' ? 'blocked_media' : 'unfilled', ...(modality === 'image' ? { blocker: 'question_specific_publishable_media_required' } : {}) });
  }
  return slots;
}

export function partitionSlotsV21(slots: SlotV21[]) { return { classic: slots.filter((slot) => slot.modality === 'classic'), image: slots.filter((slot) => slot.modality === 'image'), charades: slots.filter((slot) => slot.modality === 'charades') }; }

export function validateSlotsV21(slots: SlotV21[], policies: CategoryPolicyV21[]): string[] {
  const issues: string[] = []; const ids = new Set<string>(); const policyById = new Map(policies.map((policy) => [policy.categoryId, policy]));
  for (const slot of slots) {
    if (ids.has(slot.slotId)) issues.push(`duplicate slot ${slot.slotId}`); ids.add(slot.slotId);
    const policy = policyById.get(slot.categoryId); if (!policy || policy.modality !== slot.modality) issues.push(`policy mismatch ${slot.slotId}`);
    if (slot.modality === 'charades' ? slot.targetLetter !== undefined : !slot.targetLetter) issues.push(`letter mismatch ${slot.slotId}`);
    if (Object.keys(slot).some((key) => ['promptAr', 'canonicalAnswer', 'sources', 'review', 'media'].includes(key))) issues.push(`question field in slot ${slot.slotId}`);
  }
  return issues;
}

export function validateDraftsV21(drafts: DraftV21[], slots: SlotV21[], policies: CategoryPolicyV21[], packets: SourcePacketV21[], registryIds: Set<string>): string[] {
  const issues: string[] = []; const slotsById = new Map(slots.map((slot) => [slot.slotId, slot])); const policiesById = new Map(policies.map((policy) => [policy.categoryId, policy])); const packetsById = new Map(packets.map((packet) => [packet.packetId, packet])); const draftIds = new Set<string>(); const boundSlots = new Set<string>();
  for (const draft of drafts) {
    if (draftIds.has(draft.id)) issues.push(`duplicate draft ${draft.id}`); draftIds.add(draft.id);
    const slot = slotsById.get(draft.slotId); const policy = policiesById.get(draft.categoryId);
    if (!slot || slot.categoryId !== draft.categoryId || slot.modality !== 'classic' || slot.targetLetter !== draft.targetLetter) issues.push(`draft-slot mismatch ${draft.id}`);
    if (boundSlots.has(draft.slotId)) issues.push(`multiple drafts bind slot ${draft.slotId}`); boundSlots.add(draft.slotId);
    if (!policy || policy.modality !== 'classic') issues.push(`draft policy mismatch ${draft.id}`);
    if (!SUPPORTED_LETTERS.includes(draft.targetLetter) || !draft.canonicalAnswer || normalizeArabic(draft.canonicalAnswer).replace(/^ال/, '')[0] !== draft.targetLetter || !draft.acceptedAnswers.length || draft.acceptedAnswers.some((answer) => normalizeArabic(answer).replace(/^ال/, '')[0] !== draft.targetLetter)) issues.push(`initial mismatch ${draft.id}`);
    if (!draft.headerAr || draft.promptAr.startsWith(draft.headerAr) || !draft.promptAr || draft.explanationAr !== null || !isRealDate(draft.temporal.checkedAt)) issues.push(`draft textual/temporal invalid ${draft.id}`);
    if (draft.sourcePacketIds.length !== 1) issues.push(`draft must bind one packet ${draft.id}`);
    for (const packetId of draft.sourcePacketIds) { const packet = packetsById.get(packetId); if (!packet || packet.categoryId !== draft.categoryId || !registryIds.has(packet.sourceRegistryId) || !/^https:\/\//.test(packet.sourceUrl) || !/^[a-f0-9]{64}$/.test(packet.contentHash) || !packet.claimLocators.includes(draft.sourceLocator) || !isRealDate(packet.checkedAt) || (packet.validUntil && (!isRealDate(packet.validUntil) || packet.validUntil < packet.checkedAt))) issues.push(`draft source invalid ${draft.id}`); }
  }
  return issues;
}

export function indexedDuplicateClustersV21(items: Array<Pick<DraftV21, 'id' | 'promptAr' | 'canonicalAnswer'>>) {
  const exact = new Map<string, string[]>(); const buckets = new Map<string, string[]>(); const pairs = new Set<string>();
  for (const item of items) {
    const exactKey = sha(`${normalizeArabic(item.promptAr)}|${normalizeArabic(item.canonicalAnswer)}`); exact.set(exactKey, [...(exact.get(exactKey) ?? []), item.id]);
    const words = normalizeArabic(item.promptAr).split(/\s+/).filter(Boolean); const grams = new Set(words.length < 3 ? [words.join(' ')] : words.slice(0, -2).map((_, index) => words.slice(index, index + 3).join(' ')));
    for (const gram of grams) { const bucket = buckets.get(gram) ?? []; for (const prior of bucket) pairs.add([prior, item.id].sort().join('|')); if (bucket.length < 50) buckets.set(gram, [...bucket, item.id]); }
  }
  return { exact: [...exact.values()].filter((ids) => ids.length > 1), candidates: [...pairs].sort().map((pair) => pair.split('|') as [string, string]), bucketCap: 50 };
}

export function promoteDraftV21(draft: DraftV21, slots: SlotV21[], policies: CategoryPolicyV21[], packets: SourcePacketV21[], registryIds: Set<string>, receipts: ReviewReceiptV21[], asOf: string): RuntimeRecordV21 {
  if (!isRealDate(asOf)) throw new Error('Invalid promotion date.');
  const validation = validateDraftsV21([draft], slots, policies, packets, registryIds); if (validation.length) throw new Error(validation.join('; '));
  const policy = policies.find((entry) => entry.categoryId === draft.categoryId); if (!policy || policy.activation !== 'runtime' || !policy.runtimeVisible) throw new Error('Proposed authoring-only categories cannot be promoted.');
  if (draft.temporal.checkedAt > asOf || packets.some((packet) => draft.sourcePacketIds.includes(packet.packetId) && (packet.checkedAt > asOf || (packet.validUntil && packet.validUntil < asOf)))) throw new Error('Draft source is stale or from the future.');
  const required = ['fact', 'arabic', 'relevance', 'duplicate', 'temporal']; const bound = receipts.filter((receipt) => receipt.itemId === draft.id && receipt.policyVersion === AUTHORING_V21 && receipt.verdict === 'pass' && receipt.reviewer.trim() && receipt.evidence.trim() && isRealDate(receipt.reviewedAt) && receipt.reviewedAt <= asOf && receipt.contentHash === canonicalHash(draft));
  for (const kind of required) if (!bound.some((receipt) => receipt.kind === kind)) throw new Error(`Missing content-bound ${kind} receipt.`);
  return { id: draft.id, categoryId: draft.categoryId, slotId: draft.slotId, targetLetter: draft.targetLetter, modality: 'classic', status: 'approved', approvedAt: asOf, validUntil: null, policyVersion: AUTHORING_V21, schemaValid: true, policyValid: true, contentHash: canonicalHash(draft), sourcePacketIds: [...draft.sourcePacketIds], reviewReceiptIds: bound.map((receipt) => receipt.receiptId).sort() };
}

/** Image questions are intentionally a different promotion path from classic text. */
export async function verifyImageMediaV21(media: ImageMediaV21, receipt: ReviewReceiptV21): Promise<void> {
  if (!media.publishable || !media.altAr.trim() || /^https?:\/\//.test(media.localPath) || /category-\d+/i.test(media.localPath)) throw new Error('Image media must be a local, publishable question asset, not a cover.');
  await access(media.localPath); const bytes = await readFile(media.localPath); const byteHash = sha(bytes);
  if (byteHash !== media.sha256 || receipt.receiptId !== media.rightsReceiptId || receipt.kind !== 'rights' || receipt.verdict !== 'pass' || receipt.contentHash !== media.sha256 || !receipt.reviewer.trim() || !receipt.evidence.trim()) throw new Error('Image media rights receipt is not bound to the exact media bytes.');
}

export function promoteCharadesV21(item: { id: string; categoryId: string; phraseAr: string; status: 'draft'; targetLetter?: never }, policies: CategoryPolicyV21[]) {
  const policy = policies.find((entry) => entry.categoryId === item.categoryId);
  if (!policy || policy.modality !== 'charades' || item.targetLetter || !item.phraseAr.trim()) throw new Error('Charades are separate-mode records and never classic inventory.');
  return { ...item, modality: 'charades' as const, status: 'approved' as const };
}

export function createReleaseManifestV21(items: RuntimeRecordV21[], policies: CategoryPolicyV21[], asOf: string, roots: { catalogHash: string; policyHash: string; receiptHash: string; sourceHash: string; mediaHash: string }) {
  if (!isRealDate(asOf) || !items.length) throw new Error('A release must be nonempty and have a real date.');
  if (Object.values(roots).some((value) => !/^[a-f0-9]{64}$/.test(value))) throw new Error('Release roots must be canonical SHA-256 hashes.');
  const policyById = new Map(policies.map((policy) => [policy.categoryId, policy])); const ids = new Set<string>();
  for (const item of items) { const policy = policyById.get(item.categoryId); if (ids.has(item.id) || !policy || !policy.runtimeVisible || policy.activation !== 'runtime' || item.modality !== 'classic' || item.status !== 'approved' || !item.schemaValid || !item.policyValid || item.policyVersion !== AUTHORING_V21 || !/^[a-f0-9]{64}$/.test(item.contentHash) || !item.sourcePacketIds.length || !item.reviewReceiptIds.length || (item.validUntil && item.validUntil < asOf)) throw new Error('Release contains an ineligible, duplicate, or proposed record.'); ids.add(item.id); }
  const approvedRecords = [...items].sort((a, b) => a.id.localeCompare(b.id)); const approvedContentHash = canonicalHash(approvedRecords);
  return { schemaVersion: AUTHORING_V21, releaseId: `release-v21-${asOf}-${approvedContentHash.slice(0, 12)}`, asOf, categoryIds: [...new Set(approvedRecords.map((item) => item.categoryId))].sort(), approvedCount: approvedRecords.length, approvedContentHash, roots, immutable: true };
}

export function seededScenarioV21(seed: number) {
  const random = seededRandom(seed); const pool = ['tahadani-001', 'tahadani-006', 'tahadani-010', 'tahadani-020'];
  for (let index = pool.length - 1; index > 0; index--) { const selected = Math.floor(random() * (index + 1)); [pool[index], pool[selected]] = [pool[selected], pool[index]]; }
  const modality = (['classic', 'image', 'charades'] as Modality[])[Math.floor(random() * 3)]; const reserve = 6 + Math.floor(random() * 4); const inventoryPerLetter = Math.floor(random() * 10); const expiry = random() > .5 ? '2026-09-02' : null; const policyValid = random() > .2;
  const playable = modality === 'classic' && expiry === null && policyValid && inventoryPerLetter >= reserve;
  return { seed, categoryPack: pool.slice(0, 2).sort(), modality, reserve, inventoryPerLetter, expiry, policyValid, playable };
}
export function simulateV21(rounds = 1_000) {
  const fingerprints = new Set<string>();
  for (let seed = 1; seed <= rounds; seed++) { const scenario = seededScenarioV21(seed); if ((!scenario.policyValid || scenario.expiry !== null || scenario.modality !== 'classic' || scenario.inventoryPerLetter < scenario.reserve) && scenario.playable) throw new Error('Invalid inventory became playable.'); fingerprints.add(canonicalHash(scenario)); }
  if (fingerprints.size < 2) throw new Error('Seeded simulations did not vary.');
  return { rounds, distinctOutcomes: fingerprints.size, invalidInventoryPlayable: false };
}
