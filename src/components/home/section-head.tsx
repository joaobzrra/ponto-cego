import type { ReactNode } from "react";

/** Caps 800 label on a 2px rule, optional light subtitle, optional right slot (spec §4). */
export function SectionHead({ label, sub, right }: { label: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="pc-head">
      <div className="pc-head-l">
        <h2 className="pc-head-lbl">{label}</h2>
        {sub && <span className="pc-head-sub">{sub}</span>}
      </div>
      {right && <div className="pc-head-r">{right}</div>}
    </div>
  );
}
