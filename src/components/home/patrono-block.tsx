import Link from "next/link";

/** Closes the centre column (spec §5). The brand logo (same file and theme
 * inversion as the header) over two lines of copy, nothing else. */
export function PatronoBlock() {
  return (
    <div className="pc-patrono">
      <img
        src="/brand/pontocego-logo.png"
        alt=""
        className="pc-brand-logo pc-patrono-logo"
      />
      <p className="pc-patrono-line">
        Apoie esse projeto <strong>anonimamente</strong>
      </p>
      <Link href="/patrono" className="pc-patrono-btn">
        Seja um patrono
      </Link>
    </div>
  );
}
