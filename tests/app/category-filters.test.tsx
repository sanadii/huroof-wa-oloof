import { expect, it } from 'vitest';
import { availableCategoryCatalog, categoryCatalog } from '../../src/data/category-catalog';
import {
  categoryTopics,
  filterCategories,
  normalizeCategoryFilterText,
} from '../../src/data/category-filters';

it('assigns every imported category to one browse topic exactly once', () => {
  const catalogIds = categoryCatalog.map((category) => category.id).sort();
  const topicIds = categoryTopics.flatMap((topic) => topic.categoryIds);

  expect(topicIds).toHaveLength(catalogIds.length);
  expect([...new Set(topicIds)]).toHaveLength(topicIds.length);
  expect([...topicIds].sort()).toEqual(catalogIds);
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
