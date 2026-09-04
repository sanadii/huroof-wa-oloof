import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('entry has no critical or serious automated accessibility violations', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`); const results = await new AxeBuilder({ page }).analyze(); expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
});
