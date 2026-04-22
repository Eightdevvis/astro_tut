import { jwtVerify } from 'jose';
import { getDb, ensureDbSchema } from '../../lib/db.js';
import { getJwtSecretBytes } from '../../lib/jwt-secret.js';

const MAX_POINTS = 420;
const FADE_DAYS = 90;
const FUNCTIONAL_CLEAN_DAYS = 7;

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function cleanPoints(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_POINTS)
    .map((p) => ({
      x: toInt(p?.x),
      y: toInt(p?.y),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/')) return '/';
  return raw.slice(0, 250);
}

async function cleanupGraffiti(db) {
  await db.execute({
    sql: `DELETE FROM graffiti_strokes
          WHERE created_at < datetime('now', ?)
             OR (is_functional = 1 AND created_at < datetime('now', ?))`,
    args: [`-${FADE_DAYS} days`, `-${FUNCTIONAL_CLEAN_DAYS} days`],
  });
}

export async function GET({ url }) {
  const pagePath = normalizePath(url.searchParams.get('page'));
  try {
    await ensureDbSchema();
    const db = getDb();
    await cleanupGraffiti(db);
    const result = await db.execute({
      sql: `SELECT id, mode, points_json, created_at
            FROM graffiti_strokes
            WHERE page_path = ?
            ORDER BY id ASC`,
      args: [pagePath],
    });
    const nowMs = Date.now();
    const strokes = (result.rows || []).map((row) => {
      let points = [];
      try {
        points = JSON.parse(String(row.points_json || '[]'));
      } catch {
        points = [];
      }
      const created = Date.parse(String(row.created_at || ''));
      const ageDays = Number.isFinite(created) ? (nowMs - created) / 86400000 : 0;
      return {
        id: Number(row.id),
        mode: String(row.mode || 'tag'),
        points,
        createdAt: String(row.created_at || ''),
        ageDays: Math.max(0, ageDays),
      };
    });
    return new Response(JSON.stringify({ success: true, strokes }), { status: 200 });
  } catch (err) {
    console.error('GET /api/graffiti', err);
    return new Response(JSON.stringify({ error: 'Graffiti konnte nicht geladen werden' }), { status: 500 });
  }
}

export async function POST({ request, cookies }) {
  const token = cookies.get('session')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  let username;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    username = String(payload.username || '');
    if (!username) throw new Error('no-user');
  } catch {
    return new Response(JSON.stringify({ error: 'Session ungültig' }), { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }

  const pagePath = normalizePath(body?.pagePath);
  const mode = String(body?.mode || 'tag') === 'spray' ? 'spray' : 'tag';
  const points = cleanPoints(body?.points);
  const isFunctional = body?.isFunctional ? 1 : 0;
  if (points.length < 2) {
    return new Response(JSON.stringify({ error: 'Zu wenig Punkte' }), { status: 400 });
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    await cleanupGraffiti(db);
    await db.execute({
      sql: `INSERT INTO graffiti_strokes (page_path, username, mode, points_json, is_functional)
            VALUES (?, ?, ?, ?, ?)`,
      args: [pagePath, username, mode, JSON.stringify(points), isFunctional],
    });
    return new Response(JSON.stringify({ success: true }), { status: 201 });
  } catch (err) {
    console.error('POST /api/graffiti', err);
    return new Response(JSON.stringify({ error: 'Graffiti speichern fehlgeschlagen' }), { status: 500 });
  }
}
