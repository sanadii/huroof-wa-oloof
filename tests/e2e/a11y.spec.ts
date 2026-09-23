import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('entry has no critical or serious automated accessibility violations', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`); const results = await new AxeBuilder({ page }).analyze(); expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
});

test('legacy question routes reach the current protected admin access state without serious violations', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/questions`);
  await expect(page).toHaveURL(/\/admin\/questions$/);
  await expect(page.getByRole('heading', { name: 'لا تملك صلاحية الوصول إلى الاستوديو الإداري.' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
});
