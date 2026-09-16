import Link from "next/link";
import { ClusterMeter } from "@/components/cluster-meter";
import type { AltaCard as AltaCardData } from "@/lib/home";
import { CaptionArrow } from "./caption-arrow";
import { Headline } from "./headline";

/*
 * Tópicos em Alta card: inside-label tri-meter above, cluster headline,
 * outlet count with the slide-out arrow. The whole card is one link into the event
 * thread (/e/[id]).
 */
export function AltaCard({ c, chips }: { c: AltaCardData; chips: string[] }) {
  return (
    <article className="pc-alta-card">
      <Link href={`/e/${c.clusterId}`} className="pc-home-link">
        <ClusterMeter sides={c.sides} labels="inside" />
        <Headline title={c.title} chips={chips} />
        <CaptionArrow outlets={c.outlets} />
      </Link>
    </article>
  );
}
