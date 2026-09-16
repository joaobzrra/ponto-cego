import { isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { db, tables } from "@/db";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL, SECTIONS, sectionsForRole } from "@/lib/roles";
import { ThemeToggle } from "@/components/theme-toggle";
import "../admin.css";
import { logout } from "./actions";

export const metadata = { title: "Ponto Cego — Admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const allowed = await sectionsForRole(user.role);
  const visible = SECTIONS.filter((s) => allowed.has(s.key));
  const showFeedbackBadge = allowed.has("feedback");
  const unreviewed = showFeedbackBadge
    ? Number(
        (
          await db
            .select({ n: sql<number>`count(distinct ${tables.feedback.articleId})` })
            .from(tables.feedback)
            .where(isNull(tables.feedback.reviewedAt))
        )[0].n,
      )
    : 0;
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <span className="brand">PONTO CEGO</span>
        {visible.map((s) => (
          <Link key={s.key} href={s.href}>
            {s.label}
            {s.key === "feedback" && unreviewed > 0 ? ` (${unreviewed})` : ""}
          </Link>
        ))}
        <span className="spacer" />
        <span className="muted">
          {user.email}
          {user.role !== "admin" ? ` · ${ROLE_LABEL[user.role]}` : ""}
        </span>
        <ThemeToggle variant="admin" />
        <form action={logout}>
          <button className="ghost">Sair</button>
        </form>
      </nav>
      {children}
    </div>
  );
}
