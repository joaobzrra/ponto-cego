import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { sessionCanSee } from "@/lib/auth";
import { safeJoin, SNAPSHOTS_DIR } from "@/lib/paths";

/**
 * Raw snapshot viewer for diff-debugging. Route handlers do NOT inherit the
 * layout guard — auth is enforced here explicitly.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sessionCanSee("health"))) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const { id } = await params;
  const [snap] = await db
    .select()
    .from(tables.rawSnapshots)
    .where(eq(tables.rawSnapshots.id, Number(id)));
  if (!snap) return new NextResponse("not found", { status: 404 });
  try {
    const content = await readFile(safeJoin(SNAPSHOTS_DIR, snap.filePath), "utf8");
    return new NextResponse(content, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new NextResponse("snapshot file missing (past retention?)", { status: 410 });
  }
}
