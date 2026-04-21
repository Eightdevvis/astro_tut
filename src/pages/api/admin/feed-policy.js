import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { ensureDbSchema, getDb } from '../../../lib/db.js';
import {
  seedFeedPolicyDefaults,
  adminListAllowlist,
  adminListBlocklist,
  adminAddAllowlist,
  adminRemoveAllowlist,
  adminAddBlocklist,
  adminRemoveBlocklist,
} from '../../../lib/feed-policy.js';

export async function GET({ cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || !(await hasPermission(caller, 'super_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }
  await ensureDbSchema();
  const db = getDb();
  await seedFeedPolicyDefaults(db);
  const allowlist = await adminListAllowlist(db);
  const blocklist = await adminListBlocklist(db);
  return new Response(JSON.stringify({ allowlist, blocklist }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || !(await hasPermission(caller, 'super_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }

  await ensureDbSchema();
  const db = getDb();

  const action = String(body?.action || '');
  try {
    if (action === 'add_allow') {
      await adminAddAllowlist(db, {
        kind: body.kind,
        value: body.value,
        category: body.category,
        trust_tier: body.trust_tier,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (action === 'remove_allow') {
      const id = Number(body?.id);
      if (!Number.isFinite(id)) throw new Error('id fehlt');
      await adminRemoveAllowlist(db, id);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (action === 'add_block') {
      await adminAddBlocklist(db, String(body?.host_pattern || ''));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (action === 'remove_block') {
      const id = Number(body?.id);
      if (!Number.isFinite(id)) throw new Error('id fehlt');
      await adminRemoveBlocklist(db, id);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Unbekannte action' }), { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
