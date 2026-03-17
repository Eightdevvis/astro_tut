import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { getDb } from '../../lib/db.js';

const JWT_SECRET = new TextEncoder().encode(import.meta.env.JWT_SECRET);

export async function POST({ request, cookies }) {
  const { username, birthday, password } = await request.json();

  if (!username || !birthday || !password) {
    return new Response(JSON.stringify({ error: 'Alle Felder ausfüllen' }), { status: 400 });
  }

  const db = getDb();

  const exists = await db.execute({
    sql: 'SELECT id FROM users WHERE username = ?',
    args: [username]
  });
  if (exists.rows.length > 0) {
    return new Response(JSON.stringify({ error: 'Username existiert schon' }), { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  await db.execute({
    sql: 'INSERT INTO users (username, birthday, password) VALUES (?, ?, ?)',
    args: [username, birthday, hash]
  });

  const token = await new SignJWT({ username, birthday })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  cookies.set('session', token, { httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7 });

  return new Response(
    JSON.stringify({ success: true, user: { username, birthday } }),
    { status: 201 }
  );
}
