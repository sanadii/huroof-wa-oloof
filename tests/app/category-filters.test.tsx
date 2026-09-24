import { expect, it } from 'vitest';
import { availableCategoryCatalog, categoryCatalog } from '../../src/data/category-catalog';
import sourceCategoryCovers from '../../src/data/tahadani-games-category-covers.public.json';
import {
  categoryTopicIdForCategory,
  categoryTopics,
  filterCategories,
  normalizeCategoryFilterText,
} from '../../src/data/category-filters';
import { sourceTopicCoverage } from '../../src/data/category-topic-taxonomy';

it('assigns every imported category to one browse topic exactly once', () => {
  const topicIdSet = new Set(categoryTopics.map((topic) => topic.id));
  const explicitCategoryIds = categoryTopics.flatMap((topic) => topic.categoryIds);

  expect(categoryCatalog.every((category) =>
    topicIdSet.has(categoryTopicIdForCategory(category)),
  )).toBe(true);
  expect([...new Set(explicitCategoryIds)]).toHaveLength(
    explicitCategoryIds.length,
  );
});

it('exposes only documented drafting or ready inventory to player-facing filters', () => {
  expect(availableCategoryCatalog.map((category) => category.id)).toEqual([
    'tahadani-006',
    'tahadani-007',
    'tahadani-008',
    'tahadani-013',
    'tahadani-045',
    'tahadani-046',
    'tahadani-047',
    'tahadani-051',
  ]);
  expect(availableCategoryCatalog.every((category) =>
    category.questionReadiness === 'drafting' || category.questionReadiness === 'ready',
  )).toBe(true);
});

it('normalizes Arabic search text and intersects topic and selected-only filters', () => {
  expect(normalizeCategoryFilterText('إِمـاراتى')).toBe('اماراتي');

  const results = filterCategories(availableCategoryCatalog, {
    query: 'تِكْنُولـوجيا',
    selectedIds: ['tahadani-006', 'tahadani-008'],
    selectedOnly: true,
    topicId: 'science',
  });

  expect(results.map((category) => category.id)).toEqual(['tahadani-008']);
  expect(filterCategories(availableCategoryCatalog, {
    query: '',
    selectedIds: [],
    selectedOnly: true,
    topicId: 'all',
  })).toEqual([]);
});

it('keeps documented newer categories and unknown Firebase labels in exactly one topic', () => {
  expect(categoryTopicIdForCategory({ id: 'goals-2026', displayNameAr: 'من سجل الهدف؟' })).toBe('sports');
  expect(categoryTopicIdForCategory({ id: 'huroof-076', displayNameAr: 'Fortnite' })).toBe('games');
  expect(categoryTopicIdForCategory({ id: 'huroof-100', displayNameAr: 'جغرافيا العالم' })).toBe('geography');
  expect(categoryTopicIdForCategory({ id: 'future-anime', displayNameAr: 'مسلسلات أنمي' })).toBe('animation');
  expect(categoryTopicIdForCategory({ id: 'future-music', displayNameAr: 'أغاني جديدة' })).toBe('music');
  expect(categoryTopicIdForCategory({ id: 'future-kitchen', displayNameAr: 'مطبخ عالمي' })).toBe('other');
  expect(categoryTopicIdForCategory({ id: 'firebase-175', displayNameAr: 'موضوع غير مصنف' })).toBe('other');

  const categories = [
    { id: 'goals-2026', displayNameAr: 'من سجل الهدف؟', questionReadiness: 'ready', cover: { web320: '', altAr: '', publishable: true } },
    { id: 'huroof-076', displayNameAr: 'Fortnite', questionReadiness: 'ready', cover: { web320: '', altAr: '', publishable: true } },
    { id: 'huroof-100', displayNameAr: 'جغرافيا العالم', questionReadiness: 'ready', cover: { web320: '', altAr: '', publishable: true } },
    { id: 'future-science', displayNameAr: 'فضاء جديد', questionReadiness: 'ready', cover: { web320: '', altAr: '', publishable: true } },
    { id: 'future-kitchen', displayNameAr: 'مطبخ عالمي', questionReadiness: 'ready', cover: { web320: '', altAr: '', publishable: true } },
    { id: 'firebase-175', displayNameAr: 'موضوع غير مصنف', questionReadiness: 'ready', cover: { web320: '', altAr: '', publishable: true } },
  ] as const;
  const topicCounts = categoryTopics.map(({ id }) =>
    filterCategories(categories, { query: '', selectedIds: [], selectedOnly: false, topicId: id }).length,
  );
  const allCount = filterCategories(categories, {
    query: '', selectedIds: [], selectedOnly: false, topicId: 'all',
  }).length;

  expect(topicCounts.reduce((total, count) => total + count, 0)).toBe(allCount);
  expect(allCount).toBe(categories.length);
  expect(categories.every((category) => categoryTopics.some(
    (topic) => topic.id === categoryTopicIdForCategory(category),
  ))).toBe(true);
  expect(filterCategories(categories, { query: '', selectedIds: [], selectedOnly: false, topicId: 'science' }).map((category) => category.id)).toEqual(['future-science']);
  expect(filterCategories(categories, { query: '', selectedIds: [], selectedOnly: false, topicId: 'other' }).map((category) => category.id)).toEqual(['future-kitchen', 'firebase-175']);
});

it('keeps every reviewed source category meaningful when Firebase supplies a different runtime ID', () => {
  expect(sourceTopicCoverage).toEqual({ categoryIds: 558, normalizedLabels: 544 });

  const sourceTopics = sourceCategoryCovers.categories.map((category) =>
    categoryTopicIdForCategory({ id: category.categoryId, displayNameAr: category.normalizedNameAr }),
  );
  const runtimeLabelTopics = sourceCategoryCovers.categories.map((category) =>
    categoryTopicIdForCategory({ id: `firebase-${category.sourceIndex}`, displayNameAr: category.normalizedNameAr }),
  );

  expect(sourceTopics).not.toContain('other');
  expect(runtimeLabelTopics).toEqual(sourceTopics);
});

it('uses reviewed content parents for mixed Gulf collections and quiz formats', () => {
  const topicFor = (displayNameAr: string) => categoryTopicIdForCategory({
    id: `runtime-${displayNameAr}`,
    displayNameAr,
  });

  expect(topicFor('نادي القادسية')).toBe('sports');
  expect(topicFor('مطاعم الكويت')).toBe('restaurants');
  expect(topicFor('دبي مول')).toBe('lifestyle');
  expect(topicFor('يوتيوب سعودي')).toBe('digital');
  expect(topicFor('يوم التأسيس')).toBe('history');
  expect(topicFor('كلمات كويتية قديمة')).toBe('literature');
  expect(topicFor('مدينة برشلونة')).toBe('geography');
  expect(topicFor('غزوات ومعارك')).toBe('religion');
  expect(topicFor('حروف اسلامي')).toBe('religion');
  expect(topicFor('توقع الحيوان')).toBe('science');
  expect(topicFor('خمن الصورة كُروية')).toBe('sports');
  expect(topicFor('خليجي')).toBe('sports');
  expect(topicFor('من أنا / شخصيات كويتية')).toBe('screen');
});

it('aligns reviewed legacy labels with their source-parent assignments', () => {
  const legacyByLabel = new Map(categoryCatalog.map((category) => [category.displayNameAr, category]));

  expect(categoryTopicIdForCategory(legacyByLabel.get('تاريخ')!)).toBe('history');
  expect(categoryTopicIdForCategory(legacyByLabel.get('سيارات')!)).toBe('lifestyle');
  expect(categoryTopicIdForCategory(legacyByLabel.get('منوعات شعرية')!)).toBe('literature');
});
