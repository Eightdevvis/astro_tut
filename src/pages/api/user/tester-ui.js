import { hasPermission } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { getTesterUiPreference, setTesterUiPreference } from '../../../lib/tester-ui-preference.js';

async function canControlTesterUi(username) {
  if (!username) return false;
  return hasPermission(username, 'tester_access');
}

export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }
  const allowed = await canControlTesterUi(username);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }
  const enabled = await getTesterUiPreference(username);
  return new Response(JSON.stringify({ enabled }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }
  const allowed = await canControlTesterUi(username);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean') {
    return new Response(JSON.stringify({ error: 'enabled muss boolean sein' }), { status: 400 });
  }
  await setTesterUiPreference(username, body.enabled);
  return new Response(JSON.stringify({ success: true, enabled: body.enabled }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
