import { getDb, ensureDbSchema } from './db.js';

const MAX_FONT_BYTES = 2 * 1024 * 1024;

export { MAX_FONT_BYTES };

/**
 * @returns {Promise<Array<{ id: number, family_name: string, original_filename: string, mime_type: string, format_hint: string }>>}
 */
export async function listCustomFontsMeta() {
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT id, family_name, original_filename, mime_type, format_hint FROM custom_fonts ORDER BY id ASC',
  });
  return r.rows.map((row) => ({
    id: row.id,
    family_name: row.family_name,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    format_hint: row.format_hint,
  }));
}

/**
 * @returns {Promise<{ data: Uint8Array, mime_type: string, format_hint: string, family_name: string } | null>}
 */
export async function getCustomFontBlob(id) {
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT data, mime_type, format_hint, family_name FROM custom_fonts WHERE id = ?',
    args: [id],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    data: row.data,
    mime_type: row.mime_type,
    format_hint: row.format_hint,
    family_name: row.family_name,
  };
}

/**
 * @param {{ familyName: string, originalFilename: string, mimeType: string, formatHint: string, data: Uint8Array }} p
 */
export async function insertCustomFont(p) {
  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO custom_fonts (family_name, original_filename, mime_type, format_hint, data)
          VALUES (?, ?, ?, ?, ?)`,
    args: [p.familyName, p.originalFilename, p.mimeType, p.formatHint, p.data],
  });
  const last = await db.execute({ sql: 'SELECT last_insert_rowid() AS id' });
  return Number(last.rows[0]?.id ?? 0);
}

export function sanitizeFamilyBase(name) {
  const s = String(name || '')
    .trim()
    .slice(0, 60)
    .replace(/['"<>]/g, '')
    .replace(/\s+/g, ' ');
  return s || 'Uploaded';
}
