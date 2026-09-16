/*
 * The one meter legend on the home page. Meters count DISTINCT OUTLETS per
 * side (see cluster-meter.tsx), so the copy says "veículos", never
 * "artigos". Rendered once, under the sides-band heading; every other meter
 * on the page inherits its meaning from here instead of carrying a label.
 */
export function MeterLegend() {
  return (
    <p className="pc-meter-legend">
      Cada barra mostra quantos veículos de{" "}
      <strong style={{ color: "var(--vies-esquerda)" }}>esquerda</strong>,{" "}
      <strong style={{ color: "var(--vies-centro)" }}>centro</strong> e{" "}
      <strong style={{ color: "var(--vies-direita)" }}>direita</strong> cobriram o
      assunto.
    </p>
  );
}
