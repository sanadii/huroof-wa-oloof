import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ChallengeStage } from "../../src/features/game/challenges/ChallengeStage";
import type { ChallengeProjection } from "../../src/features/game/challenges/integration";

const base = (kind: ChallengeProjection["kind"]): ChallengeProjection => ({
  protocolVersion: "t36-challenge-runtime-v1", kind, recipient: "captain", occurrence: "synthetic-occurrence", revision: 4,
  assignmentGeneration: 1, disclosureGeneration: 1, stage: "answer", entitledTeam: "horizontal", answeringTeam: "horizontal",
  paused: false, strikes: 0, readiness: { protocolHash: "p", assignmentHash: "a", stimulusHash: "s", required: true, acknowledged: true },
  assignments: { captain: "member:c" }, legalActions: ["SUBMIT"], timing: { countdownSeconds: 3, answerSeconds: 30 },
  deadlineAt: new Date(Date.now() + 30_000).toISOString(), attemptsClosed: false, solutionRevealed: false,
});

const renderStage = (challenge: ChallengeProjection, onIntent = vi.fn().mockResolvedValue(true)) => {
  render(<ChallengeStage challenge={challenge} role="player" connection="connected" authoritative serverTime={new Date().toISOString()} onIntent={onIntent} />);
  return onIntent;
};

it("keeps a synthetic missing-tile answer local until confirmation", async () => {
  const onIntent = renderStage({ ...base("missing_tile"), stimulus: {
    rows: 3, columns: 3, promptAr: "اختر القطعة", cells: [{ row: 0, column: 0, id: "a", labelAr: "أ", shape: "circle", hex: "#f00" }, { row: 0, column: 1, missing: true }],
    options: [{ id: "A", labelAr: "أ", shape: "circle", hex: "#f00" }, { id: "B", labelAr: "ب", shape: "square", hex: "#0f0" }],
  } });
  fireEvent.click(screen.getByRole("button", { name: "أ", exact: true }));
  expect(onIntent).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "تأكيد الإجابة" })));
  expect(onIntent).toHaveBeenCalledWith("CHALLENGE_SUBMIT", expect.objectContaining({ answers: ["A"], occurrence: "synthetic-occurrence" }));
});

it("masks an unavailable challenge projection", () => {
  render(<ChallengeStage challenge={{ ...base("memory"), stimulus: { rows: 2, columns: 2, promptAr: "لا تعرض", answerSlots: 2, palette: [] } }} role="audience" connection="stale" authoritative={false} serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
  expect(screen.getByText("جارٍ تأكيد أحدث حالة للتحدّي…")).toBeVisible();
  expect(screen.queryByText("لا تعرض")).not.toBeInTheDocument();
});

it("submits an ordered synthetic map selection", async () => {
  const onIntent = renderStage({ ...base("qatar_map"), stimulus: { mode: "order", promptAr: "رتّب", markers: [{ id: "A", x: 20, y: 20 }, { id: "B", x: 40, y: 40 }, { id: "C", x: 60, y: 60 }], optionIds: ["A", "B", "C"], namedPoints: [{ id: "A", nameAr: "الشمال" }, { id: "B", nameAr: "الوسط" }, { id: "C", nameAr: "الجنوب" }] } });
  ["الشمال", "الوسط", "الجنوب"].forEach((name) => fireEvent.click(screen.getByRole("button", { name: new RegExp(name) })));
  fireEvent.click(screen.getByRole("button", { name: "حرّك الجنوب للأعلى" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "تأكيد الإجابة" })));
  expect(onIntent).toHaveBeenCalledWith("CHALLENGE_SUBMIT", expect.objectContaining({ answers: ["A", "C", "B"] }));
});
