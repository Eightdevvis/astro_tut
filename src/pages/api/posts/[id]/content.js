/**
 * Inhalts-API fuer JS-only-Render (B21).
 *
 * Liefert nur das gerenderte content_html eines Posts — wendet aber dieselben
 * Gates an wie die Detail-Route (Visibility, Token, Passwort, Expire,
 * UA-Gate, full_hidden des Autors), damit JS-only kein Gate-Bypass wird.
 */

import bcrypt from 'bcryptjs';
import { getDb, ensureDbSchema } from '../../../../lib/db.js';
import {
  computeEffectivePrivacy,
  isValidPublicSlug,
  rewriteOutboundLinks,
} from '../../../../lib/blog-privacy.js';
import { classifyUserAgent } from '../../../../lib/bot-fingerprints.js';
import {
  consumeTokenIfOnetime,
  findValidTokenForPost,
} from '../../../../lib/blog-tokens.js';
import { extractClientMeta, hashIp, safeLogRequest } from '../../../../lib/request-log.js';
import { isAuthorBlockAllAi } from '../../../../lib/user-privacy-defaults.js';
import { getSessionUserFromCookies } from '../../../../lib/session.js';
import { checkPasswordAttemptLimit, checkRateLimit } from '../../../../lib/rate-limit.js';
import { sanitizePostHtml } from '../../../../lib/sanitize-html.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function GET({ params, url, request, cookies, clientAddress }) {
  const rawId = String(params?.id ?? '').trim();
  const asInteger = Number(rawId);
  const isIntegerLookup = Number.isInteger(asInteger) && asInteger > 0;
  const isSlugLookup = isValidPublicSlug(rawId);
  if (!isIntegerLookup && !isSlugLookup) return json({ error: 'Ungültige ID' }, 400);

  await ensureDbSchema();
  const db = getDb();

  // K3: Rate-Limit auch auf dem JS-only-Render-Pfad. Sonst koennte ein
  // Angreifer hier beliebig viele Passwoerter durchprobieren, weil das
  // Gate auf der .astro-Seite ihn nicht erreicht.
  const clientMetaEarly = extractClientMeta(request, clientAddress);
  const rl = await checkRateLimit({ ipHash: hashIp(clientMetaEarly.ip) });
  if (!rl.allowed) {
    void safeLogRequest({
      path: `/api/posts/${rawId}/content`,
      postId: null, username: null,
      ua: clientMetaEarly.ua, ip: clientMetaEarly.ip,
      country: clientMetaEarly.country, referer: clientMetaEarly.referer,
      status: 429, blockedReason: 'rate_limit',
    });
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  const r = await db.execute({
    sql: isSlugLookup
      ? `SELECT id, username, content_html, visibility, privacy_flags,
                public_slug, password_hash, expires_at
           FROM blog_posts
          WHERE public_slug = ? AND deleted_at IS NULL LIMIT 1`
      : `SELECT id, username, content_html, visibility, privacy_flags,
                public_slug, password_hash, expires_at
           FROM blog_posts
          WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    args: isSlugLookup ? [rawId] : [asInteger],
  });
  const row = r.rows?.[0];
  if (!row) return json({ error: 'not_found' }, 404);

  const client = clientMetaEarly;

  // Expire
  if (row.expires_at) {
    const now = new Date().toISOString();
    if (String(row.expires_at) <= now) {
      void safeLogRequest({ path: `/api/posts/${rawId}/content`, postId: Number(row.id), username: String(row.username), ua: client.ua, ip: client.ip, country: client.country, referer: client.referer, status: 410, blockedReason: 'expired' });
      return json({ error: 'expired' }, 410);
    }
  }

  // Token-Gate
  const tokenParam = url.searchParams.get('key') || '';
  let tokenRowForConsume = null;
  let tokenUnlocked = false;
  if (tokenParam) {
    tokenRowForConsume = await findValidTokenForPost(db, {
      post: { id: Number(row.id), username: String(row.username) },
      providedToken: tokenParam,
    });
    if (tokenRowForConsume) tokenUnlocked = true;
  }

  // Visibility/Password-Gate
  if (!tokenUnlocked) {
    if (row.visibility === 'private') {
      const sess = await getSessionUserFromCookies(cookies);
      if (!sess || sess.username !== String(row.username)) {
        void safeLogRequest({ path: `/api/posts/${rawId}/content`, postId: null, username: null, ua: client.ua, ip: client.ip, country: client.country, referer: client.referer, status: 404, blockedReason: 'private_no_auth' });
        return json({ error: 'not_found' }, 404);
      }
    } else if (row.visibility === 'password') {
      const sess = await getSessionUserFromCookies(cookies);
      const pwParam = url.searchParams.get('pw') || '';
      let ok = false;
      if (sess && sess.username === String(row.username)) {
        ok = true;
      } else if (row.password_hash && pwParam) {
        // H2: PW-Counter pro (IP-Hash × Post).
        const pwLimit = await checkPasswordAttemptLimit({
          ipHash: hashIp(client.ip),
          postId: Number(row.id),
        });
        if (pwLimit.allowed) {
          try { ok = await bcrypt.compare(pwParam, String(row.password_hash)); } catch {}
        }
      }
      if (!ok) {
        // Fehl-Versuch mit postId loggen — Counter sieht den Eintrag.
        void safeLogRequest({
          path: `/api/posts/${rawId}/content`,
          postId: Number(row.id),
          username: String(row.username),
          ua: client.ua, ip: client.ip, country: client.country, referer: client.referer,
          status: 404, blockedReason: 'password_required',
        });
        return json({ error: 'not_found' }, 404);
      }
    }
  }

  // UA-Gate (mit C7-Erweiterung)
  const effective = computeEffectivePrivacy({ visibility: row.visibility, privacyFlags: row.privacy_flags });
  if (await isAuthorBlockAllAi(String(row.username))) {
    effective.uaGateBlock.add('ai');
    effective.uaGateBlock.add('archive');
  }
  if (effective.uaGateBlock.size > 0) {
    const { category, botName } = classifyUserAgent(client.ua);
    if (effective.uaGateBlock.has(category)) {
      void safeLogRequest({ path: `/api/posts/${rawId}/content`, postId: Number(row.id), username: String(row.username), ua: client.ua, ip: client.ip, country: client.country, referer: client.referer, status: 403, blockedReason: `ua_gate:${botName || category}` });
      return json({ error: 'forbidden' }, 403);
    }
  }

  // K1 Defense-in-depth: sanitisieren auch hier, falls altes
  // vor-Sanitize-HTML in der DB liegt.
  let html = sanitizePostHtml(String(row.content_html || ''));
  if (effective.noReferrer) {
    html = rewriteOutboundLinks(html);
  }

  void safeLogRequest({ path: `/api/posts/${rawId}/content`, postId: Number(row.id), username: String(row.username), ua: client.ua, ip: client.ip, country: client.country, referer: client.referer, status: 200 });

  if (tokenRowForConsume && tokenRowForConsume.kind === 'onetime') {
    try { await consumeTokenIfOnetime(db, tokenRowForConsume); } catch {}
  }

  return new Response(JSON.stringify({ contentHtml: html }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
