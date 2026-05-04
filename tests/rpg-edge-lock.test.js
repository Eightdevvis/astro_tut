/**
 * Tests fuer das Edge-Lock-Feature (Tree-View Subtree-Sperre).
 *
 * Modell-Konzept
 * ──────────────
 * Eine `parent_of`-Edge kann das Flag `locked: true` tragen. Aus den
 * gelockten Edges wird eine Set gesperrter Node-IDs berechnet
 * (`computeLockedNodeIds`): ein Knoten gilt als gelockt, wenn JEDER
 * eingehende Pfad blockiert ist (Edge selbst gelockt ODER Parent transitiv
 * gelockt). Multi-Parent-Knoten mit MIND. einem unlocked Pfad bleiben
 * sichtbar.
 *
 * STRICT GETRENNT von `node.isLock` (Lock-Sibling-Modifier im Editor) —
 * das hier ist edge-spezifisch und pfad-spezifisch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRpgGraph,
  graphEdges,
  isParentChildRelation,
} from '../src/lib/rpg-quests-data.js';
import {
  setEdgeLocked,
  toggleEdgeLocked,
  isEdgeLocked,
  isNodeLockedInGraph,
  computeLockedNodeIds,
  setEdgeLockSide,
  toggleEdgeLockSide,
  getEdgeLockSide,
  readEdgeLockSide,
} from '../src/lib/rpg-quest-graph.js';

// =============================================================================
// Helper
// =============================================================================

/**
 * Layout:
 *   q1 ─parent_of─▶ a ─parent_of─▶ d
 *   q1 ─parent_of─▶ b
 *   q2 ─parent_of─▶ c ─parent_of─▶ d   (d hat Multi-Parent: a UND c)
 */
function buildDiamondGraph() {
  return makeRpgGraph(
    {
      q1: { id: 'q1', title: 'Quest 1' },
      q2: { id: 'q2', title: 'Quest 2' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
      d: { id: 'd', title: 'D' },
    },
    [
      { from: 'q1', to: 'a', relation: 'parent_of' },
      { from: 'q1', to: 'b', relation: 'parent_of' },
      { from: 'q2', to: 'c', relation: 'parent_of' },
      { from: 'a', to: 'd', relation: 'parent_of' },
      { from: 'c', to: 'd', relation: 'parent_of' },
    ]
  );
}

/** Linear-Kette: r ─▶ x ─▶ y ─▶ z */
function buildChainGraph() {
  return makeRpgGraph(
    {
      r: { id: 'r', title: 'Root' },
      x: { id: 'x', title: 'X' },
      y: { id: 'y', title: 'Y' },
      z: { id: 'z', title: 'Z' },
    },
    [
      { from: 'r', to: 'x', relation: 'parent_of' },
      { from: 'x', to: 'y', relation: 'parent_of' },
      { from: 'y', to: 'z', relation: 'parent_of' },
    ]
  );
}

// =============================================================================
// setEdgeLocked / toggleEdgeLocked / isEdgeLocked
// =============================================================================

test('setEdgeLocked: setzt locked: true auf existierende parent_of-Edge', () => {
  const g0 = buildChainGraph();
  assert.equal(isEdgeLocked(g0, 'r', 'x'), false);
  const g1 = setEdgeLocked(g0, 'r', 'x', true);
  assert.notEqual(g1, g0); // neue Referenz weil geändert
  assert.equal(isEdgeLocked(g1, 'r', 'x'), true);
  // andere Edges bleiben unverändert
  assert.equal(isEdgeLocked(g1, 'x', 'y'), false);
});

test('setEdgeLocked: locked: false entfernt das Feld komplett (kein false-Eintrag)', () => {
  const g0 = setEdgeLocked(buildChainGraph(), 'r', 'x', true);
  const g1 = setEdgeLocked(g0, 'r', 'x', false);
  assert.equal(isEdgeLocked(g1, 'r', 'x'), false);
  // Die persistierte Edge soll kompakt sein — kein 'locked'-Property
  const edge = graphEdges(g1).find((e) => e.from === 'r' && e.to === 'x');
  assert.ok(edge, 'Edge muss existieren');
  assert.equal('locked' in edge, false, 'locked-Property muss entfernt sein');
});

test('setEdgeLocked: idempotent wenn schon im Soll-Zustand (gleiche Referenz)', () => {
  const g0 = buildChainGraph();
  const g1 = setEdgeLocked(g0, 'r', 'x', false); // schon unlocked
  assert.equal(g1, g0, 'unveraendert: gleiche Referenz');

  const g2 = setEdgeLocked(g0, 'r', 'x', true);
  const g3 = setEdgeLocked(g2, 'r', 'x', true); // schon locked
  assert.equal(g3, g2);
});

test('setEdgeLocked: nicht-existierende Edge → unveraendert', () => {
  const g0 = buildChainGraph();
  const g1 = setEdgeLocked(g0, 'r', 'nonexistent', true);
  assert.equal(g1, g0);
});

test('toggleEdgeLocked: dreht Lock-Zustand um', () => {
  const g0 = buildChainGraph();
  const g1 = toggleEdgeLocked(g0, 'r', 'x');
  assert.equal(isEdgeLocked(g1, 'r', 'x'), true);
  const g2 = toggleEdgeLocked(g1, 'r', 'x');
  assert.equal(isEdgeLocked(g2, 'r', 'x'), false);
});

test('isEdgeLocked: dependency-Edge gibt false (locked nur fuer structure)', () => {
  const g0 = makeRpgGraph(
    { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } },
    // Versucher: dependency-Edge mit locked=true gesetzt
    [{ from: 'a', to: 'b', relation: 'dependency', locked: true }]
  );
  // normalizeGraphEdge stripped locked auf dependency-Edges → muss false sein
  assert.equal(isEdgeLocked(g0, 'a', 'b'), false);
});

// =============================================================================
// isNodeLockedInGraph: direkte eingehende Edges
// =============================================================================

test('isNodeLockedInGraph: Root nie gelockt (keine eingehende Edge)', () => {
  const g = setEdgeLocked(buildChainGraph(), 'r', 'x', true);
  assert.equal(isNodeLockedInGraph(g, 'r'), false);
});

test('isNodeLockedInGraph: Single-Parent + Edge gelockt → Node gelockt', () => {
  const g = setEdgeLocked(buildChainGraph(), 'r', 'x', true);
  assert.equal(isNodeLockedInGraph(g, 'x'), true);
});

test('isNodeLockedInGraph: Multi-Parent, EINE Edge gelockt → Node NICHT gelockt', () => {
  // d hat Parents a und c. Wir locken nur a→d.
  const g = setEdgeLocked(buildDiamondGraph(), 'a', 'd', true);
  assert.equal(isNodeLockedInGraph(g, 'd'), false);
});

test('isNodeLockedInGraph: Multi-Parent, ALLE Edges gelockt → Node gelockt', () => {
  let g = buildDiamondGraph();
  g = setEdgeLocked(g, 'a', 'd', true);
  g = setEdgeLocked(g, 'c', 'd', true);
  assert.equal(isNodeLockedInGraph(g, 'd'), true);
});

// =============================================================================
// computeLockedNodeIds: globaler Subtree-Lock (Fixpunkt)
// =============================================================================

test('computeLockedNodeIds: leerer Lock → leeres Set', () => {
  const set = computeLockedNodeIds(buildChainGraph());
  assert.equal(set.size, 0);
});

test('computeLockedNodeIds: gelockte Edge propagiert auf alle Descendants', () => {
  const g = setEdgeLocked(buildChainGraph(), 'r', 'x', true);
  const set = computeLockedNodeIds(g);
  // x, y, z muessen alle gelockt sein (transitive Propagation)
  assert.equal(set.has('x'), true);
  assert.equal(set.has('y'), true);
  assert.equal(set.has('z'), true);
  // Root nie gelockt
  assert.equal(set.has('r'), false);
});

test('computeLockedNodeIds: Multi-Parent — Semantik ist branch-orientiert (ANY)', () => {
  // Seit 2026-05-04 reicht EIN blockierter eingehender Pfad damit der
  // Subtree gedimmt wird (vorher: alle Pfade muessen blockiert sein).
  // UX-Begruendung: nach einem Klick soll sofort sichtbares Feedback kommen,
  // auch wenn der Knoten ueber andere Pfade theoretisch noch erreichbar waere.
  const g = setEdgeLocked(buildDiamondGraph(), 'a', 'd', true);
  const set = computeLockedNodeIds(g);
  // a haengt direkt unter q1 ueber unlocked Edge → a selbst nicht gelockt
  assert.equal(set.has('a'), false);
  // d wird jetzt gelockt sobald a→d gelockt ist (branch-orientiert).
  assert.equal(set.has('d'), true, 'ANY-Semantik: ein gelockter Pfad reicht');
});

test('computeLockedNodeIds: Multi-Parent — wenn beide Wege gesperrt, wird d gelockt', () => {
  let g = buildDiamondGraph();
  g = setEdgeLocked(g, 'a', 'd', true);
  g = setEdgeLocked(g, 'c', 'd', true);
  const set = computeLockedNodeIds(g);
  assert.equal(set.has('d'), true);
  // a und c selbst sind nicht direkt gelockt (haben unlocked Edges von Roots)
  assert.equal(set.has('a'), false);
  assert.equal(set.has('c'), false);
});

test('computeLockedNodeIds: indirekte Propagation (branch-orientiert)', () => {
  // Wenn q1→a gelockt, ist a gelockt. D wird via a→d (unlocked) erreicht;
  // a selbst ist down-stream-gelockt → ANY-Semantik: ein blockierter Pfad
  // zu d reicht, also wird d ebenfalls gelockt — auch wenn der Pfad via
  // q2→c→d theoretisch noch frei waere. Bewusste UX-Entscheidung fuer
  // sofortiges visuelles Feedback.
  const g = setEdgeLocked(buildDiamondGraph(), 'q1', 'a', true);
  const set = computeLockedNodeIds(g);
  assert.equal(set.has('a'), true);
  assert.equal(set.has('d'), true, 'ANY-Semantik: a-Branch propagiert auf d');
});

test('computeLockedNodeIds: alle Wege blockiert → Subtree komplett gelockt', () => {
  let g = buildDiamondGraph();
  // Beide Roots zu ihren Children sperren
  g = setEdgeLocked(g, 'q1', 'a', true);
  g = setEdgeLocked(g, 'q1', 'b', true);
  g = setEdgeLocked(g, 'q2', 'c', true);
  const set = computeLockedNodeIds(g);
  // Alle Nicht-Root-Nodes muessen gelockt sein
  assert.equal(set.has('a'), true);
  assert.equal(set.has('b'), true);
  assert.equal(set.has('c'), true);
  assert.equal(set.has('d'), true);
  // Roots bleiben aussen vor
  assert.equal(set.has('q1'), false);
  assert.equal(set.has('q2'), false);
});

// =============================================================================
// Persistenz-Roundtrip: locked-Flag ueberlebt makeRpgGraph + normalizeGraphEdge
// =============================================================================

test('Persistenz: locked: true ueberlebt makeRpgGraph-Roundtrip', () => {
  const g0 = makeRpgGraph(
    { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } },
    [{ from: 'a', to: 'b', relation: 'parent_of', locked: true }]
  );
  const persisted = JSON.stringify(g0);
  const reloaded = makeRpgGraph(g0.nodes, JSON.parse(persisted).edges);
  assert.equal(isEdgeLocked(reloaded, 'a', 'b'), true);
});

test('Persistenz: locked auf dependency-Edge wird nicht uebernommen', () => {
  const g0 = makeRpgGraph(
    { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } },
    [{ from: 'a', to: 'b', relation: 'dependency', locked: true }]
  );
  const edge = graphEdges(g0).find((e) => e.from === 'a' && e.to === 'b');
  assert.ok(edge);
  assert.equal('locked' in edge, false, 'locked muss von dependency-Edges entfernt sein');
});

test('Persistenz: parent_of-Edge ohne locked-Property bleibt kompakt', () => {
  const g0 = makeRpgGraph(
    { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } },
    [{ from: 'a', to: 'b', relation: 'parent_of' }]
  );
  const edge = graphEdges(g0).find((e) => e.from === 'a' && e.to === 'b');
  assert.ok(edge);
  assert.equal('locked' in edge, false, 'Default-Edge soll kein locked-Feld tragen');
});

test('Edge-Set bewahrt isParentChildRelation auch mit locked: true', () => {
  const g = setEdgeLocked(buildChainGraph(), 'r', 'x', true);
  const edge = graphEdges(g).find((e) => e.from === 'r' && e.to === 'x');
  assert.equal(isParentChildRelation(edge), true);
});

// =============================================================================
// Regression: locked muss durch die V2+V3-Migrations-Pipeline durchkommen.
//
// Bug-Hintergrund (2026-05-03): migrateRpgGraphToV3 hat zuerst einen Tree-Walk
// durch nested children gemacht und dabei "naked" structure-Edges (ohne
// `locked`) in finalEdges geschrieben. Anschliessend wurden die expliziten
// edges aus `graph.edges` via Dedup-Set wegegeschmissen, weil ihre Keys schon
// vergeben waren. Resultat: `locked: true` ging beim PUT verloren — jeder
// Reload zeigte das Schloss als nicht-gesetzt.
//
// Fix: Edges-Liste wird ZUERST aus `graphEdges(v2)` befuellt, der Tree-Walk
// ergaenzt nur fehlende strukturelle Edges.
// =============================================================================

import { migrateRpgGraphToV2 } from '../src/lib/rpg-quest-nodes.js';
import { migrateRpgGraphToV3, stripGraphCompatFields } from '../src/lib/rpg-payload-schema.js';

test('Regression: locked ueberlebt migrateRpgGraphToV2 + migrateRpgGraphToV3', () => {
  // Bewusst mit nested children (Compat-View), damit der Tree-Walk in V3
  // wirklich ueber Edges laufen muss. Genau die Situation, die in der
  // echten Persist-Pipeline (Server-PUT) auftritt.
  const g0 = makeRpgGraph(
    {
      root: { id: 'root', title: 'Root' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
    },
    [
      { from: 'root', to: 'a', relation: 'parent_of' },
      { from: 'a', to: 'b', relation: 'parent_of' },
    ]
  );
  const locked = setEdgeLocked(g0, 'root', 'a', true);
  const afterV2 = migrateRpgGraphToV2(locked);
  const afterV3 = migrateRpgGraphToV3(afterV2);

  const target = afterV3.edges.find((e) => e.from === 'root' && e.to === 'a');
  assert.ok(target, 'Edge muss nach V3-Migration existieren');
  // Persistenz-Format ist jetzt der explizite String 'child' (vorher: true).
  // Legacy-`true` wird beim Lesen automatisch als 'child' interpretiert.
  assert.equal(target.locked, 'child', 'locked-Side muss durch V2+V3-Migration durchkommen');
});

test('Regression: locked ueberlebt vollen Pipeline-Roundtrip (Server-PUT-Aequivalent)', () => {
  // Das ist die exakte Sequenz, die der Server-PUT-Endpoint durchfuehrt.
  const g0 = makeRpgGraph(
    {
      root: { id: 'root', title: 'Root' },
      child: { id: 'child', title: 'Child' },
      leaf: { id: 'leaf', title: 'Leaf' },
    },
    [
      { from: 'root', to: 'child', relation: 'parent_of' },
      { from: 'child', to: 'leaf', relation: 'parent_of' },
    ]
  );
  const locked = setEdgeLocked(g0, 'root', 'child', true);
  // Server: migrate V1 -> V2 -> V3
  const migrated = migrateRpgGraphToV3(migrateRpgGraphToV2(locked));
  // Server: makeRpgGraph (mit normalisierten Inputs) und stripCompatFields
  const normalized = makeRpgGraph(migrated.nodes, migrated.edges);
  const persisted = stripGraphCompatFields(normalized);
  // JSON-Roundtrip wie in der DB-Spalte
  const reloaded = JSON.parse(JSON.stringify(persisted));
  const target = reloaded.edges.find((e) => e.from === 'root' && e.to === 'child');
  assert.ok(target, 'Edge muss in der persistierten Form existieren');
  assert.equal(target.locked, 'child', 'locked-Side muss durch den vollen Roundtrip ueberleben');
});

// =============================================================================
// Bidirektionales Edge-Lock (ab 2026-05-04)
//
// `edge.locked` traegt jetzt eine Side-Angabe: 'child' (Subtree unten gesperrt)
// oder 'parent' (Subtree oben gesperrt). Click-Position auf der Edge bestimmt
// die Side. computeLockedNodeIds propagiert in beide Richtungen.
// =============================================================================

test('readEdgeLockSide: alle Werte korrekt interpretieren', () => {
  // Direkte Aufrufe ohne Graph — pruefen die reine Lese-Logik.
  assert.equal(readEdgeLockSide({ locked: 'child' }), 'child');
  assert.equal(readEdgeLockSide({ locked: 'parent' }), 'parent');
  // Legacy-Boolean true → 'child' (Backward-Compat)
  assert.equal(readEdgeLockSide({ locked: true }), 'child');
  // Alle anderen Werte → null
  assert.equal(readEdgeLockSide({ locked: false }), null);
  assert.equal(readEdgeLockSide({}), null);
  assert.equal(readEdgeLockSide(null), null);
});

test('setEdgeLockSide: persistiert "parent" als String, nicht boolean', () => {
  const g0 = buildChainGraph();
  const g1 = setEdgeLockSide(g0, 'r', 'x', 'parent');
  const edge = graphEdges(g1).find((e) => e.from === 'r' && e.to === 'x');
  assert.equal(edge.locked, 'parent');
  assert.equal(getEdgeLockSide(g1, 'r', 'x'), 'parent');
});

test('setEdgeLockSide: switcht zwischen child und parent', () => {
  const g0 = setEdgeLockSide(buildChainGraph(), 'r', 'x', 'child');
  assert.equal(getEdgeLockSide(g0, 'r', 'x'), 'child');
  const g1 = setEdgeLockSide(g0, 'r', 'x', 'parent');
  assert.equal(getEdgeLockSide(g1, 'r', 'x'), 'parent');
  const g2 = setEdgeLockSide(g1, 'r', 'x', null);
  assert.equal(getEdgeLockSide(g2, 'r', 'x'), null);
});

test('toggleEdgeLockSide: Klick auf gleiche Seite → unlock', () => {
  const g0 = setEdgeLockSide(buildChainGraph(), 'r', 'x', 'child');
  // Nochmal child geklickt → unlock
  const g1 = toggleEdgeLockSide(g0, 'r', 'x', 'child');
  assert.equal(getEdgeLockSide(g1, 'r', 'x'), null);
});

test('toggleEdgeLockSide: Klick auf andere Seite → both (unabhaengiges Toggle)', () => {
  // Seit 2026-05-04 togglet jede Seite unabhaengig. Bestehender child-Lock
  // plus Klick auf parent-Haelfte → `both` (beide Sperren gleichzeitig aktiv).
  // Macht UX-Sinn: jede Haelfte hat ihren eigenen Toggle-Cycle.
  const g0 = setEdgeLockSide(buildChainGraph(), 'r', 'x', 'child');
  const g1 = toggleEdgeLockSide(g0, 'r', 'x', 'parent');
  assert.equal(getEdgeLockSide(g1, 'r', 'x'), 'both');
  // Klick auf child-Haelfte bei `both` → entfernt child, parent bleibt
  const g2 = toggleEdgeLockSide(g1, 'r', 'x', 'child');
  assert.equal(getEdgeLockSide(g2, 'r', 'x'), 'parent');
});

test('toggleEdgeLockSide: nicht gelockt + Klick auf parent → setzt parent', () => {
  const g0 = buildChainGraph();
  const g1 = toggleEdgeLockSide(g0, 'r', 'x', 'parent');
  assert.equal(getEdgeLockSide(g1, 'r', 'x'), 'parent');
});

// --- Bidirektionale Subtree-Propagation in computeLockedNodeIds -------------

test('computeLockedNodeIds: parent-side-Lock auf Single-Edge sperrt den Parent', () => {
  // Chain r → x → y → z. Wir locken die Edge r→x mit 'parent'.
  // Effekt: alles in Parent-Richtung von dieser Edge ist gesperrt → r.
  // r ist Root und hat nur die Edge nach x als ausgehend → wenn die parent-locked
  // ist, gilt r als gelockt.
  const g = setEdgeLockSide(buildChainGraph(), 'r', 'x', 'parent');
  const set = computeLockedNodeIds(g);
  assert.equal(set.has('r'), true, 'r muss via parent-side-Lock gelockt sein');
  // x, y, z bleiben sichtbar — die Edge schuetzt nur in Parent-Richtung
  assert.equal(set.has('x'), false);
  assert.equal(set.has('y'), false);
  assert.equal(set.has('z'), false);
});

test('computeLockedNodeIds: parent-side-Lock auf tieferer Edge propagiert nach oben', () => {
  // Chain r → x → y → z. Wir locken die Edge x→y mit 'parent'.
  // Effekt: y's einziger Vorgaenger (x) muss ueber eine parent-locked Edge
  // erreichbar sein → x ist gelockt. r ist x's einziger Vorgaenger ueber unlocked
  // Edge, aber x ist gelockt → r's einzige ausgehende Edge geht zu einem
  // gelockten Child → r ist auch gelockt.
  const g = setEdgeLockSide(buildChainGraph(), 'x', 'y', 'parent');
  const set = computeLockedNodeIds(g);
  assert.equal(set.has('x'), true, 'x via parent-side');
  assert.equal(set.has('r'), true, 'r transitiv: einzige ausgehende Edge zu gelocktem Child');
  // y und z bleiben sichtbar
  assert.equal(set.has('y'), false);
  assert.equal(set.has('z'), false);
});

test('computeLockedNodeIds: parent-side-Lock auf Multi-Child-Parent — branch-orientiert', () => {
  // q1 hat zwei Children: a und b. Wir locken q1→a mit 'parent'.
  // ANY-Semantik (seit 2026-05-04): EIN parent-locked Ausgang reicht damit
  // q1 als up-stream-gelockt gilt — sonst waere parent-side-Lock bei
  // Multi-Child-Knoten praktisch wirkungslos.
  const g = setEdgeLockSide(buildDiamondGraph(), 'q1', 'a', 'parent');
  const set = computeLockedNodeIds(g);
  assert.equal(set.has('q1'), true, 'ANY-Semantik: q1 ueber den a-Branch gelockt');
  // a selbst ist NICHT gelockt — der parent-side-Lock wirkt nach oben, nicht nach unten
  assert.equal(set.has('a'), false, 'a ist auf der Child-Seite der parent-Sperre');
});

test('computeLockedNodeIds: Multi-Child — alle ausgehenden parent-locked → Parent gelockt', () => {
  // q1 hat zwei Children a, b. Beide ausgehenden Edges parent-locked.
  let g = buildDiamondGraph();
  g = setEdgeLockSide(g, 'q1', 'a', 'parent');
  g = setEdgeLockSide(g, 'q1', 'b', 'parent');
  const set = computeLockedNodeIds(g);
  assert.equal(set.has('q1'), true, 'q1 muss gelockt sein wenn alle ausgehenden parent-locked');
});

test('computeLockedNodeIds: Symmetrie — child-side-Lock funktioniert wie vorher', () => {
  // Regression: das alte Verhalten (child-side-Lock = downstream-Sperre)
  // muss durch die neue bidirektionale Logik UNVERAENDERT funktionieren.
  const g = setEdgeLockSide(buildChainGraph(), 'r', 'x', 'child');
  const set = computeLockedNodeIds(g);
  assert.equal(set.has('x'), true);
  assert.equal(set.has('y'), true);
  assert.equal(set.has('z'), true);
  assert.equal(set.has('r'), false);
});

test('computeLockedNodeIds: Mischung child- und parent-side-Lock im selben Graph', () => {
  // Layout: r → x → y → z
  // r→x: child-side  (Subtree unten ab x ist gesperrt)
  // y→z: parent-side (Subtree oben ab y ist gesperrt)
  let g = buildChainGraph();
  g = setEdgeLockSide(g, 'r', 'x', 'child');
  g = setEdgeLockSide(g, 'y', 'z', 'parent');
  const set = computeLockedNodeIds(g);

  // x: down-stream-locked durch r→x='child'
  assert.equal(set.has('x'), true);

  // y: down-stream-locked transitiv (x ist gelockt, x→y unlocked Edge → propagiert).
  //    Plus: up-stream-locked durch y→z='parent'. Egal welche Richtung — y ist gelockt.
  assert.equal(set.has('y'), true);

  // z: NICHT down-stream-locked. Die eingehende Edge y→z ist 'parent' — die Sperre
  //    liegt auf Parent-Seite, NICHT auf Child-Seite. Down-stream-Propagation wird
  //    durch eine 'parent'-Edge aktiv geschuetzt (sonst waere "parent-side-Lock"
  //    sinnlos — er soll ja den Parent-Branch sperren, nicht den eigenen Subtree).
  //    Up-stream geht auch nicht (z hat keine ausgehende Edge).
  assert.equal(set.has('z'), false, 'z ist auf der Child-Seite der parent-Sperre — bleibt sichtbar');

  // r: Down-stream geht nicht (keine eingehende Edge). Up-stream-Check:
  //    r→x ist 'child'-locked. Eine 'child'-Edge schuetzt Up-stream genauso wie
  //    'parent' Down-stream schuetzt — die Sperre liegt auf der ANDEREN Seite.
  //    Also r ist NICHT up-stream-locked durch r→x.
  //    Bleibt: ist x up-stream-locked? Nein, denn x→y ist null und y up-stream-locked.
  //    Wait — das ist die transitive Frage. Aber r→x ist 'child' und schuetzt Up-stream.
  //    → r bleibt sichtbar.
  assert.equal(set.has('r'), false, 'r→x ist child-locked — schuetzt r vor Up-stream-Propagation');
});

// =============================================================================
// Sibling-Lock via node.isLock (ab 2026-05-04 in computeLockedNodeIds integriert)
//
// Eine als isLock markierte Node sperrt visuell ihre Geschwister (Children
// derselben Parents). Lock-Node selbst und andere Lock-Nodes bleiben sichtbar.
// nodeDone-aware: ist die Lock-Node done, sind die Geschwister frei.
// =============================================================================

/**
 * Layout fuer Sibling-Lock-Tests:
 *   p ─parent_of─▶ lockA   (isLock)
 *   p ─parent_of─▶ sib1
 *   p ─parent_of─▶ sib2 ─parent_of─▶ grandkid
 *   p ─parent_of─▶ lockB   (isLock — andere Lock-Node, soll NICHT gedimmt werden)
 */
function buildSiblingLockGraph() {
  return makeRpgGraph(
    {
      p: { id: 'p', title: 'Parent' },
      lockA: { id: 'lockA', title: 'Lock-Sibling A', isLock: true },
      sib1: { id: 'sib1', title: 'Sibling 1' },
      sib2: { id: 'sib2', title: 'Sibling 2' },
      grandkid: { id: 'grandkid', title: 'Grand-Child' },
      lockB: { id: 'lockB', title: 'Lock-Sibling B', isLock: true },
    },
    [
      { from: 'p', to: 'lockA', relation: 'parent_of' },
      { from: 'p', to: 'sib1', relation: 'parent_of' },
      { from: 'p', to: 'sib2', relation: 'parent_of' },
      { from: 'sib2', to: 'grandkid', relation: 'parent_of' },
      { from: 'p', to: 'lockB', relation: 'parent_of' },
    ]
  );
}

test('Sibling-Lock: aktive Lock-Node sperrt Geschwister, nicht sich selbst', () => {
  const g = buildSiblingLockGraph();
  const set = computeLockedNodeIds(g, {}); // niemand done
  // Lock-Nodes selbst sind NICHT im Set
  assert.equal(set.has('lockA'), false, 'Lock-Node A bleibt sichtbar');
  assert.equal(set.has('lockB'), false, 'Lock-Node B bleibt sichtbar');
  // Normale Geschwister sind gedimmt
  assert.equal(set.has('sib1'), true, 'Geschwister 1 ist gedimmt');
  assert.equal(set.has('sib2'), true, 'Geschwister 2 ist gedimmt');
  // Subtree des Geschwisters propagiert (Down-stream-Walk in Fixpunkt)
  assert.equal(set.has('grandkid'), true, 'Subtree des Geschwisters ist auch gedimmt');
  // Parent ist nicht gedimmt
  assert.equal(set.has('p'), false, 'Parent bleibt sichtbar');
});

test('Sibling-Lock: done Lock-Node sperrt Geschwister NICHT mehr', () => {
  const g = buildSiblingLockGraph();
  // lockA done → seine Geschwister sind frei (lockB ist noch offen, sperrt aber
  // wieder die selben Geschwister; deshalb braucht's BEIDE done damit alle frei sind)
  const setBoth = computeLockedNodeIds(g, { lockA: true, lockB: true });
  assert.equal(setBoth.has('sib1'), false, 'Beide Lock-Nodes done → Geschwister frei');
  assert.equal(setBoth.has('sib2'), false);
  assert.equal(setBoth.has('grandkid'), false);
});

test('Sibling-Lock: nur EINE von zwei Lock-Nodes done → Geschwister bleiben gedimmt', () => {
  const g = buildSiblingLockGraph();
  // lockA done, lockB noch offen → lockB sperrt die Geschwister weiter
  const set = computeLockedNodeIds(g, { lockA: true });
  assert.equal(set.has('sib1'), true, 'lockB ist noch aktiv → sib1 bleibt gedimmt');
  assert.equal(set.has('sib2'), true);
});

test('Sibling-Lock: kombiniert mit Edge-Lock — Sibling-Subtree korrekt gedimmt', () => {
  // Sib2 hat einen child-Subtree (grandkid). Wir setzen zusaetzlich eine
  // child-side-Edge-Sperre auf sib2→grandkid. Die Sibling-Lock-Logik
  // markiert sib2 schon als gedimmt; der Edge-Lock ist redundant, aber muss
  // koexistieren ohne Probleme.
  let g = buildSiblingLockGraph();
  g = setEdgeLockSide(g, 'sib2', 'grandkid', 'child');
  const set = computeLockedNodeIds(g, {});
  assert.equal(set.has('sib1'), true);
  assert.equal(set.has('sib2'), true);
  assert.equal(set.has('grandkid'), true);
});

test('Sibling-Lock: nodeDone undefined / null tolerieren', () => {
  // Robustheit: ohne nodeDone-Argument soll trotzdem funktionieren —
  // dann zaehlt keine Node als done, alle Lock-Nodes sind aktiv.
  const g = buildSiblingLockGraph();
  const setNoArg = computeLockedNodeIds(g);
  assert.equal(setNoArg.has('sib1'), true);
  const setNull = computeLockedNodeIds(g, null);
  assert.equal(setNull.has('sib1'), true);
});

test('Sibling-Lock: Multi-Parent — Geschwister via ALLEN Parents von L', () => {
  // Layout: zwei Parents (p1, p2), beide haben dieselbe Lock-Node L plus eigene
  // Geschwister. Lock-Wirkung muss ueber beide Parents reichen.
  //   p1 → L (isLock)
  //   p1 → s1
  //   p2 → L (Multi-Parent)
  //   p2 → s2
  const g = makeRpgGraph(
    {
      p1: { id: 'p1', title: 'P1' },
      p2: { id: 'p2', title: 'P2' },
      L: { id: 'L', title: 'Lock', isLock: true },
      s1: { id: 's1', title: 'S1' },
      s2: { id: 's2', title: 'S2' },
    },
    [
      { from: 'p1', to: 'L', relation: 'parent_of' },
      { from: 'p1', to: 's1', relation: 'parent_of' },
      { from: 'p2', to: 'L', relation: 'parent_of' },
      { from: 'p2', to: 's2', relation: 'parent_of' },
    ]
  );
  const set = computeLockedNodeIds(g, {});
  assert.equal(set.has('s1'), true, 'Geschwister via p1');
  assert.equal(set.has('s2'), true, 'Geschwister via p2');
  assert.equal(set.has('L'), false, 'Lock-Node selbst nicht');
});
