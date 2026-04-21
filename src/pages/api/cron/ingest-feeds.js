import { ingestAllFeedsRoundRobin } from '../../../lib/feed-ingest.js';
import { summarizeFeedsRoundRobin } from '../../../lib/feed-summary-ai.js';

function cronAuthorized(request) {
  const secret = String(import.meta.env.CRON_SECRET ?? '').trim();
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

/**
 * POST /api/cron/ingest-feeds — Vercel Cron + optional manuell mit CRON_SECRET.
 */
export async function POST({ request }) {
  if (!cronAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    await ingestAllFeedsRoundRobin({ maxFeeds: 24 });
    const summaries = await summarizeFeedsRoundRobin({ max: 8 });
    return new Response(JSON.stringify({ ok: true, summaries_generated: summaries }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg.slice(0, 500) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function GET({ request }) {
  return POST({ request });
}
