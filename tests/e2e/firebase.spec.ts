import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

test("demo Firebase emulator room is authoritative, private, and reconnect-safe", async ({
  browser,
  baseURL,
}) => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.GCLOUD_PROJECT?.startsWith("demo-")
  ) {
    throw new Error(
      "Firebase E2E requires FIRESTORE_EMULATOR_HOST and a demo-* GCLOUD_PROJECT.",
    );
  }

  const host = await browser.newContext();
  const horizontal = await browser.newContext();
  const vertical = await browser.newContext();
  const audience = await browser.newContext();
  try {
    const hostPage = await host.newPage();
    await hostPage.goto(`${baseURL}/host/new`);
    const questionSeconds = hostPage.getByLabel("وقت السؤال");
    await questionSeconds.evaluate((input) => input.setAttribute("min", "5"));
    await questionSeconds.fill("5");
    await hostPage.getByTestId("create-room").click();
    await expect(
      hostPage.getByRole("heading", { name: "ردهة المباراة" }),
    ).toBeVisible({ timeout: 15_000 });

    const code = (await hostPage
      .locator(".lobby-room-code bdi")
      .textContent())!;
    const roomId = await hostPage.evaluate(
      (roomCode) => sessionStorage.getItem(`huroof:code:${roomCode}`),
      code,
    );
    expect(roomId).toBeTruthy();

    const join = async (context: typeof horizontal, name: string) => {
      const page = await context.newPage();
      await page.goto(`${baseURL}/`);
      await page.getByLabel("رمز الغرفة").fill(code);
      await page.getByText("إضافة اسم اللاعب").click();
      await page.getByLabel("اسم اللاعب").fill(name);
      await page.getByRole("button", { name: "انضم إلى غرفة" }).click();
      await expect(
        page.getByRole("heading", { name: "ردهة المباراة" }),
      ).toBeVisible();
      await page.getByTestId("ready").click();
      await expect(page.getByTestId("ready")).toContainText("إلغاء الجاهزية");
      return page;
    };

    const one = await join(horizontal, "الأول");
    const two = await join(vertical, "الثاني");
    const display = await audience.newPage();
    await display.goto(`${baseURL}/room/${code}/display`);
    await expect(hostPage.getByTestId("start-match")).toBeEnabled();
    await hostPage.getByTestId("start-match").click();
    await expect(hostPage).toHaveURL(new RegExp(`/room/${code}/host$`));
    await expect(
      hostPage.locator('.host-page[data-state="ROUND_SETUP"]'),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: "جهّز الجولة" }).click();
    await hostPage.locator(".game-board__button").first().click();
    await hostPage.getByRole("button", { name: "اكشف الحرف" }).click();
    await expect(
      hostPage.locator('.host-page[data-state="QUESTION_READING"]'),
    ).toBeVisible();

    // Warm every role route and inspect already-projected data before opening the
    // five-second buzzer window. The later simultaneous clicks then exercise the
    // authoritative race instead of cold navigation latency.
    await Promise.all([
      one.goto(`${baseURL}/room/${code}/play`),
      two.goto(`${baseURL}/room/${code}/play`),
    ]);
    await expect(one.locator(".buzzer")).toBeDisabled();
    await expect(two.locator(".buzzer")).toBeDisabled();

    const admin = getFirestore(
      getApps()[0] ?? initializeApp({ projectId: "demo-huroof-wa-oloof" }),
    );
    const projections = await admin
      .collection(`rooms/${roomId}/projections`)
      .get();
    const serialized = Object.fromEntries(
      projections.docs.map((document) => [
        document.id,
        JSON.stringify(document.data()),
      ]),
    );
    expect(serialized.host).toContain("primaryAnswer");
    expect(serialized.host).toContain('"modality":"classic"');
    expect(serialized.host).toMatch(/"categories":\["tahadani-001"/);
    expect(serialized.audience).not.toMatch(
      /primaryAnswer|canonicalAnswer|acceptedAnswers|sources|review|moderation/,
    );
    for (const [id, value] of Object.entries(serialized)) {
      if (id.startsWith("player_"))
        expect(value).not.toMatch(
          /primaryAnswer|canonicalAnswer|acceptedAnswers|sources|review|moderation/,
        );
    }

    await hostPage.getByRole("button", { name: "افتح البازر" }).click();
    const buzzOne = one.getByRole("button", { name: /اضغط الآن/ });
    const buzzTwo = two.getByRole("button", { name: /اضغط الآن/ });
    await expect(buzzOne).toBeEnabled();
    await expect(buzzTwo).toBeEnabled();
    await Promise.all([buzzOne.click(), buzzTwo.click()]);
    await expect(hostPage.locator(".buzz-winner")).toBeVisible();
    await expect(display.locator(".buzz-winner")).toBeVisible();
    await expect(
      one.locator('.buzzer[data-state="first"], .buzzer[data-state="locked"]'),
    ).toBeVisible();
    await expect(
      two.locator('.buzzer[data-state="first"], .buzzer[data-state="locked"]'),
    ).toBeVisible();
    const winnerCount = await Promise.all([
      one.locator('.buzzer[data-state="first"]').count(),
      two.locator('.buzzer[data-state="first"]').count(),
    ]);
    expect(winnerCount[0] + winnerCount[1]).toBe(1);
    for (const page of [one, two, display]) {
      await expect(page.locator("body")).not.toContainText("الإجابة الخاصة");
      await expect(page.locator("body")).not.toContainText("البدائل:");
    }

    await one.reload();
    await expect(
      one.locator('.buzzer[data-state="first"], .buzzer[data-state="locked"]'),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: "إجابة صحيحة" }).click();
    await expect(
      hostPage.locator('.host-page[data-state="CELL_AWARDED"]'),
    ).toBeVisible();

    const beginCorrection = async () => {
      await hostPage.getByText("تصحيح وسجل التدقيق").click();
      const form = hostPage.locator(".correction-form");
      await form.locator("select").first().selectOption({ index: 1 });
      await form.locator("select").nth(1).selectOption("horizontal");
      await form.locator("textarea").fill("اختبار تصحيح فايربيس");
      await form.getByRole("button", { name: "معاينة التصحيح" }).click();
      await expect(hostPage.getByTestId("correction-review")).toBeVisible();
    };
    await beginCorrection();
    await hostPage.getByRole("button", { name: "إلغاء التصحيح" }).click();
    await expect(
      hostPage.locator('.host-page[data-state="CELL_AWARDED"]'),
    ).toBeVisible();
    await beginCorrection();
    await hostPage.getByRole("button", { name: "تأكيد التصحيح" }).click();
    await expect(
      hostPage.locator('.host-page[data-state="CELL_SELECTION"]'),
    ).toBeVisible();

    await hostPage.locator(".game-board__button").nth(1).click();
    await hostPage.getByRole("button", { name: "اكشف الحرف" }).click();
    await hostPage.getByRole("button", { name: "افتح البازر" }).click();
    await expect(
      hostPage.locator('.host-page[data-state="QUESTION_FAILED"]'),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await Promise.all([
      host.close(),
      horizontal.close(),
      vertical.close(),
      audience.close(),
    ]);
  }
});
