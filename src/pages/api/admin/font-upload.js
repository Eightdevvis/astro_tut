import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import {
  MAX_FONT_BYTES,
  insertCustomFont,
  sanitizeFamilyBase,
} from '../../../lib/custom-fonts.js';

const ALLOWED_EXT = new Map([
  ['.ttf', { format: 'truetype', mime: 'font/ttf' }],
  ['.otf', { format: 'opentype', mime: 'font/otf' }],
  ['.woff', { format: 'woff', mime: 'font/woff' }],
  ['.woff2', { format: 'woff2', mime: 'font/woff2' }],
]);

async function uniqueFamilyName(db, base) {
  let candidate = base;
  let i = 0;
  while (true) {
    const r = await db.execute({
      sql: 'SELECT 1 FROM custom_fonts WHERE family_name = ?',
      args: [candidate],
    });
    if (r.rows.length === 0) return candidate;
    i += 1;
    candidate = `${base} ${i}`;
  }
}

export async function POST({ request, cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || caller !== SUPERUSER) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'multipart/form-data erwartet' }), { status: 400 });
  }

  const form = await request.formData();
  const file = form.get('file');
  const labelRaw = form.get('label');

  if (!file || typeof file.arrayBuffer !== 'function') {
    return new Response(JSON.stringify({ error: 'Datei fehlt' }), { status: 400 });
  }

  const name = file.name || 'font.ttf';
  const lower = name.toLowerCase();
  let ext = '';
  for (const e of ALLOWED_EXT.keys()) {
    if (lower.endsWith(e)) {
      ext = e;
      break;
    }
  }
  if (!ext) {
    return new Response(
      JSON.stringify({ error: 'Nur .ttf, .otf, .woff, .woff2 erlaubt' }),
      { status: 400 }
    );
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.byteLength > MAX_FONT_BYTES) {
    return new Response(JSON.stringify({ error: `Maximal ${MAX_FONT_BYTES / 1024 / 1024} MB` }), {
      status: 400,
    });
  }
  if (buf.byteLength < 16) {
    return new Response(JSON.stringify({ error: 'Datei zu klein' }), { status: 400 });
  }

  const meta = ALLOWED_EXT.get(ext);
  const baseFromFile = name.slice(0, name.length - ext.length);
  const label = sanitizeFamilyBase(typeof labelRaw === 'string' ? labelRaw : baseFromFile);
  const familyBase = label || sanitizeFamilyBase(baseFromFile) || 'Uploaded';

  await ensureDbSchema();
  const db = getDb();
  const familyName = await uniqueFamilyName(db, familyBase);

  const id = await insertCustomFont({
    familyName,
    originalFilename: name,
    mimeType: meta.mime,
    formatHint: meta.format,
    data: buf,
  });

  return new Response(JSON.stringify({ success: true, id, family_name: familyName }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
