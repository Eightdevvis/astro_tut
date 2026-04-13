import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

/**
 * PATCH /api/quotes/:id
 * Text und angezeigten Autor bearbeiten — nur eigenes Zitat.
 */
export async function PATCH({ cookies, params, request }) {
  const token = cookies.get('session')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  let username;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    username = payload.username;
  } catch {
    return new Response(JSON.stringify({ error: 'Session ungültig' }), { status: 401 });
  }

  const allowed = await hasPermission(username, 'quote_poster');
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const id = Number(params.id);
  if (!Number.isFinite(id) || id < 1) {
    return new Response(JSON.stringify({ error: 'Ungültige ID' }), { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }

  const { text, author } = body;
  const textRaw = text === undefined || text === null ? '' : String(text);
  if (!textRaw.trim()) {
    return new Response(JSON.stringify({ error: 'Zitat darf nicht leer sein' }), { status: 400 });
  }

  const authorTrim =
    author !== undefined && author !== null ? String(author).trim() : '';

  try {
    await ensureDbSchema();
    const db = getDb();
    const chk = await db.execute({
      sql: 'SELECT id FROM quotes WHERE id = ? AND username = ?',
      args: [id, username],
    });
    if (!chk.rows?.length) {
      return new Response(JSON.stringify({ error: 'Nicht gefunden' }), { status: 404 });
    }

    await db.execute({
      sql: 'UPDATE quotes SET text = ?, author = ? WHERE id = ? AND username = ?',
      args: [textRaw, authorTrim, id, username],
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('quotes PATCH', err);
    return new Response(JSON.stringify({ error: 'Speichern fehlgeschlagen' }), { status: 500 });
  }
}

/**
 * DELETE /api/quotes/:id
 * Nur eigenes Zitat.
 */
export async function DELETE({ cookies, params }) {
  const token = cookies.get('session')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  let username;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    username = payload.username;
  } catch {
    return new Response(JSON.stringify({ error: 'Session ungültig' }), { status: 401 });
  }

  const allowed = await hasPermission(username, 'quote_poster');
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const id = Number(params.id);
  if (!Number.isFinite(id) || id < 1) {
    return new Response(JSON.stringify({ error: 'Ungültige ID' }), { status: 400 });
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    const chk = await db.execute({
      sql: 'SELECT id FROM quotes WHERE id = ? AND username = ?',
      args: [id, username],
    });
    if (!chk.rows?.length) {
      return new Response(JSON.stringify({ error: 'Nicht gefunden' }), { status: 404 });
    }

    await db.execute({
      sql: 'DELETE FROM quotes WHERE id = ? AND username = ?',
      args: [id, username],
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('quotes DELETE', err);
    return new Response(JSON.stringify({ error: 'Löschen fehlgeschlagen' }), { status: 500 });
  }
}
