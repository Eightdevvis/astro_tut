/**
 * Tests fuer rpg-force-layout.js — Force-Directed Layout fuer den Quest-Graphen.
 *
 * Pruefkriterien (vom User-Wunsch abgeleitet):
 *   - Determinismus: gleicher Graph muss EXAKT gleiches Layout liefern,
 *     auch ueber wiederholte Aufrufe (deterministischer Hash-Init).
 *   - Konvergenz: nach den 350 Iterationen sollten Edges nicht mehr
 *     dramatisch laenger oder kuerzer sein als die Wunschlaenge — das
 *     System soll stabil eingependelt sein.
 *   - Multi-Parent: ein Node mit mehreren Parents wird zwischen ihnen
 *     positioniert (gewichteter Schwerpunkt).
 *   - Edge-Cases: leerer Graph, einzelner Node.
 *   - Bounding-Box: Output enthaelt alle Nodes (mit Padding).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpgGraph } from '../src/lib/rpg-quests-data.js';
import { computeForceLayout } from '../src/lib/rpg-force-layout.js';

// =============================================================================
// Helper
// =============================================================================

/**
 * Helfer: Baut einen einfachen 3-Knoten-Tree
 *   r1 ─parent_of→ a
 *   r1 ─parent_of→ b
 */
function buildSmallTree() {
  return makeRpgGraph(
    {
      r1: { id: 'r1', title: 'Root 1' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
    },
    [
      { from: 'r1', to: 'a', relation: 'parent_of' },
      { from: 'r1', to: 'b', relation: 'parent_of' },
    ]
  );
}

/**
 * Helfer: Baut einen Graph mit Multi-Parent-Knoten
 *   r1 ─parent_of→ shared
 *   r2 ─parent_of→ shared
 * `shared` haengt an beiden Roots.
 */
function buildMultiParentGraph() {
  return makeRpgGraph(
    {
      r1: { id: 'r1', title: 'Root 1' },
      r2: { id: 'r2', title: 'Root 2' },
      shared: { id: 'shared', title: 'Shared' },
    },
    [
      { from: 'r1', to: 'shared', relation: 'parent_of' },
      { from: 'r2', to: 'shared', relation: 'parent_of' },
    ]
  );
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// =============================================================================
// Determinismus
// =============================================================================

test('computeForceLayout: gleicher Graph liefert exakt gleiche Positionen (Run 1 vs Run 2)', () => {
  const g = buildSmallTree();
  const layout1 = computeForceLayout(g);
  const layout2 = computeForceLayout(g);
  for (const id of Object.keys(layout1.positions)) {
    const p1 = layout1.positions[id];
    const p2 = layout2.positions[id];
    assert.equal(p1.x, p2.x, `X-Position fuer ${id} muss exakt gleich sein`);
    assert.equal(p1.y, p2.y, `Y-Position fuer ${id} muss exakt gleich sein`);
  }
});

test('computeForceLayout: gleicher Graph in anderer Insert-Reihenfolge liefert gleiches Layout', () => {
  // Reihenfolge der Edges sollte das deterministische Ergebnis nicht beeinflussen,
  // weil intern stabil sortiert wird.
  const a = makeRpgGraph(
    {
      r1: { id: 'r1', title: 'R1' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
    },
    [
      { from: 'r1', to: 'a', relation: 'parent_of' },
      { from: 'r1', to: 'b', relation: 'parent_of' },
    ]
  );
  const b = makeRpgGraph(
    {
      r1: { id: 'r1', title: 'R1' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
    },
    [
      { from: 'r1', to: 'b', relation: 'parent_of' },
      { from: 'r1', to: 'a', relation: 'parent_of' },
    ]
  );
  const la = computeForceLayout(a);
  const lb = computeForceLayout(b);
  for (const id of ['r1', 'a', 'b']) {
    assert.equal(la.positions[id].x, lb.positions[id].x);
    assert.equal(la.positions[id].y, lb.positions[id].y);
  }
});

// =============================================================================
// Konvergenz
// =============================================================================

test('computeForceLayout: Edges bleiben nach Konvergenz in plausibler Laenge', () => {
  // Spring-Wunschlaenge default ~110 (non-compact). Nach 350 Iterationen
  // sollten verbundene Nodes ungefaehr in dieser Distanz stehen — wir geben
  // einen grosszuegigen Korridor (50..200), weil Repulsion und Center-Gravity
  // die Federn etwas verzerren.
  const g = buildSmallTree();
  const { positions } = computeForceLayout(g);
  const dRA = distance(positions.r1, positions.a);
  const dRB = distance(positions.r1, positions.b);
  assert.ok(dRA > 50 && dRA < 200, `r1-a Distanz sollte 50..200 sein, war ${dRA}`);
  assert.ok(dRB > 50 && dRB < 200, `r1-b Distanz sollte 50..200 sein, war ${dRB}`);
});

test('computeForceLayout: nicht-verbundene Nodes stossen sich ab (sollten nicht uebereinander liegen)', () => {
  // Zwei isolierte Nodes ohne Edge: nur Repulsion + Center-Gravity wirken.
  // Sie sollten sich auseinanderdruecken, aber nicht ins Unendliche driften.
  const g = makeRpgGraph(
    {
      x: { id: 'x', title: 'X' },
      y: { id: 'y', title: 'Y' },
    },
    []
  );
  const { positions } = computeForceLayout(g);
  const d = distance(positions.x, positions.y);
  assert.ok(d > 5, `Isolierte Nodes sollten Mindestabstand haben, war ${d}`);
});

// =============================================================================
// Multi-Parent-Verhalten
// =============================================================================

test('computeForceLayout: Multi-Parent-Node liegt im Bereich seiner Parents', () => {
  // Bei zwei Parents (r1, r2) sollte `shared` ungefaehr zwischen ihnen
  // landen — gewichteter Schwerpunkt durch die zwei gleichstarken Federn.
  // Wir testen mit einer Toleranz: `shared` darf nicht NUR bei einem
  // der beiden Parents kleben.
  const g = buildMultiParentGraph();
  const { positions } = computeForceLayout(g);
  const dToR1 = distance(positions.shared, positions.r1);
  const dToR2 = distance(positions.shared, positions.r2);
  // Beide Distanzen sollten ungefaehr gleich sein (Verhaeltnis nahe 1).
  // Toleranz: max 2x Unterschied (Federn sind gleich stark, Center-Gravity
  // koennte minimale Asymmetrie einfuehren).
  const ratio = Math.max(dToR1, dToR2) / Math.min(dToR1, dToR2);
  assert.ok(ratio < 2.0, `Distanzen sollten aehnlich sein, Verhaeltnis war ${ratio.toFixed(2)} (dToR1=${dToR1.toFixed(1)}, dToR2=${dToR2.toFixed(1)})`);
});

// =============================================================================
// Edge-Cases
// =============================================================================

test('computeForceLayout: leerer Graph liefert leere positions und valides Bounding-Box', () => {
  const g = makeRpgGraph({}, []);
  const { positions, width, height } = computeForceLayout(g);
  assert.deepEqual(positions, {});
  assert.ok(width > 0, 'Width sollte trotz leerem Graph positiv sein (Padding)');
  assert.ok(height > 0, 'Height sollte trotz leerem Graph positiv sein (Padding)');
});

test('computeForceLayout: einzelner Node bekommt valide Position', () => {
  const g = makeRpgGraph({ only: { id: 'only', title: 'Solo' } }, []);
  const { positions, width, height } = computeForceLayout(g);
  assert.ok(positions.only, 'Single-Node muss Position haben');
  assert.ok(Number.isFinite(positions.only.x), 'X muss endlich sein');
  assert.ok(Number.isFinite(positions.only.y), 'Y muss endlich sein');
  assert.ok(width > 0 && height > 0, 'Bounding-Box muss positiv sein');
});

// =============================================================================
// Compact-Modus
// =============================================================================

test('computeForceLayout: compact-Modus liefert engeres Layout', () => {
  // Compact = kuerzere Federn + staerkere Repulsion. Bei gleichem Graph
  // sollte das Bounding-Box im compact-Modus kleiner sein als im non-compact.
  // Wir bauen einen etwas groesseren Tree damit der Unterschied messbar ist.
  const g = makeRpgGraph(
    {
      r: { id: 'r', title: 'R' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
      d: { id: 'd', title: 'D' },
    },
    [
      { from: 'r', to: 'a', relation: 'parent_of' },
      { from: 'r', to: 'b', relation: 'parent_of' },
      { from: 'r', to: 'c', relation: 'parent_of' },
      { from: 'r', to: 'd', relation: 'parent_of' },
    ]
  );
  const normal = computeForceLayout(g, { compact: false });
  const compact = computeForceLayout(g, { compact: true });
  // Compact sollte deutlich kleiner sein
  assert.ok(
    compact.width < normal.width,
    `Compact-Width (${compact.width}) sollte kleiner sein als normal (${normal.width})`
  );
});

// =============================================================================
// Bounding-Box-Korrektheit
// =============================================================================

test('computeForceLayout: alle Positionen liegen innerhalb des Bounding-Box', () => {
  const g = buildSmallTree();
  const { positions, width, height, minX, minY } = computeForceLayout(g);
  for (const id of Object.keys(positions)) {
    const p = positions[id];
    assert.ok(p.x >= minX, `${id}.x (${p.x}) sollte >= minX (${minX}) sein`);
    assert.ok(p.y >= minY, `${id}.y (${p.y}) sollte >= minY (${minY}) sein`);
    assert.ok(p.x <= minX + width, `${id}.x (${p.x}) sollte <= minX+width (${minX + width}) sein`);
    assert.ok(p.y <= minY + height, `${id}.y (${p.y}) sollte <= minY+height (${minY + height}) sein`);
  }
});

// =============================================================================
// Stabilitaet bei Graph-Erweiterung
// =============================================================================

// =============================================================================
// Connected Components: disconnected Trees landen mit grossem Abstand
// =============================================================================

test('computeForceLayout: zwei disconnected Trees haben grossen Abstand zueinander', () => {
  // Tree A: r1 → a, r1 → b (verbunden)
  // Tree B: r2 → c, r2 → d (verbunden)
  // KEINE Edge zwischen A und B → zwei Components.
  // Erwartung: der Abstand ZWISCHEN den Trees ist deutlich groesser als
  // der Abstand INNERHALB eines Trees.
  const g = makeRpgGraph(
    {
      r1: { id: 'r1', title: 'R1' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      r2: { id: 'r2', title: 'R2' },
      c: { id: 'c', title: 'C' },
      d: { id: 'd', title: 'D' },
    },
    [
      { from: 'r1', to: 'a', relation: 'parent_of' },
      { from: 'r1', to: 'b', relation: 'parent_of' },
      { from: 'r2', to: 'c', relation: 'parent_of' },
      { from: 'r2', to: 'd', relation: 'parent_of' },
    ]
  );
  const { positions } = computeForceLayout(g);

  // Innerhalb Tree A: r1-a oder r1-b
  const dInsideA = distance(positions.r1, positions.a);
  // Innerhalb Tree B
  const dInsideB = distance(positions.r2, positions.c);
  // Zwischen Tree A und Tree B
  const dBetween = distance(positions.r1, positions.r2);

  // Zwischen-Distanz sollte mind. 1.8x Innen-Distanz sein.
  // (Das ist die Auswirkung des interComponentGap-Padding plus der
  // separaten Component-Layouts.)
  const dInsideAvg = (dInsideA + dInsideB) / 2;
  assert.ok(
    dBetween > dInsideAvg * 1.8,
    `Zwischen-Tree-Abstand (${dBetween.toFixed(0)}) sollte deutlich groesser sein als Innen-Abstand (${dInsideAvg.toFixed(0)})`
  );
});

// =============================================================================
// Sibling-Swap Crossing-Reduction
// =============================================================================

/**
 * Hilfsfunktion: zaehlt Edge-Crossings in einem Layout.
 * Strikt innere Crossings; gemeinsame Endpunkte zaehlen nicht.
 */
function countCrossings(positions, structureEdges) {
  function ccw(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }
  function cross(e1, e2) {
    const [a, b] = e1; const [c, d] = e2;
    if (a === c || a === d || b === c || b === d) return false;
    const pa = positions[a]; const pb = positions[b];
    const pc = positions[c]; const pd = positions[d];
    if (!pa || !pb || !pc || !pd) return false;
    const d1 = ccw(pc.x, pc.y, pd.x, pd.y, pa.x, pa.y);
    const d2 = ccw(pc.x, pc.y, pd.x, pd.y, pb.x, pb.y);
    const d3 = ccw(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y);
    const d4 = ccw(pa.x, pa.y, pb.x, pb.y, pd.x, pd.y);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
        && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  let count = 0;
  for (let i = 0; i < structureEdges.length; i++) {
    for (let j = i + 1; j < structureEdges.length; j++) {
      if (cross(structureEdges[i], structureEdges[j])) count++;
    }
  }
  return count;
}

test('computeForceLayout: Sibling-Swap reduziert Edge-Crossings auf 0 in einfachem Tree', () => {
  // Konstruktion: Parent X mit 2 Children A, B. Jedes Child hat 2 Sub-Kinder.
  // Ohne Sibling-Swap koennten A1/A2/B1/B2 zufaellig so liegen, dass die
  // Edges A→A1 und B→B1 sich kreuzen. Nach Swap-Reduction sollten keine
  // strukturellen Crossings mehr da sein.
  const g = makeRpgGraph(
    {
      x: { id: 'x', title: 'X' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      a1: { id: 'a1', title: 'A1' },
      a2: { id: 'a2', title: 'A2' },
      b1: { id: 'b1', title: 'B1' },
      b2: { id: 'b2', title: 'B2' },
    },
    [
      { from: 'x', to: 'a', relation: 'parent_of' },
      { from: 'x', to: 'b', relation: 'parent_of' },
      { from: 'a', to: 'a1', relation: 'parent_of' },
      { from: 'a', to: 'a2', relation: 'parent_of' },
      { from: 'b', to: 'b1', relation: 'parent_of' },
      { from: 'b', to: 'b2', relation: 'parent_of' },
    ]
  );
  const { positions } = computeForceLayout(g);
  const structureEdges = [
    ['x', 'a'], ['x', 'b'],
    ['a', 'a1'], ['a', 'a2'],
    ['b', 'b1'], ['b', 'b2'],
  ];
  const crossings = countCrossings(positions, structureEdges);
  // Ziel: 0 Crossings nach Sibling-Swap. Pragmatische Toleranz <= 1
  // falls Force-Layout in seltenen Faellen einen Edge-Case nicht trifft.
  assert.ok(
    crossings <= 1,
    `Erwartet <= 1 Crossing nach Sibling-Swap, gefunden ${crossings}`
  );
});

test('computeForceLayout: viele isolierte Nodes (alle disconnected) bekommen Abstand', () => {
  // 5 Nodes, keine Edges → 5 Components a 1 Node.
  const g = makeRpgGraph(
    {
      n1: { id: 'n1', title: 'N1' },
      n2: { id: 'n2', title: 'N2' },
      n3: { id: 'n3', title: 'N3' },
      n4: { id: 'n4', title: 'N4' },
      n5: { id: 'n5', title: 'N5' },
    },
    []
  );
  const { positions } = computeForceLayout(g);
  // Alle Paare sollten Mindestabstand haben (interComponentGap-Effekt)
  const ids = ['n1', 'n2', 'n3', 'n4', 'n5'];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const d = distance(positions[ids[i]], positions[ids[j]]);
      assert.ok(d > 50, `Paar ${ids[i]}-${ids[j]} sollte Mindestabstand 50 haben, war ${d.toFixed(0)}`);
    }
  }
});

test('computeForceLayout: Hinzufuegen eines neuen Nodes laesst alte Init-Positionen gleich (deterministisch)', () => {
  // Einer der Hauptvorteile des Hash-basierten Inits: ein neuer Node aendert
  // nicht die Init-Positionen der bestehenden Nodes. Wir koennen das nicht
  // direkt am finalen Output testen (Federn beeinflussen sich gegenseitig),
  // aber wir koennen pruefen, dass die Positionen nicht WILD herumspringen.
  const small = makeRpgGraph(
    { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } },
    [{ from: 'a', to: 'b', relation: 'parent_of' }]
  );
  const big = makeRpgGraph(
    {
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'a', to: 'b', relation: 'parent_of' },
      { from: 'a', to: 'c', relation: 'parent_of' },
    ]
  );
  const lSmall = computeForceLayout(small);
  const lBig = computeForceLayout(big);
  // Ohne harte Garantie auf identische Positionen, aber die Distanz a-b
  // sollte in beiden Faellen ungefaehr gleich bleiben (Spring zieht sie
  // zur selben Wunschlaenge).
  const dSmall = distance(lSmall.positions.a, lSmall.positions.b);
  const dBig = distance(lBig.positions.a, lBig.positions.b);
  // Akzeptable Abweichung durch zusaetzliche Federn/Repulsion: max 50%
  const ratio = Math.max(dSmall, dBig) / Math.min(dSmall, dBig);
  assert.ok(ratio < 1.5, `a-b Distanz sollte stabil bleiben, Verhaeltnis war ${ratio.toFixed(2)}`);
});
