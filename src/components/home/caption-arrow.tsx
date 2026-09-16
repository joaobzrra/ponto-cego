/*
 * The "(N VEÍCULOS · HOJE) ⟶" caption — the wireframe's shared click-invite.
 * Outlets, not articles: the meters count outlets, and "440 artigos" read as
 * an archive instead of a day (r/brasil launch feedback 2026-09-02). The
 * window word says out loud how far back the item looked. The arrow slides
 * out on hover of the caption OR its parent card link (CSS:
 * .pc-caption-arrow). Rendered as a span so it can live inside a card-wide
 * <Link> without nesting anchors; standalone uses wrap it in their own <a>.
 */
export function captionText(outlets: number, hours = 24): string {
  const span = hours <= 24 ? "hoje" : `${hours}h`;
  return `(${outlets} ${outlets === 1 ? "veículo" : "veículos"} · ${span})`;
}

export function CaptionArrow({ outlets, hours = 24 }: { outlets: number; hours?: number }) {
  return (
    <span className="pc-caption-arrow">
      {captionText(outlets, hours)} <span className="arrow">⟶</span>
    </span>
  );
}
