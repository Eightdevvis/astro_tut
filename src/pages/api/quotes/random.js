import { getDb } from '../../../lib/db.js';

export async function GET() {
  const db = getDb();
  const result = await db.execute('SELECT id, username, text, created_at FROM quotes ORDER BY RANDOM() LIMIT 1');
  const quote = result.rows[0] ?? null;

  return new Response(JSON.stringify({ quote }), { status: 200 });
}
