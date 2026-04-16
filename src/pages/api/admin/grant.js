import { grantPermission, hasPermission, KNOWN_PERMISSIONS } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';

export async function POST({ request, cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  if (!(await hasPermission(caller, 'super_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const { username, permission } = await request.json();
  if (!username || !permission) {
    return new Response(JSON.stringify({ error: 'username und permission erforderlich' }), { status: 400 });
  }
  if (!KNOWN_PERMISSIONS.includes(permission)) {
    return new Response(JSON.stringify({ error: 'Unbekanntes Recht' }), { status: 400 });
  }

  await grantPermission(username, permission);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
