/**
 * Regressions-Test: das Base-Canvas darf NICHT durch setTiles-Acks aus eigenen
 * Uploads neu gebaut werden, sonst gehen frisch committete, aber noch nicht
 * extrahierte Strokes verloren.
 *
 * Hintergrund (aus realem Tablet-Debug-Dump vom 2026-05-16):
 *   Stroke N pointer-up → commit ins bctx → enqueueTileUpload (extract ist async).
 *   Bevor extract laeuft, kommt das setTiles vom vorigen Upload (N-1) zurueck,
 *   triggert useEffect([tiles]) → baseDirty=true → naechste paintComposite-Frame
 *   clearRect + drawTilesOntoContext(tilesRef) → Stroke N ist aus dem Base raus,
 *   bevor sein eigener Upload-Task ihn als PNG extrahieren kann. Resultat: der
 *   hochgeladene Tile enthaelt Stroke N nicht → permanenter Datenverlust und
 *   ein sichtbarer Flacker dazwischen.
 *
 * Wir schuetzen die Invarianten textuell:
 *   1. `useEffect(..., [tiles])` darf KEIN `baseDirtyRef.current = true` enthalten.
 *   2. Der Initial-Fetch-Handler (Pfad mit `fetchTilesForPage`) MUSS nach
 *      `tilesRef.current = map; setTiles(map)` `baseDirtyRef.current = true`
 *      und `schedulePaint()` aufrufen — sonst landet das erste Page-Load-Tile
 *      nie im Base.
 *
 * Warum ein Text-Test: die node:test-Suite laeuft ohne Browser/JSDOM; was wir
 * hier verteidigen ist eine architektonische Constraint, kein Browser-Verhalten.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAFFITI_LAYER_PATH = resolve(__dirname, '../src/components/GraffitiLayer.jsx');

function readSource() {
  return readFileSync(GRAFFITI_LAYER_PATH, 'utf8');
}

/**
 * Findet den Funktionskoerper eines useEffect-Calls, dessen Dependency-Array
 * exakt die uebergebenen Variablen-Namen enthaelt. Greift den ersten Treffer.
 * Nicht generisch — reicht fuer flache Effects ohne nested useEffects.
 */
function extractUseEffectBodyByDeps(source, deps) {
  // Suche das schliessende `}, [<deps>])` Muster und lese ab dort rueckwaerts
  // bis zum oeffnenden `useEffect(() => {`.
  const depPattern = `}, [${deps.join(', ')}]);`;
  const closeIdx = source.indexOf(depPattern);
  if (closeIdx < 0) return null;
  // Finde den passenden useEffect-Start vor dieser Stelle.
  const openMarker = 'useEffect(() => {';
  // Suche das letzte Vorkommen des openMarker vor closeIdx.
  const openIdx = source.lastIndexOf(openMarker, closeIdx);
  if (openIdx < 0) return null;
  return source.slice(openIdx, closeIdx + depPattern.length);
}

test('useEffect([tiles]) markiert das Base NICHT als dirty (Race-Fix)', () => {
  const src = readSource();
  const body = extractUseEffectBodyByDeps(src, ['tiles']);
  assert.ok(body, 'useEffect mit Dependency [tiles] muss existieren');
  assert.ok(
    !/baseDirtyRef\.current\s*=\s*true/.test(body),
    'useEffect([tiles]) darf baseDirtyRef.current NICHT auf true setzen — sonst '
    + 'wischt das naechste Repaint frisch committete Strokes aus dem Base, bevor '
    + 'ihre Upload-Tasks extractTilePngBase64 aufrufen koennen.'
  );
  assert.ok(
    !/schedulePaint\s*\(/.test(body),
    'useEffect([tiles]) sollte auch kein schedulePaint() ausloesen — die paint-'
    + 'sichtbaren Pixel sind nach einem Upload-Ack identisch zu denen vor dem '
    + 'Ack (wir haben sie selbst committet), eine zusaetzliche Frame bringt '
    + 'keine Information und kostet nur CPU.'
  );
});

test('z-index ist im Leerlauf unter 100 und im aktiven Modus deutlich ueber Modalen', () => {
  // Spec: Modale (Header z-index 1000, VocabCardStack-Modal 600, etc.) sollen
  // bei _inaktivem_ Graffiti ueber dem Canvas liegen, damit ein altes Graffito
  // nicht quer durch ein geoeffnetes Modal kritzelt. Bei _aktivem_ Tool soll
  // man dagegen ueberall malen koennen, auch ueber Modalen — sonst koennte
  // der User nicht in ein gerade offenes Modal kritzeln. Doppel-Schicht via
  // .fgraffiti-canvas vs. .fgraffiti-canvas.is-active.
  const src = readSource();
  // Erster z-index-Eintrag im Basis-Block — muss < 100 sein.
  const baseBlock = src.match(/\.fgraffiti-canvas\s*\{[^}]*\}/);
  assert.ok(baseBlock, 'Basis-Canvas-CSS-Block muss existieren');
  const baseZ = baseBlock[0].match(/z-index:\s*(\d+)/);
  assert.ok(baseZ, 'Basis-Block braucht z-index');
  const baseVal = parseInt(baseZ[1], 10);
  assert.ok(
    baseVal < 100,
    `Idle-Graffiti z-index muss < 100 sein (war ${baseVal}), sonst rendern sich `
    + 'alte Striche ueber Nav/Header/Modals.'
  );

  const activeBlock = src.match(/\.fgraffiti-canvas\.is-active\s*\{[^}]*\}/);
  assert.ok(activeBlock, 'Aktiv-Canvas-CSS-Block muss existieren');
  const activeZ = activeBlock[0].match(/z-index:\s*(\d+)/);
  assert.ok(activeZ, 'Aktiv-Block braucht z-index');
  const activeVal = parseInt(activeZ[1], 10);
  assert.ok(
    activeVal >= 1500,
    `Aktiv-Graffiti z-index muss deutlich ueber typischen Modalen (>= 1500) `
    + `liegen (war ${activeVal}), sonst kann der User waehrend "Tool in der Hand" `
    + 'nicht auf einem geoeffneten Modal malen.'
  );
});

test('Initial-Tile-Fetch loest baseDirty + schedulePaint nach setTiles aus', () => {
  const src = readSource();
  // Der Initial-Fetch-Handler benutzt fetchTilesForPage und macht danach
  // tilesRef.current = map / setTiles(map). Wir lesen einen Slice um diesen
  // Block herum und pruefen, dass darin baseDirtyRef=true UND schedulePaint
  // VORHANDEN sind — sonst wird das geladene Page-Inventar nicht ins Base
  // gezeichnet (Konsequenz waere: leere Seite bis zum ersten User-Stroke).
  const fetchIdx = src.indexOf('fetchTilesForPage(');
  assert.ok(fetchIdx > -1, 'fetchTilesForPage-Aufruf muss existieren');
  const sliceEnd = src.indexOf('}, []);', fetchIdx);
  assert.ok(sliceEnd > fetchIdx, 'Initial-Fetch-useEffect muss geschlossen sein');
  const slice = src.slice(fetchIdx, sliceEnd);
  assert.match(
    slice,
    /tilesRef\.current\s*=\s*map/,
    'Initial-Fetch muss tilesRef synchron setzen'
  );
  assert.match(
    slice,
    /setTiles\s*\(\s*map\s*\)/,
    'Initial-Fetch muss setTiles(map) aufrufen'
  );
  assert.match(
    slice,
    /baseDirtyRef\.current\s*=\s*true/,
    'Initial-Fetch muss baseDirtyRef.current = true setzen, sonst werden die '
    + 'geladenen Tiles nie ins Base gezeichnet (der [tiles]-Effect macht das '
    + 'absichtlich nicht mehr).'
  );
  assert.match(
    slice,
    /schedulePaint\s*\(\s*\)/,
    'Initial-Fetch muss schedulePaint() aufrufen, damit das gerade gesetzte '
    + 'baseDirty-Flag im naechsten rAF abgearbeitet wird.'
  );
});
