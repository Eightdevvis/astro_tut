/**
 * B6 — sitemap.xml. Listet nur Posts, die wirklich oeffentlich UND
 * indexierbar sind (visibility=public UND nicht noindex). Soft-deleted
 * sind ohnehin draussen.
 *
 * Statische Seiten wie / und /blog bleiben einfach drin; bei Bedarf hier
 * erweitern.
 */

import { ensureDbSchema, getDb } from '../lib/db.js';
import { computeEffectivePrivacy } from '../lib/blog-privacy.js';
import { getFullHiddenUsernames } from '../lib/user-privacy-defaults.js';

function siteOrigin() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  if (process.env.VERCEL && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:4321';
}

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const origin = siteOrigin();
  const entries = [
    { loc: `${origin}/`, lastmod: null },
    { loc: `${origin}/blog`, lastmod: null },
    { loc: `${origin}/blogpost`, lastmod: null },
  ];

  try {
    await ensureDbSchema();
    const hidden = await getFullHiddenUsernames();
    const r = await getDb().execute(
      `SELECT id, username, public_slug, visibility, privacy_flags, created_at
         FROM blog_posts
        WHERE deleted_at IS NULL AND visibility = 'public'
        ORDER BY datetime(created_at) DESC`
    );
    for (const row of r.rows || []) {
      if (hidden.has(String(row.username || ''))) continue;
      const eff = computeEffectivePrivacy({
        visibility: row.visibility,
        privacyFlags: row.privacy_flags,
      });
      if (eff.noindex) continue;
      const key = row.public_slug ? String(row.public_slug) : String(row.id);
      entries.push({
        loc: `${origin}/posts/db/${key}`,
        lastmod: String(row.created_at || '').slice(0, 10) || null,
      });
    }
  } catch (err) {
    console.error('sitemap.xml build', err);
  }

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((e) => {
      const lastmod = e.lastmod ? `<lastmod>${escXml(e.lastmod)}</lastmod>` : '';
      return `<url><loc>${escXml(e.loc)}</loc>${lastmod}</url>`;
    }),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
