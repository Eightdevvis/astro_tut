// scripts/seed-placed-items.js
//
// Legt die drei Seed-Items als "liegende Items" auf / ab, damit das
// Inventar-System einen organischen Einstieg hat. Idempotent: prüft pro
// item_id, ob auf / bereits eines liegt (wenn ja → skip dieses Item).
//
//   node scripts/seed-placed-items.js          # Dry-Run
//   node scripts/seed-placed-items.js --apply

import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

const APPLY = process.argv.includes('--apply');
const PAGE = '/';

// Positionen verteilt unter dem Hero-Titel auf der Startseite.
// Y bei ~50% des Viewports (in CSS-px page-relative), X gefächert.
const PLACED = [
  { itemId: 'marker_black', x: 200, y: 520 },
  { itemId: 'spray_black', x: 480, y: 540 },
  { itemId: 'sponge_eraser', x: 760, y: 510 },
];

async function main() {
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error('TURSO_URL / TURSO_AUTH_TOKEN fehlen in .env(.local).');
    process.exit(1);
  }
  const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — page=${PAGE}, ${PLACED.length} Items.`);

  for (const p of PLACED) {
    const existing = await db.execute({
      sql: 'SELECT id FROM site_placed_items WHERE page_path = ? AND item_id = ? LIMIT 1',
      args: [PAGE, p.itemId],
    });
    if ((existing.rows || []).length > 0) {
      console.log(`  SKIP ${p.itemId} — liegt schon auf ${PAGE} (id=${existing.rows[0].id})`);
      continue;
    }
    console.log(`  PLACE ${p.itemId} @ (${p.x}, ${p.y})`);
    if (!APPLY) continue;
    await db.execute({
      sql: `INSERT INTO site_placed_items (page_path, item_id, x, y, placed_by)
            VALUES (?, ?, ?, ?, 'system')`,
      args: [PAGE, p.itemId, p.x, p.y],
    });
  }

  if (!APPLY) console.log('\nMit `node scripts/seed-placed-items.js --apply` ausführen.');
  else console.log('\nFertig.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
