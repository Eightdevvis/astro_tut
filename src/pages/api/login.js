import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { getDb } from '../../lib/db.js';

const JWT_SECRET = new TextEncoder().encode(import.meta.env.JWT_SECRET);

export async function POST({ request, cookies }) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Alle Felder ausfüllen' }), { status: 400 });
  }

  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE username = ?',
    args: [username]
  });
  const user = result.rows[0];

  if (!user) {
    return new Response(JSON.stringify({ error: 'User nicht gefunden' }), { status: 404 });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Falsches Passwort' }), { status: 401 });
  }

  const token = await new SignJWT({ username: user.username, birthday: user.birthday })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  cookies.set('session', token, { httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7 });

  return new Response(
    JSON.stringify({ success: true, user: { username: user.username, birthday: user.birthday } }),
    { status: 200 }
  );
}
