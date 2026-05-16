import { getUsernameFromCookies } from '../../../../lib/session.js';
import { getDb, ensureDbSchema } from '../../../../lib/db.js';

const MAX_WORD = 80;
const MAX_PRON = 120;
const MAX_DEF = 1000;
const MAX_CARDS_PER_USER = 200;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rowToCard(row) {
  return {
    id: Number(row.id),
    word: String(row.word ?? ''),
    pronunciation: String(row.pronunciation ?? ''),
    definition: String(row.definition ?? ''),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) return jsonResponse({ error: 'Nicht eingeloggt' }, 401);

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT id, word, pronunciation, definition, created_at, updated_at
            FROM user_vocab_cards
            WHERE username = ?
            ORDER BY datetime(created_at) ASC, id ASC`,
      args: [username],
    });
    const cards = (result.rows ?? []).map(rowToCard);
    return jsonResponse({ cards });
  } catch (err) {
    console.error('vocab GET', err);
    return jsonResponse({ error: 'Laden fehlgeschlagen' }, 500);
  }
}

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) return jsonResponse({ error: 'Nicht eingeloggt' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Ungültiger JSON-Body' }, 400); }

  const word = String(body?.word ?? '').trim().slice(0, MAX_WORD);
  const pronunciation = String(body?.pronunciation ?? '').trim().slice(0, MAX_PRON);
  const definition = String(body?.definition ?? '').trim().slice(0, MAX_DEF);
  if (!word) return jsonResponse({ error: 'Wort darf nicht leer sein' }, 400);

  try {
    await ensureDbSchema();
    const db = getDb();
    const countRes = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM user_vocab_cards WHERE username = ?',
      args: [username],
    });
    const n = Number(countRes.rows?.[0]?.n ?? 0);
    if (n >= MAX_CARDS_PER_USER) {
      return jsonResponse({ error: `Maximal ${MAX_CARDS_PER_USER} Karten pro User.` }, 400);
    }
    const ins = await db.execute({
      sql: `INSERT INTO user_vocab_cards (username, word, pronunciation, definition)
            VALUES (?, ?, ?, ?)`,
      args: [username, word, pronunciation, definition],
    });
    const id = ins.lastInsertRowid === undefined || ins.lastInsertRowid === null
      ? null : Number(ins.lastInsertRowid);
    const row = await db.execute({
      sql: `SELECT id, word, pronunciation, definition, created_at, updated_at
            FROM user_vocab_cards WHERE id = ? AND username = ?`,
      args: [id, username],
    });
    const card = row.rows?.[0] ? rowToCard(row.rows[0]) : null;
    return jsonResponse({ card }, 201);
  } catch (err) {
    console.error('vocab POST', err);
    return jsonResponse({ error: 'Speichern fehlgeschlagen' }, 500);
  }
}
