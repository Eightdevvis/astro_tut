import {
  setGlobalPermission,
  hasPermission,
  KNOWN_PERMISSIONS,
  SUPER_PERMISSION,
} from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';

export async function POST({ request, cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }
  if (!(await hasPermission(caller, 'super_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const { permission, active } = await request.json();
  if (!permission || typeof active !== 'boolean') {
    return new Response(
      JSON.stringify({ error: 'permission (string) und active (boolean) erforderlich' }),
      { status: 400 }
    );
  }
  if (!KNOWN_PERMISSIONS.includes(permission)) {
    return new Response(JSON.stringify({ error: 'Unbekanntes Recht' }), { status: 400 });
  }
  if (permission === SUPER_PERMISSION && active) {
    return new Response(
      JSON.stringify({ error: 'super_access kann nicht global aktiviert werden' }),
      { status: 400 }
    );
  }

  await setGlobalPermission(permission, active);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
