import { jwtVerify } from 'jose';
import { hasPermission } from '../../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../../lib/db.js';
import { getJwtSecretBytes } from '../../../../lib/jwt-secret.js';
import { hashToken, makeToken, normalizeTokenKind } from '../../../../lib/blog-tokens.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function parsePostId(params) {
  const id = Number(String(params?.id ?? '').trim());
  return Number.isInteger(id) && id > 0 ? id : null;
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

async function requireOwnedPost(db, postId, username) {
  const r = await db.execute({
    sql: `SELECT id FROM blog_posts WHERE id = ? AND username = ? AND deleted_at IS NULL LIMIT 1`,
    args: [postId, username],
  });
  return Boolean(r.rows?.[0]);
}

// GET — Liste aktiver Token fuer diesen Post (nur eigene).
export async function GET({ params, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const id = parsePostId(params);
  if (!id) return json({ error: 'Ungültige Post-ID' }, 400);
  try {
    await ensureDbSchema();
    const db = getDb();
    if (!(await requireOwnedPost(db, id, auth.username))) {
      return json({ error: 'Post nicht gefunden' }, 404);
    }
    const r = await db.execute({
      sql: `SELECT id, kind, label, max_uses, used_count, expires_at,
                   created_at, revoked_at
              FROM blog_post_tokens
             WHERE owner_user = ? AND post_id = ?
             ORDER BY id DESC`,
      args: [auth.username, id],
    });
    return json({ tokens: r.rows || [] });
  } catch (err) {
    console.error('posts/[id]/tokens GET', err);
    return json({ error: 'Laden fehlgeschlagen' }, 500);
  }
}

// POST — neuen Token fuer diesen Post anlegen. Klartext-Token wird einmalig
// im Response zurueckgegeben (DB speichert nur den sha256-Hash).
export async function POST({ params, request, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const id = parsePostId(params);
  if (!id) return json({ error: 'Ungültige Post-ID' }, 400);

  let body = {};
  try { body = await request.json(); } catch {}

  const kind = normalizeTokenKind(body?.kind);
  const label = String(body?.label || '').slice(0, 120).trim();
  const maxUsesRaw = body?.maxUses;
  let maxUses = null;
  if (maxUsesRaw != null && maxUsesRaw !== '') {
    const n = Number(maxUsesRaw);
    if (Number.isInteger(n) && n > 0 && n <= 10000) maxUses = n;
  }
  if (kind === 'onetime' && maxUses == null) maxUses = 1;

  let expiresAt = null;
  if (body?.expiresAt) {
    const d = new Date(body.expiresAt);
    if (!Number.isNaN(d.getTime())) expiresAt = d.toISOString();
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    if (!(await requireOwnedPost(db, id, auth.username))) {
      return json({ error: 'Post nicht gefunden' }, 404);
    }
    let plain;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      plain = makeToken();
      try {
        await db.execute({
          sql: `INSERT INTO blog_post_tokens
                  (owner_user, post_id, token_hash, kind, label, max_uses, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [auth.username, id, hashToken(plain), kind, label, maxUses, expiresAt],
        });
        break;
      } catch (err) {
        if (attempt < 2 && /unique/i.test(err?.message || '')) continue;
        throw err;
      }
    }
    return json({ success: true, token: plain, kind, label, maxUses, expiresAt }, 201);
  } catch (err) {
    console.error('posts/[id]/tokens POST', err);
    return json({ error: 'Anlegen fehlgeschlagen' }, 500);
  }
}
