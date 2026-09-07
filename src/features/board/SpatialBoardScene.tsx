import { type PointerEvent, useState } from "react";
import { GameBoard, type BoardCell } from "./game-board";

const MAX_TILT = 4;
const previewLetters = ["أ", "ب", "ت", "ث", "ح", "خ", "د", "ر", "س", "ش", "ص", "ط", "ج", "ع", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي", "ا", "ب"];
const previewCells: BoardCell[] = previewLetters.map((visibleValue, index) => ({
  id: `spatial-${index}`,
  q: index % 5,
  r: Math.floor(index / 5),
  kind: "letter",
  visibleValue,
}));

function tiltFor(pointer: PointerEvent<HTMLDivElement>) {
  if (pointer.pointerType !== "mouse" || typeof window === "undefined") return undefined;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
  const bounds = pointer.currentTarget.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return undefined;
  const x = ((pointer.clientX - bounds.left) / bounds.width - 0.5) * MAX_TILT * 2;
  const y = ((pointer.clientY - bounds.top) / bounds.height - 0.5) * MAX_TILT * 2;
  return { x: Math.max(-MAX_TILT, Math.min(MAX_TILT, x)), y: Math.max(-MAX_TILT, Math.min(MAX_TILT, y)) };
}

/** Homepage-only presentation wrapper. The board itself stays the canonical SVG/DOM board. */
export function SpatialBoardScene() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  return (
    <div className="spatial-board-scene" data-testid="spatial-board-scene" onPointerLeave={() => setTilt({ x: 0, y: 0 })} onPointerMove={(event) => {
      const nextTilt = tiltFor(event);
      if (nextTilt) setTilt(nextTilt);
    }}>
      <div className="spatial-board-scene__tilt" style={{ "--spatial-tilt-x": `${tilt.x}deg`, "--spatial-tilt-y": `${tilt.y}deg` } as React.CSSProperties}>
        <div className="spatial-board-scene__plinth" aria-hidden="true" />
        <GameBoard cells={previewCells} className="spatial-board-scene__board" presentation="tactile" />
      </div>
    </div>
  );
}
