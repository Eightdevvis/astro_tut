import { ensureDbSchema, getDb } from './db.js';

export async function getTesterUiPreference(username) {
  if (!username) return true;
  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT enabled FROM tester_ui_preferences WHERE username = ? LIMIT 1',
    args: [username],
  });
  const row = result.rows[0];
  if (!row) return true;
  return Number(row.enabled) === 1;
}

export async function setTesterUiPreference(username, enabled) {
  if (!username) return;
  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: `
      INSERT INTO tester_ui_preferences (username, enabled, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(username) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = datetime('now')
    `,
    args: [username, enabled ? 1 : 0],
  });
}
