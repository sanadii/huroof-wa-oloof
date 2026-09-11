import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/app/ThemeProvider";
import { HomeSurface } from "../../src/routes/HomeSurface";

vi.mock("../../src/features/game/runtime", () => ({
  gameRuntime: { kind: "local" },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("uses only local categories eligible for the category board", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        source: "local_sqlite_import",
        huroofAvailable: true,
        categories: [
          {
            id: "tahadani-ready",
            labelAr: "فئة جاهزة",
            sourceOnly: true,
            questionCount: 14,
            heldQuestionCount: 0,
            huroofQuestionCount: 14,
            categoryGameEligible: true,
            availability: "ready",
          },
          {
            id: "tahadani-held",
            labelAr: "فئة مؤجلة",
            sourceOnly: true,
            questionCount: 0,
            heldQuestionCount: 6,
            huroofQuestionCount: 0,
            categoryGameEligible: false,
            availability: "held_only",
          },
        ],
      }),
    ),
  );
  render(
    <ThemeProvider>
      <MemoryRouter>
        <HomeSurface joinForm={<form />} joinMessage={null} />
      </MemoryRouter>
    </ThemeProvider>,
  );
  expect(await screen.findByRole("link", { name: /فئة جاهزة/ })).toHaveAttribute(
    "href",
    "/host/new?kind=categories&category=tahadani-ready",
  );
  expect(screen.queryByRole("link", { name: /فئة مؤجلة/ })).not.toBeInTheDocument();
  expect(screen.queryByText("فئة مؤجلة")).not.toBeInTheDocument();
});

it("shows the full checked-in metadata inventory in a static preview without requesting the local API", async () => {
  vi.stubEnv("VITE_STATIC_PREVIEW", "true");
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <MemoryRouter>
        <HomeSurface joinForm={<form />} joinMessage={null} staticPreview />
      </MemoryRouter>
    </ThemeProvider>,
  );

  expect(screen.getByText(/تعكس حالة الجاهزية السجل المتاح حالياً\. \d+ فئة في الفهرس\./)).toBeVisible();
  expect(screen.getAllByText("محتوى محلي مدرج في معاينة الواجهة فقط")).toHaveLength(8);
  await user.click(screen.getByRole("button", { name: /عرض كل الفئات/ }));
  expect(screen.getByRole("link", { name: /جغرافيا العالم/ })).toHaveAttribute(
    "href",
    "/host/new?kind=categories&category=huroof-100",
  );
  expect(screen.queryByRole("link", { name: /دول \/ ولا كلمة/ })).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
