/**
 * Tests fuer rpg-tree-svg.js — Form-Helper (maxNodeDepth + nodeShapePath).
 *
 * Hintergrund (Force-Layout-Refactor 2026-05-04):
 *   - maxNodeDepth Convention NEU: leaf = 0, parent of leafs = 1, etc.
 *     (frueher: leaf = 1)
 *   - nodeShapePath nimmt jetzt depth statt childCount:
 *     0 → null (Caller rendert <circle>)
 *     1 → Tropfen (Quadratic Bezier mit Q-Segmenten)
 *     2 → Linse  (Quadratic Bezier mit Q-Segmenten)
 *     3+ → Polygon mit `depth` Ecken (regularPolygonPath)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxNodeDepth, nodeShapePath, regularPolygonPath, edgeEndpoints } from '../src/lib/rpg-tree-svg.js';

// =============================================================================
// maxNodeDepth — neue Convention (leaf = 0)
// =============================================================================

test('maxNodeDepth: Leaf (keine Children) hat depth 0', () => {
  assert.equal(maxNodeDepth({ id: 'leaf', children: [] }), 0);
  assert.equal(maxNodeDepth({ id: 'leaf' }), 0, 'children-Array fehlt → trotzdem 0');
});

test('maxNodeDepth: Parent von Leafs hat depth 1', () => {
  const node = {
    id: 'p',
    children: [
      { id: 'a', children: [] },
      { id: 'b', children: [] },
    ],
  };
  assert.equal(maxNodeDepth(node), 1);
});

test('maxNodeDepth: zweistufige Hierarchie hat depth 2', () => {
  const node = {
    id: 'gp',
    children: [
      {
        id: 'p',
        children: [{ id: 'l', children: [] }],
      },
    ],
  };
  assert.equal(maxNodeDepth(node), 2);
});

test('maxNodeDepth: nimmt MAX ueber asymmetrische Subtrees', () => {
  // Ein Ast ist tief, der andere flach — Maximum gewinnt.
  const node = {
    id: 'root',
    children: [
      { id: 'shallow', children: [] }, // depth 0
      {
        id: 'deep',
        children: [
          { id: 'd1', children: [{ id: 'd2', children: [] }] },
        ],
      }, // depth 2
    ],
  };
  assert.equal(maxNodeDepth(node), 3, 'Tieferer Ast bestimmt das Ergebnis');
});

test('maxNodeDepth: defensiv bei null/undefined', () => {
  assert.equal(maxNodeDepth(null), 0);
  assert.equal(maxNodeDepth(undefined), 0);
  assert.equal(maxNodeDepth({}), 0);
});

// =============================================================================
// nodeShapePath — Form basierend auf Tiefe
// =============================================================================

test('nodeShapePath: depth 0 → null (Caller rendert Circle)', () => {
  assert.equal(nodeShapePath(0, 20), null);
});

test('nodeShapePath: depth 1 → Tropfen-Path mit Q-Segmenten', () => {
  const path = nodeShapePath(1, 20);
  assert.ok(typeof path === 'string', 'Pfad muss String sein');
  assert.match(path, /^M0/, 'Tropfen startet bei (0, top)');
  // Tropfen ist mit Q-Bezier konstruiert
  const qCount = (path.match(/Q/g) || []).length;
  assert.ok(qCount >= 3, `Tropfen sollte mehrere Q-Segmente haben, gefunden ${qCount}`);
  assert.match(path, /Z$/, 'Pfad muss geschlossen sein (Z)');
});

test('nodeShapePath: depth 2 → Linse-Path mit Q-Segmenten', () => {
  const path = nodeShapePath(2, 20);
  assert.ok(typeof path === 'string');
  assert.match(path, /^M/);
  const qCount = (path.match(/Q/g) || []).length;
  assert.ok(qCount === 2, `Linse hat genau 2 Q-Segmente, gefunden ${qCount}`);
  assert.match(path, /Z$/);
});

test('nodeShapePath: depth 3 → Polygon mit 3 Ecken (Dreieck)', () => {
  const path = nodeShapePath(3, 20);
  assert.match(path, /^M/);
  // Dreieck: 1x M + 2x L + Z = 3 Punkte
  const lCount = (path.match(/L/g) || []).length;
  assert.equal(lCount, 2, 'Dreieck hat 2 L-Segmente nach dem M');
});

test('nodeShapePath: depth 5 → Polygon mit 5 Ecken (Pentagon)', () => {
  const path = nodeShapePath(5, 20);
  const lCount = (path.match(/L/g) || []).length;
  assert.equal(lCount, 4, 'Pentagon hat 4 L-Segmente nach dem M');
});

test('nodeShapePath: defensiv bei negativen oder NaN-Werten', () => {
  assert.equal(nodeShapePath(-3, 20), null, 'Negative depth → behandelt wie 0');
  assert.equal(nodeShapePath(NaN, 20), null, 'NaN → behandelt wie 0');
});

// =============================================================================
// regularPolygonPath
// =============================================================================

test('regularPolygonPath: 3 Ecken → 1 M, 2 L, 1 Z', () => {
  const path = regularPolygonPath(3, 10);
  assert.match(path, /^M/);
  const lCount = (path.match(/L/g) || []).length;
  assert.equal(lCount, 2);
  assert.match(path, /Z$/);
});

test('regularPolygonPath: erzwingt mind. 3 Ecken auch bei kleineren Inputs', () => {
  // Defensiv: 0/1/2 als Eingabe → trotzdem mind. Dreieck.
  const path1 = regularPolygonPath(1, 10);
  const path0 = regularPolygonPath(0, 10);
  assert.equal((path1.match(/L/g) || []).length, 2, 'corners=1 → trotzdem Dreieck (2x L)');
  assert.equal((path0.match(/L/g) || []).length, 2, 'corners=0 → trotzdem Dreieck');
});

test('regularPolygonPath: erste Ecke ist oben (12-Uhr-Position)', () => {
  // Das erste Vertex sollte bei (cos(-π/2)*r, sin(-π/2)*r) = (0, -r) liegen.
  const path = regularPolygonPath(4, 10);
  // Pfad-String beginnt mit "M{x} {y} L..." — Zahlen koennen in
  // Scientific Notation sein (z.B. 6.12e-16 statt exakt 0 wegen Float-Praezision).
  const numRe = '-?\\d*\\.?\\d+(?:e[+-]?\\d+)?';
  const match = path.match(new RegExp(`^M(${numRe})\\s(${numRe})`));
  assert.ok(match, `Path sollte mit M{x} {y} starten, war: ${path}`);
  const x0 = parseFloat(match[1]);
  const y0 = parseFloat(match[2]);
  // Erlaube Numerik-Toleranz (cos(-π/2) ist nahe 0, nicht exakt 0)
  assert.ok(Math.abs(x0) < 0.01, `Erste Ecke X sollte ~0 sein, war ${x0}`);
  assert.ok(Math.abs(y0 - -10) < 0.01, `Erste Ecke Y sollte ~-10 sein, war ${y0}`);
});

// =============================================================================
// edgeEndpoints — Trim am Knotenrand
// =============================================================================

test('edgeEndpoints: trimmt um die jeweiligen Radii ab', () => {
  // Edge von (0,0) bis (100,0), beide Knoten Radius 10.
  // Trimmed: von (10,0) bis (90,0).
  const seg = edgeEndpoints(0, 0, 100, 0, 10, 10);
  assert.equal(seg.x1, 10);
  assert.equal(seg.y1, 0);
  assert.equal(seg.x2, 90);
  assert.equal(seg.y2, 0);
  assert.equal(seg.len, 80, 'len = directDistance - r1 - r2');
});

test('edgeEndpoints: degenerierte Edge (from == to) crasht nicht', () => {
  const seg = edgeEndpoints(50, 50, 50, 50, 10, 10);
  // len-Hilfswert ist 1 → Trim NaN waere problematisch, sollte aber einen
  // sinnvollen Output liefern (Position ist whatever, nur kein NaN/Crash).
  assert.ok(Number.isFinite(seg.x1));
  assert.ok(Number.isFinite(seg.y1));
  assert.ok(Number.isFinite(seg.x2));
  assert.ok(Number.isFinite(seg.y2));
});

test('edgeEndpoints: diagonale Edge wird korrekt getrimmt', () => {
  // Von (0,0) bis (3,4) — Diagonale Laenge 5. Mit r1=1, r2=1 → trim 1 von jeder Seite.
  const seg = edgeEndpoints(0, 0, 3, 4, 1, 1);
  // Einheitsvektor (3/5, 4/5). Start trimmed um (3/5, 4/5).
  assert.ok(Math.abs(seg.x1 - 0.6) < 0.001);
  assert.ok(Math.abs(seg.y1 - 0.8) < 0.001);
  assert.ok(Math.abs(seg.x2 - 2.4) < 0.001);
  assert.ok(Math.abs(seg.y2 - 3.2) < 0.001);
  assert.ok(Math.abs(seg.len - 3) < 0.001, 'len = 5 - 1 - 1 = 3');
});
