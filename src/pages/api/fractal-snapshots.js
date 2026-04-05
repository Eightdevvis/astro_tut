import { jwtVerify } from 'jose';
import { getDb, ensureDbSchema } from '../../lib/db.js';
import { getJwtSecretBytes } from '../../lib/jwt-secret.js';
import { normalizeFractalSnapshot } from '../../lib/fractal-snapshots.js';

async function getUsername(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    return payload.username;
  } catch {
    return null;
  }
}

/**
 * GET /api/fractal-snapshots?mode=all|mandelbrot|julia
 */
export async function GET({ cookies, url }) {
  const username = await getUsername(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  const u = new URL(url);
  const modeFilter = u.searchParams.get('mode');
  const validFilter = modeFilter === 'mandelbrot' || modeFilter === 'julia' ? modeFilter : null;

  try {
    await ensureDbSchema();
    const db = getDb();
    let sql =
      'SELECT id, mode, payload, created_at FROM fractal_snapshots WHERE username = ?';
    const args = [username];
    if (validFilter) {
      sql += ' AND mode = ?';
      args.push(validFilter);
    }
    sql += ' ORDER BY datetime(created_at) DESC LIMIT 200';

    const result = await db.execute({ sql, args });
    const snapshots = [];
    for (const row of result.rows) {
      let settings;
      try {
        settings = JSON.parse(String(row.payload));
      } catch {
        continue;
      }
      snapshots.push({
        id: String(row.id),
        mode: row.mode,
        created_at: row.created_at,
        settings,
      });
    }

    return new Response(JSON.stringify({ snapshots }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('fractal-snapshots GET', err);
    return new Response(JSON.stringify({ error: 'Laden fehlgeschlagen' }), { status: 500 });
  }
}

/**
 * POST /api/fractal-snapshots
 * Body: vollständiges Settings-Objekt oder { settings: { … } }
 */
export async function POST({ request, cookies }) {
  const username = await getUsername(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }

  const norm = normalizeFractalSnapshot(body);
  if (!norm.ok) {
    return new Response(JSON.stringify({ error: norm.error }), { status: 400 });
  }

  const value = norm.value;
  const payload = JSON.stringify(value);

  try {
    await ensureDbSchema();
    const db = getDb();
    const ins = await db.execute({
      sql: 'INSERT INTO fractal_snapshots (username, mode, payload) VALUES (?, ?, ?)',
      args: [username, value.mode, payload],
    });
    const rid = ins.lastInsertRowid;
    const id = rid === undefined || rid === null ? null : String(rid);

    return new Response(JSON.stringify({ success: true, id, settings: value }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('fractal-snapshots POST', err);
    return new Response(JSON.stringify({ error: 'Speichern fehlgeschlagen' }), { status: 500 });
  }
}
