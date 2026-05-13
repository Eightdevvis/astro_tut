// scripts/migrate-md-to-db.js
//
// Migriert die Markdown-Blogposts unter src/pages/posts/*.md in die DB-Tabelle
// blog_posts unter dem Superuser 'sash'. Idempotent: Posts mit gleichem Title
// als erster Klartext-Zeile werden uebersprungen.
//
// Aufruf:
//   node scripts/migrate-md-to-db.js          # Dry-Run (zeigt was passieren wuerde)
//   node scripts/migrate-md-to-db.js --apply  # Schreibt wirklich

import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

// .env.local hat Vorrang vor .env (Convention wie bei Astro/Vite).
config({ path: '.env.local' });
config({ path: '.env' });

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = join(SCRIPT_DIR, '..', 'src', 'pages', 'posts');
const TARGET_USERNAME = 'sash';
const APPLY = process.argv.includes('--apply');

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { fm: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  const fm = {};
  for (const line of fmBlock.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  return { fm, body };
}

// Mirror von stripMarkdownLight in index.astro — minimal, fuer Snippet-Generator.
function stripMarkdownLight(src) {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pubDateToDbTimestamp(value) {
  // Frontmatter ist meist "YYYY-MM-DD". Wir mappen auf "YYYY-MM-DD 12:00:00",
  // damit die Sortierung deterministisch ist (Datum-Posts an einem fixen
  // Tageszeit-Anker, nicht 00:00:00 — verhindert dass sie nach DB-Posts
  // mit Uhrzeit "Mittag" einer existierenden Konvention reinrutschen).
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} 12:00:00`;
}

async function main() {
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error('TURSO_URL / TURSO_AUTH_TOKEN fehlen in .env.');
    process.exit(1);
  }
  const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // Sanity: User 'sash' muss existieren.
  const userCheck = await db.execute({
    sql: 'SELECT username FROM users WHERE username = ? LIMIT 1',
    args: [TARGET_USERNAME],
  });
  if ((userCheck.rows || []).length === 0) {
    console.error(`User '${TARGET_USERNAME}' existiert nicht in users.`);
    process.exit(1);
  }

  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  if (files.length === 0) {
    console.log('Keine MD-Files unter', POSTS_DIR);
    return;
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${files.length} MD-Files gefunden.\n`);

  let imported = 0;
  let skipped = 0;
  for (const file of files) {
    const raw = await readFile(join(POSTS_DIR, file), 'utf8');
    const { fm, body } = parseFrontmatter(raw);
    const title = String(fm.title || '').trim();
    const pubDate = pubDateToDbTimestamp(fm.pubDate);
    if (!title || !pubDate || !body.trim()) {
      console.log(`  SKIP ${file} — fehlender Title/Date/Body`);
      skipped += 1;
      continue;
    }

    // content_text: Title als erste Zeile + Klartext-Body (das ist was
    // posts/db/[id].astro als firstLine→Title liest und was index.astro
    // als Snippet-Quelle nutzt).
    const plainBody = stripMarkdownLight(body);
    const contentText = `${title}\n\n${plainBody}`;
    // content_html: marked vom kompletten body mit Title als h1.
    const contentHtml = marked(`# ${title}\n\n${body}`).toString();

    // Idempotenz: Post mit gleichem Title als erste Zeile + selber User → skip.
    const existing = await db.execute({
      sql: `SELECT id FROM blog_posts
            WHERE username = ?
              AND content_text LIKE ?
            LIMIT 1`,
      args: [TARGET_USERNAME, `${title}%`],
    });
    if ((existing.rows || []).length > 0) {
      console.log(`  SKIP ${file} — bereits in DB (id=${existing.rows[0].id})`);
      skipped += 1;
      continue;
    }

    console.log(`  IMPORT ${file}`);
    console.log(`         title=${title}`);
    console.log(`         pubDate=${pubDate}`);
    console.log(`         bytes html=${contentHtml.length} text=${contentText.length}`);

    if (APPLY) {
      await db.execute({
        sql: `INSERT INTO blog_posts (username, content_html, content_text, accent_color, doodle_data_url, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [TARGET_USERNAME, contentHtml, contentText, '#8dc5ff', '', pubDate],
      });
    }
    imported += 1;
  }

  console.log(`\n${APPLY ? 'Fertig' : 'Dry-Run fertig'}: ${imported} importiert, ${skipped} übersprungen.`);
  if (!APPLY && imported > 0) {
    console.log('Mit `node scripts/migrate-md-to-db.js --apply` ausführen.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
