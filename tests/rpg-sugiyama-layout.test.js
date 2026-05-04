/**
 * Tests fuer rpg-sugiyama-layout.js — klassisches DAG-Layout.
 *
 * Pruefkriterien:
 *   - Layer-Korrektheit: Roots auf Y=0, Children auf groesserer Y
 *   - Multi-Parent: Layer ist max(parents.layer)+1
 *   - Crossing-Reduction: 0 Crossings auf einfachem Tree
 *   - Connected-Components: getrennte Trees rueckwaerts gepackt
 *   - Determinismus: gleiche Eingabe → identisches Layout
 *   - Edge-Cases: leerer Graph, einzelner Node
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpgGraph } from '../src/lib/rpg-quests-data.js';
import { computeSugiyamaLayout } from '../src/lib/rpg-sugiyama-layout.js';

// =============================================================================
// Helpers
// =============================================================================

function buildSmallTree() {
  return makeRpgGraph(
    {
      r: { id: 'r', title: 'R' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
    },
    [
      { from: 'r', to: 'a', relation: 'parent_of' },
      { from: 'r', to: 'b', relation: 'parent_of' },
    ]
  );
}

function countStructureCrossings(positions, structureEdges) {
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

// =============================================================================
// Layer-Korrektheit
// =============================================================================

test('Sugiyama: Root liegt vertikal ueber seinen Children', () => {
  const g = buildSmallTree();
  const { positions } = computeSugiyamaLayout(g);
  // Root y < Children y (Sugiyama: Layer 0 oben, Layer 1 darunter)
  assert.ok(positions.r.y < positions.a.y, `Root (y=${positions.r.y}) sollte ueber A (y=${positions.a.y}) liegen`);
  assert.ok(positions.r.y < positions.b.y, `Root (y=${positions.r.y}) sollte ueber B (y=${positions.b.y}) liegen`);
});

test('Sugiyama: Geschwister liegen auf gleicher Y-Layer', () => {
  const g = buildSmallTree();
  const { positions } = computeSugiyamaLayout(g);
  assert.equal(positions.a.y, positions.b.y, 'Geschwister A und B muessen gleiche Y haben');
});

test('Sugiyama: Multi-Parent-Node landet auf max-parent-Layer + 1', () => {
  // Diamond: r → a, r → b, a → c, b → c. c hat zwei Parents (a, b).
  // a und b sind beide auf Layer 1, c muss auf Layer 2 sein.
  const g = makeRpgGraph(
    {
      r: { id: 'r', title: 'R' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'r', to: 'a', relation: 'parent_of' },
      { from: 'r', to: 'b', relation: 'parent_of' },
      { from: 'a', to: 'c', relation: 'parent_of' },
      { from: 'b', to: 'c', relation: 'parent_of' },
    ]
  );
  const { positions } = computeSugiyamaLayout(g);
  // Y-Reihenfolge: r < a == b < c
  assert.ok(positions.r.y < positions.a.y);
  assert.equal(positions.a.y, positions.b.y);
  assert.ok(positions.c.y > positions.a.y);
});

test('Sugiyama: Tiefer Tree hat saubere Layer-Hierarchie', () => {
  // r → a → b → c (4 Layer)
  const g = makeRpgGraph(
    {
      r: { id: 'r', title: 'R' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'r', to: 'a', relation: 'parent_of' },
      { from: 'a', to: 'b', relation: 'parent_of' },
      { from: 'b', to: 'c', relation: 'parent_of' },
    ]
  );
  const { positions } = computeSugiyamaLayout(g);
  assert.ok(positions.r.y < positions.a.y);
  assert.ok(positions.a.y < positions.b.y);
  assert.ok(positions.b.y < positions.c.y);
});

// =============================================================================
// Crossing-Reduction
// =============================================================================

test('Sugiyama: einfacher Tree hat 0 Crossings', () => {
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
  const { positions } = computeSugiyamaLayout(g);
  const structureEdges = [
    ['x', 'a'], ['x', 'b'],
    ['a', 'a1'], ['a', 'a2'],
    ['b', 'b1'], ['b', 'b2'],
  ];
  assert.equal(
    countStructureCrossings(positions, structureEdges),
    0,
    'Klassischer Tree muss 0 Crossings haben'
  );
});

test('Sugiyama: Diamond-Pattern hat minimale Crossings', () => {
  // Vier-Punkt-Diamond: r → a, r → b, a → c, a → d, b → c, b → d
  // Crossings sind hier strukturell unvermeidbar (cross-edges zwischen
  // zwei Layern), aber die Median-Heuristik sollte sie minimieren.
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
      { from: 'a', to: 'c', relation: 'parent_of' },
      { from: 'a', to: 'd', relation: 'parent_of' },
      { from: 'b', to: 'c', relation: 'parent_of' },
      { from: 'b', to: 'd', relation: 'parent_of' },
    ]
  );
  const { positions } = computeSugiyamaLayout(g);
  const structureEdges = [
    ['r', 'a'], ['r', 'b'],
    ['a', 'c'], ['a', 'd'],
    ['b', 'c'], ['b', 'd'],
  ];
  const crossings = countStructureCrossings(positions, structureEdges);
  // Bei diesem Pattern sind 1-2 Crossings akzeptabel (Median-Heuristik
  // ist nicht garantiert optimal, aber selten weit weg).
  assert.ok(crossings <= 2, `Diamond max 2 Crossings erwartet, bekommen ${crossings}`);
});

// =============================================================================
// Connected Components
// =============================================================================

test('Sugiyama: zwei disconnected Trees haben klar getrennte Positionen', () => {
  const g = makeRpgGraph(
    {
      r1: { id: 'r1', title: 'R1' },
      a: { id: 'a', title: 'A' },
      r2: { id: 'r2', title: 'R2' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'r1', to: 'a', relation: 'parent_of' },
      { from: 'r2', to: 'c', relation: 'parent_of' },
    ]
  );
  const { positions } = computeSugiyamaLayout(g);
  // Innerhalb jeder Component: Root oberhalb seines Children.
  assert.ok(positions.r1.y < positions.a.y, 'r1 muss ueber a liegen');
  assert.ok(positions.r2.y < positions.c.y, 'r2 muss ueber c liegen');
  // Components muessen klar getrennt sein — entweder horizontal oder vertikal,
  // aber sicher nicht uebereinander gestapelt.
  const dxRoots = Math.abs(positions.r1.x - positions.r2.x);
  const dyRoots = Math.abs(positions.r1.y - positions.r2.y);
  assert.ok(
    dxRoots + dyRoots > 100,
    `Roots der getrennten Components muessen klar auseinander liegen, war dx+dy=${dxRoots + dyRoots}`
  );
});

// =============================================================================
// Determinismus
// =============================================================================

test('Sugiyama: gleicher Graph liefert identisches Layout', () => {
  const g = buildSmallTree();
  const l1 = computeSugiyamaLayout(g);
  const l2 = computeSugiyamaLayout(g);
  for (const id of Object.keys(l1.positions)) {
    assert.equal(l1.positions[id].x, l2.positions[id].x);
    assert.equal(l1.positions[id].y, l2.positions[id].y);
  }
});

test('Sugiyama: verschiedene Edge-Insertion-Reihenfolge liefert gleiches Layout', () => {
  const a = makeRpgGraph(
    {
      r: { id: 'r', title: 'R' },
      x: { id: 'x', title: 'X' },
      y: { id: 'y', title: 'Y' },
    },
    [
      { from: 'r', to: 'x', relation: 'parent_of' },
      { from: 'r', to: 'y', relation: 'parent_of' },
    ]
  );
  const b = makeRpgGraph(
    {
      r: { id: 'r', title: 'R' },
      x: { id: 'x', title: 'X' },
      y: { id: 'y', title: 'Y' },
    },
    [
      { from: 'r', to: 'y', relation: 'parent_of' },
      { from: 'r', to: 'x', relation: 'parent_of' },
    ]
  );
  const la = computeSugiyamaLayout(a);
  const lb = computeSugiyamaLayout(b);
  for (const id of ['r', 'x', 'y']) {
    assert.equal(la.positions[id].x, lb.positions[id].x);
    assert.equal(la.positions[id].y, lb.positions[id].y);
  }
});

// =============================================================================
// Dependency-Edges beeinflussen Layout nicht
// =============================================================================

test('Sugiyama: dependency-Edge zwingt Knoten NICHT in andere Layer', () => {
  // Zwei separate Quest-Trees, verbunden nur via dependency.
  // Beide Roots sollten auf Layer 0 bleiben (Querverbindung "neben" den Trees).
  const g = makeRpgGraph(
    {
      r1: { id: 'r1', title: 'R1' },
      a: { id: 'a', title: 'A' },
      r2: { id: 'r2', title: 'R2' },
      b: { id: 'b', title: 'B' },
    },
    [
      { from: 'r1', to: 'a', relation: 'parent_of' },
      { from: 'r2', to: 'b', relation: 'parent_of' },
      { from: 'r1', to: 'r2', relation: 'dependency' },
    ]
  );
  const { positions } = computeSugiyamaLayout(g);
  // r1 und r2 muessen beide auf Layer 0 sein (gleiche Y), trotz
  // dependency-Edge. Sie sind in derselben Component (durch dependency
  // verbunden), aber die Layer-Hierarchie zaehlt nur parent_of.
  assert.equal(
    positions.r1.y, positions.r2.y,
    `r1 (y=${positions.r1.y}) und r2 (y=${positions.r2.y}) muessen beide auf Layer 0 sein — dependency darf das Layout nicht verformen`
  );
});

// =============================================================================
// Edge-Cases
// =============================================================================

test('Sugiyama: leerer Graph gibt valides Bounding-Box', () => {
  const g = makeRpgGraph({}, []);
  const { positions, width, height } = computeSugiyamaLayout(g);
  assert.deepEqual(positions, {});
  assert.ok(width > 0);
  assert.ok(height > 0);
});

test('Sugiyama: einzelner isolierter Node bekommt Position', () => {
  const g = makeRpgGraph({ only: { id: 'only', title: 'Solo' } }, []);
  const { positions } = computeSugiyamaLayout(g);
  assert.ok(positions.only);
  assert.ok(Number.isFinite(positions.only.x));
  assert.ok(Number.isFinite(positions.only.y));
});

test('Sugiyama: viele isolierte Nodes werden mit Abstand verteilt', () => {
  const g = makeRpgGraph(
    {
      n1: { id: 'n1', title: 'N1' },
      n2: { id: 'n2', title: 'N2' },
      n3: { id: 'n3', title: 'N3' },
    },
    []
  );
  const { positions } = computeSugiyamaLayout(g);
  const ids = ['n1', 'n2', 'n3'];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const dx = positions[ids[i]].x - positions[ids[j]].x;
      const dy = positions[ids[i]].y - positions[ids[j]].y;
      const d = Math.hypot(dx, dy);
      assert.ok(d > 50, `Paar ${ids[i]}-${ids[j]} sollte Mindestabstand haben`);
    }
  }
});

// =============================================================================
// Compact-Modus
// =============================================================================

test('Sugiyama: compact-Modus liefert engeres Layout', () => {
  const g = makeRpgGraph(
    {
      r: { id: 'r', title: 'R' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'r', to: 'a', relation: 'parent_of' },
      { from: 'r', to: 'b', relation: 'parent_of' },
      { from: 'r', to: 'c', relation: 'parent_of' },
    ]
  );
  const normal = computeSugiyamaLayout(g, { compact: false });
  const compact = computeSugiyamaLayout(g, { compact: true });
  assert.ok(
    compact.width < normal.width,
    `Compact width (${compact.width}) sollte kleiner sein als normal (${normal.width})`
  );
});

// =============================================================================
// Bounding-Box-Korrektheit
// =============================================================================

test('Sugiyama: alle Positionen liegen innerhalb des Bounding-Box', () => {
  const g = buildSmallTree();
  const { positions, width, height, minX, minY } = computeSugiyamaLayout(g);
  for (const id of Object.keys(positions)) {
    const p = positions[id];
    assert.ok(p.x >= minX, `${id}.x ${p.x} >= minX ${minX}`);
    assert.ok(p.y >= minY, `${id}.y ${p.y} >= minY ${minY}`);
    assert.ok(p.x <= minX + width);
    assert.ok(p.y <= minY + height);
  }
});
