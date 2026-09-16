import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { safeJoin, THUMBS_DIR } from "@/lib/paths";

/** Serves re-hosted greyscale thumbnails from data/thumbs (spec §3.3). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  try {
    const file = await readFile(safeJoin(THUMBS_DIR, segments.join("/")));
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
