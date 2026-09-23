import { expect, test } from '@playwright/test';

for (const gameKind of ['huroof', 'categories'] as const) test(gameKind + ': a host, two teams, and audience complete an authoritative demo match without answer leakage', async ({ browser, baseURL }) => {
  const host = await browser.newContext(); const horizontal = await browser.newContext(); const vertical = await browser.newContext(); const audience = await browser.newContext();
  try {
    const categorySeed = gameKind === 'categories' ? '&category=tahadani-006&category=tahadani-007' : '';
    const hostPage = await host.newPage(); await hostPage.goto(`${baseURL}/host/new?kind=${gameKind}&mode=classic&demo=1${categorySeed}`); await hostPage.getByTestId('create-room').click(); await expect(hostPage.getByRole('heading', { name: 'ردهة المباراة' })).toBeVisible();
    const code = (await hostPage.locator('bdi').textContent())!;
    const join = async (context: typeof horizontal, name: string) => { const page = await context.newPage(); await page.goto(`${baseURL}/`); await page.getByLabel('رمز الغرفة').fill(code); await page.getByRole('button', { name: 'انضم إلى غرفة' }).click(); await page.getByLabel('اسم اللاعب').fill(name); await page.getByRole('button', { name: 'دخول الغرفة' }).click(); await expect(page.getByRole('heading', { name: 'ردهة المباراة' })).toBeVisible(); await page.getByTestId('ready').click(); return page; };
    const horizontalPage = await join(horizontal, 'فريق أفقي'); const verticalPage = await join(vertical, 'فريق عمودي');
    const audiencePage = await audience.newPage(); await audiencePage.goto(`${baseURL}/room/${code}/display`); await expect(audiencePage.locator('.stage[data-state="LOBBY"]')).toBeVisible();
    await expect(hostPage.getByTestId('start-match')).toBeEnabled(); await hostPage.getByTestId('start-match').click(); await hostPage.goto(`${baseURL}/room/${code}/host`); await expect(hostPage.locator('.host-page[data-state="ROUND_SETUP"]')).toBeVisible(); await hostPage.getByRole('button', { name: 'جهّز الجولة' }).click();
    await horizontalPage.goto(`${baseURL}/room/${code}/play`); await verticalPage.goto(`${baseURL}/room/${code}/play`); await expect(horizontalPage.locator('a.skip-link')).toHaveAttribute('href', '#main-content'); await expect(hostPage.locator('h1')).toContainText('لوحة المضيف');
    const hostState = (value: string) => hostPage.locator(`.host-page[data-state="${value}"]`);
    const winRound = async () => { for (let q = 0; q < 5; q++) {
      await expect(hostState('CELL_SELECTION')).toBeVisible(); await hostPage.locator(`.host-board .game-board__button:visible[data-testid="cell-${q}-0"]`).click(); await expect(hostState('QUESTION_READING')).toBeVisible();
      await expect(horizontalPage.getByRole('button', { name: /اضغط الآن/ })).toBeEnabled(); await horizontalPage.getByRole('button', { name: /اضغط الآن/ }).click(); await expect(hostState('FIRST_ANSWER')).toBeVisible(); await hostPage.getByRole('button', { name: 'إجابة صحيحة' }).click();
      await expect(audiencePage.getByTestId(`cell-${q}-0`)).toHaveClass(/game-board__cell--horizontal/);
    } };
    await winRound(); await expect(hostState('ROUND_COMPLETE')).toBeVisible(); await hostPage.getByRole('button', { name: 'جولة جديدة' }).click(); await hostPage.getByRole('button', { name: 'جهّز الجولة' }).click(); await winRound();
    await expect(hostState('MATCH_COMPLETE')).toBeVisible(); await expect(audiencePage.locator('.stage[data-state="MATCH_COMPLETE"]')).toBeVisible(); await expect(audiencePage.getByText(/فاز فريق/)).toBeVisible(); await expect(audiencePage.locator('body')).not.toContainText('فريق فريق');
    await hostPage.goto(`${baseURL}/room/${code}/results`); await hostPage.getByTestId('rematch-same-settings').click(); await expect(hostPage.getByRole('heading', { name: 'ردهة المباراة' })).toBeVisible(); expect(hostPage.url()).not.toContain(`/room/${code}/`);
    for (const page of [horizontalPage, verticalPage, audiencePage]) { const body = await page.locator('body').textContent(); expect(body).not.toContain('الإجابة الخاصة:'); expect(body).not.toContain('البدائل:'); }
  } finally { await Promise.all([host.close(), horizontal.close(), vertical.close(), audience.close()]); }
});
