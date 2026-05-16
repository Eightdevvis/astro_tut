/**
 * GET /api/search?q=<query>
 *
 * Sucht in oeffentlichen Blogposts (content_text LIKE) und Usern (username +
 * display_name LIKE). Full-hidden User werden vollstaendig ausgeblendet —
 * sie tauchen weder als User-Treffer auf noch deren Posts.
 *
 * Antwort: { posts: [...], users: [...] }
 * - posts: bis zu 5 oeffentliche Posts mit { id, slug, snippet, date }
 * - users: bis zu 5 mit { username, displayName }
 *
 * Kein Login noetig — Ergebnisse sind eh nur oeffentliche Daten.
 */
import { ensureDbSchema, getDb } from '../../lib/db.js';
import { getFullHiddenUsernames } from '../../lib/user-privacy-defaults.js';

const MAX_RESULTS = 5;
const SNIPPET_LEN = 220;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (ch) => '\\' + ch);
}

// Zufaelliger roher Textausschnitt — KEINE "…"-Markierungen, KEIN
// Titel-/Datum-Voranstellen. Soll wirken wie ein zufaellig aufgemachtes
// Fenster auf den Post: am Anfang faengt evtl. mitten im Wort an
// (Word-Boundary-Skip ist optional am Start), am Ende hart abgeschnitten —
// das visuelle Crop macht das CSS-overflow:hidden.
function pickRandomSnippet(plain, length = SNIPPET_LEN) {
  const text = String(plain || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= length) return text;
  const maxStart = text.length - length;
  const rawStart = Math.floor(Math.random() * (maxStart + 1));
  // Zum naechsten Wortanfang springen, damit das erste Wort lesbar ist.
  const spaceAfter = text.indexOf(' ', rawStart);
  const start = rawStart === 0
    ? 0
    : (spaceAfter > -1 && spaceAfter - rawStart < 30 ? spaceAfter + 1 : rawStart);
  return text.slice(start, start + length);
}

// Versuche, einen Snippet zu schneiden, der das Suchwort enthaelt — sonst
// fall back auf einen zufaelligen Schnitt.
function snippetAroundMatch(plain, query, length = SNIPPET_LEN) {
  const text = String(plain || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= length) return text;
  const q = String(query || '').trim();
  if (!q) return pickRandomSnippet(text, length);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return pickRandomSnippet(text, length);
  // Snippet um den Treffer zentrieren
  const half = Math.floor((length - q.length) / 2);
  let start = Math.max(0, idx - half);
  if (start + length > text.length) start = Math.max(0, text.length - length);
  // Wortgrenzen suchen
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp > -1 && sp - start < 40) start = sp + 1;
  }
  const slice = text.slice(start, start + length);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = lastSpace > length * 0.6 ? slice.slice(0, lastSpace) : slice;
  const prefix = start > 0 ? '… ' : '';
  const suffix = start + length < text.length ? ' …' : '';
  return `${prefix}${trimmed.trim()}${suffix}`;
}

function titleFromText(text, id) {
  const firstLine = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine?.slice(0, 90) || `Post #${id}`;
}

export async function GET({ url }) {
  const qRaw = String(url?.searchParams?.get('q') ?? '').trim();
  if (!qRaw) {
    return jsonResponse({ posts: [], users: [] });
  }
  const q = qRaw.slice(0, 120);
  const like = `%${escapeLike(q)}%`;

  try {
    await ensureDbSchema();
    const hidden = await getFullHiddenUsernames();
    const db = getDb();

    // === Posts ===
    const postRes = await db.execute({
      sql: `SELECT id, username, public_slug, content_text, created_at
              FROM blog_posts
             WHERE deleted_at IS NULL
               AND visibility = 'public'
               AND content_text LIKE ? ESCAPE '\\'
             ORDER BY datetime(created_at) DESC, id DESC
             LIMIT ?`,
      args: [like, MAX_RESULTS * 4],
    });
    const posts = (postRes.rows ?? [])
      .filter((row) => !hidden.has(String(row.username || '')))
      .slice(0, MAX_RESULTS)
      .map((row) => {
        const id = Number(row.id ?? 0);
        const slug = row.public_slug ? String(row.public_slug) : null;
        const text = String(row.content_text ?? '');
        return {
          id,
          slug,
          url: id > 0 ? `/posts/db/${slug || id}` : '',
          snippet: pickRandomSnippet(text),
        };
      })
      .filter((p) => p.id > 0);

    // === Users ===
    const userRes = await db.execute({
      sql: `SELECT username, display_name
              FROM users
             WHERE (username LIKE ? ESCAPE '\\' OR COALESCE(display_name, '') LIKE ? ESCAPE '\\')
             ORDER BY username ASC
             LIMIT ?`,
      args: [like, like, MAX_RESULTS * 4],
    });
    const users = (userRes.rows ?? [])
      .filter((row) => !hidden.has(String(row.username || '')))
      .slice(0, MAX_RESULTS)
      .map((row) => ({
        username: String(row.username || ''),
        displayName: String(row.display_name || row.username || ''),
        url: `/users/${encodeURIComponent(String(row.username || ''))}`,
      }))
      .filter((u) => u.username);

    return jsonResponse({ posts, users });
  } catch (err) {
    console.error('search GET', err);
    return jsonResponse({ error: 'Suche fehlgeschlagen' }, 500);
  }
}
