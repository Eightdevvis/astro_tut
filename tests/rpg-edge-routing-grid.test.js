/**
 * Tests fuer rpg-edge-routing-grid.js — A*-Edge-Routing.
 *
 * Pruefkriterien (laut User-Empfehlung):
 *   - Ohne Hindernisse: gerader Pfad mit `sampleCount` Stuetzpunkten.
 *   - Mit Hindernis: A* findet Umweg → type='spline', samples weichen
 *     vom direkten Pfad ab.
 *   - Mit excludeIds: Endpunkte werden nicht als Hindernisse gewertet.
 *   - Bei umzingeltem Target: Fallback auf gerade Linie + cut=true.
 *   - Sample-Count wird exakt eingehalten (Animation-Faehigkeit).
 *   - SVG-Pfad-Format ist gueltig (M am Anfang, optional C-Segmente).
 *   - Degenerierte Edge (from == to) crasht nicht.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeEdge } from '../src/lib/rpg-edge-routing-grid.js';

// =============================================================================
// Default: gerader Pfad
// =============================================================================

test('routeEdge: keine Hindernisse → samples auf direktem Pfad', () => {
  const result = routeEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, []);
  assert.equal(result.cut, false);
  assert.equal(result.samples.length, 16, 'Default-sampleCount = 16');
  // Erster Sample = Start, letzter = Ziel
  assert.ok(Math.abs(result.samples[0].x - 0) < 5);
  assert.ok(Math.abs(result.samples[0].y - 0) < 5);
  assert.ok(Math.abs(result.samples[15].x - 100) < 5);
  assert.ok(Math.abs(result.samples[15].y - 0) < 5);
});

test('routeEdge: keine Hindernisse → SVG-Pfad startet mit M', () => {
  const result = routeEdge({ x: 10, y: 20 }, { x: 200, y: 80 }, []);
  assert.match(result.d, /^M[\d.\-]+\s[\d.\-]+/);
});

// =============================================================================
// Hindernis-Vermeidung
// =============================================================================

test('routeEdge: Hindernis mitten auf der Linie → samples weichen aus', () => {
  // Hindernis sitzt direkt zwischen from und to. A* sollte einen Umweg finden.
  const obstacles = [{ id: 'mid', x: 100, y: 0, radius: 30 }];
  const result = routeEdge({ x: 0, y: 0 }, { x: 200, y: 0 }, obstacles);
  // type sollte 'spline' sein (Umweg gefunden)
  assert.equal(result.type, 'spline');
  assert.equal(result.cut, false);
  // Mindestens ein Sample-Punkt sollte signifikant von y=0 abweichen
  // (das Hindernis um zu umgehen)
  const maxDeviation = Math.max(...result.samples.map((s) => Math.abs(s.y)));
  assert.ok(maxDeviation > 15, `Mind. ein Sample sollte vom Hindernis ausweichen (max y-Abweichung ${maxDeviation.toFixed(1)})`);
});

test('routeEdge: Hindernis seitlich → bleibt auf direktem Pfad', () => {
  // Hindernis liegt 80px seitlich von der direkten Linie — kein Eingriff.
  const obstacles = [{ id: 'side', x: 100, y: 80, radius: 20 }];
  const result = routeEdge({ x: 0, y: 0 }, { x: 200, y: 0 }, obstacles);
  // type sollte 'line' sein (keine Behinderung)
  assert.equal(result.type, 'line');
  assert.equal(result.cut, false);
});

// =============================================================================
// excludeIds: Endpunkte ignorieren
// =============================================================================

test('routeEdge: excludeIds laesst from/to als Hindernisse weg', () => {
  // Source und Target selbst sind in der Obstacle-Liste — duerfen aber
  // nicht zaehlen, sonst koennte A* den Pfad nicht finden.
  const obstacles = [
    { id: 'fromN', x: 0, y: 0, radius: 30 },
    { id: 'toN', x: 200, y: 0, radius: 30 },
  ];
  const result = routeEdge(
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    obstacles,
    { excludeIds: new Set(['fromN', 'toN']) }
  );
  assert.equal(result.cut, false, 'A* sollte einen Pfad finden');
  assert.equal(result.samples.length, 16);
});

// =============================================================================
// Fallback: umzingeltes Target
// =============================================================================

test('routeEdge: umzingelter Target → Fallback gerade Linie, cut=true', () => {
  // Target ist von 4 Hindernissen umzingelt — A* findet keinen Pfad.
  // Erwartet: gerade Linie als Fallback, cut-Flag gesetzt.
  const tx = 200;
  const ty = 0;
  const obstacles = [
    { id: 'top', x: tx, y: ty - 30, radius: 25 },
    { id: 'bot', x: tx, y: ty + 30, radius: 25 },
    { id: 'left', x: tx - 30, y: ty, radius: 25 },
    { id: 'right', x: tx + 30, y: ty, radius: 25 },
  ];
  const result = routeEdge({ x: 0, y: 0 }, { x: tx, y: ty }, obstacles);
  assert.equal(result.cut, true, 'Bei umzingeltem Target → cut=true');
  assert.equal(result.type, 'line', 'Fallback ist gerade Linie');
  assert.equal(result.samples.length, 16);
});

// =============================================================================
// Sample-Count
// =============================================================================

test('routeEdge: sampleCount wird exakt eingehalten', () => {
  const result1 = routeEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, [], { sampleCount: 8 });
  const result2 = routeEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, [], { sampleCount: 32 });
  assert.equal(result1.samples.length, 8);
  assert.equal(result2.samples.length, 32);
});

test('routeEdge: minimaler sampleCount = 2 wird erzwungen', () => {
  // sampleCount unter 2 macht keinen Sinn (kein Pfad interpretierbar).
  const result = routeEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, [], { sampleCount: 1 });
  assert.equal(result.samples.length, 2, 'sampleCount=1 wird auf 2 angehoben');
});

// =============================================================================
// Edge-Cases
// =============================================================================

test('routeEdge: degenerierte Edge (from == to) crasht nicht', () => {
  const result = routeEdge({ x: 50, y: 50 }, { x: 50, y: 50 }, [
    { id: 'irrelevant', x: 0, y: 0, radius: 10 },
  ]);
  assert.equal(result.samples.length, 16);
  assert.equal(result.cut, false);
  // Alle Samples sollten am Punkt (50, 50) sein
  for (const s of result.samples) {
    assert.equal(s.x, 50);
    assert.equal(s.y, 50);
  }
});

test('routeEdge: leere Hindernisliste → gerader Pfad', () => {
  const result = routeEdge({ x: 0, y: 0 }, { x: 100, y: 100 }, []);
  assert.equal(result.cut, false);
  assert.equal(result.type, 'line');
});

// =============================================================================
// SVG-Pfad-Format
// =============================================================================

test('routeEdge: spline-output enthaelt Cubic-Bezier-Segmente (C)', () => {
  const obstacles = [{ id: 'mid', x: 100, y: 0, radius: 30 }];
  const result = routeEdge({ x: 0, y: 0 }, { x: 200, y: 0 }, obstacles);
  if (result.type === 'spline') {
    assert.match(result.d, /C/, 'Spline-Pfad enthaelt mindestens ein C-Segment');
  }
});

test('routeEdge: alle Sample-Koordinaten sind endlich (kein NaN)', () => {
  const result = routeEdge({ x: 0, y: 0 }, { x: 200, y: 100 }, [
    { id: 'h1', x: 50, y: 30, radius: 15 },
    { id: 'h2', x: 150, y: 70, radius: 15 },
  ]);
  for (const s of result.samples) {
    assert.ok(Number.isFinite(s.x), `Sample.x muss endlich sein, war ${s.x}`);
    assert.ok(Number.isFinite(s.y), `Sample.y muss endlich sein, war ${s.y}`);
  }
});

// =============================================================================
// Animation-Faehigkeit: feste Punktanzahl bei beliebiger Edge-Laenge
// =============================================================================

test('routeEdge: kurze und lange Edges haben identische Sample-Count', () => {
  // Animation braucht: gleiche Punktanzahl unabhaengig von Laenge,
  // damit Punkt-zu-Punkt-Tween moeglich ist.
  const short = routeEdge({ x: 0, y: 0 }, { x: 30, y: 0 }, []);
  const long = routeEdge({ x: 0, y: 0 }, { x: 1000, y: 500 }, []);
  assert.equal(short.samples.length, long.samples.length);
});

test('routeEdge: samples sind monoton (von start nach ziel) — keine Schleifen', () => {
  // Bei einem direkten Pfad sollten die Samples chronologisch von Start
  // zu Ziel laufen — kein "Hin und Zurueck".
  const result = routeEdge({ x: 0, y: 0 }, { x: 200, y: 0 }, []);
  // Pruefen: x-Koordinate steigt monoton (oder bleibt gleich)
  for (let i = 1; i < result.samples.length; i++) {
    assert.ok(
      result.samples[i].x >= result.samples[i - 1].x - 0.1,
      `Sample ${i}.x (${result.samples[i].x.toFixed(1)}) sollte >= Sample ${i - 1}.x (${result.samples[i - 1].x.toFixed(1)}) sein`
    );
  }
});
