export async function audit(
  db: D1Database,
  userId: string | null,
  action: string,
  target?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audit_logs (user_id, action, target, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(userId, action, target ?? null, metadata ? JSON.stringify(metadata) : null, Date.now())
    .run();
}
