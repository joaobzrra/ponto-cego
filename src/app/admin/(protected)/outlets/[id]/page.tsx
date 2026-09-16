import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, tables } from "@/db";
import { requireSection } from "@/lib/auth";
import { updateOutlet } from "../actions";
import { OutletForm } from "../outlet-form";

export const dynamic = "force-dynamic";

export default async function EditOutletPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSection("outlets");
  const { id } = await params;
  const [outlet] = await db
    .select()
    .from(tables.outlets)
    .where(eq(tables.outlets.id, Number(id)));
  if (!outlet) notFound();
  const feeds = await db
    .select()
    .from(tables.feeds)
    .where(eq(tables.feeds.outletId, outlet.id))
    .orderBy(tables.feeds.id);

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0, fontWeight: 400 }}>Editar — {outlet.name}</h2>
      <OutletForm action={updateOutlet} values={{ ...outlet, feeds }} submitLabel="Salvar" />
    </div>
  );
}
