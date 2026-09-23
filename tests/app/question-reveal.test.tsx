import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionReveal } from "../../src/features/ui/QuestionReveal";

const prompt = "أبجد";

it("freezes on a buzz and resumes from the same point without counting paused time", () => {
  const view = render(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  act(() => vi.advanceTimersByTime(400));
  view.rerender(<QuestionReveal prompt={prompt} questionKey="round-1" paused />);
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByTestId("question-reveal").textContent).toBe("أب");
  expect(document.querySelector(".question-reveal .sr-only")?.textContent).toBe("أب");

  view.rerender(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  act(() => vi.advanceTimersByTime(400));
  expect(screen.getByTestId("question-reveal").textContent).toBe(prompt);
});

it("resets progress when a different question arrives while paused", () => {
  const view = render(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  act(() => vi.advanceTimersByTime(400));
  view.rerender(<QuestionReveal prompt="هوز" questionKey="round-2" paused />);
  act(() => vi.advanceTimersByTime(5_000));
  expect(screen.getByTestId("question-reveal").textContent).toBe("");
  view.rerender(<QuestionReveal prompt="هوز" questionKey="round-2" />);
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByTestId("question-reveal").textContent).toBe("ه");
});

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

it("reveals the audience prompt in right-to-left grapheme order within the finite 750ms phase transition", () => {
  render(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("");

  act(() => vi.advanceTimersByTime(400));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("أب");

  act(() => vi.advanceTimersByTime(400));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent(prompt);
  expect(document.querySelector(".question-reveal .sr-only")).toHaveTextContent(prompt);
});

it("cleans up a replaced question and does not restart for an unrelated rerender", () => {
  const view = render(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  act(() => vi.advanceTimersByTime(400));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("أب");

  view.rerender(<QuestionReveal prompt={prompt} questionKey="round-1" />);
  act(() => vi.advanceTimersByTime(375));
  expect(screen.getByTestId("question-reveal")).toHaveTextContent(prompt);

  view.rerender(<QuestionReveal prompt="هوز" questionKey="round-2" />);
  expect(screen.getByTestId("question-reveal")).toHaveTextContent("");
  act(() => vi.advanceTimersByTime(750));
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
