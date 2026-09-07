import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionReveal } from "../../src/features/ui/QuestionReveal";

const prompt = "أبجد";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reveals the audience prompt in right-to-left grapheme order over three seconds", () => {
  render(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("");

  act(() => vi.advanceTimersByTime(1_500));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("أب");

  act(() => vi.advanceTimersByTime(1_500));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent(prompt);
  expect(document.querySelector(".question-reveal .sr-only")).toHaveTextContent(prompt);
});

it("cleans up a replaced question and does not restart for an unrelated rerender", () => {
  const view = render(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  act(() => vi.advanceTimersByTime(1_500));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("أب");

  view.rerender(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  act(() => vi.advanceTimersByTime(1_500));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent(prompt);

  view.rerender(<QuestionReveal prompt="هوز" questionKey="round-2" />);
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("");
  act(() => vi.advanceTimersByTime(3_000));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("هوز");
});

it("shows the full prompt immediately for reduced motion and renders nothing for waiting copy", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const view = render(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  expect(screen.getByTestId("question-reveal")).toHaveTextContent(prompt);
  expect(vi.getTimerCount()).toBe(0);

  view.rerender(<QuestionReveal prompt={undefined} questionKey="waiting" />);
  expect(screen.queryByTestId("question-reveal")).toBeNull();
});
