import type { ReactNode } from "react";

/** Original, inline-vector identity for the public product surfaces. */
export function BrandMark({ className = "", suffix }: { className?: string; suffix?: ReactNode }) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-label="الخلية" role="img">
      <svg aria-hidden="true" className="brand-mark__svg" viewBox="0 0 172 64">
        <path className="brand-mark__shadow" d="m12 20 19-13h113l18 13-17 37H30L12 42Z" />
        <path className="brand-mark__plate" d="m7 15 21-13h114l20 14-17 37H27L7 38Z" />
        <path className="brand-mark__line" d="m17 16 13-8h109l13 9-13 29H31L17 36Z" />
        <path className="brand-mark__honey" d="m24 20 7-4 7 4v8l-7 4-7-4Zm112 0 7-4 7 4v8l-7 4-7-4Z" />
        <text className="brand-mark__text" x="86" y="41" textAnchor="middle">الخلية</text>
      </svg>
      {suffix ? <small className="brand-mark__suffix">{suffix}</small> : null}
    </span>
  );
}
