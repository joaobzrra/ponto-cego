import "server-only";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import type { PanelRole } from "@/db/schema";

/*
 * Panel sections — the single registry the nav, the per-page guards and the
 * /admin/usuarios permission matrix all read, so a section added here shows
 * up everywhere at once (old-forum/Discord model: roles × visibility).
 *
 * Rules:
 * - admin sees every section, always; nothing stored, nothing editable.
 * - "usuarios" is admin-only by construction and never appears in the matrix
 *   (a role that could edit permissions could grant itself everything).
 * - Mutations are NOT covered by this matrix: every server action requires
 *   the admin role (see requireAdmin). Visibility ≠ write access.
 */

export type SectionKey =
  | "overview"
  | "outlets"
  | "articles"
  | "health"
  | "rubric"
  | "clusters"
  | "feedback"
  | "analytics"
  | "assunto"
  | "newsletter"
  | "usuarios";

export const SECTIONS: Array<{ key: SectionKey; label: string; href: string }> = [
  { key: "overview", label: "Visão geral", href: "/admin" },
  { key: "outlets", label: "Veículos", href: "/admin/outlets" },
  { key: "articles", label: "Artigos", href: "/admin/articles" },
  { key: "health", label: "Saúde", href: "/admin/health" },
  { key: "rubric", label: "Rubrica", href: "/admin/rubric" },
  { key: "clusters", label: "Clusters", href: "/admin/clusters" },
  { key: "feedback", label: "Correções", href: "/admin/feedback" },
  { key: "analytics", label: "Analytics", href: "/admin/analytics" },
  { key: "assunto", label: "Assunto", href: "/admin/assunto" },
  { key: "newsletter", label: "Newsletter", href: "/admin/newsletter" },
  { key: "usuarios", label: "Usuários", href: "/admin/usuarios" },
];

/** Sections a non-admin role may be granted (the matrix's columns). */
export const GRANTABLE_SECTIONS = SECTIONS.filter((s) => s.key !== "usuarios");

export const ROLE_LABEL: Record<PanelRole, string> = {
  admin: "Admin",
  moderator: "Moderador",
  patron: "Patrono",
};

export async function sectionsForRole(role: PanelRole): Promise<Set<SectionKey>> {
  if (role === "admin") return new Set(SECTIONS.map((s) => s.key));
  const rows = await db
    .select({ section: tables.rolePermissions.section })
    .from(tables.rolePermissions)
    .where(eq(tables.rolePermissions.role, role));
  const grantable = new Set(GRANTABLE_SECTIONS.map((s) => s.key));
  return new Set(
    rows.map((r) => r.section as SectionKey).filter((s) => grantable.has(s)),
  );
}

/** Where to land a user who can't see the page they hit (e.g. /admin). */
export function defaultPathFor(allowed: Set<SectionKey>): string {
  const first = SECTIONS.find((s) => allowed.has(s.key));
  return first?.href ?? "/";
}
