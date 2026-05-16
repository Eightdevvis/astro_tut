/**
 * Account-Loeschung (DSGVO Art. 17 — Recht auf Vergessenwerden).
 *
 * Pflicht-Schutz gegen Versehen:
 *   - POST nur, kein GET (kein CSRF-friendlicher Pfad).
 *   - Body MUSS { confirm: 'Ich-meine-es' } enthalten — sonst 400.
 *   - Hard-Delete aller Zeilen, die mit `username` verknuepft sind.
 *
 * Session wird **nicht** automatisch geloescht — der httpOnly-Cookie laeuft
 * naturgemaess gegen die nicht-mehr-existierende User-Reihe und wird beim
 * naechsten Reload als ungueltig erkannt.
 */

import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function requireUser(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return { error: json({ error: 'Nicht eingeloggt' }, 401) };
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    const username = String(payload.username || '');
    // Account-Loeschung darf JEDER eingeloggte User fuer seinen eigenen Account
    // — nicht nur blogpost_poster.
    return { username };
  } catch {
    return { error: json({ error: 'Session ungültig' }, 401) };
  }
}

const TABLES_BY_USERNAME = [
  'blog_posts',
  'blog_post_revisions',
  'blog_post_drafts',
  'quotes',
  'fractal_snapshots',
  'rpg_user_state',
  'rpg_user_state_backups',
  'minigame_progress',
  'ai_usage_log',
  'tester_bug_reports',
  'tester_ui_preferences',
  'site_user_inventory',
  'site_placed_items',
  'user_feeds',
  'user_permissions',
  'user_privacy_defaults',
];

const TABLES_BY_OWNER_USER = [
  'blog_post_tokens',
];

export async function POST({ request, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;

  let body = {};
  try { body = await request.json(); } catch {}
  if (String(body?.confirm || '') !== 'Ich-meine-es') {
    return json({ error: 'Bestaetigung erforderlich' }, 400);
  }

  // H1: Re-Auth verlangen, damit ein gestohlener Session-Cookie oder
  // ein Stored-XSS allein nicht ausreichen, um den Account zu loeschen.
  // Body MUSS zusaetzlich `password` mit dem aktuellen Klartext-Passwort
  // enthalten, gegen das wir bcrypt-vergleichen.
  const pwGuess = String(body?.password || '');
  if (!pwGuess) {
    return json({ error: 'Passwort erforderlich' }, 401);
  }
  try {
    await ensureDbSchema();
    const db = getDb();
    const u = auth.username;
    const r = await db.execute({
      sql: `SELECT password FROM users WHERE username = ? LIMIT 1`,
      args: [u],
    });
    const pwHash = String(r.rows?.[0]?.password || '');
    const ok = pwHash ? await bcrypt.compare(pwGuess, pwHash) : false;
    if (!ok) {
      return json({ error: 'Passwort falsch' }, 401);
    }
    const counts = {};

    for (const t of TABLES_BY_USERNAME) {
      try {
        const r = await db.execute({ sql: `DELETE FROM ${t} WHERE username = ?`, args: [u] });
        counts[t] = Number(r.rowsAffected ?? 0);
      } catch (err) {
        console.warn(`delete-account: ${t}`, err?.message || err);
        counts[t] = `error: ${err?.message || err}`;
      }
    }
    for (const t of TABLES_BY_OWNER_USER) {
      try {
        const r = await db.execute({ sql: `DELETE FROM ${t} WHERE owner_user = ?`, args: [u] });
        counts[t] = Number(r.rowsAffected ?? 0);
      } catch (err) {
        console.warn(`delete-account: ${t}`, err?.message || err);
        counts[t] = `error: ${err?.message || err}`;
      }
    }

    // Zum Schluss die Users-Reihe selbst.
    try {
      const r = await db.execute({ sql: `DELETE FROM users WHERE username = ?`, args: [u] });
      counts.users = Number(r.rowsAffected ?? 0);
    } catch (err) {
      console.warn(`delete-account: users`, err?.message || err);
      counts.users = `error: ${err?.message || err}`;
    }

    // Session-Cookie loeschen (Best Effort — wir setzen ablaufendes Cookie).
    return new Response(JSON.stringify({ success: true, deleted: counts }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      },
    });
  } catch (err) {
    console.error('delete-account', err);
    return json({ error: 'Loeschung fehlgeschlagen' }, 500);
  }
}
