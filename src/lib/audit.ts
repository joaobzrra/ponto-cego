import { db, tables } from "@/db";

/**
 * Append-only audit trail (spec §5). Call from every admin mutation.
 * adminId null = system/CLI action (e.g. seed scripts).
 */
export async function writeAudit(
  adminId: number | null,
  action: string,
  target?: { type: string; id: string | number },
  details?: Record<string, unknown>,
) {
  await db.insert(tables.auditLog).values({
    adminId,
    action,
    targetType: target?.type,
    targetId: target?.id?.toString(),
    details,
  });
}
