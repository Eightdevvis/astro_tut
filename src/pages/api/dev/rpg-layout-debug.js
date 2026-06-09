/**
 * Nur in DEV: Client sendet Layout-Telemetrie (z. B. iPhone vs. Desktop),
 * damit Logs in .cursor/debug-*.log landen — fetch zu localhost:7537 geht auf dem Gerät nicht.
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export async function POST({ request }) {
  if (!import.meta.env.DEV) {
    return new Response(null, { status: 404 });
  }
  try {
    const body = await request.json();
    const line = `${JSON.stringify(body)}\n`;
    appendFileSync(join(process.cwd(), '.cursor', 'debug-414c7b.log'), line, 'utf8');
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
