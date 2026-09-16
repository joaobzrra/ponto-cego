import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/newsletter";

function token(url: string): string | null {
  const t = new URL(url).searchParams.get("t");
  return t && /^[0-9a-f]{64}$/.test(t) ? t : null;
}

export async function GET(req: Request) {
  const t = token(req.url);
  return NextResponse.redirect(new URL(`/newsletter/sair${t ? `?t=${t}` : ""}`, req.url), 302);
}

// RFC 8058 one-click: mail clients POST with body "List-Unsubscribe=One-Click".
export async function POST(req: Request) {
  const t = token(req.url);
  if (!t) return new NextResponse("bad token", { status: 400 });
  await unsubscribeByToken(t);
  return new NextResponse("ok", { status: 200 });
}
