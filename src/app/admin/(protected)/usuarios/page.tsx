import { asc } from "drizzle-orm";
import { db, tables } from "@/db";
import { PANEL_ROLES, type PanelRole } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { GRANTABLE_SECTIONS, ROLE_LABEL } from "@/lib/roles";
import { savePermissions } from "./actions";
import { CreateUserForm } from "./create-user-form";
import { UserRowActions } from "./user-row-actions";

export const dynamic = "force-dynamic";

/*
 * Usuários (2026-07-20): panel accounts + the role × section visibility
 * matrix — the old-forum/Discord model. Admin-only, including the actions.
 * Admin rows aren't in the matrix (implicit full access) and "usuarios"
 * isn't a column (never grantable) — see lib/roles.ts.
 */

export default async function UsuariosPage() {
  const me = await requireAdmin();

  const [users, perms] = await Promise.all([
    db
      .select({
        id: tables.adminUsers.id,
        email: tables.adminUsers.email,
        role: tables.adminUsers.role,
        totpEnabled: tables.adminUsers.totpEnabled,
        disabled: tables.adminUsers.disabled,
        createdAt: tables.adminUsers.createdAt,
      })
      .from(tables.adminUsers)
      .orderBy(asc(tables.adminUsers.id)),
    db
      .select({ role: tables.rolePermissions.role, section: tables.rolePermissions.section })
      .from(tables.rolePermissions),
  ]);

  const granted = new Set(perms.map((p) => `${p.role}:${p.section}`));
  const editableRoles = PANEL_ROLES.filter((r): r is Exclude<PanelRole, "admin"> => r !== "admin");

  return (
    <main>
      <h1>Usuários</h1>

      <div className="card">
        <h2>Contas</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Papel</th>
                <th>TOTP</th>
                <th>Estado</th>
                <th>Criado</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {u.id === me.id && <span className="muted"> (você)</span>}
                  </td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>
                    {u.totpEnabled ? (
                      <span className="badge ok">ativo</span>
                    ) : (
                      <span className="badge warn">pendente</span>
                    )}
                  </td>
                  <td>
                    {u.disabled ? (
                      <span className="badge err">desativado</span>
                    ) : (
                      <span className="badge ok">ativo</span>
                    )}
                  </td>
                  <td className="muted">
                    {u.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })}
                  </td>
                  <td>
                    <UserRowActions
                      id={u.id}
                      role={u.role}
                      disabled={u.disabled}
                      self={u.id === me.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Novo usuário</h2>
        <CreateUserForm />
      </div>

      <div className="card">
        <h2>Permissões por papel</h2>
        <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
          O que cada papel pode <strong>ver</strong>. Admin sempre vê tudo (e só admins alteram
          qualquer coisa — papéis não-admin são somente leitura nas seções liberadas). A seção
          Usuários é exclusiva de admins.
        </p>
        <form action={savePermissions}>
          <div className="table-scroll">
            <table style={{ maxWidth: 900 }}>
              <thead>
                <tr>
                  <th>Seção</th>
                  {editableRoles.map((r) => (
                    <th key={r}>{ROLE_LABEL[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GRANTABLE_SECTIONS.map((s) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    {editableRoles.map((r) => (
                      <td key={r}>
                        <input
                          type="checkbox"
                          name={`perm:${r}:${s.key}`}
                          defaultChecked={granted.has(`${r}:${s.key}`)}
                          aria-label={`${ROLE_LABEL[r]} pode ver ${s.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit" style={{ marginTop: "0.75rem" }}>
            Salvar permissões
          </button>
        </form>
      </div>
    </main>
  );
}
