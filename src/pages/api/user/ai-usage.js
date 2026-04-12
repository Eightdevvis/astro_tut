import { getUsernameFromCookies } from '../../../lib/session.js';
import { getAiUsageReportForUser } from '../../../lib/ai-usage-db.js';

/**
 * GET /api/user/ai-usage — Aggregierte KI-Nutzung für den eingeloggten User.
 */
export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const report = await getAiUsageReportForUser(username);
  return new Response(JSON.stringify(report), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
