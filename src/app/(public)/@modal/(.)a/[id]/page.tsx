import { notFound } from "next/navigation";
import { previewAllowed } from "@/lib/preview";
import { ArticleGateCard } from "../../../a/gate-card";
import { ModalShell } from "../../../modal-shell";

export const dynamic = "force-dynamic";

/**
 * Intercepted route: clicking an article on the front page renders the gate
 * card as a closable modal over the list instead of a full navigation.
 * Direct URL loads still hit the full page at /a/[id].
 */
export default async function ArticleGateModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await previewAllowed())) notFound();
  const { id } = await params;
  const articleId = Number(id);
  if (!Number.isInteger(articleId)) notFound();

  return (
    <ModalShell>
      <ArticleGateCard articleId={articleId} />
    </ModalShell>
  );
}
