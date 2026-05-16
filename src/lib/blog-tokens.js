/**
 * Token-Verwaltung fuer Blog-Posts (Phase 9 — B15/B16).
 *
 * Zwei Geltungsbereiche:
 *   - post-spezifisch: token_row.post_id ist gesetzt; oeffnet diesen Post.
 *   - user-global:     token_row.post_id ist NULL; oeffnet alle
 *                      passwortgeschuetzten Posts dieses Users
 *                      ("Hauptschluessel" fuer Lesekreis).
 *
 * Zwei Typen:
 *   - 'shared'  : unbegrenzt nutzbar bis Ablauf/Widerruf.
 *   - 'onetime' : bei jedem erfolgreichen Render wird used_count++,
 *                 ab used_count >= max_uses (default 1) ungueltig.
 *
 * Sicherheit:
 *   - Klartext-Token wird **nie** gespeichert, nur sha256-Hash.
 *   - Bei Token-Erzeugung gibt der Endpoint den Klartext einmalig zurueck.
 *   - Token-Format: 24 Hex-Zeichen aus crypto.randomUUID() (~96 Bit
 *     Entropie) — nicht ratbar.
 */

import { createHash, randomUUID } from 'node:crypto';

const TOKEN_KINDS = new Set(['shared', 'onetime']);
const TOKEN_RE = /^[0-9a-f]{24}$/;

export function makeToken() {
  const uuid = randomUUID();
  return uuid.replace(/-/g, '').slice(0, 24).toLowerCase();
}

export function isValidTokenFormat(value) {
  return typeof value === 'string' && TOKEN_RE.test(value.toLowerCase());
}

export function hashToken(token) {
  return createHash('sha256').update(String(token || '').toLowerCase()).digest('hex');
}

export function normalizeTokenKind(value) {
  const v = String(value || '').trim().toLowerCase();
  return TOKEN_KINDS.has(v) ? v : 'shared';
}

/**
 * Prueft, ob eine geladene Token-Reihe gerade gueltig ist.
 * Pure Funktion — keine DB-Mutation, kein I/O.
 */
export function isTokenLive(row, nowIso = new Date().toISOString()) {
  if (!row) return false;
  if (row.revoked_at) return false;
  if (row.expires_at && String(row.expires_at) <= nowIso) return false;
  const max = row.max_uses == null ? null : Number(row.max_uses);
  if (max != null && Number.isFinite(max) && Number(row.used_count || 0) >= max) return false;
  return true;
}

/**
 * Lookup eines Tokens fuer einen konkreten Post. Prueft sowohl
 * post-spezifische als auch user-globale Token (post_id IS NULL) des
 * Post-Eigentuemers.
 *
 * M1: bei `kind='onetime'` wird der Verbrauch **atomar** zusammen mit
 * dem Lookup gemacht (UPDATE … RETURNING). Damit kann der Token nicht
 * von zwei parallelen Requests doppelt eingeloest werden — das alte
 * SELECT-render-UPDATE-Pattern hatte ein TOCTOU-Fenster.
 *
 * Liefert die Token-Reihe (oder null). Bei One-Time-Tokens ist nach
 * dem Aufruf `used_count` bereits inkrementiert; der Caller muss nichts
 * mehr "konsumieren".
 */
export async function findValidTokenForPost(db, { post, providedToken }) {
  if (!providedToken || !isValidTokenFormat(providedToken)) return null;
  if (!post || !post.id || !post.username) return null;
  const hash = hashToken(providedToken);
  const r = await db.execute({
    sql: `SELECT id, owner_user, post_id, token_hash, kind, label, max_uses,
                 used_count, expires_at, created_at, revoked_at
            FROM blog_post_tokens
           WHERE token_hash = ?
             AND ((post_id = ?) OR (post_id IS NULL AND owner_user = ?))
           LIMIT 1`,
    args: [hash, post.id, post.username],
  });
  const row = r.rows?.[0] || null;
  if (!row) return null;
  if (!isTokenLive(row)) return null;
  if (row.kind !== 'onetime') return row;

  // M1: atomar inkrementieren. Wenn 0 Zeilen betroffen → Race verloren
  // (anderer Request war schneller) → Token ist verbraucht → null.
  const upd = await db.execute({
    sql: `UPDATE blog_post_tokens
             SET used_count = used_count + 1
           WHERE id = ?
             AND revoked_at IS NULL
             AND (max_uses IS NULL OR used_count < max_uses)`,
    args: [Number(row.id)],
  });
  if (Number(upd.rowsAffected ?? 0) === 0) return null;
  return row;
}

/**
 * No-Op-Kompat-Funktion fuer alte Aufrufer. Der atomare Consume passiert
 * jetzt direkt in `findValidTokenForPost` (siehe M1).
 */
export async function consumeTokenIfOnetime(_db, _tokenRow) {
  return;
}
