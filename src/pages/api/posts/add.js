import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';
import { makePublicSlug, normalizeVisibility } from '../../../lib/blog-privacy.js';
import { getUserPrivacyDefaults } from '../../../lib/user-privacy-defaults.js';
import { fireBackupWebhook } from '../../../lib/backup-webhook.js';
import { sanitizePostHtml } from '../../../lib/sanitize-html.js';
import { apiError, serverError } from '../../../lib/api-error.js';

function parseExpiresAt(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function hashPasswordIfGiven(pw) {
  const s = String(pw || '');
  if (!s) return null;
  if (s.length < 1 || s.length > 256) return null;
  return await bcrypt.hash(s, 10);
}

function normalizeColor(v) {
  const value = String(v || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return '#8dc5ff';
  return value.toLowerCase();
}

function normalizePrivacyFlags(v) {
  if (v == null || v === '') return '{}';
  try {
    const obj = typeof v === 'string' ? JSON.parse(v) : v;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '{}';
    // Nur boolesche Werte zulassen — wir sind hier offen fuer neue Toggles,
    // aber ein Toggle ist immer an/aus.
    const clean = {};
    for (const [k, val] of Object.entries(obj)) {
      if (typeof val === 'boolean') clean[k] = val;
    }
    return JSON.stringify(clean);
  } catch {
    return '{}';
  }
}

export async function POST({ request, cookies }) {
  try {
    const token = cookies.get('session')?.value;
    if (!token) return apiError('Nicht eingeloggt', 'add:no_token', 401);

    let username = '';
    try {
      const { payload } = await jwtVerify(token, getJwtSecretBytes());
      username = String(payload.username || '');
    } catch {
      return apiError('Session ungültig', 'add:bad_session', 401);
    }

    const allowed = await hasPermission(username, 'blogpost_poster');
    if (!allowed) return apiError('Keine Berechtigung', 'add:no_permission', 403);

    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Ungültiger JSON-Body', 'add:bad_json', 400);
    }

    // K1 Stored-XSS-Schutz: alles HTML vom Editor durch DOMPurify mit
    // strikter Allow-List jagen, bevor wir es persistieren. document.exec-
    // Command liefert ungefiltertes Markup; ohne Sanitize landeten
    // <script>, <img onerror=…> und javascript:-Links 1:1 in der DB.
    const rawHtml = String(body?.contentHtml || '').trim();
    let contentHtml;
    try {
      contentHtml = sanitizePostHtml(rawHtml);
    } catch (err) {
      return serverError('Inhalt konnte nicht verarbeitet werden', 'add:sanitize_failed', err);
    }
    const contentText = String(body?.contentText || '').trim();
    const accentColor = normalizeColor(body?.accentColor);
    const doodleDataUrl = String(body?.doodleDataUrl || '').trim();

    // C1: wenn der Client keine Visibility/Flags mitschickt, fallen wir auf
    // die Profil-Defaults dieses Users zurueck. Damit setzt jeder Post
    // automatisch das, was der User in seinem Datenschutz-Tab vorgewaehlt
    // hat. Bestehende Defaults (public/leere flags) bleiben unauffaellig.
    const userDefaults = await getUserPrivacyDefaults(username).catch(() => null);
    const visibility = body?.visibility !== undefined
      ? normalizeVisibility(body.visibility)
      : (userDefaults?.default_visibility || 'public');
    const privacyFlags = body?.privacyFlags !== undefined
      ? normalizePrivacyFlags(body.privacyFlags)
      : (userDefaults?.default_flags || '{}');
    const expiresAt = parseExpiresAt(body?.expiresAt);
    const passwordHash = visibility === 'password' ? await hashPasswordIfGiven(body?.password) : null;

    if (!contentText) {
      return apiError('Inhalt darf nicht leer sein', 'add:content_empty', 400);
    }
    if (contentText.length > 100000 || contentHtml.length > 400000) {
      return apiError('Post ist zu lang', 'add:content_too_long', 413);
    }
    // M3: Editor exportiert ueber Canvas immer PNG. SVG-mit-Skript ist ein
    // gueltiges data:image/-Prefix; deshalb hier explizit nur PNG/JPEG
    // zulassen.
    if (doodleDataUrl && !/^data:image\/(png|jpe?g);base64,/i.test(doodleDataUrl)) {
      return apiError('Ungültige Kritzel-Daten', 'add:doodle_invalid', 400);
    }
    if (doodleDataUrl.length > 2_000_000) {
      return apiError('Kritzelbild ist zu groß', 'add:doodle_too_large', 413);
    }

    await ensureDbSchema();
    const db = getDb();
    // B13: bei jedem neuen Post wird sofort ein unraidbarer Slug vergeben,
    // damit `unlisted`-Posts auch nachtraeglich nicht durch Hochzaehlen der
    // Integer-ID gefunden werden koennen. Bei extrem unwahrscheinlicher
    // Kollision auf der UNIQUE-Spalte zweiter Versuch.
    let slug = makePublicSlug();
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await db.execute({
          sql: `INSERT INTO blog_posts
                  (username, content_html, content_text, accent_color,
                   doodle_data_url, visibility, privacy_flags, public_slug,
                   password_hash, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [username, contentHtml, contentText, accentColor, doodleDataUrl, visibility, privacyFlags, slug, passwordHash, expiresAt],
        });
        break;
      } catch (err) {
        const msg = err?.message ?? String(err);
        if (/unique/i.test(msg) && /slug/i.test(msg) && attempt < 2) {
          slug = makePublicSlug();
          continue;
        }
        throw err;
      }
    }
    const id = result.lastInsertRowid == null ? null : String(result.lastInsertRowid);
    // A2-Cleanup: der "neuer Post"-Draft-Slot (post_id = 0) ist nach
    // erfolgreichem Erst-Post obsolet.
    try {
      await db.execute({
        sql: `DELETE FROM blog_post_drafts WHERE username = ? AND post_id = 0`,
        args: [username],
      });
    } catch (cleanupErr) {
      console.warn('posts/add: draft cleanup', cleanupErr);
    }
    fireBackupWebhook(username, 'post.add', {
      id: id ? Number(id) : null,
      public_slug: slug,
      visibility,
      content_text: contentText,
      content_html: contentHtml,
    });
    return new Response(JSON.stringify({ success: true, id, slug, visibility }), { status: 201 });
  } catch (err) {
    return serverError('Speichern fehlgeschlagen', 'add:db_insert_failed', err);
  }
}
