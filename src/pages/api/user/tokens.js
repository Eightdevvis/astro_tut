import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';
import { hashToken, makeToken, normalizeTokenKind } from '../../../lib/blog-tokens.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function requireUser(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return { error: json({ error: 'Nicht eingeloggt' }, 401) };
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    const username = String(payload.username || '');
    const allowed = await hasPermission(username, 'blogpost_poster');
    if (!allowed) return { error: json({ error: 'Keine Berechtigung' }, 403) };
    return { username };
  } catch {
    return { error: json({ error: 'Session ungültig' }, 401) };
  }
}

// GET — Liste der user-globalen Token (post_id IS NULL). Pendant zu
// posts/[id]/tokens, nur fuer den Hauptschluessel-Pfad.
export async function GET({ cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  try {
    await ensureDbSchema();
    const r = await getDb().execute({
      sql: `SELECT id, kind, label, max_uses, used_count, expires_at, created_at, revoked_at
              FROM blog_post_tokens
             WHERE owner_user = ? AND post_id IS NULL
             ORDER BY id DESC`,
      args: [auth.username],
    });
    return json({ tokens: r.rows || [] });
  } catch (err) {
    console.error('user/tokens GET', err);
    return json({ error: 'Laden fehlgeschlagen' }, 500);
  }
}

export async function POST({ request, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  let body = {};
  try { body = await request.json(); } catch {}
  const kind = normalizeTokenKind(body?.kind);
  const label = String(body?.label || '').slice(0, 120).trim();
  let maxUses = null;
  const n = Number(body?.maxUses);
  if (Number.isInteger(n) && n > 0 && n <= 10000) maxUses = n;
  if (kind === 'onetime' && maxUses == null) maxUses = 1;
  let expiresAt = null;
  if (body?.expiresAt) {
    const d = new Date(body.expiresAt);
    if (!Number.isNaN(d.getTime())) expiresAt = d.toISOString();
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    let plain;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      plain = makeToken();
      try {
        await db.execute({
          sql: `INSERT INTO blog_post_tokens
                  (owner_user, post_id, token_hash, kind, label, max_uses, expires_at)
                VALUES (?, NULL, ?, ?, ?, ?, ?)`,
          args: [auth.username, hashToken(plain), kind, label, maxUses, expiresAt],
        });
        break;
      } catch (err) {
        if (attempt < 2 && /unique/i.test(err?.message || '')) continue;
        throw err;
      }
    }
    return json({ success: true, token: plain, kind, label, maxUses, expiresAt }, 201);
  } catch (err) {
    console.error('user/tokens POST', err);
    return json({ error: 'Anlegen fehlgeschlagen' }, 500);
  }
}

export async function DELETE({ url, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const tokenId = Number(url.searchParams.get('id') || '');
  if (!Number.isInteger(tokenId) || tokenId <= 0) return json({ error: 'Ungültige Token-ID' }, 400);
  try {
    await ensureDbSchema();
    const r = await getDb().execute({
      sql: `UPDATE blog_post_tokens
              SET revoked_at = datetime('now')
            WHERE id = ? AND owner_user = ? AND post_id IS NULL AND revoked_at IS NULL`,
      args: [tokenId, auth.username],
    });
    if (Number(r.rowsAffected ?? 0) === 0) return json({ error: 'Token nicht gefunden' }, 404);
    return json({ success: true });
  } catch (err) {
    console.error('user/tokens DELETE', err);
    return json({ error: 'Widerruf fehlgeschlagen' }, 500);
  }
}
