import { expect, test } from '@playwright/test';

test('an admin can create, run, and score a room without any players', async ({ browser, baseURL }) => {
  const host = await browser.newContext();
  const audience = await browser.newContext();

  try {
    const hostPage = await host.newPage();
    await hostPage.goto(`${baseURL}/host/new`);
    await hostPage.getByLabel('اسم الفريق الأحمر ↔ الأحمر').fill('الأحمر');
    await hostPage.getByLabel('اسم الفريق الأخضر ↕ الأخضر').fill('الأخضر');
    await hostPage.getByTestId('create-room').click();

    await expect(hostPage.getByRole('heading', { name: 'ردهة المباراة' })).toBeVisible({ timeout: 15_000 });
    await expect(hostPage.getByText('0/0 جاهزون')).toBeVisible();
    await expect(hostPage.getByTestId('start-blocked')).toContainText('وضع المضيف فقط جاهز');
    await expect(hostPage.getByTestId('start-match')).toBeEnabled();

    const code = (await hostPage.locator('bdi').textContent())!;
    const audiencePage = await audience.newPage();
    await audiencePage.goto(`${baseURL}/room/${code}/display`);

    await hostPage.getByTestId('start-match').click();
    await hostPage.goto(`${baseURL}/room/${code}/host`);
    await expect(hostPage.getByText('تجهيز الجولة', { exact: true })).toBeVisible();
    await hostPage.getByRole('button', { name: 'جهّز الجولة' }).click();

    const hostState = (value: string) => hostPage.locator(`.host-page[data-state="${value}"]`);
    await expect(hostState('CELL_SELECTION')).toBeVisible();
    await hostPage.locator('.game-board__button').first().click();
    await expect(hostState('LETTER_REVEAL')).toBeVisible();
    await hostPage.getByRole('button', { name: 'اكشف الحرف' }).click();
    await expect(hostState('QUESTION_READING')).toBeVisible();

    await expect(hostPage.getByRole('button', { name: 'افتح البازر' })).toHaveCount(0);
    await expect(hostPage.getByTestId('host-select-horizontal')).toBeEnabled();
    await expect(hostPage.getByTestId('host-select-vertical')).toBeEnabled();
    await hostPage.getByTestId('host-select-horizontal').click();

    await expect(hostState('FIRST_ANSWER')).toBeVisible();
    await expect(hostPage.locator('.buzz-winner')).toContainText('اختيار المضيف:');
    await expect(hostPage.locator('.buzz-winner')).toContainText('الأحمر');
    await expect(audiencePage.locator('.buzz-winner')).toContainText('اختيار المضيف:');
    await expect(audiencePage.locator('.buzz-winner')).toContainText('الأحمر');

    await hostPage.getByRole('button', { name: 'إجابة صحيحة' }).click();
    await expect(hostState('CELL_AWARDED')).toBeVisible();
    await hostPage.getByRole('button', { name: 'ثبّت الخلية (+1 نقطة)' }).click();
    await expect(hostState('PATH_CHECK')).toBeVisible();
    await expect(hostPage.getByTestId('host-score-horizontal')).toContainText('نقاط الإجابات: 1');
    await expect(audiencePage.locator('.stage-score--horizontal')).toContainText('نقاط الإجابات: 1');

    await expect(audiencePage.locator('body')).not.toContainText('الإجابة الخاصة:');
    await expect(audiencePage.locator('body')).not.toContainText('البدائل:');
  } finally {
    await Promise.all([host.close(), audience.close()]);
  }
});
