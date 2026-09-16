import { BAND_LABEL } from "@/components/bias";
import type { Band } from "@/db/schema";

/**
 * The masthead spectrum ruler — the site's signature element (spec §2).
 * A calibrated instrument scale of the 7 bands, E3 → D3. It is at once the
 * brand device, the color legend (color = data, made explicit above the fold)
 * and the reading key for every bias bar below it. The center notch is taller:
 * C is the calibration zero, not just another stop.
 */
const SCALE: Array<{ band: Exclude<Band, "NC">; color: string }> = [
  { band: "E3", color: "var(--vies-esquerda)" },
  { band: "E2", color: "var(--vies-esquerda)" },
  { band: "E1", color: "var(--vies-esquerda)" },
  { band: "C", color: "var(--vies-centro)" },
  { band: "D1", color: "var(--vies-direita)" },
  { band: "D2", color: "var(--vies-direita)" },
  { band: "D3", color: "var(--vies-direita)" },
];

export function SpectrumRuler() {
  return (
    <div
      className="pc-ruler"
      role="img"
      aria-label="Escala de viés, da esquerda para a direita: E3, E2, E1 (esquerda), C (centro), D1, D2, D3 (direita)"
    >
      <div className="pc-ruler-track" aria-hidden />
      {SCALE.map(({ band, color }, i) => (
        <div
          key={band}
          className="pc-ruler-tick"
          data-center={band === "C" || undefined}
          style={{ left: `${(i / (SCALE.length - 1)) * 100}%` }}
          title={BAND_LABEL[band]}
          aria-hidden
        >
          <span className="pc-ruler-mark" style={{ background: color }} />
          <span className="pc-ruler-lbl">{band}</span>
        </div>
      ))}
    </div>
  );
}
