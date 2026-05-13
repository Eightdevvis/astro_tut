import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { ensureDbSchema, getDb } from '../../../lib/db.js';

const MAX_NOTE_CHARS = 20000;
const MAX_HISTORY = 5;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requireSuperUser(cookies) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) return null;
  const ok = await hasPermission(username, 'super_access');
  return ok ? username : null;
}

function notesKey(username) {
  return `super_settings_notes_${username}`;
}

function parseHistory(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // alter plain-Text-Wert → als Migration wrappen
  }
  return [{ note: raw, savedAt: 'migriert' }];
}

export async function GET({ cookies }) {
  const username = await requireSuperUser(cookies);
  if (!username) return json({ error: 'Forbidden' }, 403);

  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT value FROM site_settings WHERE setting_key = ? LIMIT 1',
    args: [notesKey(username)],
  });

  const history = parseHistory(result.rows?.[0]?.value);
  const note = history[0]?.note ?? '';
  return json({ note, history });
}

export async function PUT({ cookies, request }) {
  const username = await requireSuperUser(cookies);
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

  const existing = await db.execute({
    sql: 'SELECT value FROM site_settings WHERE setting_key = ? LIMIT 1',
    args: [notesKey(username)],
  });
  const oldHistory = parseHistory(existing.rows?.[0]?.value);

  const newEntry = { note, savedAt: new Date().toISOString() };
  const history = [newEntry, ...oldHistory].slice(0, MAX_HISTORY);

  await db.execute({
    sql: `INSERT INTO site_settings (setting_key, value)
          VALUES (?, ?)
          ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value`,
    args: [notesKey(username), JSON.stringify(history)],
  });
  return json({ ok: true, note, history });
}
