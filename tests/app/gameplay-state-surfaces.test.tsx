import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/app/ThemeProvider";
import type { ProjectionEnvelope, SafeProjection } from "../../src/features/game/runtime/contracts";

const runtime = vi.hoisted(() => ({
  kind: "firebase" as const,
  createRoom: vi.fn(),
  submitGameIntent: vi.fn(),
  subscribeProjection: vi.fn(),
}));

vi.mock("../../src/features/game/runtime", () => ({ gameRuntime: runtime }));

import { RoomRoute } from "../../src/routes/GameRoutes";

let projection: ProjectionEnvelope<SafeProjection>;

function RoomLocation() {
  return <output data-testid="room-location">{useLocation().pathname}</output>;
}
function hostProjection({
  state = "CELL_SELECTION",
  contentHold,
  endedWithoutWinner,
}: {
  state?: SafeProjection["room"]["state"];
  contentHold?: SafeProjection["contentHold"];
  endedWithoutWinner?: boolean;
} = {}): ProjectionEnvelope<SafeProjection> {
  return {
    roomId: "room-hold",
    revision: 7,
    role: "host",
    serverTime: new Date().toISOString(),
    projection: {
      room: {
        roomCode: "HOLD42",
        state,
        readyCount: 2,
        memberCount: 2,
        teams: { horizontal: "الأحمر", vertical: "الأخضر" },
        matchSettings: {
          demo: true,
          gameKind: "categories",
          modality: "classic",
          mode: "classic",
          questionSeconds: 20,
          opponentSeconds: 10,
          teams: { horizontal: "الأحمر", vertical: "الأخضر" },
          categories: ["tahadani-006", "tahadani-007"],
        },
      },
      board: [{ id: "cell-0-0", q: 0, r: 0, kind: "category", visibleValue: "فئة", categoryLabelAr: "من أنا / لاعبين كرة قدم", categoryOccurrence: 3 }],
      questionScores: { horizontal: 2, vertical: 1 },
      roundWins: { horizontal: 0, vertical: 0 },
      ...(contentHold ? { contentHold } : {}),
      ...(endedWithoutWinner ? { endedWithoutWinner: true } : {}),
    },
  };
}

function renderHost(surface: "host" | "results" = "host") {
  const path = `/room/HOLD42/${surface}`;
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/room/:roomCode/host" element={<RoomRoute surface="host" />} />
          <Route path="/room/:roomCode/results" element={<RoomRoute surface="results" />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  projection = hostProjection();
  sessionStorage.setItem("huroof:code:HOLD42", "room-hold");
  sessionStorage.setItem("huroof:room-hold", JSON.stringify({ token: "", role: "host" }));
  runtime.submitGameIntent.mockReset();
  runtime.submitGameIntent.mockResolvedValue({ revision: 8, replayed: false });
  runtime.createRoom.mockReset();
  runtime.createRoom.mockResolvedValue({ roomId: "rematch", roomCode: "REMATCH", token: "" });
  runtime.subscribeProjection.mockReset();
  runtime.subscribeProjection.mockImplementation((_roomId: string, _role: string, _uid: string, onProjection: (value: typeof projection) => void) => {
    onProjection(projection);
    return () => undefined;
  });
});

afterEach(cleanup);

describe("RoomRoute held and incomplete game surfaces", () => {
  it("makes an exhausted selection an end-only host state instead of a playable board", async () => {
    projection = hostProjection({ contentHold: { reason: "CONTENT_EXHAUSTED", operation: "SELECT_CELL", cellId: "cell-0-0" } });
    renderHost();

    expect(await screen.findByText(/توقف اختيار المحتوى/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "اختر حرفًا من اللوحة" })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".game-board__button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "إيقاف مؤقت" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("إظهار السؤال على شاشة العرض")).toBeDisabled();
    expect(screen.getByText(/خيارات العرض المشتركة معلقة/)).toBeVisible();
    fireEvent.click(screen.getByTestId("correction-trigger"));
    expect(await screen.findByText(/سجل التدقيق متاح للقراءة فقط/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "معاينة التصحيح" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إنهاء المباراة بلا فائز" }));
    await waitFor(() => expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1));
    expect(runtime.submitGameIntent.mock.calls[0][1]).toMatchObject({ type: "END_WITHOUT_WINNER" });
  });

  it("opens a modal enlarged category board, then restores trigger focus after Escape", async () => {
    renderHost();

    const trigger = await screen.findByTestId("expand-category-board");
    fireEvent.click(trigger);
    const dialog = screen.getByTestId("expanded-category-board");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "لوحة الفئات المكبرة" })).toBeVisible();
    expect(dialog.querySelectorAll('[data-testid="cell-0-0"]')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "إغلاق اللوحة المكبرة" })).toHaveFocus());
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByTestId("expanded-category-board")).not.toHaveAttribute("open");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows an honest incomplete result and creates a fresh same-settings rematch", async () => {
    projection = hostProjection({ state: "MATCH_COMPLETE", endedWithoutWinner: true });
    renderHost("results");

    expect(await screen.findByRole("heading", { name: "انتهت المباراة بلا فائز" })).toBeVisible();
    expect(screen.getByText(/احتُفظ بالنقاط وسجل الجولات دون إعلان فائز/)).toBeVisible();
    expect(screen.getByRole("link", { name: "مباراة جديدة" })).toHaveAttribute("href", "/host/new");
    fireEvent.click(screen.getByTestId("rematch-same-settings"));
    await waitFor(() => expect(runtime.createRoom).toHaveBeenCalledWith(expect.objectContaining({
      gameKind: "categories",
      categories: ["tahadani-006", "tahadani-007"],
    })));
  });
  it("ignores a delayed completed-room projection while a same-route rematch lobby loads", async () => {
    const callbacks = new Map<string, (value: ProjectionEnvelope<SafeProjection>) => void>();
    const old = { ...hostProjection({ state: "LOBBY" }), roomId: "room-old", revision: 4 };
    runtime.subscribeProjection.mockImplementation((roomId: string, _role: string, _uid: string, onProjection: (value: ProjectionEnvelope<SafeProjection>) => void) => {
      callbacks.set(roomId, onProjection);
      if (roomId === "room-old") onProjection(old);
      return () => undefined;
    });
    sessionStorage.setItem("huroof:code:OLD", "room-old");
    sessionStorage.setItem("huroof:room-old", JSON.stringify({ token: "", role: "host" }));
    sessionStorage.setItem("huroof:code:NEW", "room-new");
    sessionStorage.setItem("huroof:room-new", JSON.stringify({ token: "", role: "host" }));
    render(<ThemeProvider><MemoryRouter initialEntries={["/room/OLD/lobby"]}><RoomLocation /><Link to="/room/NEW/lobby">انتقل للإعادة</Link><Routes><Route path="/room/:roomCode/lobby" element={<RoomRoute surface="lobby" />} /><Route path="/room/:roomCode/host" element={<RoomRoute surface="host" />} /></Routes></MemoryRouter></ThemeProvider>);
    await waitFor(() => expect(callbacks.has("room-old")).toBe(true));
    fireEvent.click(screen.getByRole("link", { name: "انتقل للإعادة" }));
    await waitFor(() => expect(callbacks.has("room-new")).toBe(true));
    callbacks.get("room-old")!({ ...old, revision: 99, projection: { ...old.projection, room: { ...old.projection.room, state: "ROUND_SETUP" } } });
    expect(screen.getByTestId("room-location")).toHaveTextContent("/room/NEW/lobby");
    expect(runtime.submitGameIntent).not.toHaveBeenCalled();
  });
});


