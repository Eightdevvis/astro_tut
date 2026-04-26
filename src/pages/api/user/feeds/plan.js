import { getUsernameFromCookies } from '../../../../lib/session.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { runFeedPlanAi } from '../../../../lib/feed-plan-ai.js';

const MAX_PROMPT = 6000;

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!(await hasPermission(username, 'feed_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung für Feed.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Bitte Thema beschreiben.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (prompt.length > MAX_PROMPT) {
    return new Response(JSON.stringify({ error: `Text zu lang (max. ${MAX_PROMPT}).` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const plan = await runFeedPlanAi(username, prompt);
    return new Response(JSON.stringify(plan), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // @ts-ignore
    if (e?.code === 'NO_API_KEY') {
      return new Response(
        JSON.stringify({ error: 'KI nicht konfiguriert', detail: 'OPENAI_API_KEY fehlt.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: 'KI-Anfrage fehlgeschlagen', detail: msg.slice(0, 500) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
