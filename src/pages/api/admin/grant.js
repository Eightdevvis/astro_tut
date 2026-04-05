import { jwtVerify } from 'jose';
import { grantPermission } from '../../../lib/permissions.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';
const SUPERUSER = 'sash';

export async function POST({ request, cookies }) {
  const token = cookies.get('session')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  let caller;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    caller = payload.username;
  } catch {
    return new Response(JSON.stringify({ error: 'Session ungültig' }), { status: 401 });
  }

  if (caller !== SUPERUSER) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const { username, permission } = await request.json();
  if (!username || !permission) {
    return new Response(JSON.stringify({ error: 'username und permission erforderlich' }), { status: 400 });
  }

  await grantPermission(username, permission);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
