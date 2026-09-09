import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp as initializeClientApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore as getClientFirestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

async function callableClient(name: string) {
  const app = initializeClientApp(
    {
      apiKey: "demo-api-key",
      authDomain: "demo-huroof-wa-oloof.firebaseapp.com",
      projectId: "demo-huroof-wa-oloof",
      appId: `1:1234567890:web:${name}`,
    },
    name,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:19099", {
    disableWarnings: true,
  });
  await signInAnonymously(auth);
  const firestore = getClientFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 18080);
  const functions = getFunctions(app, "me-central2");
  connectFunctionsEmulator(functions, "127.0.0.1", 15001);
  return { app, auth, functions, firestore };
}

test('Firebase emulator serves the four actual v18 image fixtures only through current room bindings', async () => {
  const host = await callableClient('v18-media-host');
  const audience = await callableClient('v18-media-audience');
  const fixtures = [
    ['011', 'v18-011-001', 'e17ba1a51399bee8f086c41a9c1736543240c206e4e208027641fcbe153e701e'],
    ['012', 'v18-012-001', 'e181407175327841cca462e8dae064204108ed0234c4d41d71c0d91f3b208b5c'],
    ['014', 'v18-tahadani-014-001', '1ee18bdcdf48ebef738ff4b85985eaa5a37997c7e1f2f8ab677b048bf397d985'],
    ['061', 'v18-tahadani-061-001', '37b3fa0bde40f23072a4c98122135226849584f3010d32664c371006a019923b'],
  ] as const;
  try {
    const database = getFirestore(getApps()[0] ?? initializeApp({ projectId: 'demo-huroof-wa-oloof' }));
    const hostUid = host.auth.currentUser?.uid, audienceUid = audience.auth.currentUser?.uid;
    expect(hostUid).toBeTruthy(); expect(audienceUid).toBeTruthy();
    const mediaCall = httpsCallable(host.functions, 'getCurrentQuestionMedia');
    const audienceCall = httpsCallable(audience.functions, 'getCurrentQuestionMedia');
    for (const [category, mediaId, assetSha256] of fixtures) {
      const roomId = `v18-media-${category}`;
      const canonical = {
        schemaVersion: 2, roomCode: `MEDIA${category}`, revision: 1,
        game: { lifecycle: 'QUESTION_READING', currentRound: 1, questionScores: { horizontal: 0, vertical: 0 }, roundWins: { horizontal: 0, vertical: 0 } },
        config: { demo: true, questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: 'أحمر', vertical: 'أخضر' }, releaseId: 'release-media-emulator-fixture', releaseRootSha256: 'a'.repeat(64), releaseDemoFixture: true, showQuestionOnAudience: true },
        timer: { deadlineMs: Date.now() + 20_000, buzzOpen: true }, questionCursor: 1,
        activeQuestion: { id: `fixture-${category}`, categoryId: `fixture-${category}`, modality: 'image', answerConceptId: `fixture:${category}`, targetLetter: 'ا', headerAr: 'صورة اختبار', promptAr: 'اختبار صورة حقيقية', canonicalAnswer: 'خاص', acceptedAnswers: ['خاص'], media: { mediaId, assetSha256, altAr: 'صورة السؤال' } },
      };
      await database.doc(`rooms/${roomId}`).set(canonical);
      await Promise.all([
        database.doc(`rooms/${roomId}/members/${hostUid}`).set({ uid: hostUid, role: 'host', displayName: 'مضيف', active: true, ready: true }),
        database.doc(`rooms/${roomId}/members/${audienceUid}`).set({ uid: audienceUid, role: 'audience', displayName: 'جمهور', active: true, ready: false }),
        database.doc(`releases/release-media-emulator-fixture/media/${mediaId}`).set({ mediaId, assetSha256, objectName: `question-media/v18/${assetSha256}.png`, generation: '1', immutable: true }),
      ]);
      const request = { roomId, mediaId, assetSha256 };
      const [hostResult, audienceResult] = await Promise.all([mediaCall(request), audienceCall(request)]);
      for (const result of [hostResult.data, audienceResult.data] as Array<{ mediaId: string; assetSha256: string; url: string; expiresAt: string }>) {
        expect(result.mediaId).toBe(mediaId); expect(result.assetSha256).toBe(assetSha256); expect(result.url).toMatch(/^data:image\/png;base64,/); expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
      }
      await expect(mediaCall({ ...request, assetSha256: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'functions/permission-denied' });
      const releasePath = `releases/release-media-emulator-fixture/media/${mediaId}`;
      await database.doc(releasePath).update({ immutable: false });
      await expect(mediaCall(request)).rejects.toMatchObject({ code: 'functions/failed-precondition' });
      await database.doc(releasePath).update({ immutable: true, objectName: `question-media/v18/${'a'.repeat(64)}.png` });
      await expect(mediaCall(request)).rejects.toMatchObject({ code: 'functions/failed-precondition' });
      await database.doc(releasePath).update({ objectName: `question-media/v18/${assetSha256}.png`, generation: 'not-a-generation' });
      await expect(mediaCall(request)).rejects.toMatchObject({ code: 'functions/failed-precondition' });
      await database.doc(releasePath).update({ generation: '1' });
    }
  } finally { await Promise.all([deleteApp(host.app), deleteApp(audience.app)]); }
});

test('Firebase host and audience render a real private image without crop, overflow, or answer leakage', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const evidence = join(process.cwd(), 'output', 't14.2-media');
  const fixture = { mediaId: 'v18-tahadani-014-001', assetSha256: '1ee18bdcdf48ebef738ff4b85985eaa5a37997c7e1f2f8ab677b048bf397d985', altAr: 'صورة السؤال' };
  const host = await browser.newContext();
  const audience = await browser.newContext();
  try {
    await mkdir(evidence, { recursive: true });
    const hostPage = await host.newPage();
    await hostPage.goto(`${baseURL}/host/new?demo=1`);
    await hostPage.getByTestId('create-room').click();
    await expect(hostPage.getByRole('heading', { name: 'ردهة المباراة' })).toBeVisible();
    const code = (await hostPage.locator('.lobby-room-code bdi').textContent())!;
    const roomId = await hostPage.evaluate((roomCode) => sessionStorage.getItem(`huroof:code:${roomCode}`), code);
    expect(roomId).toBeTruthy();
    const audiencePage = await audience.newPage();
    await audiencePage.goto(`${baseURL}/room/${code}/display`);
    await expect(audiencePage.locator('.stage[data-state="LOBBY"]')).toBeVisible();
    await hostPage.goto(`${baseURL}/room/${code}/host`);
    const database = getFirestore(getApps()[0] ?? initializeApp({ projectId: 'demo-huroof-wa-oloof' }));
    const roomRef = database.doc(`rooms/${roomId}`);
    const canonical = (await roomRef.get()).data()!;
    const question = { id: 'ui-image-fixture', categoryId: 'fixture-014', modality: 'image', answerConceptId: 'fixture:014', targetLetter: 'ا', headerAr: 'صورة السؤال', promptAr: 'تعرّف إلى الصورة', canonicalAnswer: 'ممنوع-للجمهور', acceptedAnswers: ['ممنوع-للجمهور'], media: fixture };
    await Promise.all([
      roomRef.update({
        config: { ...canonical.config, releaseId: 'release-media-ui-fixture', releaseRootSha256: 'a'.repeat(64), showQuestionOnAudience: true },
        game: { ...canonical.game, lifecycle: 'QUESTION_READING' }, timer: { deadlineMs: Date.now() + 30_000, buzzOpen: true }, questionCursor: 1, activeQuestion: question,
      }),
      database.doc(`releases/release-media-ui-fixture/media/${fixture.mediaId}`).set({ mediaId: fixture.mediaId, assetSha256: fixture.assetSha256, objectName: `question-media/v18/${fixture.assetSha256}.png`, generation: '1', immutable: true }),
      database.doc(`rooms/${roomId}/projections/host`).set({ projection: { question: { ...question, primaryAnswer: question.canonicalAnswer }, room: { state: 'QUESTION_READING' } } }, { merge: true }),
      database.doc(`rooms/${roomId}/projections/audience`).set({ projection: { question: { headerAr: question.headerAr, promptAr: question.promptAr, media: fixture }, room: { state: 'QUESTION_READING', audienceQuestionVisible: true } } }, { merge: true }),
    ]);
    for (const page of [hostPage, audiencePage]) {
      await expect(page.getByTestId('question-media')).toBeVisible();
      await expect(page.getByTestId('question-media').locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
      await expect.poll(() => page.getByTestId('question-media').locator('img').evaluate((image) => image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);
    }
    await expect(audiencePage.locator('body')).not.toContainText('ممنوع-للجمهور');
    const capture = async (page: typeof hostPage, name: string, width: number, height: number) => {
      await page.setViewportSize({ width, height });
      const image = page.getByTestId('question-media').locator('img');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(image).toHaveCSS('object-fit', 'contain');
      const box = await image.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: join(evidence, `${name}-${width}x${height}.png`), fullPage: true, animations: 'disabled' });
    };
    await capture(hostPage, 'host-image', 1440, 900);
    await capture(hostPage, 'host-image', 320, 568);
    await capture(audiencePage, 'audience-image', 1440, 900);
    await capture(audiencePage, 'audience-image', 320, 568);
  } finally { await Promise.all([host.close(), audience.close()]); }
});

test("Firebase category board persists a trusted label, failure replacement, and actor receipt", async () => {
  const host = await callableClient("category-runtime-host");
  try {
    const create = httpsCallable(host.functions, "createRoom");
    const submit = httpsCallable(host.functions, "submitGameIntent");
    const created = await create({ displayName: "مضيف الفئات", demo: true, gameKind: "categories", categories: ["tahadani-006", "tahadani-007"], modality: "classic", questionSeconds: 5, opponentSeconds: 5 });
    const room = created.data as { roomId: string; revision: number };
    let revision = room.revision;
    const intent = async (type: string, payload: Record<string, unknown> = {}) => {
      const result = await submit({ roomId: room.roomId, intent: { type, intentId: `${type}-${revision}`, expectedRevision: revision, payload } });
      revision = (result.data as { revision: number }).revision;
      return result;
    };
    await intent("START_MATCH"); await intent("ROUND_READY");
    const database = getFirestore(getApps()[0] ?? initializeApp({ projectId: "demo-huroof-wa-oloof" }));
    const canonicalBefore = (await database.doc(`rooms/${room.roomId}`).get()).data()!;
    const before = canonicalBefore.game.board.cells[0] as { id: string; kind: string; categoryId: string; categoryLabelAr: string };
    expect(before.kind).toBe("category"); expect(before.categoryLabelAr).toBeTruthy();
    await intent("SELECT_CELL", { cellId: before.id });
    await intent("HOST_SELECT_TEAM", { team: "horizontal" }); await intent("JUDGE_INCORRECT");
    await intent("HOST_SELECT_TEAM", { team: "vertical" }); await intent("JUDGE_INCORRECT");
    const retryRevision = revision;
    const retried = await intent("RETRY_CELL");
    expect(retried.data).toMatchObject({ replayed: false });
    const canonicalAfterRetry = (await database.doc(`rooms/${room.roomId}`).get()).data()!;
    const after = canonicalAfterRetry.game.board.cells.find((cell: { id: string }) => cell.id === before.id) as { categoryId: string; categoryLabelAr: string };
    expect(after.categoryId).not.toBe(before.categoryId);
    expect(after.categoryLabelAr).toBeTruthy();
    expect(canonicalAfterRetry.game.lifecycle).toBe("CELL_SELECTION");
    expect(canonicalAfterRetry.game.activeCellId).toBeUndefined();
    expect(canonicalAfterRetry.activeQuestion).toBeUndefined();
    expect(canonicalAfterRetry.timer).toBeUndefined();
    const replay = await submit({ roomId: room.roomId, intent: { type: "RETRY_CELL", intentId: `RETRY_CELL-${retryRevision}`, expectedRevision: retryRevision, payload: {} } });
    expect(replay.data).toMatchObject({ revision, replayed: true });
    await database.doc(`categories/${after.categoryId}`).update({ displayNameAr: "تسمية لا ينبغي أن تغير الغرفة" });
    const reloaded = ((await database.doc(`rooms/${room.roomId}`).get()).data()!).game.board.cells.find((cell: { id: string }) => cell.id === before.id) as { categoryLabelAr: string };
    expect(reloaded.categoryLabelAr).toBe(after.categoryLabelAr);
    const publicProjection = await database.doc(`rooms/${room.roomId}/projections/host`).get();
    expect(JSON.stringify(publicProjection.data())).not.toMatch(/questionSelection|reservedQuestionIds|canonicalAnswer|answerConceptId/);
  } finally { await deleteApp(host.app); }
});

test("Firebase callable persists a depletion hold, ends without a winner, and starts a fresh same-settings room", async () => {
  const host = await callableClient("content-hold-host");
  try {
    const create = httpsCallable(host.functions, "createRoom");
    const submit = httpsCallable(host.functions, "submitGameIntent");
    const created = await create({ displayName: "مضيف", demo: true, categories: ["tahadani-006"], modality: "classic" });
    const room = created.data as { roomId: string; revision: number };
    let revision = room.revision;
    const send = async (type: string, payload: Record<string, unknown> = {}) => {
      const response = await submit({ roomId: room.roomId, intent: { type, intentId: `${type}-${revision}`, expectedRevision: revision, payload } });
      revision = (response.data as { revision: number }).revision;
      return response;
    };
    await send("START_MATCH"); await send("ROUND_READY");
    const database = getFirestore(getApps()[0] ?? initializeApp({ projectId: "demo-huroof-wa-oloof" }));
    const canonical = (await database.doc(`rooms/${room.roomId}`).get()).data()!;
    const cell = canonical.game.board.cells.find((item: { kind: string }) => item.kind === "letter") as { id: string };
    const queues = Object.fromEntries(Object.keys(canonical.questionSelection.queues).map((key) => [key, []]));
    await database.doc(`rooms/${room.roomId}`).update({ "questionSelection.queues": queues });
    await send("SELECT_CELL", { cellId: cell.id });
    const held = (await database.doc(`rooms/${room.roomId}`).get()).data()!;
    expect(held.game.contentHold).toMatchObject({ reason: "CONTENT_EXHAUSTED", operation: "SELECT_CELL", cellId: cell.id });
    await expect(submit({ roomId: room.roomId, intent: { type: "ROUND_READY", intentId: "held-play", expectedRevision: revision, payload: {} } })).rejects.toThrow();
    await send("END_WITHOUT_WINNER");
    const ended = (await database.doc(`rooms/${room.roomId}`).get()).data()!;
    expect(ended.game.lifecycle).toBe("MATCH_COMPLETE"); expect(ended.game.endedWithoutWinner).toBe(true); expect(ended.game.roundOutcomeHistory).toEqual([]);
    const fresh = await create({ displayName: "مضيف", demo: true, categories: ["tahadani-006"], modality: "classic" });
    const freshRoom = fresh.data as { roomId: string; revision: number };
    const started = await submit({ roomId: freshRoom.roomId, intent: { type: "START_MATCH", intentId: "fresh-start", expectedRevision: freshRoom.revision, payload: {} } });
    expect(started.data).toMatchObject({ revision: freshRoom.revision + 1 });
  } finally { await deleteApp(host.app); }
});

test("Firebase depleted-content rejection never mutates canonical state for unauthorized or illegal callers", async () => {
  const host = await callableClient("depletion-preflight-host");
  const player = await callableClient("depletion-preflight-player");
  const audience = await callableClient("depletion-preflight-audience");
  try {
    const create = httpsCallable(host.functions, "createRoom");
    const hostSubmit = httpsCallable(host.functions, "submitGameIntent");
    const playerSubmit = httpsCallable(player.functions, "submitGameIntent");
    const audienceSubmit = httpsCallable(audience.functions, "submitGameIntent");
    const created = await create({ displayName: "مضيف الحماية", demo: true, categories: ["tahadani-006"], modality: "classic" });
    const room = created.data as { roomId: string; revision: number };
    let revision = room.revision;
    const send = async (type: string, payload: Record<string, unknown> = {}) => {
      const response = await hostSubmit({ roomId: room.roomId, intent: { type, intentId: `preflight-${type}-${revision}`, expectedRevision: revision, payload } });
      revision = (response.data as { revision: number }).revision;
      return response;
    };
    await send("START_MATCH"); await send("ROUND_READY");
    const database = getFirestore(getApps()[0] ?? initializeApp({ projectId: "demo-huroof-wa-oloof" }));
    const roomRef = database.doc(`rooms/${room.roomId}`);
    const canonical = (await roomRef.get()).data()!;
    const cell = canonical.game.board.cells.find((item: { kind: string }) => item.kind === "letter") as { id: string };
    const queues = Object.fromEntries(Object.keys(canonical.questionSelection.queues).map((key) => [key, []]));
    await roomRef.update({ "questionSelection.queues": queues });
    const hostUid = getAuth(host.app).currentUser!.uid;
    const playerUid = getAuth(player.app).currentUser!.uid;
    const audienceUid = getAuth(audience.app).currentUser!.uid;
    await Promise.all([
      database.doc(`rooms/${room.roomId}/members/${playerUid}`).set({ uid: playerUid, role: "player", displayName: "لاعب الحماية", ready: false, active: true, team: "horizontal" }),
      database.doc(`rooms/${room.roomId}/members/${audienceUid}`).set({ uid: audienceUid, role: "audience", displayName: "جمهور الحماية", ready: false, active: true }),
    ]);
    const baseline = (await roomRef.get()).data()!;
    const hostMember = (await database.doc(`rooms/${room.roomId}/members/${hostUid}`).get()).data()!;
    const snapshot = async () => {
      const serialize = async (path: string) => (await database.collection(path).get()).docs
        .map((document) => [document.id, document.data()]).sort(([left], [right]) => left.localeCompare(right));
      return {
        room: (await roomRef.get()).data(),
        events: await serialize(`rooms/${room.roomId}/events`),
        receipts: await serialize(`rooms/${room.roomId}/intentReceipts`),
        projections: await serialize(`rooms/${room.roomId}/projections`),
      };
    };
    const rejectedWithoutMutation = async (
      label: string,
      submit: typeof hostSubmit,
      intent: { type: string; intentId: string; expectedRevision: number; payload: Record<string, unknown> },
      expectedCode?: string,
    ) => {
      const before = await snapshot();
      if (expectedCode)
        await expect(submit({ roomId: room.roomId, intent })).rejects.toMatchObject({ code: expectedCode });
      else
        await expect(submit({ roomId: room.roomId, intent })).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    };
    const select = (intentId: string, expectedRevision = revision) => ({ type: "SELECT_CELL", intentId, expectedRevision, payload: { cellId: cell.id } });

    await rejectedWithoutMutation("player", playerSubmit, select("depleted-player"));
    await rejectedWithoutMutation("audience", audienceSubmit, select("depleted-audience"));
    await database.doc(`rooms/${room.roomId}/members/${hostUid}`).update({ active: false });
    await rejectedWithoutMutation("inactive host", hostSubmit, select("depleted-inactive-host"));
    await database.doc(`rooms/${room.roomId}/members/${hostUid}`).set(hostMember);
    await rejectedWithoutMutation("stale host", hostSubmit, select("depleted-stale-host", revision - 1), "functions/aborted");
    await roomRef.set({ ...baseline, game: { ...baseline.game, lifecycle: "MATCH_COMPLETE" } });
    await rejectedWithoutMutation("illegal phase", hostSubmit, select("depleted-illegal-phase"));
    await roomRef.set(baseline);
    await roomRef.set({ ...baseline, closedAt: new Date() });
    await rejectedWithoutMutation("closed", hostSubmit, select("depleted-closed"));
    await roomRef.set(baseline);
    await roomRef.set({ ...baseline, game: { ...baseline.game, board: { ...baseline.game.board, cells: baseline.game.board.cells.map((item: { id: string }) => item.id === cell.id ? { ...item, owner: "horizontal" } : item) } } });
    await rejectedWithoutMutation("owned cell", hostSubmit, select("depleted-owned-cell"));
    await roomRef.set(baseline);
    await rejectedWithoutMutation("illegal next round", hostSubmit, { type: "START_NEXT_ROUND", intentId: "depleted-illegal-next", expectedRevision: revision, payload: {} });
    await roomRef.set({ ...baseline, game: { ...baseline.game, lifecycle: "QUESTION_FAILED", activeCellId: cell.id } });
    await rejectedWithoutMutation("player continuation", playerSubmit, { type: "RETRY_CELL", intentId: "depleted-player-continue", expectedRevision: revision, payload: {} });
    await roomRef.set(baseline);

    await send("SELECT_CELL", { cellId: cell.id });
    const held = (await roomRef.get()).data()!;
    expect(held.game.contentHold).toMatchObject({ reason: "CONTENT_EXHAUSTED", operation: "SELECT_CELL", cellId: cell.id });
    await rejectedWithoutMutation("already held", hostSubmit, select("depleted-already-held", revision));
  } finally {
    await Promise.all([deleteApp(host.app), deleteApp(player.app), deleteApp(audience.app)]);
  }
});

test("Firebase callables persist manual players atomically without member artifacts", async () => {
  const host = await callableClient("manual-host");
  const device = await callableClient("manual-device");
  const stranger = await callableClient("manual-stranger");
  try {
    const createRoom = httpsCallable(host.functions, "createRoom");
    const submit = httpsCallable(host.functions, "submitGameIntent");
    const joined = httpsCallable(device.functions, "joinRoom");
    const missingNameJoin = httpsCallable(stranger.functions, "joinRoom");
    const created = await createRoom({
      displayName: "مضيف يدوي",
      demo: true,
      categories: ["tahadani-006"],
      modality: "classic",
      teams: { horizontal: "الأحمر", vertical: "الأخضر" },
      questionSeconds: 5,
      opponentSeconds: 5,
    });
    const room = created.data as {
      roomId: string;
      roomCode: string;
      revision: number;
    };
    const intent = async (
      intentId: string,
      expectedRevision: number,
      displayName: string,
      team: "horizontal" | "vertical",
    ) =>
      submit({
        roomId: room.roomId,
        intent: {
          type: "LOBBY_ADD_MANUAL_PLAYER",
          intentId,
          expectedRevision,
          payload: { displayName, team },
        },
      });
    const first = await intent(
      "manual-replay",
      room.revision,
      "يدوي أول",
      "horizontal",
    );
    const firstRevision = (first.data as { revision: number }).revision;
    const replay = await intent(
      "manual-replay",
      room.revision,
      "يدوي أول",
      "horizontal",
    );
    expect(replay.data).toMatchObject({
      revision: firstRevision,
      replayed: true,
    });
    const second = await intent(
      "manual-second",
      firstRevision,
      "يدوي ثانٍ",
      "vertical",
    );
    let revision = (second.data as { revision: number }).revision;
    const database = getFirestore(
      getApps()[0] ?? initializeApp({ projectId: "demo-huroof-wa-oloof" }),
    );
    const canonical = await database.doc(`rooms/${room.roomId}`).get();
    expect(canonical.data()?.manualParticipants).toEqual([
      expect.objectContaining({ displayName: "يدوي أول", team: "horizontal" }),
      expect.objectContaining({ displayName: "يدوي ثانٍ", team: "vertical" }),
    ]);
    const deviceJoin = await joined({
      roomCode: room.roomCode,
      displayName: "جهاز حقيقي",
    });
    revision = (deviceJoin.data as { revision: number }).revision;
    await expect(joined({ roomCode: room.roomCode })).resolves.toMatchObject({
      data: { revision },
    });
    await expect(
      missingNameJoin({ roomCode: room.roomCode }),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
    for (let index = 0; index < 12; index += 1) {
      const result = await intent(
        `manual-cap-${index}`,
        revision,
        `يدوي ${index}`,
        index % 2 ? "horizontal" : "vertical",
      );
      revision = (result.data as { revision: number }).revision;
    }
    const boundary = await Promise.allSettled([
      intent("manual-boundary-one", revision, "حد أول", "horizontal"),
      intent("manual-boundary-two", revision, "حد ثانٍ", "vertical"),
    ]);
    const accepted = boundary.filter(
      (
        result,
      ): result is PromiseFulfilledResult<{ data: { revision: number } }> =>
        result.status === "fulfilled",
    );
    expect(accepted).toHaveLength(1);
    expect(
      boundary.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    revision = accepted[0].value.data.revision;
    const atCapacity = await database.doc(`rooms/${room.roomId}`).get();
    expect(atCapacity.data()?.manualParticipants).toHaveLength(15);
    await expect(
      intent("manual-over-cap", revision, "زيادة", "horizontal"),
    ).rejects.toMatchObject({ code: "functions/resource-exhausted" });
    const memberDocuments = await database
      .collection(`rooms/${room.roomId}/members`)
      .get();
    expect(memberDocuments.docs).toHaveLength(2);
    const projections = await database
      .collection(`rooms/${room.roomId}/projections`)
      .get();
    expect(
      projections.docs.filter((document) => document.id.startsWith("player_")),
    ).toHaveLength(1);
    for (const projection of projections.docs.filter(
      (document) => document.id !== "host",
    ))
      expect(JSON.stringify(projection.data())).not.toMatch(
        /manualParticipantId/,
      );

    const movedManual = atCapacity.data()?.manualParticipants?.[0] as {
      id: string;
      team: "horizontal" | "vertical";
    };
    const moved = await submit({
      roomId: room.roomId,
      intent: {
        type: "LOBBY_ASSIGN_TEAM",
        intentId: "move-manual-after-capacity",
        expectedRevision: revision,
        payload: {
          manualParticipantId: movedManual.id,
          team: movedManual.team === "horizontal" ? "vertical" : "horizontal",
        },
      },
    });
    revision = (moved.data as { revision: number }).revision;
    const movedTeam =
      movedManual.team === "horizontal" ? "vertical" : "horizontal";
    const movedCanonical = await database.doc(`rooms/${room.roomId}`).get();
    expect(
      movedCanonical
        .data()
        ?.manualParticipants?.find(
          (participant: { id: string }) => participant.id === movedManual.id,
        )?.team,
    ).toBe(movedTeam);
    const hostProjection = await database
      .doc(`rooms/${room.roomId}/projections/host`)
      .get();
    const playerProjection = await database
      .doc(
        `rooms/${room.roomId}/projections/player_${getAuth(device.app).currentUser?.uid}`,
      )
      .get();
    const hostMembers = (hostProjection.data()?.projection as {
      room: { members: Array<Record<string, unknown>> };
    }).room.members;
    const playerMembers = (playerProjection.data()?.projection as {
      room: { members: Array<Record<string, unknown>> };
    }).room.members;
    expect(
      hostMembers.find(
        (participant) => participant.manualParticipantId === movedManual.id,
      )?.team,
    ).toBe(movedTeam);
    expect(
      playerMembers.find(
        (participant) => participant.displayName === "يدوي أول",
      )?.team,
    ).toBe(movedTeam);
    expect(JSON.stringify(playerMembers)).not.toMatch(/manualParticipantId/);

    const deviceSubmit = httpsCallable(device.functions, "submitGameIntent");
    const deviceReady = await deviceSubmit({
      roomId: room.roomId,
      intent: {
        type: "LOBBY_SET_READY",
        intentId: "mixed-device-ready",
        expectedRevision: revision,
        payload: { ready: true },
      },
    });
    revision = (deviceReady.data as { revision: number }).revision;
    await expect(
      submit({
        roomId: room.roomId,
        intent: {
          type: "START_MATCH",
          intentId: "mixed-start",
          expectedRevision: revision,
          payload: {},
        },
      }),
    ).resolves.toMatchObject({ data: { replayed: false } });
    expect(
      (await database.doc(`rooms/${room.roomId}`).get()).data()?.game.lifecycle,
    ).toBe("ROUND_SETUP");

    const allManual = await callableClient("all-manual-host");
    try {
      const allCreate = await httpsCallable(
        allManual.functions,
        "createRoom",
      )({
        displayName: "مضيف فقط",
        demo: true,
        categories: ["tahadani-006"],
        modality: "classic",
        teams: { horizontal: "الأحمر", vertical: "الأخضر" },
        questionSeconds: 5,
        opponentSeconds: 5,
      });
      const allRoom = allCreate.data as { roomId: string; revision: number };
      const allSubmit = httpsCallable(allManual.functions, "submitGameIntent");
      const allOne = await allSubmit({
        roomId: allRoom.roomId,
        intent: {
          type: "LOBBY_ADD_MANUAL_PLAYER",
          intentId: "all-one",
          expectedRevision: allRoom.revision,
          payload: { displayName: "أول", team: "horizontal" },
        },
      });
      const allTwo = await allSubmit({
        roomId: allRoom.roomId,
        intent: {
          type: "LOBBY_ADD_MANUAL_PLAYER",
          intentId: "all-two",
          expectedRevision: (allOne.data as { revision: number }).revision,
          payload: { displayName: "ثانٍ", team: "vertical" },
        },
      });
      await expect(
        allSubmit({
          roomId: allRoom.roomId,
          intent: {
            type: "START_MATCH",
            intentId: "all-start",
            expectedRevision: (allTwo.data as { revision: number }).revision,
            payload: {},
          },
        }),
      ).resolves.toMatchObject({ data: { replayed: false } });
    } finally {
      await deleteApp(allManual.app);
    }
  } finally {
    await Promise.all([
      deleteApp(host.app),
      deleteApp(device.app),
      deleteApp(stranger.app),
    ]);
  }
});

test("Firebase presence leases are private, throttled, and expire without game writes", async () => {
  const host = await callableClient("presence-host");
  const device = await callableClient("presence-device");
  try {
    const created = await httpsCallable(host.functions, "createRoom")({
      displayName: "مضيف الحالة",
      demo: true,
      categories: ["tahadani-006"],
      modality: "classic",
      teams: { horizontal: "الأحمر", vertical: "الأخضر" },
      questionSeconds: 5,
      opponentSeconds: 5,
    });
    const room = created.data as { roomId: string; roomCode: string };
    await httpsCallable(device.functions, "joinRoom")({
      roomCode: room.roomCode,
      displayName: "لاعب الحالة",
    });
    const database = getFirestore(
      getApps()[0] ?? initializeApp({ projectId: "demo-huroof-wa-oloof" }),
    );
    const canonicalBefore = await database.doc(`rooms/${room.roomId}`).get();
    const eventBefore = await database.collection(`rooms/${room.roomId}/events`).get();
    const read = httpsCallable<{ roomId: string }, { players: Record<string, { state: string }> }>(host.functions, "getRoomPresence");
    const renew = httpsCallable<{ roomId: string }, { accepted: boolean }>(device.functions, "renewPresence");
    const deviceUid = getAuth(device.app).currentUser?.uid;
    expect(deviceUid).toBeTruthy();
    await expect(
      read({ roomId: room.roomId }),
    ).resolves.toMatchObject({ data: { players: { [deviceUid!]: { state: "unknown" } } } });
    await expect(
      httpsCallable(host.functions, "renewPresence")({ roomId: room.roomId }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(
      httpsCallable(device.functions, "getRoomPresence")({ roomId: room.roomId }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    const concurrent = await Promise.all([
      renew({ roomId: room.roomId }),
      renew({ roomId: room.roomId }),
    ]);
    expect(concurrent.filter((result) => result.data.accepted)).toHaveLength(1);
    expect(
      (await read({ roomId: room.roomId })).data.players[deviceUid!].state,
    ).toBe("connected");
    await expect(
      renew({ roomId: room.roomId, ignored: true } as { roomId: string }),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const canonicalAfter = await database.doc(`rooms/${room.roomId}`).get();
    const eventAfter = await database.collection(`rooms/${room.roomId}/events`).get();
    expect(canonicalAfter.data()?.revision).toBe(canonicalBefore.data()?.revision);
    expect(eventAfter.docs).toHaveLength(eventBefore.docs.length);
    expect(
      (await database.doc(`rooms/${room.roomId}/presence/${deviceUid}`).get()).exists,
    ).toBe(true);
    await expect(
      getDoc(doc(device.firestore, `rooms/${room.roomId}/presence/${deviceUid}`)),
    ).rejects.toMatchObject({ code: "permission-denied" });
  } finally {
    await Promise.all([deleteApp(host.app), deleteApp(device.app)]);
  }
});

test("Firebase player tabs share one renewing presence lease", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const host = await browser.newContext();
  const player = await browser.newContext();
  try {
    const hostPage = await host.newPage();
    await hostPage.goto(`${baseURL}/host/new`);
    await hostPage.getByTestId("create-room").click();
    await expect(hostPage.getByRole("heading", { name: "ردهة المباراة" })).toBeVisible({ timeout: 15_000 });
    const code = (await hostPage.locator(".lobby-room-code bdi").textContent())!;
    const roomId = await hostPage.evaluate((roomCode) => sessionStorage.getItem(`huroof:code:${roomCode}`), code);
    expect(roomId).toBeTruthy();

    const firstTab = await player.newPage();
    await firstTab.goto(`${baseURL}/`);
    await firstTab.getByLabel("رمز الغرفة").fill(code);
    await firstTab.getByRole("button", { name: "انضم إلى غرفة" }).click();
    await firstTab.getByLabel("اسم اللاعب").fill("نفس اللاعب");
    await firstTab.getByRole("button", { name: "دخول الغرفة" }).click();
    await expect(firstTab.getByRole("heading", { name: "ردهة المباراة" })).toBeVisible();
    const playerSession = await firstTab.evaluate(() => Object.entries(sessionStorage));
    await firstTab.goto(`${baseURL}/room/${code}/play`);
    await expect(firstTab.locator(".buzzer")).toBeVisible();

    const secondTab = await player.newPage();
    await secondTab.goto(`${baseURL}/`);
    await secondTab.evaluate((entries) => {
      for (const [key, value] of entries) sessionStorage.setItem(key, value);
    }, playerSession);
    await secondTab.goto(`${baseURL}/room/${code}/play`);
    await expect(secondTab.locator(".buzzer")).toBeVisible();

    await hostPage.goto(`${baseURL}/room/${code}/host`);
    await expect(hostPage.locator('.host-page[data-state="LOBBY"]')).toBeVisible();
    const capsule = hostPage.locator('[data-member-uid]').filter({ hasText: "نفس اللاعب" });
    await expect(capsule).toHaveAttribute("data-presence-state", "connected", { timeout: 20_000 });
    const deviceUid = await capsule.getAttribute("data-member-uid");
    expect(deviceUid).toBeTruthy();
    const database = getFirestore(
      getApps()[0] ?? initializeApp({ projectId: "demo-huroof-wa-oloof" }),
    );
    const initialLease = (await database.doc(`rooms/${roomId}/presence/${deviceUid}`).get()).data()?.updatedAtMs as number;
    expect(initialLease).toEqual(expect.any(Number));
    await firstTab.close();
    // The remaining tab's next 15-second heartbeat must keep the shared UID lease fresh.
    await secondTab.waitForTimeout(16_000);
    await expect(capsule).toHaveAttribute("data-presence-state", "connected", { timeout: 15_000 });
    const renewedLease = (await database.doc(`rooms/${roomId}/presence/${deviceUid}`).get()).data()?.updatedAtMs as number;
    expect(renewedLease).toBeGreaterThan(initialLease);
    await secondTab.close();
    await expect(capsule).toHaveAttribute("data-presence-state", "disconnected", { timeout: 60_000 });

    const reconnectTab = await player.newPage();
    await reconnectTab.goto(`${baseURL}/`);
    await reconnectTab.evaluate((entries) => {
      for (const [key, value] of entries) sessionStorage.setItem(key, value);
    }, playerSession);
    await reconnectTab.goto(`${baseURL}/room/${code}/play`);
    await expect(reconnectTab.locator(".buzzer")).toBeVisible();
    await expect(capsule).toHaveAttribute("data-presence-state", "connected", { timeout: 20_000 });
  } finally {
    await Promise.all([host.close(), player.close()]);
  }
});

for (const gameKind of ["huroof", "categories"] as const) {
  test(`Firebase ${gameKind} room completes two authoritative rounds, preserves private projections, and rematches`, async ({
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
      const categorySeed =
        gameKind === "categories"
          ? "&category=tahadani-006&category=tahadani-007"
          : "";
      await hostPage.goto(`${baseURL}/host/new?kind=${gameKind}&mode=classic&demo=1${categorySeed}`);
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
        await page.getByRole("button", { name: "انضم إلى غرفة" }).click();
        await page.getByLabel("اسم اللاعب").fill(name);
        await page.getByRole("button", { name: "دخول الغرفة" }).click();
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
      await expect(display.locator('.stage[data-state="LOBBY"]')).toBeVisible();
      await hostPage.goto(`${baseURL}/room/${code}/host`);
      await expect(
        hostPage.locator('.host-page[data-state="LOBBY"]'),
      ).toBeVisible();
      await expect(hostPage.getByTestId("host-lobby-member-count")).toContainText(
        "2 لاعبون منضمون",
      );

      // Move a ready player between teams, then reload and ready again. This proves
      // the callable membership transition remains authoritative across reconnect.
      const firstCapsule = hostPage.getByRole("button", { name: /الأول.*انقل إلى/ });
      await expect(firstCapsule).toBeVisible();
      await firstCapsule.click();
      await expect(one.getByTestId("ready")).toContainText("اختبر البازر وأنا جاهز");
      await one.getByTestId("ready").click();
      await expect(one.getByTestId("ready")).toContainText("إلغاء الجاهزية");
      await expect(
        hostPage.getByRole("button", { name: /الأول.*جاهز.*انقل إلى/ }),
      ).toBeVisible();
      await hostPage.getByRole("button", { name: /الأول.*انقل إلى/ }).click();
      await expect(
        hostPage.getByRole("button", {
          name: /الأول.*بانتظار الجاهزية.*انقل إلى/,
        }),
      ).toBeVisible();
      await one.reload();
      await expect(one.getByTestId("ready")).toContainText("اختبر البازر وأنا جاهز");
      await one.getByTestId("ready").click();
      await expect(one.getByTestId("ready")).toContainText("إلغاء الجاهزية");

      await expect(hostPage.getByTestId("start-match")).toBeEnabled();
      await hostPage.getByTestId("start-match").click();
      const hostState = (value: string) =>
        hostPage.locator(`.host-page[data-state="${value}"]`);
      await expect(hostState("ROUND_SETUP")).toBeVisible({ timeout: 10_000 });
      await hostPage.getByRole("button", { name: "جهّز الجولة" }).click();
      await Promise.all([
        one.goto(`${baseURL}/room/${code}/play`),
        two.goto(`${baseURL}/room/${code}/play`),
      ]);
      await expect(one.locator(".buzzer")).toBeDisabled();
      await expect(two.locator(".buzzer")).toBeDisabled();

      const admin = getFirestore(
        getApps()[0] ?? initializeApp({ projectId: "demo-huroof-wa-oloof" }),
      );
      const assertPrivateProjections = async () => {
        const projections = await admin.collection(`rooms/${roomId}/projections`).get();
        const serialized = Object.fromEntries(
          projections.docs.map((document) => [
            document.id,
            JSON.stringify(document.data()),
          ]),
        );
        expect(serialized.host).toContain("primaryAnswer");
        expect(serialized.host).toContain(`"gameKind":"${gameKind}"`);
        expect(serialized.host).toMatch(/"categories":\["tahadani-006"/);
        for (const value of Object.values(serialized)) {
          expect(value).not.toMatch(
            /questionSelection|queues|consumedQuestionIds|consumedAnswerConceptIds|reservedQuestionIds|reservedAnswerConceptIds|reservedForCell|answerConceptId/,
          );
        }
        expect(serialized.audience).not.toMatch(
          /primaryAnswer|canonicalAnswer|acceptedAnswers|sources|review|moderation/,
        );
        for (const [id, value] of Object.entries(serialized)) {
          if (id.startsWith("player_"))
            expect(value).not.toMatch(
              /primaryAnswer|canonicalAnswer|acceptedAnswers|sources|review|moderation/,
            );
        }
        const hostRoster = projections.docs
          .find((document) => document.id === "host")
          ?.data().projection.room.members as Array<{ uid?: string }>;
        expect(hostRoster.every((member) => typeof member.uid === "string")).toBe(true);
        for (const document of projections.docs.filter(
          (item) => item.id === "audience" || item.id.startsWith("player_"),
        )) {
          const roster = document.data().projection.room.members as Array<{ uid?: string }>;
          expect(roster.some((member) => member.uid)).toBe(false);
        }
      };
      const selectCell = async (row: number) => {
        await expect(hostState("CELL_SELECTION")).toBeVisible();
        await hostPage
          .locator(`.host-board .game-board__button:visible[data-testid="cell-${row}-0"]`)
          .click();
        await expect(hostState("QUESTION_READING")).toBeVisible();
      };
      const awardActiveToHorizontal = async (expectedState = "CELL_SELECTION") => {
        const buzzOne = one.getByRole("button", { name: /اضغط الآن/ });
        await expect(buzzOne).toBeEnabled();
        await buzzOne.click();
        await expect(hostState("FIRST_ANSWER")).toBeVisible();
        await hostPage.getByRole("button", { name: "إجابة صحيحة" }).click();
        await expect(hostState(expectedState)).toBeVisible({ timeout: 10_000 });
      };
      const buzzAndAwardHorizontal = async (
        row: number,
        pause = false,
        expectedState = "CELL_SELECTION",
      ) => {
        await selectCell(row);
        if (pause) {
          await hostPage.getByRole("button", { name: "إيقاف مؤقت" }).click();
          await expect(hostState("PAUSED")).toBeVisible();
          await expect(display.locator('.stage[data-state="PAUSED"]')).toBeVisible();
          await hostPage.getByRole("button", { name: "استئناف" }).click();
          await expect(hostState("QUESTION_READING")).toBeVisible();
        }
        await awardActiveToHorizontal(expectedState);
      };

      // The first selection exercises two simultaneous buzzes, client reload, and
      // a confirmed host correction. Public roles never receive the revealed answer.
      await selectCell(0);
      await assertPrivateProjections();
      const buzzOne = one.getByRole("button", { name: /اضغط الآن/ });
      const buzzTwo = two.getByRole("button", { name: /اضغط الآن/ });
      await expect(buzzOne).toBeEnabled();
      await expect(buzzTwo).toBeEnabled();
      await Promise.all([buzzOne.click(), buzzTwo.click()]);
      await expect(hostPage.locator(".buzz-winner")).toBeVisible();
      await expect(display.locator(".buzz-winner")).toBeVisible();
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
      await expect(hostState("CELL_SELECTION")).toBeVisible();

      const beginCorrection = async () => {
        await hostPage.getByTestId("correction-trigger").click();
        const dialog = hostPage.getByTestId("correction-dialog");
        await dialog.getByTestId("cell-0-0").click();
        await dialog.getByTestId("correction-owner-horizontal").click();
        await dialog
          .getByRole("textbox", { name: "سبب التصحيح" })
          .fill("اختبار تصحيح فايربيس");
        await dialog.getByRole("button", { name: "معاينة التصحيح" }).click();
        await expect(hostPage.getByTestId("correction-review")).toBeVisible();
      };
      await beginCorrection();
      await hostPage.getByRole("button", { name: "إلغاء التصحيح" }).click();
      await expect(hostState("CELL_SELECTION")).toBeVisible();
      await beginCorrection();
      await hostPage.getByRole("button", { name: "تأكيد التصحيح" }).click();
      await expect(hostState("CELL_SELECTION")).toBeVisible();

      // Five seconds with no buzz enters the failure state. Retrying replaces the
      // reserved question without exposing it and permits the cell to be answered.
      await selectCell(1);
      await expect(hostState("QUESTION_FAILED")).toBeVisible({ timeout: 12_000 });
      await hostPage.getByRole("button", { name: "متابعة واستبدال الخلية" }).click();
      await expect(hostState("CELL_SELECTION")).toBeVisible();
      await buzzAndAwardHorizontal(1);

      // A first wrong answer gives the opponent its bounded chance. A second
      // wrong answer then reaches the same replacement flow without reusing the
      // exposed question.
      await selectCell(2);
      await expect(one.getByRole("button", { name: /اضغط الآن/ })).toBeEnabled();
      await one.getByRole("button", { name: /اضغط الآن/ }).click();
      await expect(hostState("FIRST_ANSWER")).toBeVisible();
      await hostPage.getByRole("button", { name: "إجابة خاطئة" }).click();
      await expect(hostState("OPPONENT_CHANCE")).toBeVisible();
      await expect(two.getByRole("button", { name: /اضغط الآن/ })).toBeEnabled();
      await two.getByRole("button", { name: /اضغط الآن/ }).click();
      await expect(hostState("FIRST_ANSWER")).toBeVisible();
      await hostPage.getByRole("button", { name: "إجابة خاطئة" }).click();
      await expect(hostState("QUESTION_FAILED")).toBeVisible();
      await hostPage.getByRole("button", { name: "متابعة واستبدال الخلية" }).click();
      await expect(hostState("CELL_SELECTION")).toBeVisible();
      await buzzAndAwardHorizontal(2);

      await buzzAndAwardHorizontal(3, true);
      await buzzAndAwardHorizontal(4, false, "ROUND_COMPLETE");

      await hostPage.getByRole("button", { name: "جولة جديدة" }).click();
      await expect(hostState("ROUND_SETUP")).toBeVisible();
      await hostPage.getByRole("button", { name: "جهّز الجولة" }).click();
      for (let row = 0; row < 5; row += 1)
        await buzzAndAwardHorizontal(
          row,
          false,
          row === 4 ? "MATCH_COMPLETE" : "CELL_SELECTION",
        );

      await expect(hostState("MATCH_COMPLETE")).toBeVisible({ timeout: 15_000 });
      await expect(display.locator('.stage[data-state="MATCH_COMPLETE"]')).toBeVisible();
      await expect(display.getByText(/فاز فريق/)).toBeVisible();
      await expect(display.locator("body")).not.toContainText("فريق فريق");

      await hostPage.goto(`${baseURL}/room/${code}/results`);
      await expect(hostPage.getByText("النتيجة النهائية", { exact: true })).toBeVisible();
      await expect(hostPage.getByRole("heading", { name: /الفائز: فريق/ })).toBeVisible();
      await hostPage.getByTestId("rematch-same-settings").click();
      await expect(hostPage.getByRole("heading", { name: "ردهة المباراة" })).toBeVisible();
      expect(hostPage.url()).not.toContain(`/room/${code}/`);
    } finally {
      await Promise.all([
        host.close(),
        horizontal.close(),
        vertical.close(),
        audience.close(),
      ]);
    }
  });
}
