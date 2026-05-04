/**
 * rpg-edge-routing-grid.js
 * ========================
 *
 * Grid-basiertes A*-Edge-Routing fuer den Quest-Baum.
 *
 * Konzept (User-Empfehlung 2026-05-04)
 * ────────────────────────────────────
 * Nach Force-Layout-Konvergenz:
 *   1. Grid ueber den Viewport legen (Aufloesung 12px)
 *   2. Nodes als blockierte Zellen mit Padding (Edges sollen nicht direkt am
 *      Knoten-Rand kleben)
 *   3. Pro Edge: A* von Source-Cell zu Target-Cell — 8-Richtungen-Bewegung,
 *      euklidische Heuristik
 *   4. Ergibt Polyline die Hindernisse umgeht
 *   5. Catmull-Rom-Smoothing → weiche, organische Kurven
 *   6. Resample auf 16 Stuetzpunkte fuer spaetere Punkt-zu-Punkt-Animation
 *   7. SVG-Pfad aus den samples (erneut Catmull-Rom als Cubic-Bezier)
 *
 * Output ist API-abwaerts-kompatibel mit dem alten `rpg-edge-routing.js`
 * `{ d, type, cut }` — plus zusaetzlich `samples` als feste Punktanzahl
 * fuer Animation-Fakeit (Tween zwischen alt/neu).
 *
 * Fallback: wenn A* keinen Pfad findet (z.B. Target ist vollstaendig
 * von Hindernissen umzingelt), wird die gerade Linie zurueckgegeben mit
 * `cut: true`.
 *
 * Cache-Strategie: der Aufrufer (z.B. RpgQuestTree.jsx) sollte die
 * Routing-Ergebnisse pro Edge memoisieren (`useMemo`-Dependency = alle
 * Positionen + Hindernis-Liste). Dieses Modul ist stateless.
 */

/** @typedef {{ x: number; y: number }} Point */
/** @typedef {{ x: number; y: number; radius: number; id?: string }} Obstacle */

// ============================================================================
// 1. Min-Heap (Priority Queue fuer A*)
// ============================================================================

/**
 * Min-Heap mit Vergleichsfunktion. Wird im A* als Open-Set genutzt —
 * wir brauchen schnell den Knoten mit dem niedrigsten f-Score.
 *
 * Klassische Binary-Heap-Implementation: push (O(log n)), pop (O(log n)),
 * peek (O(1)). Ausreichend schnell fuer unsere Grid-Groessen (~5000 Cells).
 */
class MinHeap {
  /** @param {(a: any, b: any) => number} cmp */
  constructor(cmp) {
    /** @type {any[]} */
    this.data = [];
    this.cmp = cmp;
  }
  get size() { return this.data.length; }
  get empty() { return this.data.length === 0; }

  /** @param {any} item */
  push(item) {
    this.data.push(item);
    // Sift-up: solange Parent groesser ist, tausche
    let i = this.data.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.cmp(this.data[i], this.data[parent]) >= 0) break;
      [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
      i = parent;
    }
  }

  /** @returns {any} */
  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      // Sift-down
      let i = 0;
      const n = this.data.length;
      while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.cmp(this.data[l], this.data[smallest]) < 0) smallest = l;
        if (r < n && this.cmp(this.data[r], this.data[smallest]) < 0) smallest = r;
        if (smallest === i) break;
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      }
    }
    return top;
  }
}

// ============================================================================
// 2. Grid-Aufbau (Hindernis-Maske)
// ============================================================================

/**
 * Baut ein Grid ueber die Bounding-Box aller Hindernisse plus Source/Target.
 * Markiert Cells als blockiert wenn sie innerhalb (obstacle.radius + padding)
 * eines Obstacles liegen — A* meidet diese Cells.
 *
 * Das Grid ist gross genug um from/to einzuschliessen (mit Margin) und
 * alle Hindernisse, plus etwas Reserveplatz aussenrum. So findet A* auch
 * dann einen Weg, wenn er ueber das Hindernis-Cluster aussenrum gehen muss.
 *
 * @param {Point} from
 * @param {Point} to
 * @param {Obstacle[]} obstacles
 * @param {{ resolution: number; padding: number; excludeIds?: Set<string> }} opts
 * @returns {{
 *   width: number;
 *   height: number;
 *   resolution: number;
 *   originX: number;
 *   originY: number;
 *   blocked: Uint8Array;
 *   fromCell: { x: number; y: number };
 *   toCell: { x: number; y: number };
 * }}
 */
function buildGrid(from, to, obstacles, opts) {
  const { resolution, padding, excludeIds } = opts;

  // Bounding-Box: schliesst alle relevanten Punkte ein, plus Margin.
  // Margin = grossess Hindernis-Radius + 4 Cells, damit A* Umweg-Wege
  // ausserhalb des dichten Bereichs findet wenn noetig.
  let minX = Math.min(from.x, to.x);
  let maxX = Math.max(from.x, to.x);
  let minY = Math.min(from.y, to.y);
  let maxY = Math.max(from.y, to.y);
  let maxObstacleRadius = 0;
  for (const o of obstacles) {
    if (excludeIds && o.id && excludeIds.has(o.id)) continue;
    minX = Math.min(minX, o.x - o.radius);
    maxX = Math.max(maxX, o.x + o.radius);
    minY = Math.min(minY, o.y - o.radius);
    maxY = Math.max(maxY, o.y + o.radius);
    if (o.radius > maxObstacleRadius) maxObstacleRadius = o.radius;
  }
  const margin = maxObstacleRadius + padding + resolution * 4;
  const originX = minX - margin;
  const originY = minY - margin;
  const spanX = (maxX + margin) - originX;
  const spanY = (maxY + margin) - originY;
  const width = Math.ceil(spanX / resolution);
  const height = Math.ceil(spanY / resolution);

  // Blocked-Maske: Uint8Array (0 = frei, 1 = blockiert) — schneller als Set<string>.
  const blocked = new Uint8Array(width * height);

  // Fuer jedes Hindernis alle Cells innerhalb (radius + padding) markieren.
  for (const o of obstacles) {
    if (excludeIds && o.id && excludeIds.has(o.id)) continue;
    const r = o.radius + padding;
    const cellMinX = Math.max(0, Math.floor((o.x - r - originX) / resolution));
    const cellMaxX = Math.min(width - 1, Math.ceil((o.x + r - originX) / resolution));
    const cellMinY = Math.max(0, Math.floor((o.y - r - originY) / resolution));
    const cellMaxY = Math.min(height - 1, Math.ceil((o.y + r - originY) / resolution));
    const r2 = r * r;
    for (let cy = cellMinY; cy <= cellMaxY; cy++) {
      for (let cx = cellMinX; cx <= cellMaxX; cx++) {
        // Cell-Mittelpunkt im Welt-Koordinatensystem
        const wx = originX + cx * resolution + resolution / 2;
        const wy = originY + cy * resolution + resolution / 2;
        const dx = wx - o.x;
        const dy = wy - o.y;
        if (dx * dx + dy * dy <= r2) {
          blocked[cy * width + cx] = 1;
        }
      }
    }
  }

  // From/To-Cell aus Welt-Koordinate. Source/Target IMMER frei machen,
  // sonst kann A* nicht starten/enden (typischerweise sind from/to
  // ohnehin am Knotenrand, koennten aber leicht in Block-Zone liegen).
  const fromCell = {
    x: Math.max(0, Math.min(width - 1, Math.floor((from.x - originX) / resolution))),
    y: Math.max(0, Math.min(height - 1, Math.floor((from.y - originY) / resolution))),
  };
  const toCell = {
    x: Math.max(0, Math.min(width - 1, Math.floor((to.x - originX) / resolution))),
    y: Math.max(0, Math.min(height - 1, Math.floor((to.y - originY) / resolution))),
  };
  blocked[fromCell.y * width + fromCell.x] = 0;
  blocked[toCell.y * width + toCell.x] = 0;

  return { width, height, resolution, originX, originY, blocked, fromCell, toCell };
}

// ============================================================================
// 3. A*-Pathfinding
// ============================================================================

// 8-Richtungen-Bewegung: vier Achsen + vier Diagonalen.
// dx, dy, cost. Diagonale Cost = sqrt(2) ≈ 1.41.
const NEIGHBORS_8 = [
  [1, 0, 1],  [-1, 0, 1],  [0, 1, 1],  [0, -1, 1],
  [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * A*-Pathfinding mit euklidischer Heuristik und 8-Richtungen-Bewegung.
 * Liefert eine Cell-Sequenz von Source zu Target oder null wenn kein Weg.
 *
 * Heuristik: Octile-Distance (akkurater als Manhattan fuer 8-Richtungen)
 * = max(|dx|, |dy|) + (sqrt(2) - 1) * min(|dx|, |dy|).
 * Sie ist konsistent (admissible), A* findet den optimalen Pfad.
 *
 * @param {ReturnType<typeof buildGrid>} grid
 * @returns {Array<{ x: number; y: number }> | null}
 */
function aStar(grid) {
  const { width, height, blocked, fromCell, toCell } = grid;
  const startIdx = fromCell.y * width + fromCell.x;
  const goalIdx = toCell.y * width + toCell.x;

  // gScore: best-known cost from start to cell (key = idx)
  /** @type {Map<number, number>} */
  const gScore = new Map();
  gScore.set(startIdx, 0);
  // cameFrom: idx → previous-idx (zum Pfad-Rekonstruieren)
  /** @type {Map<number, number>} */
  const cameFrom = new Map();
  // closed: bereits abgeschlossene Cells
  /** @type {Set<number>} */
  const closed = new Set();

  const open = new MinHeap((a, b) => a.f - b.f);
  open.push({ x: fromCell.x, y: fromCell.y, idx: startIdx, f: heuristic(fromCell, toCell) });

  while (!open.empty) {
    const current = open.pop();
    if (current.idx === goalIdx) {
      // Pfad rekonstruieren: rueckwaerts von goal zu start, dann umkehren
      const path = [{ x: current.x, y: current.y }];
      let p = current.idx;
      while (cameFrom.has(p)) {
        p = cameFrom.get(p);
        const x = p % width;
        const y = (p - x) / width;
        path.push({ x, y });
      }
      path.reverse();
      return path;
    }
    if (closed.has(current.idx)) continue;
    closed.add(current.idx);

    for (const [dx, dy, cost] of NEIGHBORS_8) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (closed.has(nIdx)) continue;
      if (blocked[nIdx]) continue;
      // Diagonale Bewegung darf nicht durch eine "Ecke" zwischen zwei
      // blockierten Cells (sonst koennte sich der Pfad durch eine Wand zwingen).
      if (dx !== 0 && dy !== 0) {
        const sideAIdx = current.y * width + nx;
        const sideBIdx = ny * width + current.x;
        if (blocked[sideAIdx] && blocked[sideBIdx]) continue;
      }
      const tentativeG = gScore.get(current.idx) + cost;
      if (!gScore.has(nIdx) || tentativeG < gScore.get(nIdx)) {
        cameFrom.set(nIdx, current.idx);
        gScore.set(nIdx, tentativeG);
        const f = tentativeG + heuristic({ x: nx, y: ny }, toCell);
        open.push({ x: nx, y: ny, idx: nIdx, f });
      }
    }
  }
  return null; // kein Pfad gefunden
}

/** Octile-Distance — heuristic fuer 8-Richtungen-Grids. */
function heuristic(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

// ============================================================================
// 4. Polyline-Verarbeitung: Cleanup + Catmull-Rom + Resampling
// ============================================================================

/**
 * Vereinfacht eine Cell-Polyline indem fast-kollineare Zwischenpunkte
 * entfernt werden. A* produziert oft viele Punkte auf einer geraden Linie
 * (Cell-Mittelpunkte haben aber kleine Pixel-Versaetze gegen die exakten
 * from/to-Positionen). Wir messen Punkt-zu-Linie-Distanz mit Pixel-Toleranz
 * statt rohem Cross-Product — verhindert dass minimale Versaetze als
 * "Knick" gewertet werden.
 *
 * Ohne diese Toleranz wuerden gerade Pfade vom A* faelschlich als
 * "spline" klassifiziert, was Tests + Verhaltens-Check brechen koennte.
 *
 * @param {Array<{ x: number; y: number }>} polyline
 * @returns {Array<{ x: number; y: number }>}
 */
function simplifyCollinear(polyline) {
  if (polyline.length <= 2) return polyline;
  // Toleranz in Pixeln. Cell-Resolution 12 → Versaetze sind <6px;
  // 1.5 ist generous genug fuer Floating-Point-Rauschen.
  const tolerance = 1.5;
  const out = [polyline[0]];
  for (let i = 1; i < polyline.length - 1; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const c = polyline[i + 1];
    const acDx = c.x - a.x;
    const acDy = c.y - a.y;
    const acLen = Math.hypot(acDx, acDy);
    if (acLen < 0.0001) continue; // a == c → b weglassen
    // Senkrechter Abstand von b zur Linie a→c: |cross| / |a→c|.
    const cross = acDx * (b.y - a.y) - acDy * (b.x - a.x);
    const dist = Math.abs(cross) / acLen;
    if (dist > tolerance) out.push(b);
  }
  out.push(polyline[polyline.length - 1]);
  return out;
}

/**
 * Konvertiert Cell-Koordinaten zurueck in Welt-Koordinaten (Cell-Mittelpunkt).
 * @param {Array<{ x: number; y: number }>} cells
 * @param {{ originX: number; originY: number; resolution: number }} grid
 * @returns {Array<{ x: number; y: number }>}
 */
function cellsToWorld(cells, grid) {
  const half = grid.resolution / 2;
  return cells.map((c) => ({
    x: grid.originX + c.x * grid.resolution + half,
    y: grid.originY + c.y * grid.resolution + half,
  }));
}

/**
 * Catmull-Rom-Spline-Auswertung fuer einen Parameter t in [0, 1] entlang
 * der Spline durch alle `points`. Tension-Parameter steuert wie eng die
 * Kurve den Punkten folgt (0.5 = uniform Catmull-Rom, klassisch).
 *
 * Implementation: pro Segment p[i] → p[i+1] ein Cubic-Hermite-Interpolation
 * mit Tangenten aus benachbarten Punkten.
 *
 * @param {Array<{ x: number; y: number }>} points
 * @param {number} t — globale Parameter [0, 1]
 * @param {number} tension — typischerweise 0.5
 * @returns {{ x: number; y: number }}
 */
function evalCatmullRom(points, t, tension) {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { ...points[0] };
  if (n === 2) {
    // Lineare Interpolation
    return {
      x: points[0].x + (points[1].x - points[0].x) * t,
      y: points[0].y + (points[1].y - points[0].y) * t,
    };
  }
  // Globale t-Skalierung auf Segment-Index + lokale t
  const tt = t * (n - 1);
  let i = Math.floor(tt);
  if (i >= n - 1) i = n - 2;
  const localT = tt - i;
  // Tangenten via tension-skalierte Differenzen der Nachbarn.
  // Randpunkte (i=0, i=n-2) duplizieren den jeweiligen Endpunkt.
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n - 1, i + 2)];
  const m1x = (p2.x - p0.x) * tension;
  const m1y = (p2.y - p0.y) * tension;
  const m2x = (p3.x - p1.x) * tension;
  const m2y = (p3.y - p1.y) * tension;
  // Hermite-Basisfunktionen
  const t2 = localT * localT;
  const t3 = t2 * localT;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + localT;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return {
    x: h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
    y: h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y,
  };
}

/**
 * Resampling der Catmull-Rom-Spline auf `count` Punkte gleichmaessig
 * entlang der Bogenlaenge. Fuer Animation-Faehigkeit: alte und neue
 * Pfade haben dieselbe Punktanzahl → punkt-zu-punkt-tweenbar.
 *
 * Algorithmus:
 *   1. Spline an `denseSamples` Punkten auswerten (z.B. 200) — ergibt
 *      eine dichte Polyline.
 *   2. Kumulative Bogenlaenge berechnen.
 *   3. Fuer jeden Ziel-Sample (i in [0..count-1]): Bogenlaenge =
 *      i/(count-1) * total. Den Punkt auf der dichten Polyline finden,
 *      linear interpolieren zwischen zwei Nachbarsamples.
 *
 * @param {Array<{ x: number; y: number }>} controlPoints
 * @param {number} count — Anzahl Output-Samples
 * @param {number} tension
 * @returns {Array<{ x: number; y: number }>}
 */
function arcLengthResample(controlPoints, count, tension) {
  if (count < 2) return controlPoints.slice(0, count);
  if (controlPoints.length < 2) {
    return Array.from({ length: count }, () => ({ ...controlPoints[0] || { x: 0, y: 0 } }));
  }
  // Schritt 1: dichte Auswertung
  const denseN = Math.max(50, controlPoints.length * 12);
  /** @type {Array<{ x: number; y: number }>} */
  const dense = [];
  for (let i = 0; i < denseN; i++) {
    dense.push(evalCatmullRom(controlPoints, i / (denseN - 1), tension));
  }
  // Schritt 2: kumulative Bogenlaenge
  const cumLen = new Float64Array(denseN);
  cumLen[0] = 0;
  for (let i = 1; i < denseN; i++) {
    const dx = dense[i].x - dense[i - 1].x;
    const dy = dense[i].y - dense[i - 1].y;
    cumLen[i] = cumLen[i - 1] + Math.hypot(dx, dy);
  }
  const total = cumLen[denseN - 1];
  // Schritt 3: gleichmaessig samplen nach Bogenlaenge
  /** @type {Array<{ x: number; y: number }>} */
  const out = [];
  let denseIdx = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / (count - 1)) * total;
    // Vorruecken bis cumLen[denseIdx+1] >= target
    while (denseIdx < denseN - 2 && cumLen[denseIdx + 1] < target) denseIdx++;
    if (denseIdx >= denseN - 1) {
      out.push({ ...dense[denseN - 1] });
      continue;
    }
    const segLen = cumLen[denseIdx + 1] - cumLen[denseIdx];
    const t = segLen > 0.0001 ? (target - cumLen[denseIdx]) / segLen : 0;
    out.push({
      x: dense[denseIdx].x + (dense[denseIdx + 1].x - dense[denseIdx].x) * t,
      y: dense[denseIdx].y + (dense[denseIdx + 1].y - dense[denseIdx].y) * t,
    });
  }
  return out;
}

// ============================================================================
// 5. SVG-Pfad aus Samples (erneut Catmull-Rom als Cubic-Bezier)
// ============================================================================

/**
 * Baut einen SVG-Pfad-String aus Sample-Punkten — Catmull-Rom-Spline
 * konvertiert in eine Cubic-Bezier-Sequenz. Der Pfad geht durch alle
 * Samples und ist C1-stetig (keine sichtbaren Knicke).
 *
 * Konvertierung Catmull-Rom → Cubic-Bezier (klassisch):
 *   Pro Segment p[i] → p[i+1]:
 *   B0 = p[i]
 *   B1 = p[i] + (p[i+1] - p[i-1]) / 6
 *   B2 = p[i+1] - (p[i+2] - p[i]) / 6
 *   B3 = p[i+1]
 *
 * Tangenten werden mit tension*2 skaliert (passt zum klassischen 1/6-Faktor).
 *
 * @param {Array<{ x: number; y: number }>} samples
 * @param {number} tension
 * @returns {string}
 */
function samplesToSvgPath(samples, tension) {
  if (samples.length === 0) return '';
  if (samples.length === 1) {
    return `M${samples[0].x.toFixed(2)} ${samples[0].y.toFixed(2)}`;
  }
  if (samples.length === 2) {
    return `M${samples[0].x.toFixed(2)} ${samples[0].y.toFixed(2)} L${samples[1].x.toFixed(2)} ${samples[1].y.toFixed(2)}`;
  }
  let d = `M${samples[0].x.toFixed(2)} ${samples[0].y.toFixed(2)}`;
  const factor = tension / 3; // klassisch 1/6 bei tension=0.5
  for (let i = 0; i < samples.length - 1; i++) {
    const p0 = samples[Math.max(0, i - 1)];
    const p1 = samples[i];
    const p2 = samples[i + 1];
    const p3 = samples[Math.min(samples.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) * factor;
    const c1y = p1.y + (p2.y - p0.y) * factor;
    const c2x = p2.x - (p3.x - p1.x) * factor;
    const c2y = p2.y - (p3.y - p1.y) * factor;
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// ============================================================================
// 6. Hauptfunktion: routeEdge
// ============================================================================

/**
 * Routet eine Edge mittels A* auf einem Hindernis-Grid und liefert sowohl
 * den SVG-Pfad als auch eine feste Anzahl Sample-Punkte fuer Animation.
 *
 * Output
 * ──────
 * - `samples`: Array von `count` Punkten (default 16) gleichmaessig verteilt
 *   entlang des gesmoothten Pfads. Stuetzpunkte fuer spaetere Punkt-zu-Punkt-
 *   Interpolation zwischen alten und neuen Pfaden (Animation-Hook).
 * - `d`: SVG-Pfad-String (Cubic-Bezier-Sequenz aus den Samples) — direkt
 *   in `<path d={...}>` rendern.
 * - `type`: `'spline'` wenn A* einen Umweg gefunden hat, `'line'` wenn
 *   gerader Pfad gerade noch ohne Hindernisse moeglich war oder Fallback.
 * - `cut`: `true` wenn A* keinen Pfad fand und auf gerade Linie zurueckfiel
 *   (Edge schneidet ggfs. Hindernisse — Konvention: lieber sichtbar als
 *   unsichtbar).
 *
 * @param {Point} from
 * @param {Point} to
 * @param {Obstacle[]} obstacles
 * @param {{
 *   resolution?: number;
 *   nodePadding?: number;
 *   sampleCount?: number;
 *   tension?: number;
 *   excludeIds?: Set<string>;
 * }} [opts]
 * @returns {{
 *   samples: Point[];
 *   d: string;
 *   type: 'line' | 'spline';
 *   cut: boolean;
 * }}
 */
export function routeEdge(from, to, obstacles, opts = {}) {
  const resolution = opts.resolution ?? 12;
  const nodePadding = opts.nodePadding ?? 8;
  const sampleCount = Math.max(2, opts.sampleCount ?? 16);
  const tension = opts.tension ?? 0.5;
  const excludeIds = opts.excludeIds ?? null;

  // Edge degeneriert? Dann Fallback-Linie mit duplizierten Samples.
  const directLen = Math.hypot(to.x - from.x, to.y - from.y);
  if (directLen < 0.5) {
    const samples = Array.from({ length: sampleCount }, () => ({ x: from.x, y: from.y }));
    return {
      samples,
      d: `M${from.x.toFixed(2)} ${from.y.toFixed(2)}`,
      type: 'line',
      cut: false,
    };
  }

  // Grid bauen + A* ausfuehren
  const grid = buildGrid(from, to, obstacles, { resolution, padding: nodePadding, excludeIds });
  const cellPath = aStar(grid);

  /** @type {Array<{ x: number; y: number }>} */
  let controlPoints;
  let cut = false;
  let type = 'spline';

  if (!cellPath) {
    // Fallback: keine A*-Loesung → gerade Linie. Edge schneidet ggfs.
    // Hindernisse (cut=true), aber das ist besser als gar keine Edge.
    controlPoints = [from, to];
    cut = true;
    type = 'line';
  } else {
    // Cell-Pfad zu Welt-Koordinaten konvertieren.
    let world = cellsToWorld(cellPath, grid);
    // Endpunkte ueberschreiben durch die exakten Welt-from/to. Cell-
    // Mittelpunkte sind nur Naeherungen — direktes Ankommen am Knotenrand
    // ist visuell sauberer.
    if (world.length >= 2) {
      world[0] = { ...from };
      world[world.length - 1] = { ...to };
    } else {
      world = [from, to];
    }
    // Kollineare Zwischenpunkte raus — A* gibt oft viele Punkte auf
    // geraden Strecken, das verfaelscht das Catmull-Rom-Smoothing.
    controlPoints = simplifyCollinear(world);
    // Wenn nach Cleanup nur noch 2 Punkte uebrig sind → effektiv eine
    // gerade Linie (kein Hindernis im Weg).
    if (controlPoints.length <= 2) type = 'line';
  }

  // Catmull-Rom-Smoothing → Resample auf festen sampleCount
  const samples = arcLengthResample(controlPoints, sampleCount, tension);
  const d = samplesToSvgPath(samples, tension);

  return { samples, d, type, cut };
}
