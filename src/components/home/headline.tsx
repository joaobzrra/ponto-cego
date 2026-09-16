import { Fragment } from "react";
import { emphasiseKeywords } from "@/lib/emphasis";

/** Sentence-case 400 headline; only chip-matching phrases go 800 (spec §4). */
export function Headline({
  title,
  chips,
  className = "pc-home-title",
}: {
  title: string;
  chips: string[];
  className?: string;
}) {
  return (
    <h3 className={className}>
      {emphasiseKeywords(title, chips).map((s, i) =>
        s.strong ? <strong key={i}>{s.text}</strong> : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </h3>
  );
}
