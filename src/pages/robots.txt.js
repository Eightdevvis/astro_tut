/**
 * B5 — dynamische robots.txt.
 *
 * Aufbau:
 * 1. Globaler Disallow fuer alle bekannten KI-Bots (Voreinstellung dieser
 *    Seite: KI-Training ist nicht erwuenscht). User-spezifischer
 *    block_all_ai erweitert die Liste nicht — die Liste ist hier bereits
 *    vollstaendig.
 * 2. Default-Allow fuer `User-agent: *`.
 * 3. Zusaetzliche Disallow-Zeilen fuer einzelne Posts, die per Visibility
 *    oder Privacy-Toggle nicht indexiert werden sollen.
 *
 * Wichtig: das ist die *Hoeflichkeits-Schicht*. Echte Bot-Faelscher
 * ignorieren das; gegen die wirkt das UA-Gate (B4) plus Rate-Limit/Login.
 */

import { ensureDbSchema, getDb } from '../lib/db.js';
import { botsInCategory } from '../lib/bot-fingerprints.js';
import { computeEffectivePrivacy } from '../lib/blog-privacy.js';
import { getFullHiddenUsernames } from '../lib/user-privacy-defaults.js';

export async function GET() {
  const aiBots = botsInCategory('ai');
  const lines = [];

  for (const bot of aiBots) {
    lines.push(`User-agent: ${bot}`);
    lines.push('Disallow: /');
    lines.push('');
  }

  lines.push('User-agent: *');
  lines.push('Allow: /');

  try {
    await ensureDbSchema();
    const hidden = await getFullHiddenUsernames();
    const r = await getDb().execute(
      `SELECT id, username, public_slug, visibility, privacy_flags
         FROM blog_posts
        WHERE deleted_at IS NULL
        ORDER BY id ASC`
    );
    for (const row of r.rows || []) {
      const isHidden = hidden.has(String(row.username || ''));
      const eff = computeEffectivePrivacy({
        visibility: row.visibility,
        privacyFlags: row.privacy_flags,
      });
      if (!isHidden && !eff.noindex) continue;
      const slug = row.public_slug ? String(row.public_slug) : null;
      const key = slug || String(row.id);
      lines.push(`Disallow: /posts/db/${key}`);
    }
  } catch (err) {
    console.error('robots.txt build', err);
  }

  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
