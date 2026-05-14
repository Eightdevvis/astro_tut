/**
 * Regressions-Test: Tablet-Modus des GraffitiLayer braucht `touch-action: none`
 * im aktiven Zustand. Ohne diese CSS-Regel klaut der Browser auf Touch-Devices
 * den ersten Drag fuer Scroll/Pinch und feuert sofort `pointercancel` — der
 * Strich bricht ab bevor er anfaengt.
 *
 * Warum ein Text-Level-Test und kein DOM-Test:
 *   - Die Test-Suite hier laeuft mit `node --test` ohne JSDOM/Browser.
 *   - Die Regel sitzt als statischer String im JSX-`<style>`-Block.
 *   - Was wir hier schuetzen wollen, ist NICHT Browser-Verhalten (das muss am
 *     Tablet manuell verifiziert werden), sondern: "die Zeile bleibt drin und
 *     bezieht sich auf den is-active-Block".
 *
 * Falls jemand das Stylesheet refactored (z.B. CSS in eine eigene Datei
 * extrahiert), muss dieser Test entsprechend mitgezogen werden — der Pfad
 * unten ist die einzige Quelle der Wahrheit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAFFITI_LAYER_PATH = resolve(__dirname, '../src/components/GraffitiLayer.jsx');

/**
 * Extrahiert den CSS-Body fuer einen gegebenen Selector aus einem Quelltext.
 * Bewusst simpel: matched die erste Vorkommen-Stelle, kein Nested-Block-Support.
 * Reicht fuer flache CSS-Bloecke wie in unserem `<style>{...}</style>`.
 */
function extractCssBlock(source, selector) {
  // Selector im String suchen, dann das naechste `{...}`-Paar greifen.
  // Wir escapen den Selector fuer den Regex, damit `.` und Punkte nicht
  // als Wildcard zaehlen.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'm');
  const m = source.match(re);
  return m ? m[1] : null;
}

test('GraffitiLayer.is-active enthaelt touch-action: none (Tablet-Regression)', () => {
  const src = readFileSync(GRAFFITI_LAYER_PATH, 'utf8');
  const block = extractCssBlock(src, '.fgraffiti-canvas.is-active');
  assert.ok(
    block !== null,
    'Selector `.fgraffiti-canvas.is-active` nicht im Quelltext gefunden — wurde das CSS extrahiert/umgebaut? Dann diesen Test mitziehen.'
  );
  // Whitespace-tolerant: `touch-action:none` und `touch-action: none` beide ok.
  const normalized = block.replace(/\s+/g, ' ');
  assert.match(
    normalized,
    /touch-action\s*:\s*none/,
    'touch-action: none fehlt im .is-active-Block. Ohne diese Regel bricht Touch-Drawing auf Tablets sofort ab (Browser scrollt statt zu malen).'
  );
});

test('extractCssBlock-Helper findet vorhandene Bloecke und gibt null fuer fehlende', () => {
  // Sanity-Check, damit der eigentliche Regression-Test nicht still gruen wird,
  // falls der Helper bricht.
  const fixture = '.a { color: red; } .b { color: blue; }';
  assert.equal(extractCssBlock(fixture, '.a').trim(), 'color: red;');
  assert.equal(extractCssBlock(fixture, '.b').trim(), 'color: blue;');
  assert.equal(extractCssBlock(fixture, '.c'), null);
});

test('GraffitiLayer sperrt dokumentweiten Scroll wenn Tool aktiv ist', () => {
  // Begleit-Regel zum CSS-Fix: Da `touch-action: none` auf dem Canvas allein
  // auf Android Chrome nicht zuverlaessig greift, muss zusaetzlich html+body
  // touch-action gesetzt werden solange `enabled` ist. Bei Cleanup MUSS der
  // vorherige Wert restored werden — sonst kapern wir den Style global.
  const src = readFileSync(GRAFFITI_LAYER_PATH, 'utf8');
  // Wir akzeptieren sowohl direkten Zugriff `document.documentElement.style…`
  // als auch via Variable wie `docEl.style…`. Hauptsache der Source enthaelt
  // zwei eigenstaendige Zuweisungen die touchAction auf 'none' setzen — eine
  // fuer html, eine fuer body. Loose-Match mit Mindest-Vorkommen ist robust
  // gegen Refactoring zu Variable-Aliasen.
  const touchActionAssignments = src.match(/\.style\.touchAction\s*=\s*['"]none['"]/g);
  assert.ok(
    touchActionAssignments && touchActionAssignments.length >= 2,
    `Erwartet: mindestens zwei .style.touchAction = 'none' Zuweisungen (html + body). Gefunden: ${touchActionAssignments?.length ?? 0}.`
  );
  assert.match(
    src,
    /document\.documentElement|docEl\s*=\s*document\.documentElement/,
    'Erwartet: documentElement wird referenziert (html-Lock).'
  );
  assert.match(
    src,
    /document\.body\.style\.touchAction/,
    'Erwartet: document.body.style.touchAction wird gesetzt.'
  );
  // Cleanup-Pfad: beide vorigen Werte muessen gesichert + restored werden.
  assert.match(
    src,
    /prevDocTouch/,
    'Erwartet: voriger documentElement.touchAction wird vor Override gesichert.'
  );
  assert.match(
    src,
    /prevBodyTouch/,
    'Erwartet: voriger body.touchAction wird vor Override gesichert.'
  );
});

test('Regression-Test wuerde anschlagen wenn touch-action entfernt wuerde', () => {
  // Negativ-Probe: wir simulieren das Entfernen der Zeile und stellen sicher,
  // dass der oben verwendete Pattern-Match dann tatsaechlich fehlschlaegt.
  // Sonst koennte der Haupt-Test stiller False-Positive sein.
  const src = readFileSync(GRAFFITI_LAYER_PATH, 'utf8');
  const mutilated = src.replace(/touch-action\s*:\s*none\s*;?/g, '');
  const block = extractCssBlock(mutilated, '.fgraffiti-canvas.is-active');
  assert.ok(block !== null, 'Block muss auch nach Mutation existieren');
  const normalized = block.replace(/\s+/g, ' ');
  assert.doesNotMatch(
    normalized,
    /touch-action\s*:\s*none/,
    'Negativ-Probe: Nach Entfernen der Regel darf der Pattern nicht mehr matchen — sonst ist der Haupt-Test wertlos.'
  );
});
