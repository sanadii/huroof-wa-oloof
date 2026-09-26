import { describe, expect, it } from 'vitest';
import type { ApprovedReleaseCatalog } from '../../src/features/game/runtime/contracts';
import { mergeLocalQuestionTypePreview } from '../../src/features/admin/local-question-type-preview';

const catalog: ApprovedReleaseCatalog = {
  releaseId: 'release-1', releaseRootSha256: 'a'.repeat(64), demoFixture: false,
  boardCapabilities: { huroof: true, categories: true, charades: true },
  categories: [{ id: 'cat-1', labelAr: 'فئة', playable: { huroof: true, categories: true, charades: false } }],
};
const counts = { text: 1, image: 0, video: 2, audio: 0, interactive: 0, other: 0 };
const index = { data: { schemaVersion: 't40-question-type-index-v1', classifierVersion: 't40-question-side-v1', releaseId: 'release-1', releaseRootSha256: 'a'.repeat(64), immutable: true, categoryCount: 1, approvedQuestionCount: 3, categories: [{ id: 'cat-1', questionTypeCounts: counts }] } };

describe('local admin question-type preview', () => {
  it('attaches complete counts to the exact immutable release without changing the source catalog', () => {
    expect(mergeLocalQuestionTypePreview(catalog, index)).toMatchObject({ localTypeIndexPreview: true, categories: [{ id: 'cat-1', questionTypeCounts: counts }] });
    expect(catalog.categories[0].questionTypeCounts).toBeUndefined();
  });
  it('rejects a different release root or an incomplete category set', () => {
    expect(mergeLocalQuestionTypePreview(catalog, { data: { ...index.data, releaseRootSha256: 'b'.repeat(64) } })).toBeNull();
    expect(mergeLocalQuestionTypePreview(catalog, { data: { ...index.data, categories: [] } })).toBeNull();
  });
});
