import { jwtVerify } from 'jose';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

// Whitelist erlaubter game-IDs. Verhindert, dass beliebige Keys gespeichert
// werden (Speicher-Spam, Verwirrung). Neue Minigames hier eintragen.
const ALLOWED_GAMES = new Set(['archaea-lipide', 'extremophile']);

// Begrenzt die Payload-Groesse — Minigame-Fortschritte sind kompakt
// (paar hundert Byte), 16 KB ist generoeser Puffer.
const MAX_PAYLOAD_BYTES = 16 * 1024;

async function getUsername(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    return typeof payload.username === 'string' ? payload.username : null;
  } catch {
    return null;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/minigames/progress?game=<id>
 *
 * Antwort: { payload: <json> | null, updated_at: <iso> | null }
 * Status:  200 immer wenn auth ok (auch wenn nichts da ist),
 *          400 bei unbekannter game-ID,
 *          401 wenn nicht eingeloggt.
 */
export async function GET({ cookies, url }) {
  const username = await getUsername(cookies);
  if (!username) return jsonResponse({ error: 'Nicht eingeloggt' }, 401);

  const u = new URL(url);
  const gameId = u.searchParams.get('game');
  if (!gameId || !ALLOWED_GAMES.has(gameId)) {
    return jsonResponse({ error: 'Unbekannte game-ID' }, 400);
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT payload, updated_at FROM minigame_progress WHERE username = ? AND game_id = ?',
      args: [username, gameId],
    });
    const row = result.rows[0];
    if (!row) return jsonResponse({ payload: null, updated_at: null });
    let payload;
    try {
      payload = JSON.parse(String(row.payload));
    } catch {
      payload = null;
    }
    return jsonResponse({ payload, updated_at: row.updated_at });
  } catch (err) {
    console.error('minigame-progress GET', err);
    return jsonResponse({ error: 'Laden fehlgeschlagen' }, 500);
  }
}

/**
 * PUT /api/minigames/progress
 * Body: { game: <id>, payload: <json> }
 *
 * Ueberschreibt den gespeicherten Fortschritt fuer (username, game). Merging
 * macht der Client (Sources of Truth fuer Spielregeln liegen pro Spiel).
 */
export async function PUT({ cookies, request }) {
  const username = await getUsername(cookies);
  if (!username) return jsonResponse({ error: 'Nicht eingeloggt' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Ungueltiger JSON-Body' }, 400);
  }

  const gameId = body?.game;
  if (typeof gameId !== 'string' || !ALLOWED_GAMES.has(gameId)) {
    return jsonResponse({ error: 'Unbekannte game-ID' }, 400);
  }

  const payload = body?.payload;
  if (payload === undefined || payload === null) {
    return jsonResponse({ error: 'Payload fehlt' }, 400);
  }
  const payloadJson = JSON.stringify(payload);
  if (payloadJson.length > MAX_PAYLOAD_BYTES) {
    return jsonResponse({ error: 'Payload zu gross' }, 413);
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    await db.execute({
      sql:
        'INSERT INTO minigame_progress (username, game_id, payload, updated_at) ' +
        "VALUES (?, ?, ?, datetime('now')) " +
        'ON CONFLICT(username, game_id) DO UPDATE SET ' +
        "  payload = excluded.payload, updated_at = datetime('now')",
      args: [username, gameId, payloadJson],
    });
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('minigame-progress PUT', err);
    return jsonResponse({ error: 'Speichern fehlgeschlagen' }, 500);
  }
}
