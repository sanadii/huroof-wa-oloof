import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function assertNoSeriousViolations(page: Parameters<typeof AxeBuilder>[0]['page']) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
}

for (const gameKind of ['huroof', 'categories'] as const) test(`${gameKind} host, player, and audience gameplay surfaces have no serious automated accessibility violations`, async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const firstContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const audienceContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const host = await hostContext.newPage();
    const categorySeed = gameKind === 'categories' ? '&category=tahadani-006&category=tahadani-007' : '';
    await host.goto(`${baseURL}/host/new?kind=${gameKind}&mode=classic&demo=1${categorySeed}`);
    await host.getByTestId('create-room').click();
    const code = (await host.locator('.lobby-room-code bdi').textContent())?.trim();
    expect(code).toBeTruthy();
    const join = async (context: typeof firstContext, name: string) => {
      const page = await context.newPage();
      await page.goto(`${baseURL}/`);
      await page.getByLabel('رمز الغرفة').fill(code!);
      await page.getByRole('button', { name: 'انضم إلى غرفة' }).click();
      await page.getByLabel('اسم اللاعب').fill(name);
      await page.getByRole('button', { name: 'دخول الغرفة' }).click();
      await page.getByTestId('ready').click();
      return page;
    };
    const first = await join(firstContext, 'لاعب أول');
    await join(secondContext, 'لاعب ثان');
    await expect(host.getByTestId('start-match')).toBeEnabled();
    await host.getByTestId('start-match').click();
    await host.goto(`${baseURL}/room/${code}/host`);
    await host.getByRole('button', { name: 'جهّز الجولة' }).click();
    await expect(host.locator('.host-page[data-state="CELL_SELECTION"]')).toBeVisible();
    const audience = await audienceContext.newPage();
    await audience.goto(`${baseURL}/room/${code}/display`);
    await expect(audience.getByText('بانتظار اختيار المضيف للخلية التالية')).toBeVisible();
    await host.locator('.host-board .game-board__button:visible').first().click();
    await expect(host.locator('.host-page[data-state="QUESTION_READING"]')).toBeVisible();
    await first.goto(`${baseURL}/room/${code}/play`);

    await assertNoSeriousViolations(host);
    await assertNoSeriousViolations(first);
    await assertNoSeriousViolations(audience);
  } finally {
    await Promise.all([hostContext.close(), firstContext.close(), secondContext.close(), audienceContext.close()]);
  }
});
