import Link from "next/link";

export function CalibrationBadge() {
  return (
    <Link
      href="/sobre#calibracao"
      className="pc-calibration-badge"
      title="Os rótulos automatizados ainda estão em calibração"
    >
      Em calibração
    </Link>
  );
}
