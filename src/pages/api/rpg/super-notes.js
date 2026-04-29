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

// Erlaubt alle User mit rpg_access ODER super_access
async function requireRpgUser(cookies) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) return null;
  const hasRpg = await hasPermission(username, 'rpg_access');
  const hasSuper = await hasPermission(username, 'super_access');
  return (hasRpg || hasSuper) ? username : null;
}

function notesKey(username) {
  return `rpg_tree_notes_${username}`;
}

/**
 * Parst den gespeicherten Wert aus der DB.
 * Altes Format: plain String → wird als erster History-Eintrag behandelt.
 * Neues Format: JSON-Array [{note, savedAt}, ...]
 * Gibt immer ein Array zurueck (neuester Eintrag zuerst).
 */
function parseHistory(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // kein JSON → alter plain-text Wert, als Migration wrappen
  }
  return [{ note: raw, savedAt: 'migriert' }];
}

export async function GET({ cookies }) {
  const username = await requireRpgUser(cookies);
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
  const username = await requireRpgUser(cookies);
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

  // Bestehende History laden um sie voranzustellen
  const existing = await db.execute({
    sql: 'SELECT value FROM site_settings WHERE setting_key = ? LIMIT 1',
    args: [notesKey(username)],
  });
  const oldHistory = parseHistory(existing.rows?.[0]?.value);

  // Neuen Stand vorne einreihen, History auf MAX_HISTORY begrenzen
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
