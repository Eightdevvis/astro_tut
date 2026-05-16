import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';
import { getUserPrivacyDefaults, upsertUserPrivacyDefaults } from '../../../lib/user-privacy-defaults.js';

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

export async function GET({ cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  try {
    const d = await getUserPrivacyDefaults(auth.username);
    return json({ defaults: d });
  } catch (err) {
    console.error('user/privacy-defaults GET', err);
    return json({ error: 'Laden fehlgeschlagen' }, 500);
  }
}

export async function PUT({ request, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Ungültiger JSON-Body' }, 400); }
  try {
    const next = await upsertUserPrivacyDefaults(auth.username, body || {});
    return json({ success: true, defaults: next });
  } catch (err) {
    console.error('user/privacy-defaults PUT', err);
    return json({ error: 'Speichern fehlgeschlagen' }, 500);
  }
}
