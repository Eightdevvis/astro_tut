import { getUsernameFromCookies } from '../../../../lib/session.js';
import { getDb, ensureDbSchema } from '../../../../lib/db.js';

const MAX_WORD = 80;
const MAX_PRON = 120;
const MAX_DEF = 1000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function PUT({ request, cookies, params }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) return jsonResponse({ error: 'Nicht eingeloggt' }, 401);

  const id = parseId(params);
  if (id === null) return jsonResponse({ error: 'Ungültige ID' }, 400);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Ungültiger JSON-Body' }, 400); }

  const word = String(body?.word ?? '').trim().slice(0, MAX_WORD);
  const pronunciation = String(body?.pronunciation ?? '').trim().slice(0, MAX_PRON);
  const definition = String(body?.definition ?? '').trim().slice(0, MAX_DEF);
  if (!word) return jsonResponse({ error: 'Wort darf nicht leer sein' }, 400);

  try {
    await ensureDbSchema();
    const db = getDb();
    const chk = await db.execute({
      sql: 'SELECT id FROM user_vocab_cards WHERE id = ? AND username = ?',
      args: [id, username],
    });
    if (!chk.rows?.length) return jsonResponse({ error: 'Nicht gefunden' }, 404);

    await db.execute({
      sql: `UPDATE user_vocab_cards
            SET word = ?, pronunciation = ?, definition = ?, updated_at = datetime('now')
            WHERE id = ? AND username = ?`,
      args: [word, pronunciation, definition, id, username],
    });
    const row = await db.execute({
      sql: `SELECT id, word, pronunciation, definition, created_at, updated_at
            FROM user_vocab_cards WHERE id = ? AND username = ?`,
      args: [id, username],
    });
    const r = row.rows?.[0];
    const card = r ? {
      id: Number(r.id),
      word: String(r.word ?? ''),
      pronunciation: String(r.pronunciation ?? ''),
      definition: String(r.definition ?? ''),
      created_at: r.created_at,
      updated_at: r.updated_at,
    } : null;
    return jsonResponse({ card });
  } catch (err) {
    console.error('vocab PUT', err);
    return jsonResponse({ error: 'Speichern fehlgeschlagen' }, 500);
  }
}

export async function DELETE({ cookies, params }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) return jsonResponse({ error: 'Nicht eingeloggt' }, 401);

  const id = parseId(params);
  if (id === null) return jsonResponse({ error: 'Ungültige ID' }, 400);

  try {
    await ensureDbSchema();
    const db = getDb();
    const chk = await db.execute({
      sql: 'SELECT id FROM user_vocab_cards WHERE id = ? AND username = ?',
      args: [id, username],
    });
    if (!chk.rows?.length) return jsonResponse({ error: 'Nicht gefunden' }, 404);
    await db.execute({
      sql: 'DELETE FROM user_vocab_cards WHERE id = ? AND username = ?',
      args: [id, username],
    });
    return jsonResponse({ success: true });
  } catch (err) {
    console.error('vocab DELETE', err);
    return jsonResponse({ error: 'Löschen fehlgeschlagen' }, 500);
  }
}
