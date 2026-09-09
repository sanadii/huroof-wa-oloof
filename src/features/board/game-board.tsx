import { type CSSProperties, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  findNearWinningCandidates,
  type NearWinningCandidate,
  type TeamAxis,
} from "../game/domain/board";

export type BoardCell = {
  id: string;
  q: number;
  r: number;
  kind: "letter" | "surprise" | "category";
  visibleValue: string;
  revealedLetter?: string;
  categoryId?: string;
  categoryLabelAr?: string;
  categoryOccurrence?: number;
  owner?: "horizontal" | "vertical";
};

type NearWinState = Record<TeamAxis, NearWinningCandidate | undefined>;
type EffectTokens = Partial<Record<TeamAxis, { token: number; signature: string }>>;
type ContentEffectTokens = Record<string, { token: number; signature: string }>;
const teams: TeamAxis[] = ["horizontal", "vertical"];

function splitCategoryLabel(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [label];
  const target = Math.ceil(label.length / 2);
  let left = "";
  let index = 0;
  while (index < words.length - 1 && `${left} ${words[index]}`.trim().length <= target) {
    left = `${left} ${words[index]}`.trim();
    index += 1;
  }
  return [left, words.slice(index).join(" ")].filter(Boolean);
}

function cellText(cell: BoardCell) {
  if (cell.kind === "category" && cell.categoryLabelAr) {
    return {
      accessible: `الفئة ${cell.categoryLabelAr}، الترتيب ${cell.categoryOccurrence ?? "غير محدد"}`,
      lines: [...splitCategoryLabel(cell.categoryLabelAr), `#${cell.categoryOccurrence ?? "—"}`],
      variant: "category" as const,
    };
  }
  if (cell.kind === "surprise" && cell.revealedLetter) {
    return {
      accessible: `الخلية المفاجأة رقم ${cell.visibleValue}، حرفها الحالي ${cell.revealedLetter}`,
      lines: [cell.visibleValue, cell.revealedLetter],
      variant: "surprise-revealed" as const,
    };
  }
  return {
    accessible: cell.revealedLetter ?? cell.visibleValue,
    lines: [cell.revealedLetter ?? cell.visibleValue],
    variant: "value" as const,
  };
}

function contentByCell(cells: readonly BoardCell[]) {
  return Object.fromEntries(cells.map((cell) => [
    cell.id,
    [cell.kind, cell.visibleValue, cell.revealedLetter ?? "", cell.categoryLabelAr ?? "", cell.categoryOccurrence ?? ""].join("|"),
  ]));
}

function ownershipContent(cells: readonly BoardCell[]) {
  return [...cells]
    .sort((left, right) => left.r - right.r || left.q - right.q || left.id.localeCompare(right.id))
    .map((cell) => `${cell.id}:${cell.owner ?? "neutral"}`)
    .join("|");
}

function nearContent(candidate: NearWinningCandidate | undefined) {
  return candidate ? `${candidate.candidateId}:${candidate.path.join(",")}` : "";
}

function winnerForPath(cells: readonly BoardCell[], winningPath: readonly string[]): TeamAxis | undefined {
  return winningPath
    .map((cellId) => cells.find((cell) => cell.id === cellId)?.owner)
    .find((owner): owner is TeamAxis => Boolean(owner));
}

const RADIUS_Y = 42;
const RADIUS_X = 49.4;
const HORIZONTAL = RADIUS_X * 1.5;
const VERTICAL = Math.sqrt(3) * RADIUS_Y;
const FRAME_MIN = 5;
const FRAME_MAX = 435;
// Cells are deliberately wider than a regular hex so the complete 5x5 framed board
// has approximately equal visible width and height. Odd columns remain offset by half a hex.
// q/r identities and domain adjacency stay independent from this rendered layout.
const center = (q: number, r: number) => ({
  x: 70 + HORIZONTAL * q,
  y: 56.5 + VERTICAL * (r + (q % 2) / 2),
});
type Point = readonly [number, number];

const vertices = (q: number, r: number): Point[] =>
  Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i);
    const c = center(q, r);
    return [c.x + RADIUS_X * Math.cos(angle), c.y + RADIUS_Y * Math.sin(angle)];
  });
const points = (q: number, r: number) =>
  vertices(q, r)
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
const insetPoints = (q: number, r: number) => {
  const c = center(q, r);
  return vertices(q, r)
    .map(([x, y]) => `${c.x + (x - c.x) * 0.92},${c.y + (y - c.y) * 0.92 - 2}`)
    .join(" ");
};
const tactileFacePoints = (q: number, r: number) => {
  const c = center(q, r);
  return vertices(q, r)
    .map(([x, y]) => `${c.x + (x - c.x) * 0.87},${c.y + (y - c.y) * 0.87 - 3}`)
    .join(" ");
};
const tactileTopHighlightPoints = (q: number, r: number) => {
  const c = center(q, r);
  return [vertices(q, r)[3], vertices(q, r)[4], vertices(q, r)[5]]
    .map(([x, y]) => `${c.x + (x - c.x) * 0.91},${c.y + (y - c.y) * 0.91 - 1.5}`)
    .join(" ");
};
const tactileLowerSidePoints = (q: number, r: number) => {
  const hex = vertices(q, r);
  // Extrude the full lower half (right slope, base, left slope), not only the
  // flat bottom segment. This keeps a continuous physical lower edge on every tile.
  const lowerHalf = [hex[0], hex[1], hex[2], hex[3]];
  return [...lowerHalf, ...[...lowerHalf].reverse().map(([x, y]) => [x, y + 6] as Point)]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
};

function edgeCells(
  axis: "horizontal" | "vertical",
  edge: "start" | "end",
  cells: BoardCell[],
) {
  return cells.filter((cell) =>
    axis === "horizontal"
      ? cell.q === (edge === "start" ? 0 : 4)
      : cell.r === (edge === "start" ? 0 : 4),
  );
}
function railBoundary(
  axis: "horizontal" | "vertical",
  edge: "start" | "end",
  cells: BoardCell[],
) {
  const edgeCellsForRail = edgeCells(axis, edge, cells).sort((a, b) =>
    axis === "horizontal" ? a.r - b.r : a.q - b.q,
  );
  return edgeCellsForRail.flatMap((cell) => {
    const hex = vertices(cell.q, cell.r);
    // Follow the actual exposed hex edges. Adjacent cells share the connecting points,
    // making one fitted zigzag silhouette instead of a thick line plus loose teeth.
    if (axis === "horizontal")
      return edge === "start"
        ? [hex[4], hex[3], hex[2]]
        : [hex[5], hex[0], hex[1]];
    return edge === "start" ? [hex[4], hex[5]] : [hex[2], hex[1]];
  });
}

function pointList(pointsForPath: Point[]) {
  return pointsForPath
    .map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" L");
}

function railPath(
  axis: "horizontal" | "vertical",
  edge: "start" | "end",
  cells: BoardCell[],
) {
  const boundary = railBoundary(axis, edge, cells);
  // Project every exposed boundary point onto one shared outer edge. The inner edge
  // keeps the honeycomb contour while the outer edge becomes a true square frame.
  const outer = boundary.map(([x, y]): Point =>
    axis === "horizontal"
      ? [edge === "start" ? FRAME_MIN : FRAME_MAX, y]
      : [x, edge === "start" ? FRAME_MIN : FRAME_MAX],
  );
  return `M${pointList(boundary)} L${pointList([...outer].reverse())} Z`;
}

function tactileRailPath(
  axis: "horizontal" | "vertical",
  edge: "start" | "end",
  cells: BoardCell[],
) {
  const boundary = railBoundary(axis, edge, cells);
  const depth = 15;
  const outer = boundary.map(([x, y]): Point =>
    axis === "horizontal"
      ? [x + (edge === "start" ? -depth : depth), y]
      : [x, y + (edge === "start" ? -depth : depth)],
  );
  return `M${pointList(boundary)} L${pointList([...outer].reverse())} Z`;
}

function Rail({
  axis,
  edge,
  cells,
  presentation,
}: {
  axis: "horizontal" | "vertical";
  edge: "start" | "end";
  cells: BoardCell[];
  presentation: "flat" | "tactile";
}) {
  const path = presentation === "tactile"
    ? tactileRailPath(axis, edge, cells)
    : railPath(axis, edge, cells);
  const tactileDepthTransform = axis === "horizontal"
    ? `translate(${edge === "start" ? -4 : 4} 0)`
    : `translate(0 ${edge === "start" ? -4 : 4})`;
  return (
    <g
      className={`game-board__rail game-board__rail--${axis}`}
      data-edge={edge}
      data-rail-shape={presentation === "tactile" ? "fitted-boundary" : "half-cell-frame"}
      data-testid={`board-rail-${axis}-${edge}`}
    >
      {presentation === "tactile" ? (
        <path
          className="game-board__rail-depth"
          d={path}
          data-material-layer="tactile-rail-depth"
          transform={tactileDepthTransform}
        />
      ) : null}
      <path className={presentation === "tactile" ? "game-board__rail-face" : undefined} d={path} />
    </g>
  );
}

export function nearestCell(
  cells: BoardCell[],
  q: number,
  r: number,
  key: string,
) {
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const vector = delta[key];
  return vector
    ? cells.find((cell) => cell.q === q + vector[0] && cell.r === r + vector[1])
    : undefined;
}

export function GameBoard({
  cells,
  activeCellId,
  winningPath = [],
  selectable = false,
  allowOwnedSelection = false,
  onSelect,
  className = "",
  presentation = "flat",
  motionBaselineKey = "authoritative",
  motionEnabled = true,
}: {
  cells: BoardCell[];
  activeCellId?: string;
  winningPath?: string[];
  selectable?: boolean;
  /** Correction-only opt-in. Gameplay keeps owned cells unavailable by default. */
  allowOwnedSelection?: boolean;
  onSelect?: (cellId: string) => void;
  className?: string;
  /** Decorative only. Gameplay stays flat unless an isolated presentation opts in. */
  presentation?: "flat" | "tactile";
  /** A new server/cache/connection baseline suppresses historical replay effects. */
  motionBaselineKey?: string;
  motionEnabled?: boolean;
}) {
  const materialId = useId().replace(/:/g, "");
  const boardId = useId().replace(/:/g, "");
  const boardRootRef = useRef<HTMLDivElement>(null);
  const materialStyle = presentation === "tactile"
    ? {
        "--board-tactile-face": `url(#${materialId}-face)`,
        "--board-tactile-shell": `url(#${materialId}-shell)`,
        "--board-tactile-side": `url(#${materialId}-side)`,
        "--board-tactile-active": `url(#${materialId}-active)`,
        "--board-tactile-horizontal": `url(#${materialId}-horizontal)`,
        "--board-tactile-vertical": `url(#${materialId}-vertical)`,
        "--board-tactile-horizontal-rail": `url(#${materialId}-horizontal-rail)`,
        "--board-tactile-vertical-rail": `url(#${materialId}-vertical-rail)`,
      } as CSSProperties
    : undefined;
  const winning = new Set(winningPath);
  const ownershipSignature = useMemo(() => ownershipContent(cells), [cells]);
  const nearWins = useMemo<NearWinState>(
    () => findNearWinningCandidates({ seed: 0, cells } as Parameters<typeof findNearWinningCandidates>[0]),
    [ownershipSignature],
  );
  const nearSignatures = useMemo<Record<TeamAxis, string>>(
    () => ({
      horizontal: nearContent(nearWins.horizontal),
      vertical: nearContent(nearWins.vertical),
    }),
    [nearWins],
  );
  const winningSignature = winningPath.join("|");
  const winningTeam = winnerForPath(cells, winningPath);
  const contentSignatures = useMemo(() => contentByCell(cells), [cells]);
  const [nearFlashTokens, setNearFlashTokens] = useState<EffectTokens>({});
  const [contentEffectTokens, setContentEffectTokens] = useState<ContentEffectTokens>({});
  const [winningPulse, setWinningPulse] = useState<{ token: number; signature: string }>();
  const [winAnnouncement, setWinAnnouncement] = useState<string>();
  const previousOwnership = useRef<string | undefined>(undefined);
  const previousNear = useRef<Record<TeamAxis, string> | undefined>(undefined);
  const previousWinningPath = useRef<string | undefined>(undefined);
  const previousContent = useRef<Record<string, string> | undefined>(undefined);
  const previousMotionBaseline = useRef<string | undefined>(undefined);
  const nextEffectToken = useRef(0);

  useEffect(() => {
    if (motionEnabled && previousMotionBaseline.current === motionBaselineKey) return;
    previousMotionBaseline.current = motionBaselineKey;
    previousOwnership.current = ownershipSignature;
    previousNear.current = nearSignatures;
    previousWinningPath.current = winningSignature;
    previousContent.current = contentSignatures;
    setNearFlashTokens({});
    setContentEffectTokens({});
    setWinningPulse(undefined);
    setWinAnnouncement(undefined);
  }, [contentSignatures, motionBaselineKey, motionEnabled, nearSignatures, ownershipSignature, winningSignature]);

  useEffect(() => {
    if (previousOwnership.current !== undefined && previousOwnership.current !== ownershipSignature) {
      const changedTeams = teams.filter((team) =>
        Boolean(nearSignatures[team]) && nearSignatures[team] !== previousNear.current?.[team],
      );
      if (changedTeams.length) {
        setNearFlashTokens((current) => {
          const next = { ...current };
          for (const team of changedTeams) {
            next[team] = { token: ++nextEffectToken.current, signature: nearSignatures[team] };
          }
          return next;
        });
      }
    }
    previousOwnership.current = ownershipSignature;
    previousNear.current = nearSignatures;
  }, [nearSignatures, ownershipSignature]);

  useEffect(() => {
    if (previousContent.current) {
      const changed = Object.entries(contentSignatures).filter(
        ([cellId, signature]) => previousContent.current?.[cellId] !== signature,
      );
      if (changed.length) {
        setContentEffectTokens((current) => {
          const next = { ...current };
          for (const [cellId, signature] of changed) {
            next[cellId] = { token: ++nextEffectToken.current, signature };
          }
          return next;
        });
      }
    }
    previousContent.current = contentSignatures;
  }, [contentSignatures]);

  useEffect(() => {
    if (previousWinningPath.current === undefined) {
      previousWinningPath.current = winningSignature;
      return;
    }
    if (previousWinningPath.current === winningSignature) return;

    previousWinningPath.current = winningSignature;
    if (!winningPath.length || !winningTeam) {
      setWinAnnouncement(undefined);
      return;
    }

    const token = ++nextEffectToken.current;
    setWinningPulse({ token, signature: winningSignature });
    setWinAnnouncement(
      winningTeam === "vertical" ? "فاز الفريق الأخضر بالجولة" : "فاز الفريق الأحمر بالجولة",
    );
    const timeout = window.setTimeout(() => setWinAnnouncement(undefined), 320 * 3);
    return () => window.clearTimeout(timeout);
  }, [winningPath.length, winningSignature, winningTeam]);

  const keyMove = (
    event: KeyboardEvent<HTMLButtonElement>,
    cell: BoardCell,
  ) => {
    const next = nearestCell(cells, cell.q, cell.r, event.key);
    if (!next) return;
    event.preventDefault();
    const nextButton = boardRootRef.current
      ?.querySelector<HTMLButtonElement>(`#board-${boardId}-${next.id}`);
    if (typeof nextButton?.scrollIntoView === "function") {
      nextButton.scrollIntoView({ block: "nearest", inline: "center" });
    }
    nextButton?.focus({ preventScroll: true });
  };
  return (
    <div className={`game-board-wrap ${presentation === "tactile" ? "game-board-wrap--tactile" : ""} ${className}`} dir="ltr" ref={boardRootRef}>
      <span className="sr-only">
        لوحة سداسية من 25 خلية. الفريق الأحمر يصل اليسار باليمين والفريق الأخضر
        يصل الأعلى بالأسفل.
      </span>
      <svg
        aria-label="لوحة المباراة"
        className="game-board-svg"
        data-frame-shape="square"
        role="img"
        style={materialStyle}
        viewBox="0 0 440 440"
      >
        {presentation === "tactile" ? (
          <defs>
            <linearGradient id={`${materialId}-face`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--arena-porcelain-top)" /><stop offset="1" stopColor="var(--arena-porcelain-bottom)" /></linearGradient>
            <linearGradient id={`${materialId}-shell`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--arena-porcelain-shell-top)" /><stop offset="1" stopColor="var(--arena-porcelain-shell-bottom)" /></linearGradient>
            <linearGradient id={`${materialId}-side`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--arena-tile-side-top)" /><stop offset="1" stopColor="var(--arena-tile-side-bottom)" /></linearGradient>
            <linearGradient id={`${materialId}-active`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--arena-active-top)" /><stop offset="1" stopColor="var(--arena-active-bottom)" /></linearGradient>
            <linearGradient id={`${materialId}-horizontal`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--arena-red-top)" /><stop offset="1" stopColor="var(--arena-red)" /></linearGradient>
            <linearGradient id={`${materialId}-vertical`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--arena-green-top)" /><stop offset="1" stopColor="var(--arena-green)" /></linearGradient>
            <linearGradient id={`${materialId}-horizontal-rail`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--arena-red-top)" /><stop offset="1" stopColor="var(--arena-red)" /></linearGradient>
            <linearGradient id={`${materialId}-vertical-rail`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--arena-green-top)" /><stop offset="1" stopColor="var(--arena-green)" /></linearGradient>
          </defs>
        ) : null}
        <g aria-hidden="true">
          <Rail axis="vertical" cells={cells} edge="start" presentation={presentation} />
          <Rail axis="vertical" cells={cells} edge="end" presentation={presentation} />
          <Rail axis="horizontal" cells={cells} edge="start" presentation={presentation} />
          <Rail axis="horizontal" cells={cells} edge="end" presentation={presentation} />
        </g>
        {cells.map((cell) => {
          const active = cell.id === activeCellId;
          const won = winning.has(cell.id);
          const winningIndex = winningPath.indexOf(cell.id);
          const nearTeam = teams.find((team) =>
            nearWins[team]?.path.includes(cell.id) && nearWins[team]?.candidateId !== cell.id,
          );
          const nearFlash = nearTeam ? nearFlashTokens[nearTeam] : undefined;
          const nearFlashToken = nearTeam && nearFlash && nearFlash.signature === nearSignatures[nearTeam]
            ? nearFlash.token
            : undefined;
          const isWinningPulse = won && winningPulse?.signature === winningSignature;
          const content = cellText(cell);
          const contentEffect = contentEffectTokens[cell.id];
          const contentTransition = contentEffect?.signature === contentSignatures[cell.id]
            ? contentEffect.token
            : undefined;
          const label = `خلية ${cell.q + 1}-${cell.r + 1}: ${content.accessible}${cell.owner ? (cell.owner === "horizontal" ? "، ملك الفريق الأحمر" : "، ملك الفريق الأخضر") : ""}${active ? "، الخلية النشطة" : ""}${won ? "، ضمن مسار الفوز" : ""}`;
          const c = center(cell.q, cell.r);
          const lineHeight = content.variant === "category" ? 14 : 12;
          return (
            <g
              className={`game-board__cell game-cell ${cell.owner ? `game-board__cell--${cell.owner}` : ""} ${active ? "game-board__cell--active" : ""} ${nearTeam ? "game-board__cell--near-path" : ""} ${nearFlashToken ? "game-board__cell--near-flash" : ""} ${contentTransition ? "game-board__cell--content-updated" : ""} ${won ? "game-board__cell--winning" : ""} ${isWinningPulse ? "game-board__cell--winning-pulse" : ""}`}
              data-active={active || undefined}
              data-content-transition={contentTransition || undefined}
              data-near-flash={nearFlashToken || undefined}
              data-near-path={nearTeam || undefined}
              data-owned={cell.owner || undefined}
              data-testid={selectable ? undefined : `cell-${cell.q}-${cell.r}`}
              data-winning={won || undefined}
              data-winning-index={winningIndex >= 0 ? winningIndex : undefined}
              data-winning-pulse-count={isWinningPulse ? 3 : undefined}
              key={`${cell.id}:${nearFlashToken ?? "rest"}:${contentTransition ?? "stable"}:${won ? isWinningPulse ? winningPulse.token : "static" : ""}`}
            >
              {presentation === "tactile" ? (
                <>
                  <polygon
                    className="game-board__cell-shell"
                    data-material-layer="tactile-shell"
                    points={points(cell.q, cell.r)}
                  />
                  <polygon
                    className="game-board__cell-side"
                    data-material-layer="tactile-lower-side"
                    points={tactileLowerSidePoints(cell.q, cell.r)}
                  />
                </>
              ) : null}
              <polygon
                className="game-board__cell-face"
                data-material-layer="flat-face"
                points={presentation === "tactile" ? tactileFacePoints(cell.q, cell.r) : points(cell.q, cell.r)}
              />
              {presentation === "tactile" ? (
                <polyline
                  className="game-board__cell-chamfer-highlight"
                  data-material-layer="tactile-top-highlight"
                  points={tactileTopHighlightPoints(cell.q, cell.r)}
                />
              ) : (
                <polygon
                  className="game-board__cell-inset-outline"
                  data-material-layer="inset-outline"
                  points={insetPoints(cell.q, cell.r)}
                />
              )}
              <text
                aria-hidden="true"
                className={`game-board__cell-label game-board__cell-label--${content.variant}`}
                dominantBaseline="middle"
                textAnchor="middle"
                x={c.x}
                y={c.y + 4 - (content.lines.length - 1) * lineHeight / 2}
              >
                {content.lines.map((line, index) => (
                  <tspan dy={index === 0 ? 0 : lineHeight} key={`${cell.id}-${index}`} x={c.x}>
                    {line}
                  </tspan>
                ))}
              </text>
              {!selectable && <title>{label}</title>}
            </g>
          );
        })}
      </svg>
      {winAnnouncement ? (
        <p aria-live="polite" className="game-board__win-announcement" role="status">
          {winAnnouncement}
        </p>
      ) : null}
      {selectable && (
        <div aria-label="اختر خلية" className="game-board__overlays">
          {cells.map((cell, index) => (
            <button
              aria-current={cell.id === activeCellId ? "true" : undefined}
              aria-label={`اختر ${cellText(cell).accessible}، ${cell.q + 1}-${cell.r + 1}`}
              className="game-board__button"
              data-testid={`cell-${cell.q}-${cell.r}`}
              disabled={Boolean(cell.owner) && !allowOwnedSelection}
              id={`board-${boardId}-${cell.id}`}
              key={cell.id}
              onClick={() => onSelect?.(cell.id)}
              onKeyDown={(event) => keyMove(event, cell)}
              style={{
                left: `${15.91 + cell.q * 16.84}%`,
                top: `${14 + cell.r * 15.47 + (cell.q % 2) * 7.74}%`,
              }}
              tabIndex={
                cell.id === activeCellId ||
                (!activeCellId &&
                  (allowOwnedSelection || !cell.owner) &&
                  index === cells.findIndex((candidate) => allowOwnedSelection || !candidate.owner))
                  ? 0
                  : -1
              }
              type="button"
            />
          ))}
        </div>
      )}
    </div>
  );
}
