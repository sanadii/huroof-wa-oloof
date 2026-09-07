import { useEffect, useMemo, useState } from "react";

const REVEAL_DURATION_MS = 3_000;

type GraphemeSegmenter = {
  segment(value: string): Iterable<{ segment: string }>;
};

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity: "grapheme" },
  ) => GraphemeSegmenter;
};

function splitGraphemes(value: string) {
  const Segmenter = (Intl as IntlWithSegmenter).Segmenter;
  return Segmenter
    ? Array.from(new Segmenter("ar", { granularity: "grapheme" }).segment(value), ({ segment }) => segment)
    : Array.from(value);
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type QuestionRevealProps = {
  prompt?: string;
  questionKey: string;
};

/**
 * Reveals an Arabic prompt by grapheme while a transparent suffix reserves the
 * completed line breaks. The two runs remain in one inline formatting context,
 * so the prompt stays centered and no individual letters are wrapped.
 */
export function QuestionReveal({ prompt, questionKey }: QuestionRevealProps) {
  const graphemes = useMemo(() => splitGraphemes(prompt ?? ""), [prompt]);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [visibleCount, setVisibleCount] = useState(() =>
    prefersReducedMotion() ? graphemes.length : 0,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setVisibleCount(graphemes.length);
      return;
    }

    setVisibleCount(0);
    if (!graphemes.length) return;

    const startedAt = Date.now();
    let timer: ReturnType<typeof window.setTimeout> | undefined;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const nextCount = Math.min(
        graphemes.length,
        Math.floor((elapsed / REVEAL_DURATION_MS) * graphemes.length),
      );
      setVisibleCount(nextCount);
      if (nextCount < graphemes.length) {
        timer = window.setTimeout(
          tick,
          Math.min(50, Math.max(1, REVEAL_DURATION_MS / graphemes.length)),
        );
      }
    };
    timer = window.setTimeout(
      tick,
      Math.min(50, Math.max(1, REVEAL_DURATION_MS / graphemes.length)),
    );
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [graphemes, questionKey, reducedMotion]);

  if (!prompt) return null;

  return (
    <span className="question-reveal" dir="rtl" lang="ar">
      <span className="sr-only">
        {prompt}
      </span>
      <span
        aria-hidden="true"
        className="question-reveal__visible"
        data-testid="question-reveal"
      >
        {graphemes.slice(0, visibleCount).join("")}
      </span>
      <span aria-hidden="true" className="question-reveal__suffix">
        {graphemes.slice(visibleCount).join("")}
      </span>
    </span>
  );
}
