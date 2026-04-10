import { getUsernameFromCookies } from '../../../lib/session.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { SAMPLE_RPG_QUESTS, SAMPLE_RPG_GRAPH } from '../../../lib/rpg-quests-data.js';

/**
 * GET /api/rpg/quests — Quest-JSON für den RPG-Hub (Superuser only).
 * Später: aus DB oder KI-Pipeline; Form bleibt kompatibel.
 */
export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ...SAMPLE_RPG_QUESTS, graph: SAMPLE_RPG_GRAPH }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
