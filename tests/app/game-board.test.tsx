import { fireEvent, render, screen } from "@testing-library/react";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import {
  GameBoard,
  nearestCell,
  type BoardCell,
} from "../../src/features/board/game-board";
import { activeLobbyDestination, canDispatchLobbyStart, currentRoomDestination, previewBoardCells, resultRouteState, TeamScoreCard } from "../../src/routes/GameRoutes";

const cells: BoardCell[] = Array.from({ length: 25 }, (_, index) => ({
  id: `cell-${index % 5}-${Math.floor(index / 5)}`,
  q: index % 5,
  r: Math.floor(index / 5),
  kind: "letter",
  visibleValue: "أ",
}));

const withOwners = (ids: string[], owner: NonNullable<BoardCell["owner"]>) =>
  cells.map((cell) => (ids.includes(cell.id) ? { ...cell, owner } : cell));

it("keeps axial keyboard adjacency in the SVG board", () => {
  expect(nearestCell(cells, 2, 2, "ArrowLeft")?.id).toBe("cell-1-2");
  expect(nearestCell(cells, 2, 2, "ArrowUp")?.id).toBe("cell-2-1");
  expect(nearestCell(cells, 0, 0, "ArrowLeft")).toBeUndefined();
});

it("does not allow a duplicate lobby start once the room has entered round setup", () => {
  expect(canDispatchLobbyStart("LOBBY", true)).toBe(true);
  expect(canDispatchLobbyStart("ROUND_SETUP", true)).toBe(false);
});

it("moves an active lobby only to the member's role-safe surface", () => {
  expect(activeLobbyDestination("AB12", "lobby", "host", "ROUND_SETUP")).toBe("/room/AB12/host");
  expect(activeLobbyDestination("AB12", "lobby", "player", "CELL_SELECTION")).toBe("/room/AB12/play");
  expect(activeLobbyDestination("AB12", "lobby", "audience", "CELL_SELECTION")).toBeUndefined();
  expect(activeLobbyDestination("AB12", "lobby", "player", "LOBBY")).toBeUndefined();
});

it("returns an in-progress result view to the current role surface", () => {
  expect(currentRoomDestination("AB12", "host")).toBe("/room/AB12/host");
  expect(currentRoomDestination("AB12", "player")).toBe("/room/AB12/play");
  expect(currentRoomDestination("AB12", "audience")).toBe("/room/AB12/display");
});

it("keeps active results role-filtered and omits a return route only after match completion", () => {
  expect(resultRouteState("AB12", "player", "CELL_SELECTION")).toEqual({
    isFinal: false,
    returnTo: "/room/AB12/play",
  });
  expect(resultRouteState("AB12", "player", "MATCH_COMPLETE")).toEqual({
    isFinal: true,
    returnTo: undefined,
  });
});

it("exposes exactly one keyboard-operable cell overlay in its initial roving state", () => {
  render(<GameBoard cells={cells} selectable />);
  const first = screen.getByTestId("cell-0-0");
  expect(first).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByTestId("cell-1-0"));
});

it("keeps arrow focus inside the board instance when a correction board is also mounted", () => {
  render(<><GameBoard cells={cells} selectable /><GameBoard allowOwnedSelection cells={cells} selectable /></>);
  const [gameCell, correctionCell] = screen.getAllByTestId("cell-0-0");
  const [gameNext, correctionNext] = screen.getAllByTestId("cell-1-0");
  expect(gameCell.id).not.toBe(correctionCell.id);
  fireEvent.keyDown(correctionCell, { key: "ArrowRight" });
  expect(document.activeElement).toBe(correctionNext);
  expect(document.activeElement).not.toBe(gameNext);
});

it("keeps owned cells unavailable in play but enables them only with the correction opt-in", () => {
  const owned = withOwners(["cell-0-0"], "horizontal");
  const play = render(<GameBoard cells={owned} selectable />);
  expect(screen.getByTestId("cell-0-0")).toBeDisabled();
  play.unmount();
  render(<GameBoard allowOwnedSelection cells={owned} selectable />);
  expect(screen.getByTestId("cell-0-0")).toBeEnabled();
});

it("renders a category title and occurrence in the cell while retaining its full accessible label", () => {
  const categoryCells = cells.map((cell, index) => index === 0
    ? { ...cell, kind: "category" as const, visibleValue: "فئة", categoryLabelAr: "من أنا / لاعبين كرة قدم", categoryOccurrence: 7 }
    : cell,
  );
  render(<GameBoard cells={categoryCells} selectable />);

  expect(screen.getByTestId("cell-0-0")).toHaveAccessibleName("اختر الفئة من أنا / لاعبين كرة قدم، الترتيب 7، 1-1");
  const svgCell = document.querySelector(".game-board__cell");
  expect(svgCell?.querySelectorAll(".game-board__cell-label--category tspan")).toHaveLength(3);
  expect(svgCell).toHaveTextContent("#7");
});

it("keeps a numbered surprise identity visible when its replacement letter changes", () => {
  const surpriseCells = cells.map((cell, index) => index === 0
    ? { ...cell, kind: "surprise" as const, visibleValue: "4", revealedLetter: "ج" }
    : cell,
  );
  render(<GameBoard cells={surpriseCells} selectable />);

  expect(screen.getByTestId("cell-0-0")).toHaveAccessibleName("اختر الخلية المفاجأة رقم 4، حرفها الحالي ج، 1-1");
  expect(document.querySelector(".game-board__cell")).toHaveTextContent("4ج");
});

it("renders four single-path flat rails on a square outer frame", () => {
  const { container } = render(<GameBoard cells={cells} />);
  expect(container.querySelector(".game-board-svg")).toHaveAttribute(
    "viewBox",
    "0 0 440 440",
  );
  expect(container.querySelector(".game-board-svg")).toHaveAttribute(
    "data-frame-shape",
    "square",
  );
  for (const rail of [
    "horizontal-start",
    "horizontal-end",
    "vertical-start",
    "vertical-end",
  ]) {
    const element = screen.getByTestId(`board-rail-${rail}`);
    expect(element).toHaveAttribute("data-rail-shape", "half-cell-frame");
    expect(element.querySelectorAll("path")).toHaveLength(1);
    expect(element.querySelectorAll(".game-board__rail-depth")).toHaveLength(0);
    expect(element.querySelectorAll("line")).toHaveLength(0);
    expect(element.querySelector("polyline")).toBeNull();
  }
});

it("keeps flat gameplay cells unchanged unless the isolated tactile presentation opts in", () => {
  const flat = render(<GameBoard cells={cells} />);
  expect(flat.container.querySelectorAll('[data-material-layer="tactile-shell"]')).toHaveLength(0);
  expect(flat.container.querySelectorAll('[data-material-layer="tactile-rail-depth"]')).toHaveLength(0);
  flat.unmount();
  const tactile = render(<GameBoard cells={cells} presentation="tactile" selectable />);
  expect(tactile.container.querySelectorAll('[data-material-layer="tactile-shell"]')).toHaveLength(25);
  expect(tactile.container.querySelectorAll('[data-material-layer="tactile-lower-side"]')).toHaveLength(25);
  expect(tactile.container.querySelectorAll('[data-material-layer="tactile-top-highlight"]')).toHaveLength(25);
  expect(tactile.container.querySelectorAll('[data-material-layer="tactile-rail-depth"]')).toHaveLength(4);
  expect(tactile.container.querySelectorAll('.game-board__cell-inset-outline')).toHaveLength(0);
  expect(tactile.container.querySelectorAll("defs, linearGradient")).toHaveLength(9);
  for (const rail of ["horizontal-start", "horizontal-end", "vertical-start", "vertical-end"]) {
    expect(screen.getByTestId(`board-rail-${rail}`)).toHaveAttribute("data-rail-shape", "fitted-boundary");
  }
  expect(screen.getByTestId("board-rail-horizontal-start").querySelector(".game-board__rail-depth")).toHaveAttribute("transform", "translate(-4 0)");
  expect(screen.getByTestId("board-rail-horizontal-end").querySelector(".game-board__rail-depth")).toHaveAttribute("transform", "translate(4 0)");
  expect(screen.getByTestId("board-rail-vertical-start").querySelector(".game-board__rail-depth")).toHaveAttribute("transform", "translate(0 -4)");
  expect(screen.getByTestId("board-rail-vertical-end").querySelector(".game-board__rail-depth")).toHaveAttribute("transform", "translate(0 4)");
  expect(screen.getByTestId("cell-0-0")).toHaveStyle({ left: "15.91%", top: "14%" });
  expect(screen.getByTestId("cell-4-4")).toHaveStyle({ left: "83.27%", top: "75.88%" });
  expect(tactile.container.querySelectorAll('.game-board__cell')).toHaveLength(25);
});

it("adds 25 flat faces and crisp inset outlines without changing overlay centres", () => {
  const { container } = render(<GameBoard cells={cells} selectable />);
  expect(
    container.querySelectorAll('[data-material-layer="flat-face"]'),
  ).toHaveLength(25);
  expect(
    container.querySelectorAll('[data-material-layer="inset-outline"]'),
  ).toHaveLength(25);
  expect(
    container.querySelectorAll(".game-board__cell-highlight"),
  ).toHaveLength(0);
  expect(container.querySelectorAll(".game-board__cell-shade")).toHaveLength(0);
  expect(screen.getByTestId("cell-0-0")).toHaveStyle({
    left: "15.91%",
    top: "14%",
  });
  expect(screen.getByTestId("cell-4-4")).toHaveStyle({
    left: "83.27%",
    top: "75.88%",
  });
});

it("uses no SVG gradients or material-depth elements", () => {
  const { container } = render(
    <>
      <GameBoard cells={cells} />
      <GameBoard cells={cells} />
    </>,
  );
  expect(container.querySelectorAll("defs, linearGradient, stop")).toHaveLength(
    0,
  );
  expect(
    container.querySelectorAll(
      ".game-board__cell-shell, .game-board__rail-depth",
    ),
  ).toHaveLength(0);
});

it("removes owned-cell patterns and axis arrows while keeping color-team accessibility copy", () => {
  const owned = withOwners(["cell-1-1"], "horizontal");
  const { container } = render(<GameBoard cells={owned} />);
  expect(container.querySelectorAll(".game-board__pattern, .game-board__axis")).toHaveLength(0);
  expect(container.textContent).not.toContain("↔");
  expect(container.textContent).not.toContain("↕");
  expect(container.querySelector(".sr-only")).toHaveTextContent("الفريق الأحمر");
  expect(container.querySelector(".sr-only")).toHaveTextContent("الفريق الأخضر");
  expect(screen.getByTestId("cell-1-1").querySelector("title")).toHaveTextContent("الفريق الأحمر");
  expect(screen.getByTestId("cell-1-1").querySelector("title")).not.toHaveTextContent("الأفقي");
});

it("does not replay a pre-existing near win, then flashes only its owned path on a new ownership state", () => {
  const near = withOwners(["cell-0-2", "cell-1-2", "cell-3-2", "cell-4-2"], "horizontal");
  const { container, rerender } = render(<GameBoard cells={near} />);
  expect(container.querySelectorAll(".game-board__cell--near-path")).toHaveLength(4);
  expect(container.querySelectorAll("[data-near-flash]")).toHaveLength(0);
  expect(screen.getByTestId("cell-2-2")).not.toHaveAttribute("data-near-path");
  expect(screen.getByTestId("cell-2-2")).not.toHaveAttribute("data-owned");

  rerender(<GameBoard cells={cells} />);
  rerender(<GameBoard cells={near} />);
  expect(container.querySelectorAll("[data-near-flash]")).toHaveLength(4);
  const flashed = screen.getByTestId("cell-0-2");
  rerender(<GameBoard cells={[...near]} />);
  expect(screen.getByTestId("cell-0-2")).toBe(flashed);
});

it("does not animate an initial board snapshot, then acknowledges only a server-delivered replacement cell", () => {
  const original = cells.map((cell, index) => index === 0
    ? { ...cell, kind: "surprise" as const, visibleValue: "6", revealedLetter: "ب" }
    : cell,
  );
  const { container, rerender } = render(<GameBoard cells={original} />);
  expect(container.querySelectorAll("[data-content-transition]")).toHaveLength(0);

  rerender(<GameBoard cells={original.map((cell, index) => index === 0 ? { ...cell, revealedLetter: "ت" } : cell)} />);
  expect(screen.getByTestId("cell-0-0")).toHaveAttribute("data-content-transition");
  expect(container.querySelectorAll("[data-content-transition]")).toHaveLength(1);
});

it("baselines stale and cached snapshots, then animates only the next live server transition", () => {
  const original = cells.map((cell, index) => index === 0
    ? { ...cell, kind: "surprise" as const, visibleValue: "6", revealedLetter: "ب" }
    : cell,
  );
  const cachedReplacement = original.map((cell, index) => index === 0
    ? { ...cell, revealedLetter: "ت" }
    : cell,
  );
  const liveReplacement = original.map((cell, index) => index === 0
    ? { ...cell, revealedLetter: "ج" }
    : cell,
  );
  const { container, rerender } = render(
    <GameBoard cells={original} motionBaselineKey="connected:server" />,
  );

  rerender(<GameBoard cells={cachedReplacement} motionEnabled={false} motionBaselineKey="offline:cached" />);
  expect(container.querySelectorAll("[data-content-transition]")).toHaveLength(0);
  rerender(<GameBoard cells={cachedReplacement} motionBaselineKey="connected:server" />);
  expect(container.querySelectorAll("[data-content-transition]")).toHaveLength(0);

  rerender(<GameBoard cells={liveReplacement} motionBaselineKey="connected:server" />);
  expect(container.querySelectorAll("[data-content-transition]")).toHaveLength(1);
  expect(screen.getByTestId("cell-0-0")).toHaveAttribute("data-content-transition");
});

it("does not replay stale near-win or winning paths after reconnect, then plays a new live win", () => {
  const nearPath = ["cell-0-2", "cell-1-2", "cell-3-2", "cell-4-2"];
  const winPath = ["cell-0-1", "cell-1-1", "cell-2-1", "cell-3-1", "cell-4-1"];
  const near = withOwners(nearPath, "horizontal");
  const winning = withOwners(winPath, "horizontal");
  const { container, rerender } = render(
    <GameBoard cells={cells} motionBaselineKey="connected:server" />,
  );

  rerender(<GameBoard cells={near} motionEnabled={false} motionBaselineKey="offline:cached" />);
  rerender(<GameBoard cells={near} motionBaselineKey="connected:server" />);
  expect(container.querySelectorAll("[data-near-flash]")).toHaveLength(0);

  rerender(<GameBoard cells={cells} motionBaselineKey="connected:server" />);
  rerender(<GameBoard cells={near} motionBaselineKey="connected:server" />);
  expect(container.querySelectorAll("[data-near-flash]")).toHaveLength(nearPath.length);

  rerender(<GameBoard cells={winning} winningPath={winPath} motionEnabled={false} motionBaselineKey="offline:cached" />);
  rerender(<GameBoard cells={winning} winningPath={winPath} motionBaselineKey="connected:server" />);
  expect(container.querySelectorAll(".game-board__cell--winning-pulse")).toHaveLength(0);
  expect(screen.queryByRole("status")).toBeNull();

  rerender(<GameBoard cells={winning} winningPath={[]} motionBaselineKey="connected:server" />);
  rerender(<GameBoard cells={winning} winningPath={winPath} motionBaselineKey="connected:server" />);
  expect(container.querySelectorAll(".game-board__cell--winning-pulse")).toHaveLength(winPath.length);
  expect(screen.getByRole("status")).toHaveTextContent("فاز الفريق الأحمر بالجولة");
});

it("pulses each newly authoritative winning path cell exactly three times in path order and announces once", () => {
  const path = ["cell-0-1", "cell-1-1", "cell-2-1", "cell-3-1", "cell-4-1"];
  const winningCells = withOwners(path, "horizontal");
  const { container, rerender } = render(<GameBoard cells={winningCells} winningPath={path} />);
  expect(container.querySelectorAll(".game-board__cell--winning")).toHaveLength(path.length);
  expect(container.querySelectorAll(".game-board__cell--winning-pulse")).toHaveLength(0);
  expect(screen.queryByText("فاز الفريق الأحمر بالجولة")).toBeNull();

  rerender(<GameBoard cells={winningCells} winningPath={[]} />);
  rerender(<GameBoard cells={winningCells} winningPath={path} />);
  const pulseCells = container.querySelectorAll(".game-board__cell--winning-pulse");
  expect(pulseCells).toHaveLength(path.length);
  pulseCells.forEach((cell, index) => {
    expect(cell).toHaveAttribute("data-winning-index", String(index));
    expect(cell).toHaveAttribute("data-winning-pulse-count", "3");
  });
  expect(screen.getByRole("status")).toHaveTextContent("فاز الفريق الأحمر بالجولة");
  expect(screen.getByRole("status")).not.toHaveTextContent("فريق الفريق");
  const firstPulse = screen.getByTestId("cell-0-1");
  rerender(<GameBoard cells={[...winningCells]} winningPath={[...path]} />);
  expect(screen.getByTestId("cell-0-1")).toBe(firstPulse);
});

it("uses the fixed broadcast score label while keeping round markers on the host surface", () => {
  render(
    <TeamScoreCard
      axis="vertical"
      currentRound={3}
      points={2}
      roundResults={[
        { round: 1, winner: "vertical" },
        { round: 2, winner: "horizontal" },
      ]}
      rounds={1}
      teamName="اسم مخصص"
      variant="stage"
    />,
  );
  expect(screen.getByText("الأخضر")).toBeInTheDocument();
  expect(screen.queryByText("اسم مخصص")).toBeNull();
  expect(document.querySelectorAll(".stage-score__medallion")).toHaveLength(1);
  expect(document.querySelector(".stage-score__team")).toHaveTextContent(
    "الأخضر",
  );
  expect(screen.getByText("الجولات")).toBeInTheDocument();
  expect(screen.getByText("النقاط")).toBeInTheDocument();
  expect(document.querySelector(".team-score__points-value")).toHaveTextContent("2");
  expect(document.querySelector(".team-score__points")).toHaveTextContent("نقاط الإجابات: 2");
  expect(document.querySelectorAll(".round-markers__marker")).toHaveLength(0);
});

it("shows five real round markers in the host score card", () => {
  render(
    <TeamScoreCard
      axis="vertical"
      currentRound={3}
      points={2}
      roundResults={[
        { round: 1, winner: "vertical" },
        { round: 2, winner: "horizontal" },
      ]}
      rounds={1}
      variant="host"
    />,
  );
  expect(document.querySelectorAll(".round-markers__marker")).toHaveLength(5);
  expect(document.querySelector('[data-round="1"]')).toHaveClass(
    "round-markers__marker--won",
  );
  expect(document.querySelector('[data-round="3"]')).toHaveClass(
    "round-markers__marker--current",
  );
});

it("keeps both generated background fields at their recorded dimensions and production weights", async () => {
  for (const name of ["studio-field-light.webp", "studio-field-dark.webp"]) {
    const asset = join(process.cwd(), "public", "assets", "backgrounds", name);
    const [metadata, details] = await Promise.all([
      sharp(asset).metadata(),
      stat(asset),
    ]);
    expect(metadata.width).toBe(1254);
    expect(metadata.height).toBe(1254);
    expect(details.size).toBeGreaterThan(90_000);
    expect(details.size).toBeLessThan(150_000);
  }
});

it("uses a rule-generated fallback preview with 16 distinct letters and all surprise numbers once", () => {
  const letters = previewBoardCells
    .filter((cell) => cell.kind === "letter")
    .map((cell) => cell.visibleValue);
  const surpriseNumbers = previewBoardCells
    .filter((cell) => cell.kind === "surprise")
    .map((cell) => cell.visibleValue);
  expect(previewBoardCells).toHaveLength(25);
  expect(new Set(letters).size).toBe(16);
  expect([...surpriseNumbers].sort()).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
  ]);
  expect(new Set(previewBoardCells.map((cell) => cell.visibleValue)).size).toBe(
    25,
  );
});
