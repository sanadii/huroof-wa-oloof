import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/app/ThemeProvider";

vi.mock("../../src/features/game/runtime", () => ({
  gameRuntime: { kind: "local" },
}));

import { HostNewRoute } from "../../src/routes/GameRoutes";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("hides Huroof-empty local categories, retains them for category boards, and prunes a deep link", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    source: "local_sqlite_import", huroofAvailable: true,
    categories: [
      { id: "huroof-ready", labelAr: "تغطية الحروف", sourceOnly: true, questionCount: 1, heldQuestionCount: 0, huroofQuestionCount: 1, availability: "ready", categoryGameEligible: true },
      { id: "categories-only", labelAr: "فئات فقط", sourceOnly: true, questionCount: 300, heldQuestionCount: 0, huroofQuestionCount: 0, availability: "ready", categoryGameEligible: true },
    ],
  })));
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter initialEntries={["/host/new?category=categories-only"]}><HostNewRoute /></MemoryRouter></ThemeProvider>);

  expect(await screen.findByRole("button", { name: "تغطية الحروف — أضف إلى الاختيار" })).toBeVisible();
  expect(screen.queryByText("فئات فقط")).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary", { name: "الفئات المختارة" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "الفئات" }));
  expect(screen.getByRole("button", { name: "فئات فقط — أضف إلى الاختيار" })).toBeVisible();
});

it("uses the checked-in preview inventory's per-board Huroof coverage", async () => {
  vi.stubEnv("VITE_STATIC_PREVIEW", "true");
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);

  expect(screen.queryByText("كرة السلة وNBA")).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "الفئات" }));
  expect(screen.getByRole("button", { name: "كرة السلة وNBA — أضف إلى الاختيار" })).toBeVisible();
});
