import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ChallengeStage } from "../../src/features/game/challenges/ChallengeStage";
import type { ChallengeProjection } from "../../src/features/game/challenges/integration";
import sourceTile from "../fixtures/m4-source-tile-arabic.json";
import sourceMemory from "../fixtures/m5-source-memory-arabic.json";

const privateM1CorpusPath = resolve("output/t36-premium-mechanics-20260922/m1/CANONICAL-DEFINITIONS.private.json");
const sourceShapeClass: Record<string, string> = {
  "دائرة": "circle", "مربع": "square", "مثلث": "triangle", "معين": "diamond",
  "نجمة": "star", "هلال": "crescent", "قلب": "heart", "سداسي": "hex",
};

type SourceTile = { id: string; labelAr: string; shape: string; hex: string };
type SourceTileData = {
  rows: 3 | 4;
  columns: 3 | 4;
  missingCell: [number, number];
  cells: Array<Array<SourceTile | null>>;
  options: SourceTile[];
  promptAr: string;
  rule: "vertical_mirror" | "latin";
};
type SourceTileDefinition = { kind: string; disposition: string; publicData: SourceTileData };
type SourceMemoryDefinition = { kind: string; disposition: string; publicData: { rows: number; columns: number }; privateGrading: { observationCells: Array<{ row: number; column: number; colorAr: string; hex: string; shapeAr: string }> } };

const base = (kind: ChallengeProjection["kind"]): ChallengeProjection => ({
  protocolVersion: "t36-challenge-runtime-v1", kind, recipient: "captain", occurrence: "occ-1", revision: 4, assignmentGeneration: 1, disclosureGeneration: 2,
  stage: "answer", entitledTeam: "horizontal", answeringTeam: "horizontal", paused: false, strikes: 0, readiness: { protocolHash: "p", assignmentHash: "a", stimulusHash: "s", required: true, acknowledged: true },
  assignments: { captain: "member:c", stealCaptain: "member:s" }, legalActions: ["SUBMIT", "PAUSE", "VOID"], timing: { countdownSeconds: 3, answerSeconds: 30 }, deadlineAt: new Date(Date.now() + 30_000).toISOString(), attemptsClosed: false, solutionRevealed: false,
});
const renderStage = (challenge: ChallengeProjection, onIntent = vi.fn().mockResolvedValue(true)) => {
  render(<ChallengeStage challenge={challenge} role="player" connection="connected" authoritative serverTime={new Date().toISOString()} teams={{ horizontal: "الأحمر", vertical: "الأخضر" }} onIntent={onIntent} />);
  return onIntent;
};

it("keeps a missing-tile draft local until explicit confirmation", async () => {
  const challenge = { ...base("missing_tile"), stimulus: { rows: 3, columns: 3, promptAr: "اختر القطعة", cells: [{ row: 0, column: 0, id: "a", labelAr: "أ", shape: "circle", hex: "#f00" }, { row: 0, column: 1, missing: true }], options: [{ id: "A", labelAr: "أ", shape: "circle", hex: "#f00" }, { id: "B", labelAr: "ب", shape: "square", hex: "#0f0" }, { id: "C", labelAr: "ج", shape: "triangle", hex: "#00f" }, { id: "D", labelAr: "د", shape: "hex", hex: "#ff0" }] } };
  const onIntent = renderStage(challenge);
  fireEvent.click(screen.getByRole("button", { name: "أ", exact: true }));
  expect(onIntent).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تأكيد الإجابة" })); });
  expect(onIntent).toHaveBeenCalledWith("CHALLENGE_SUBMIT", expect.objectContaining({ answers: ["A"], occurrence: "occ-1", challengeRevision: 4, stage: "answer" }));
  expect(document.body.textContent).not.toContain("correctOptionId");
});

it("uses accessible numbered map ordering with tap and up/down controls", async () => {
  const challenge = { ...base("qatar_map"), timing: { countdownSeconds: 3, answerSeconds: 45 }, stimulus: { mode: "order", promptAr: "رتّب النقاط", markers: [{ id: "A", x: 25, y: 20 }, { id: "B", x: 45, y: 40 }, { id: "C", x: 65, y: 60 }], optionIds: ["A", "B", "C"], namedPoints: [{ id: "A", nameAr: "الشمال" }, { id: "B", nameAr: "الوسط" }, { id: "C", nameAr: "الجنوب" }] } };
  const onIntent = renderStage(challenge);
  ["الشمال", "الوسط", "الجنوب"].forEach((name) => fireEvent.click(screen.getByRole("button", { name: new RegExp(name) })));
  fireEvent.click(screen.getByRole("button", { name: "حرّك الجنوب للأعلى" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تأكيد الإجابة" })); });
  expect(onIntent).toHaveBeenCalledWith("CHALLENGE_SUBMIT", expect.objectContaining({ answers: ["A", "C", "B"] }));
});

it("does not render stimuli from a stale projection", () => {
  const challenge = { ...base("missing_tile"), stimulus: { rows: 3, columns: 3, cells: [], options: [], promptAr: "سرّي" } };
  render(<ChallengeStage challenge={challenge} role="audience" connection="stale" authoritative={false} serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
  expect(screen.getByText("جارٍ تأكيد أحدث حالة للتحدّي…")).toBeVisible();
  expect(screen.queryByText("سرّي")).not.toBeInTheDocument();
});

it("renders every Arabic source shape and preserves source option letters once", () => {
  const challenge = { ...base("missing_tile"), stimulus: sourceTile };
  renderStage(challenge);
  for (const shape of ["circle", "square", "triangle", "diamond", "star", "crescent", "heart", "hex"])
    expect(document.querySelector(`.challenge-tile--${shape}`)).not.toBeNull();
  expect(screen.getByRole("button", { name: "أ", exact: true })).toBeVisible();
  expect(screen.queryByRole("button", { name: "أ أ", exact: true })).not.toBeInTheDocument();
});

it("renders T37 XOR dots with an explicit on/off alternative and no answer until reveal", () => {
  const challenge = { ...base("missing_tile"), stimulus: { rows: 3, columns: 3, rule: "xor_row_16_dot", promptAr: "اختر نمط XOR", cells: [{ row: 0, column: 0, id: "a", labelAr: "", shape: "dot_matrix_4x4", hex: "#123", bitmask: 2 }, { row: 0, column: 1, missing: true }], options: [{ id: "A", labelAr: "أ", shape: "dot_matrix_4x4", hex: "#123", bitmask: 3 }, { id: "B", labelAr: "ب", shape: "dot_matrix_4x4", hex: "#123", bitmask: 4 }, { id: "C", labelAr: "ج", shape: "dot_matrix_4x4", hex: "#123", bitmask: 5 }, { id: "D", labelAr: "د", shape: "dot_matrix_4x4", hex: "#123", bitmask: 6 }] } };
  renderStage(challenge);
  expect(document.querySelector(".challenge-tile--dot-matrix")).not.toBeNull();
  expect(screen.getAllByLabelText(/النقطة 1: إيقاف.*النقطة 2: تشغيل/).length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain("correctOptionId");
});

it("uses the authoritative T37 tile timer and rule before the challenge starts", () => {
  const challenge = { ...base("missing_tile"), stage: "setup" as const, timing: { countdownSeconds: 3, answerSeconds: 80 }, stimulus: { rule: "xor_row_16_dot" as const } };
  renderStage(challenge);
  expect(screen.getByText("المدة: 80 ثانية")).toBeVisible();
  expect(screen.getByText(/تضيء النقطة في القطعة اليمنى إذا ظهرت في قطعة واحدة فقط/)).toBeVisible();
});

it.skipIf(!existsSync(privateM1CorpusPath))("renders every ready M1 public tile projection with its source geometry", () => {
  const definitions = JSON.parse(readFileSync(privateM1CorpusPath, "utf8")) as SourceTileDefinition[];
  const tiles = definitions.filter((definition) => definition.kind === "missing_tile" && definition.disposition === "ready");
  expect(tiles).toHaveLength(300);

  for (const definition of tiles) {
    const data = definition.publicData;
    expect([3, 4]).toContain(data.rows);
    expect([3, 4]).toContain(data.columns);
    expect(data.cells).toHaveLength(data.rows);
    expect(data.cells.every((row) => row.length === data.columns)).toBe(true);
    expect(data.cells[data.missingCell[0]]?.[data.missingCell[1]]).toBeNull();
    expect(data.options.map((option) => option.labelAr)).toEqual(["أ", "ب", "ج", "د"]);

    const cells = data.cells.flatMap((row, rowIndex) => row.map((tile, column) => tile
      ? { row: rowIndex, column, ...tile }
      : { row: rowIndex, column, missing: true },
    ));
    const challenge = {
      ...base("missing_tile"),
      recipient: "audience" as const,
      stimulus: { ...data, cells },
    };
    const { container, unmount } = render(<ChallengeStage challenge={challenge} role="audience" connection="connected" authoritative serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
    const renderedCells = Array.from(container.querySelectorAll<HTMLElement>(".challenge-tile-cell"));
    expect(renderedCells).toHaveLength(data.rows * data.columns);
    expect(container.querySelector<HTMLElement>("[data-testid='tile-grid']")?.style.gridTemplateColumns).toBe(`repeat(${data.columns}, 1fr)`);

    data.cells.forEach((row, rowIndex) => row.forEach((tile, column) => {
      const rendered = renderedCells[rowIndex * data.columns + column]!;
      if (!tile) {
        expect(rendered).toHaveClass("is-missing");
        expect(rendered).toHaveTextContent("؟");
        return;
      }
      const glyph = rendered.querySelector<SVGElement>(`svg.challenge-tile--${sourceShapeClass[tile.shape]}`);
      expect(glyph).not.toBeNull();
      expect(glyph?.querySelector("circle, path, rect")?.getAttribute("fill")?.toLowerCase()).toBe(tile.hex.toLowerCase());
    }));

    const options = Array.from(container.querySelectorAll<HTMLButtonElement>(".challenge-option"));
    expect(options).toHaveLength(4);
    expect(options.map((option) => option.querySelector(".challenge-option__letter")?.textContent)).toEqual(data.options.map((option) => option.labelAr));
    data.options.forEach((option, index) => {
      const glyph = options[index]?.querySelector<SVGElement>(`svg.challenge-tile--${sourceShapeClass[option.shape]}`);
      expect(glyph).not.toBeNull();
      expect(glyph?.querySelector("circle, path, rect")?.getAttribute("fill")?.toLowerCase()).toBe(option.hex.toLowerCase());
    });
    unmount();
  }
}, 30_000);

it("conceals an observed Arabic source memory board at its trusted deadline", async () => {
  vi.useFakeTimers();
  try {
    const serverTime = new Date().toISOString();
    const challenge = { ...base("memory"), recipient: "captain" as const, stage: "observation" as const, deadlineAt: new Date(Date.now() + 900).toISOString(), stimulus: sourceMemory };
    const { container } = render(<ChallengeStage challenge={challenge} role="player" connection="connected" authoritative labelledColours serverTime={serverTime} onIntent={vi.fn()} />);
    expect(screen.getByTestId("memory-observation-grid")).toBeVisible();
    expect(container.querySelector(".challenge-tile--heart")).not.toBeNull();
    expect(screen.getByLabelText("قلب بلون بنفسجي")).toBeVisible();
    expect(screen.getAllByText("بنفسجي")[0]).toBeVisible();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(screen.queryByTestId("memory-observation-grid")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("بنفسجي");
  } finally { vi.useRealTimers(); }
});

it("never extends or reopens memory observation for a delayed same-stage server sample", async () => {
  vi.useFakeTimers();
  try {
    const initialServerTime = new Date().toISOString();
    const challenge = { ...base("memory"), recipient: "captain" as const, stage: "observation" as const, deadlineAt: new Date(Date.now() + 900).toISOString(), stimulus: sourceMemory };
    const { rerender } = render(<ChallengeStage challenge={challenge} role="player" connection="connected" authoritative labelledColours serverTime={initialServerTime} onIntent={vi.fn()} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    // This delayed fresh revision still carries the initial transport time. It
    // must not reset the monotonic exposure estimate to six seconds again.
    rerender(<ChallengeStage challenge={{ ...challenge, revision: 5 }} role="player" connection="connected" authoritative labelledColours serverTime={initialServerTime} onIntent={vi.fn()} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.queryByTestId("memory-observation-grid")).not.toBeInTheDocument();
    rerender(<ChallengeStage challenge={{ ...challenge, revision: 6 }} role="player" connection="connected" authoritative labelledColours serverTime={initialServerTime} onIntent={vi.fn()} />);
    expect(screen.queryByTestId("memory-observation-grid")).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

it("shows memory colour names only when the room-wide setting enables them", () => {
  const challenge = { ...base("memory"), recipient: "captain" as const, stage: "observation" as const, stimulus: sourceMemory };
  const { rerender } = render(<ChallengeStage challenge={challenge} role="player" connection="connected" authoritative serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
  expect(screen.queryByText("بنفسجي")).not.toBeInTheDocument();
  rerender(<ChallengeStage challenge={challenge} role="player" connection="connected" authoritative labelledColours serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
  expect(screen.getAllByText("بنفسجي")[0]).toBeVisible();
});

it("removes observed memory pixels and colour labels while offline or paused", () => {
  const challenge = { ...base("memory"), recipient: "captain" as const, stage: "observation" as const, stimulus: sourceMemory };
  const { rerender } = render(<ChallengeStage challenge={challenge} role="player" connection="offline" authoritative={false} labelledColours serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
  expect(screen.queryByTestId("memory-observation-grid")).not.toBeInTheDocument();
  expect(screen.queryByText("بنفسجي")).not.toBeInTheDocument();
  rerender(<ChallengeStage challenge={{ ...challenge, paused: true }} role="player" connection="connected" authoritative labelledColours serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
  expect(screen.queryByTestId("memory-observation-grid")).not.toBeInTheDocument();
  expect(screen.queryByText("بنفسجي")).not.toBeInTheDocument();
});

it("keeps numbered memory answers ordered until confirmation", async () => {
  const challenge = { ...base("memory"), recipient: "captain" as const, stimulus: { rows: 2, columns: 2, promptAr: "ما لونا الخليتين؟", answerSlots: 2, palette: [{ nameAr: "أزرق", hex: "#246BCE" }, { nameAr: "أخضر", hex: "#278A4D" }, { nameAr: "أحمر", hex: "#D52D3A" }] } };
  const onIntent = renderStage(challenge);
  fireEvent.click(screen.getByRole("button", { name: "اختر أزرق" }));
  fireEvent.click(screen.getByRole("button", { name: "اختر أخضر" }));
  fireEvent.click(screen.getByRole("button", { name: "الخانة 1: أزرق، اضغط للحذف" }));
  expect(screen.getByRole("button", { name: "الخانة 1 فارغة" })).toBeVisible();
  expect(screen.getByRole("button", { name: "الخانة 2: أخضر، اضغط للحذف" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "اختر أحمر" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تأكيد الإجابة" })); });
  expect(onIntent).toHaveBeenCalledWith("CHALLENGE_SUBMIT", expect.objectContaining({ answers: ["أحمر", "أخضر"] }));
  expect(document.body.textContent).not.toContain("targetAnswers");
});

it("announces observation and answer durations before a memory attempt", () => {
  const challenge = { ...base("memory"), stage: "setup" as const, timing: { countdownSeconds: 3, observationSeconds: 8, answerSeconds: 20 }, stimulus: undefined };
  renderStage(challenge);
  expect(screen.getByText("المدة: الحفظ: 8 ثوانٍ · الإجابة: 20 ثانية")).toBeVisible();
});

it("keeps guide-only navigation cells private and sends only confirmed mover directions", async () => {
  const guide = { ...base("navigation"), recipient: "guide" as const, legalActions: [], stimulus: { rows: 5, columns: 5, start: { row: 0, column: 0 }, current: { row: 0, column: 0 }, goal: { row: 0, column: 2 }, blocked: [{ row: 1, column: 0 }] } };
  const { rerender } = render(<ChallengeStage challenge={guide} role="player" connection="connected" authoritative serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
  expect(screen.getByLabelText("الهدف")).toBeVisible();
  expect(screen.queryByRole("button", { name: "تحرّك يمين" })).not.toBeInTheDocument();
  const onIntent = vi.fn().mockResolvedValue(true);
  const mover = { ...guide, recipient: "mover" as const, legalActions: ["MOVE"], stimulus: { rows: 5, columns: 5, start: { row: 0, column: 0 }, current: { row: 0, column: 0 }, confirmedEdges: [] } };
  rerender(<ChallengeStage challenge={mover} role="player" connection="connected" authoritative serverTime={new Date().toISOString()} onIntent={onIntent} />);
  expect(screen.queryByLabelText("الهدف")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "تحرّك أعلى" })).toBeDisabled();
  fireEvent.keyDown(screen.getByTestId("navigation-grid"), { key: "ArrowRight" });
  await act(async () => {});
  expect(onIntent).toHaveBeenCalledWith("CHALLENGE_MOVE", expect.objectContaining({ direction: "east" }));
});

it("lets the host proxy only the explicitly assigned manual mover", async () => {
  const challenge = {
    ...base("navigation"),
    recipient: "host" as const,
    legalActions: ["MOVE" as const],
    assignments: { guide: "member:guide", mover: "manual:mover" },
    stimulus: { rows: 3, columns: 3, start: { row: 1, column: 1 }, current: { row: 1, column: 1 }, confirmedEdges: [] },
  };
  const onIntent = vi.fn().mockResolvedValue(true);
  render(<ChallengeStage challenge={challenge} role="host" connection="connected" authoritative serverTime={new Date().toISOString()} onIntent={onIntent} />);
  fireEvent.click(screen.getByRole("button", { name: "تحرّك يمين" }));
  await act(async () => {});
  expect(onIntent).toHaveBeenCalledWith("CHALLENGE_MOVE", expect.objectContaining({ direction: "east" }));
});

it("keeps host readiness visible for remote private assignments before start", () => {
  const challenge = {
    ...base("navigation"),
    recipient: "host" as const,
    stage: "setup" as const,
    legalActions: ["ASSIGN" as const],
    assignments: { guide: "member:guide", mover: "member:mover" },
    readinessSummary: [{ participantId: "member:guide", acknowledged: false }, { participantId: "member:mover", acknowledged: true }],
  };
  render(<ChallengeStage challenge={challenge} role="host" connection="connected" authoritative serverTime={new Date().toISOString()} members={[{ uid: "guide", displayName: "الدليل" }, { uid: "mover", displayName: "اللاعب" }]} onIntent={vi.fn()} />);
  expect(screen.getByLabelText("ملخص جاهزية المشاركين")).toHaveTextContent("الدليل: بانتظار الجاهزية");
  expect(screen.getByLabelText("ملخص جاهزية المشاركين")).toHaveTextContent("اللاعب: جاهز");
  expect(screen.getByText("لا يمكن البدء حتى يؤكد كل مشارك مُعيَّن جاهزية المحتوى.")).toBeVisible();
  expect(screen.getByRole("button", { name: "ابدأ التحدّي" })).toBeDisabled();
});

it.skipIf(!existsSync(privateM1CorpusPath))("renders all ready M1 memory observation projections with Arabic shapes", () => {
  const definitions = JSON.parse(readFileSync(privateM1CorpusPath, "utf8")) as SourceMemoryDefinition[];
  const memories = definitions.filter((definition) => definition.kind === "memory" && definition.disposition === "ready");
  expect(memories).toHaveLength(300);
  expect(new Set(memories.map((definition) => `${definition.publicData.rows}×${definition.publicData.columns}`))).toEqual(new Set(["2×2", "3×3", "4×4"]));
  for (const definition of memories) {
    const { rows, columns } = definition.publicData;
    const cells = definition.privateGrading.observationCells;
    expect(cells).toHaveLength(rows * columns);
    const challenge = { ...base("memory"), recipient: "captain" as const, stage: "observation" as const, stimulus: { rows, columns, instructionAr: "احفظ الألوان", cells } };
    const { container, unmount } = render(<ChallengeStage challenge={challenge} role="player" connection="connected" authoritative labelledColours serverTime={new Date().toISOString()} onIntent={vi.fn()} />);
    expect(container.querySelectorAll(".challenge-memory-cell")).toHaveLength(rows * columns);
    cells.forEach((cell) => {
      const rendered = container.querySelectorAll<HTMLElement>(".challenge-memory-cell")[cell.row * columns + cell.column];
      const glyph = rendered?.querySelector<SVGElement>(`svg.challenge-tile--${sourceShapeClass[cell.shapeAr]}`);
      expect(glyph).not.toBeNull();
      expect(glyph?.querySelector("circle, path, rect")?.getAttribute("fill")?.toLowerCase()).toBe(cell.hex.toLowerCase());
      expect(container.querySelector(`[aria-label="${cell.shapeAr} بلون ${cell.colorAr}"]`)).not.toBeNull();
    });
    unmount();
  }
}, 30_000);

it("keeps the private draft and explains a rejected server confirmation", async () => {
  const challenge = { ...base("missing_tile"), stimulus: { rows: 3, columns: 3, promptAr: "اختر", cells: [{ row: 0, column: 0, missing: true }], options: [{ id: "A", labelAr: "أ", shape: "دائرة", hex: "#f00" }, { id: "B", labelAr: "ب", shape: "مربع", hex: "#0f0" }, { id: "C", labelAr: "ج", shape: "مثلث", hex: "#00f" }, { id: "D", labelAr: "د", shape: "معين", hex: "#ff0" }] } };
  const onIntent = vi.fn().mockResolvedValue(false);
  renderStage(challenge, onIntent);
  fireEvent.click(screen.getByRole("button", { name: "أ", exact: true }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تأكيد الإجابة" })); });
  expect(screen.getByText("لم يقبل الخادم الإجراء. راجع الحالة وحاول مجدداً؛ لم يُرسل اختيارك للتصحيح.")).toBeVisible();
  expect(screen.getByRole("button", { name: "أ", exact: true })).toHaveAttribute("aria-pressed", "true");
});

it("retries bounded authoritative reconciliation after an early no-op or transient rejection", async () => {
  vi.useFakeTimers();
  try {
    const onDeadline = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce(true);
    const serverTime = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + 900).toISOString();
    const challenge = { ...base("missing_tile"), stage: "countdown" as const, deadlineAt, stimulus: undefined };
    const { rerender } = render(<ChallengeStage challenge={challenge} role="host" connection="connected" authoritative serverTime={serverTime} onDeadline={onDeadline} onIntent={vi.fn()} />);
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(onDeadline).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(onDeadline).toHaveBeenCalledTimes(2);
    rerender(<ChallengeStage challenge={{ ...challenge, stage: "answer" }} role="host" connection="connected" authoritative serverTime={serverTime} onDeadline={onDeadline} onIntent={vi.fn()} />);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(onDeadline).toHaveBeenCalledTimes(3);
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(onDeadline).toHaveBeenCalledTimes(4);
  } finally { vi.useRealTimers(); }
});
