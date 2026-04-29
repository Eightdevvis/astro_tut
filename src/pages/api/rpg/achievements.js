/**
 * GET  /api/rpg/achievements?q=&limit=   — Suche (kein Auth nötig)
 * POST /api/rpg/achievements              — Neu anlegen (Login erforderlich)
 *   Body: { title: string; description?: string }
 */

import { getUsernameFromCookies } from '../../../lib/session.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { searchAchievements, upsertAchievement } from '../../../lib/rpg-achievement-catalog-db.js';

export async function GET({ url }) {
  await ensureDbSchema();
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 8, 1), 30);
  const achievements = await searchAchievements(q, limit);
  return new Response(JSON.stringify({ achievements }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Login erforderlich' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiges JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const title = String(body?.title || '').trim();
  if (!title) {
    return new Response(JSON.stringify({ error: 'title erforderlich' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await ensureDbSchema();
  try {
    const achievement = await upsertAchievement({ title, description: body?.description });
    return new Response(JSON.stringify({ ok: true, achievement }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
