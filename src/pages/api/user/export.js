/**
 * A5 / Datenschutz-Recht auf Export (DSGVO Art. 20).
 *
 * Liefert JSON mit allen Daten, die zu diesem User gehoeren:
 *  - eigene Posts (inkl. soft-deleted, mit allen privacy-Spalten),
 *  - alle Revisionen,
 *  - alle aktiven + revoked Tokens (ohne den Klartext — der ist auch in
 *    der DB nicht mehr da, nur als sha256-Hash),
 *  - Server-Drafts,
 *  - Privacy-Defaults,
 *  - Permissions.
 *
 * Bewusst kein ZIP/Markdown — JSON ist portabel und maschinenlesbar.
 * Content-Disposition macht es zum Download.
 */

import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';
import { getUserPrivacyDefaults } from '../../../lib/user-privacy-defaults.js';

async function requireUser(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return { error: new Response('Nicht eingeloggt', { status: 401 }) };
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    const username = String(payload.username || '');
    const allowed = await hasPermission(username, 'blogpost_poster');
    if (!allowed) return { error: new Response('Keine Berechtigung', { status: 403 }) };
    return { username };
  } catch {
    return { error: new Response('Session ungültig', { status: 401 }) };
  }
}

export async function GET({ cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;

  try {
    await ensureDbSchema();
    const db = getDb();
    const username = auth.username;

    const posts = await db.execute({
      sql: `SELECT id, content_html, content_text, accent_color, doodle_data_url,
                   created_at, deleted_at, public_slug, visibility, privacy_flags,
                   password_hash, expires_at
              FROM blog_posts
             WHERE username = ?
             ORDER BY id ASC`,
      args: [username],
    });
    const revisions = await db.execute({
      sql: `SELECT id, post_id, content_html, content_text, accent_color,
                   doodle_data_url, privacy_flags, change_reason, created_at
              FROM blog_post_revisions
             WHERE username = ?
             ORDER BY id ASC`,
      args: [username],
    });
    const drafts = await db.execute({
      sql: `SELECT post_id, content_html, content_text, accent_color, doodle_data_url, updated_at
              FROM blog_post_drafts
             WHERE username = ?`,
      args: [username],
    });
    const tokens = await db.execute({
      sql: `SELECT id, post_id, kind, label, max_uses, used_count, expires_at,
                   created_at, revoked_at
              FROM blog_post_tokens
             WHERE owner_user = ?`,
      args: [username],
    });
    const perms = await db.execute({
      sql: `SELECT permission, state FROM user_permissions WHERE username = ?`,
      args: [username],
    });
    const defaults = await getUserPrivacyDefaults(username);

    const payload = {
      meta: {
        format: 'astro-tut blog export v1',
        generated_at: new Date().toISOString(),
        username,
        note: 'Token-Klartext ist nicht enthalten — DB speichert nur sha256-Hashes. password_hash ist bcrypt, nicht reversibel.',
      },
      privacy_defaults: defaults,
      permissions: perms.rows || [],
      posts: posts.rows || [],
      revisions: revisions.rows || [],
      drafts: drafts.rows || [],
      tokens: tokens.rows || [],
    };

    const body = JSON.stringify(payload, null, 2);
    const today = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="astro-tut-export-${username}-${today}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('user/export', err);
    return new Response('Export fehlgeschlagen', { status: 500 });
  }
}
