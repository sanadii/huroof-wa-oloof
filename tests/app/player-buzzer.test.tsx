import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/app/ThemeProvider";
import type { ProjectionEnvelope, SafeProjection } from "../../src/features/game/runtime/contracts";

const runtime = vi.hoisted(() => ({
  kind: "firebase" as const,
  submitGameIntent: vi.fn(),
  subscribeProjection: vi.fn(),
}));

vi.mock("../../src/features/game/runtime", () => ({ gameRuntime: runtime }));

import { RoomRoute } from "../../src/routes/GameRoutes";

let projection: ProjectionEnvelope<SafeProjection>;
let publish: (value: ProjectionEnvelope<SafeProjection>) => void;

function playerProjection({
  state = "QUESTION_READING",
  team = "vertical",
  canBuzz = true,
}: {
  state?: SafeProjection["room"]["state"];
  team?: "horizontal" | "vertical";
  canBuzz?: boolean;
} = {}): ProjectionEnvelope<SafeProjection> {
  return {
    roomId: "room-1",
    revision: 1,
    role: "player",
    serverTime: new Date().toISOString(),
    projection: {
      room: {
        roomCode: "BUZZER",
        state,
        readyCount: 2,
        memberCount: 2,
        teams: { horizontal: "الأحمر", vertical: "الأخضر" },
      },
      self: { uid: "player-1", ready: true, team, canBuzz },
    },
  };
}

function renderPlayer() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/room/BUZZER/play"]}>
        <Routes>
          <Route path="/room/:roomCode/play" element={<RoomRoute surface="play" />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  projection = playerProjection();
  sessionStorage.setItem("huroof:code:BUZZER", "room-1");
  sessionStorage.setItem("huroof:room-1", JSON.stringify({ token: "", role: "player" }));
  runtime.submitGameIntent.mockReset();
  runtime.subscribeProjection.mockReset();
  runtime.subscribeProjection.mockImplementation(
    (_roomId: string, _role: string, _uid: string, onProjection: typeof publish) => {
      publish = onProjection;
      onProjection(projection);
      return () => undefined;
    },
  );
});

describe("RoomRoute player buzzer", () => {
  it("uses the joined team surface and sends one pending buzz from the keyboard", async () => {
    const user = userEvent.setup();
    let resolveIntent: () => void = () => undefined;
    runtime.submitGameIntent.mockImplementation(
      () => new Promise<void>((resolve) => { resolveIntent = resolve; }),
    );
    renderPlayer();

    const buzzer = await screen.findByRole("button", { name: "اضغط الآن" });
    expect(screen.getByRole("main")).toHaveClass("player-page--vertical");
    expect(screen.getByRole("main")).toHaveAttribute("data-team", "vertical");
    buzzer.focus();
    await user.keyboard("{Enter}");

    expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "جارٍ إرسال الضغط" })).toBeDisabled();
    expect(screen.getByRole("main")).toHaveAttribute("data-buzzer-state", "pending");
    await user.keyboard("{Enter}");
    expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveIntent();
      publish({
        ...projection,
        revision: 2,
        projection: {
          ...projection.projection,
          self: { ...projection.projection.self!, canBuzz: false },
        },
      });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "استعد" })).toBeDisabled());
  });

  it("shows an Arabic send error and allows a keyboard retry", async () => {
    const user = userEvent.setup();
    runtime.submitGameIntent
      .mockRejectedValueOnce(new Error("تعذر إرسال الضغط."))
      .mockResolvedValueOnce(undefined);
    renderPlayer();

    const buzzer = await screen.findByRole("button", { name: "اضغط الآن" });
    buzzer.focus();
    await user.keyboard(" ");
    expect(await screen.findByText("تعذر إرسال الضغط.")).toBeVisible();
    const retry = screen.getByRole("button", { name: "اضغط الآن" });
    expect(retry).toBeEnabled();
    retry.focus();
    await user.keyboard("{Enter}");
    expect(runtime.submitGameIntent).toHaveBeenCalledTimes(2);
  });

  it("keeps the buzzer disabled until a cached Firebase snapshot is confirmed by the server", async () => {
    projection = { ...playerProjection(), authoritative: false };
    renderPlayer();

    expect(await screen.findByRole("button", { name: "بانتظار تأكيد الخادم" })).toBeDisabled();
    expect(screen.getByText("وصلت نسخة محفوظة. ننتظر تأكيد الخادم قبل فتح البازر.")).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("data-buzzer-state", "stale");

    await act(async () => publish({ ...projection, authoritative: true, revision: 2 }));
    expect(await screen.findByRole("button", { name: "اضغط الآن" })).toBeEnabled();
  });

  it("shows offline and completed-match instructions on the full-screen buzzer", async () => {
    renderPlayer();
    await screen.findByRole("button", { name: "اضغط الآن" });

    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(await screen.findByRole("button", { name: "انقطع الاتصال" })).toBeDisabled();
    await act(async () => {
      publish({
        ...projection,
        revision: 3,
        projection: {
          ...projection.projection,
          room: { ...projection.projection.room, state: "MATCH_COMPLETE" },
          self: { ...projection.projection.self!, canBuzz: false },
        },
      });
    });
    expect(await screen.findByRole("button", { name: "اكتملت المباراة" })).toBeDisabled();
  });
});
