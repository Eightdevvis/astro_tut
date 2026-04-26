import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { ensureDbSchema, getDb } from '../../../lib/db.js';

const NOTES_KEY = 'rpg_tree_super_notes';
const MAX_NOTE_CHARS = 20000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requireSuperuser(cookies) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) return null;
  const allowed = await hasPermission(username, 'super_access');
  return allowed ? username : null;
}

export async function GET({ cookies }) {
  const username = await requireSuperuser(cookies);
  if (!username) return json({ error: 'Forbidden' }, 403);

  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT value FROM site_settings WHERE setting_key = ? LIMIT 1',
    args: [NOTES_KEY],
  });
  const note = typeof result.rows?.[0]?.value === 'string' ? result.rows[0].value : '';
  return json({ note });
}

export async function PUT({ cookies, request }) {
  const username = await requireSuperuser(cookies);
  if (!username) return json({ error: 'Forbidden' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const raw = typeof body?.note === 'string' ? body.note : '';
  const note = raw.slice(0, MAX_NOTE_CHARS);

  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO site_settings (setting_key, value)
          VALUES (?, ?)
          ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value`,
    args: [NOTES_KEY, note],
  });
  return json({ ok: true, note });
}
