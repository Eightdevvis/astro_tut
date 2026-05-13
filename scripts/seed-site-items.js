// scripts/seed-site-items.js
//
// Befüllt site_item_catalog mit den drei Start-Items (Marker, Spraydose,
// Schwamm), die bisher in GraffitiLayer.jsx hartcodiert waren. Idempotent
// via INSERT OR REPLACE — kann beliebig oft laufen.
//
// Aufruf:
//   node scripts/seed-site-items.js          # Dry-Run
//   node scripts/seed-site-items.js --apply  # Schreibt wirklich

import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

const APPLY = process.argv.includes('--apply');

const SEED_ITEMS = [
  {
    id: 'marker_black',
    kind: 'pen',
    variant: 'black',
    name: 'Schwarzer Marker',
    description: 'Klassischer Strich-Tag in Schwarz.',
    behavior: 'draw',
    config: { strokeMode: 'tag', color: '#111111' },
    sortOrder: 10,
  },
  {
    id: 'spray_black',
    kind: 'graffiti',
    variant: 'black',
    name: 'Schwarze Spraydose',
    description: 'Klassischer Spray-Effekt in Schwarz.',
    behavior: 'draw',
    config: { strokeMode: 'spray', color: '#111111' },
    sortOrder: 20,
  },
  {
    id: 'sponge_eraser',
    kind: 'eraser',
    variant: 'sponge',
    name: 'Schwamm',
    description: 'Wischt vorhandene Graffiti-Striche weg.',
    behavior: 'draw',
    config: { strokeMode: 'erase' },
    sortOrder: 30,
  },
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

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${SEED_ITEMS.length} Items.`);
  for (const item of SEED_ITEMS) {
    console.log(`  ${item.id}  kind=${item.kind} behavior=${item.behavior} config=${JSON.stringify(item.config)}`);
  }

  if (!APPLY) {
    console.log('\nMit `node scripts/seed-site-items.js --apply` ausführen.');
    return;
  }

  // Tabelle anlegen, falls die Cloud-DB sie noch nicht hat (Server tut das
  // sonst erst beim ersten App-Request via ensureDbSchema).
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS site_item_catalog (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      variant      TEXT NOT NULL DEFAULT '',
      name         TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      behavior     TEXT NOT NULL DEFAULT 'none',
      config_json  TEXT NOT NULL DEFAULT '{}',
      enabled      INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_site_item_catalog_kind_sort ON site_item_catalog (kind, sort_order, id);
  `);

  for (const item of SEED_ITEMS) {
    await db.execute({
      sql: `INSERT INTO site_item_catalog
            (id, kind, variant, name, description, behavior, config_json, enabled, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(id) DO UPDATE SET
              kind = excluded.kind,
              variant = excluded.variant,
              name = excluded.name,
              description = excluded.description,
              behavior = excluded.behavior,
              config_json = excluded.config_json,
              enabled = excluded.enabled,
              sort_order = excluded.sort_order`,
      args: [
        item.id,
        item.kind,
        item.variant,
        item.name,
        item.description,
        item.behavior,
        JSON.stringify(item.config),
        item.sortOrder,
      ],
    });
  }
  console.log(`\nFertig: ${SEED_ITEMS.length} Items upserted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
