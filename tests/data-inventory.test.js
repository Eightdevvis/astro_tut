/**
 * Lint-Test: jede CREATE TABLE aus src/lib/db.js MUSS in
 * src/lib/data-inventory.js dokumentiert sein — sonst faellt der Test rot
 * und Sasha kann nicht versehentlich eine neue Tabelle anlegen, ohne den
 * Datenschutz-Tab mitzuziehen.
 *
 * Zusatz: jede in data-inventory.js erwaehnte Tabelle muss auch wirklich
 * im DDL stehen — sonst veraltete Eintraege.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractCreateTables(sql) {
  const tables = new Set();
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    tables.add(m[1]);
  }
  return tables;
}

test('data-inventory deckt jede DB-Tabelle aus db.js ab', async () => {
  const dbSrc = readFile('src/lib/db.js');
  const inventorySrc = readFile('src/lib/data-inventory.js');
  const ddlTables = extractCreateTables(dbSrc);

  // Tabellen aus dem Inventar extrahieren (table: 'name')
  const invTables = new Set();
  const invRe = /\btable:\s*'([a-zA-Z_][a-zA-Z0-9_]*)'/g;
  let m;
  while ((m = invRe.exec(inventorySrc)) !== null) {
    invTables.add(m[1]);
  }

  // Jede DDL-Tabelle muss im Inventar sein.
  for (const t of ddlTables) {
    assert.ok(
      invTables.has(t),
      `DB-Tabelle "${t}" ist in src/lib/db.js definiert, aber NICHT in src/lib/data-inventory.js dokumentiert. ` +
      `Bitte Eintrag ergaenzen (Pflicht fuer Datenschutz-Details-Tab).`
    );
  }

  // Jede Inventar-Tabelle muss auch wirklich im DDL stehen.
  for (const t of invTables) {
    assert.ok(
      ddlTables.has(t),
      `data-inventory.js erwaehnt "${t}", aber keine CREATE TABLE in src/lib/db.js. ` +
      `Entweder Eintrag streichen oder DDL hinzufuegen.`
    );
  }
});
