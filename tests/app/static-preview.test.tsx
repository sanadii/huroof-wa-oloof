import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { isStaticPreviewBuild } from "../../src/features/game/runtime/static-preview";

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState({}, "", "/");
});

it("enables the boundary only for an explicit true build flag", () => {
  expect(isStaticPreviewBuild(undefined)).toBe(false);
  expect(isStaticPreviewBuild("false")).toBe(false);
  expect(isStaticPreviewBuild("true")).toBe(true);
});

it("shows direct admin and room routes as unavailable without loading their authority", async () => {
  vi.stubEnv("VITE_STATIC_PREVIEW", "true");
  window.history.replaceState({}, "", "/admin/questions");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "هذه الخدمة غير متاحة في المعاينة" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("إنشاء الغرف والانضمام وإدارة الأسئلة والبيانات غير متاحة هنا");
});
