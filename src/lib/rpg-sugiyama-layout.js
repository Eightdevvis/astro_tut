/**
 * rpg-sugiyama-layout.js
 * ======================
 *
 * Klassisches Sugiyama-Framework fuer DAG-Layouts. Ersetzt das vorherige
 * Force-Directed-Layout (2026-05-04 entfernt — Force-Layout produzierte
 * trotz Annealing/Sibling-Swap/Re-Settle zu oft verknoddelte Layouts).
 *
 * Sugiyama in vier Schritten
 * ──────────────────────────
 *  1. Cycle Removal — bereits durch hasDagCycle/breakGraphCycles
 *     stromaufwaerts erledigt; Layout-Code geht von acyclic aus.
 *  2. Layer Assignment — jeder Node bekommt eine Layer-Y. Longest-Path-
 *     Methode: Roots (ohne eingehende parent_of) → Layer 0, alle anderen
 *     auf max(parents.layer) + 1. Multi-Parent-aware.
 *  3. Crossing Minimization — innerhalb jeder Layer Reihenfolge so waehlen
 *     dass Edges zu Nachbarlayern minimal kreuzen. Median-Heuristik mit
 *     Down/Up-Sweeps; konvergiert i.d.R. nach 4-8 Sweeps.
 *  4. Coordinate Assignment — finale (x, y) pro Knoten. X aus Layer-Index,
 *     Y aus Layer-Index. Innerhalb der Layer gleichmaessig verteilt nach
 *     Crossing-optimierter Reihenfolge.
 *
 * Edges
 * ─────
 * Beide Edge-Typen (parent_of/structure UND dependency) zaehlen fuer
 * Layer-Assignment und Crossing-Minimization — eine `dependency`-Edge
 * impliziert "B braucht A", also B in tieferer Layer als A. Damit wirkt
 * sich auch sie sauber auf das Layout aus statt als Querverbindung
 * "drueber zu liegen".
 *
 * Connected Components
 * ────────────────────
 * Wie zuvor: getrennte Quest-Inseln werden separat layoutet und nebeneinander
 * gepackt. Verhindert dass disconnected Trees uebereinander stapeln.
 *
 * Determinismus
 * ─────────────
 * Sugiyama ist von Haus aus deterministisch — gleiche Eingabe (auch in
 * gleicher Insertion-Reihenfolge der Edges) → identisches Layout. Wir
 * sortieren Node-IDs und Edges intern stabil, sodass Permutationen der
 * Eingabe trotzdem das gleiche Resultat liefern.
 */

import { graphEdges } from './rpg-quests-data.js';

/** @typedef {import('./rpg-quests-data.js').RpgGraph} RpgGraph */

// ============================================================================
// 1. Connected Components (BFS, ungerichtet) — wie im alten Force-Layout
// ============================================================================

/**
 * @param {string[]} nodeIds
 * @param {Array<[string, string]>} idEdges — alle Edges (struct + dep)
 * @returns {string[][]}
 */
function findConnectedComponents(nodeIds, idEdges) {
  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of idEdges) {
    adj.get(e[0])?.push(e[1]);
    adj.get(e[1])?.push(e[0]);
  }
  /** @type {Set<string>} */
  const visited = new Set();
  /** @type {string[][]} */
  const components = [];
  for (const start of nodeIds) {
    if (visited.has(start)) continue;
    /** @type {string[]} */
    const comp = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const cur = stack.pop();
      if (typeof cur !== 'string') continue;
      comp.push(cur);
      for (const next of adj.get(cur) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    comp.sort();
    components.push(comp);
  }
  return components;
}

// ============================================================================
// 2. Layer Assignment (longest-path)
// ============================================================================

/**
 * Weist jedem Node eine Layer-Y zu. Roots (ohne eingehende strukturelle
 * Edge) bekommen Layer 0. Alle anderen: max(parent.layer) + 1.
 *
 * Multi-Parent-aware: ein Node mit mehreren Parents landet auf der
 * tiefsten Layer aller Parents + 1 — sodass alle eingehenden Edges
 * "nach unten" zeigen (Sugiyama-Invariante).
 *
 * Cycle-Schutz: wir gehen davon aus dass der Graph acyclic ist
 * (vom Caller via breakGraphCycles sichergestellt). Defensiv brechen
 * wir bei einem Zyklus die Rekursion mit visiting-Set.
 *
 * @param {string[]} compNodeIds
 * @param {Array<[string, string]>} compStructureEdges — nur parent_of in dieser Component
 * @returns {Map<string, number>} nodeId → Layer-Index (0-basiert)
 */
function assignLayers(compNodeIds, compStructureEdges) {
  /** @type {Map<string, string[]>} child → parents */
  const parentsOf = new Map();
  for (const id of compNodeIds) parentsOf.set(id, []);
  for (const [p, c] of compStructureEdges) {
    if (!parentsOf.has(c)) parentsOf.set(c, []);
    parentsOf.get(c).push(p);
  }

  /** @type {Map<string, number>} */
  const layer = new Map();
  /** @type {Set<string>} */
  const visiting = new Set();

  /** @param {string} id @returns {number} */
  function getLayer(id) {
    if (layer.has(id)) return layer.get(id);
    if (visiting.has(id)) return 0; // cycle fallback
    visiting.add(id);
    const parents = parentsOf.get(id) || [];
    if (parents.length === 0) {
      layer.set(id, 0);
      visiting.delete(id);
      return 0;
    }
    let max = 0;
    for (const p of parents) {
      const pl = getLayer(p);
      if (pl > max) max = pl;
    }
    const L = max + 1;
    layer.set(id, L);
    visiting.delete(id);
    return L;
  }

  for (const id of compNodeIds) getLayer(id);
  return layer;
}

// ============================================================================
// 3. Crossing Minimization (Median-Heuristik + Down/Up-Sweeps)
// ============================================================================

/**
 * Median einer Liste — fuer ungerade Laengen exakt der mittlere Wert,
 * fuer gerade der Durchschnitt der mittleren zwei. Konvention: leere
 * Liste → -1 (Knoten ohne Verbindungen "nach drueben" bleibt am Rand).
 *
 * @param {number[]} arr
 * @returns {number}
 */
function medianOf(arr) {
  if (arr.length === 0) return -1;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Crossing-Minimization via Median-Heuristik + Down/Up-Sweeps.
 *
 * Algorithmus
 * ───────────
 * Pro Sweep alternierend down (Layer 1..N) und up (Layer N-1..0):
 *   - Fuer jede Layer L: jeder Knoten bekommt einen "median key" =
 *     Median der Positionen seiner Verbindungen in der Vor-Layer (down)
 *     bzw. Nach-Layer (up).
 *   - Knoten in der Layer werden nach diesem Key sortiert.
 * Wiederholen bis Crossings nicht mehr abnehmen oder maxSweeps erreicht.
 *
 * Heuristik (Median statt Barycenter): in der Praxis gleichwertig oder
 * leicht besser fuer kleine Layouts; einfacher zu implementieren.
 *
 * @param {string[][]} layerNodes — pro Layer-Index ein Array von Node-IDs
 * @param {Array<[string, string]>} compStructureEdges
 * @returns {string[][]} optimierte Reihenfolge
 */
function minimizeCrossings(layerNodes, compStructureEdges) {
  // Adjazenz: pro Node die Liste der Verbindungspartner in Vor- und Nach-Layer.
  /** @type {Map<string, string[]>} */
  const upNeighbors = new Map();   // node → parents
  /** @type {Map<string, string[]>} */
  const downNeighbors = new Map(); // node → children
  for (const [p, c] of compStructureEdges) {
    if (!upNeighbors.has(c)) upNeighbors.set(c, []);
    upNeighbors.get(c).push(p);
    if (!downNeighbors.has(p)) downNeighbors.set(p, []);
    downNeighbors.get(p).push(c);
  }

  /** Aktuelle Position eines Knotens in seiner Layer. */
  function buildPositionMap(layers) {
    /** @type {Map<string, number>} */
    const pos = new Map();
    for (const layer of layers) {
      for (let i = 0; i < layer.length; i++) pos.set(layer[i], i);
    }
    return pos;
  }

  function downSweep() {
    const pos = buildPositionMap(layerNodes);
    for (let L = 1; L < layerNodes.length; L++) {
      const nodes = layerNodes[L];
      const keyed = nodes.map((id) => {
        const parents = upNeighbors.get(id) || [];
        const positions = parents.map((p) => pos.get(p)).filter((x) => typeof x === 'number');
        return { id, key: medianOf(positions), original: nodes.indexOf(id) };
      });
      // Stabil sortieren: bei Tie original-Position erhalten.
      keyed.sort((a, b) => a.key - b.key || a.original - b.original);
      layerNodes[L] = keyed.map((x) => x.id);
    }
  }

  function upSweep() {
    const pos = buildPositionMap(layerNodes);
    for (let L = layerNodes.length - 2; L >= 0; L--) {
      const nodes = layerNodes[L];
      const keyed = nodes.map((id) => {
        const children = downNeighbors.get(id) || [];
        const positions = children.map((c) => pos.get(c)).filter((x) => typeof x === 'number');
        return { id, key: medianOf(positions), original: nodes.indexOf(id) };
      });
      keyed.sort((a, b) => a.key - b.key || a.original - b.original);
      layerNodes[L] = keyed.map((x) => x.id);
    }
  }

  /** Zaehlt Crossings zwischen zwei aufeinanderfolgenden Layern.
   * Standard: zwei Edges (a,b) und (c,d) kreuzen wenn pos(a)<pos(c) und pos(b)>pos(d)
   * oder umgekehrt.
   */
  function countCrossings() {
    const pos = buildPositionMap(layerNodes);
    let total = 0;
    for (let L = 0; L < layerNodes.length - 1; L++) {
      // Sammle alle Edges zwischen L und L+1
      const upper = new Set(layerNodes[L]);
      const lower = new Set(layerNodes[L + 1]);
      /** @type {Array<[number, number]>} */
      const edgesBetween = [];
      for (const [p, c] of compStructureEdges) {
        if (upper.has(p) && lower.has(c)) {
          edgesBetween.push([pos.get(p), pos.get(c)]);
        }
      }
      // O(E^2) Paar-Vergleich — bei realen Graphen klein, OK
      for (let i = 0; i < edgesBetween.length; i++) {
        for (let j = i + 1; j < edgesBetween.length; j++) {
          const [a1, b1] = edgesBetween[i];
          const [a2, b2] = edgesBetween[j];
          if ((a1 < a2 && b1 > b2) || (a1 > a2 && b1 < b2)) total++;
        }
      }
    }
    return total;
  }

  let prevCrossings = countCrossings();
  const maxSweeps = 24;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    downSweep();
    upSweep();
    const newCrossings = countCrossings();
    if (newCrossings >= prevCrossings) break; // konvergiert
    prevCrossings = newCrossings;
  }
  return layerNodes;
}

// ============================================================================
// 4. Coordinate Assignment
// ============================================================================

/**
 * Weist jedem Node finale (x, y)-Koordinaten zu.
 *
 * Y aus Layer-Index: Roots oben (y=0), tiefer = unten. Kompatibel zur
 * Convention im aktuellen Tree (Hierarchie sichtbar).
 *
 * X innerhalb der Layer: gleichmaessig verteilt, zentriert ueber die
 * Gesamtbreite der Component. Falls die Layer unterschiedlich viele
 * Knoten haben, werden sie alle auf der gleichen Mittelachse zentriert.
 *
 * @param {string[][]} layerNodes
 * @param {{ rowGap: number; colGap: number }} cfg
 * @returns {{
 *   positions: Record<string, { x: number; y: number }>;
 *   bbox: { minX: number; minY: number; maxX: number; maxY: number };
 * }}
 */
function assignCoordinates(layerNodes, cfg) {
  /** @type {Record<string, { x: number; y: number }>} */
  const positions = {};
  // Maximale Layer-Breite bestimmen — alle Layer auf diese zentrieren.
  let maxLayerWidth = 0;
  for (const layer of layerNodes) {
    const w = (layer.length - 1) * cfg.colGap;
    if (w > maxLayerWidth) maxLayerWidth = w;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let L = 0; L < layerNodes.length; L++) {
    const layer = layerNodes[L];
    const layerWidth = (layer.length - 1) * cfg.colGap;
    const startX = -maxLayerWidth / 2 + (maxLayerWidth - layerWidth) / 2;
    const y = L * cfg.rowGap;
    for (let i = 0; i < layer.length; i++) {
      const x = startX + i * cfg.colGap;
      positions[layer[i]] = { x, y };
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = 0; maxY = 0;
  }
  return { positions, bbox: { minX, minY, maxX, maxY } };
}

// ============================================================================
// 5. Component-Packing — wie im Force-Layout
// ============================================================================

/**
 * Pro-Component-Layouts horizontal/vertikal anordnen mit grosszuegigem Gap.
 * Greedy-Row-Pack mit Wraparound bei sqrt(totalArea * 1.6).
 *
 * @param {Array<{
 *   positions: Record<string, { x: number; y: number }>;
 *   bbox: { minX: number; minY: number; maxX: number; maxY: number };
 * }>} componentLayouts
 * @param {number} padding
 * @param {number} interGap
 */
function packComponents(componentLayouts, padding, interGap) {
  if (componentLayouts.length === 0) {
    return { positions: {}, width: padding * 2, height: padding * 2, minX: 0, minY: 0 };
  }
  const sized = componentLayouts.map((layout, i) => ({
    layout,
    width: layout.bbox.maxX - layout.bbox.minX,
    height: layout.bbox.maxY - layout.bbox.minY,
    originalIndex: i,
  }));
  sized.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    return a.originalIndex - b.originalIndex;
  });
  const totalArea = sized.reduce((s, c) => s + c.width * c.height, 0);
  const targetRowWidth = Math.max(sized[0].width, Math.sqrt(totalArea * 1.6));

  /** @type {Record<string, { x: number; y: number }>} */
  const positions = {};
  let cursorX = padding;
  let cursorY = padding;
  let rowHeight = 0;
  let totalMaxX = padding;
  for (const c of sized) {
    if (cursorX > padding && cursorX + c.width > targetRowWidth + padding) {
      cursorY += rowHeight + interGap;
      cursorX = padding;
      rowHeight = 0;
    }
    const offsetX = cursorX - c.layout.bbox.minX;
    const offsetY = cursorY - c.layout.bbox.minY;
    for (const id of Object.keys(c.layout.positions)) {
      const p = c.layout.positions[id];
      positions[id] = { x: p.x + offsetX, y: p.y + offsetY };
    }
    cursorX += c.width + interGap;
    if (c.height > rowHeight) rowHeight = c.height;
    if (cursorX > totalMaxX) totalMaxX = cursorX;
  }
  const width = Math.ceil(totalMaxX + padding - interGap);
  const height = Math.ceil(cursorY + rowHeight + padding);
  return { positions, width, height, minX: 0, minY: 0 };
}

// ============================================================================
// 6. Hauptfunktion
// ============================================================================

/**
 * Berechnet das Sugiyama-Layout fuer den gegebenen Graph.
 *
 * Output ist API-kompatibel mit der frueheren `computeForceLayout`:
 *   - `positions[nodeId] = { x, y }`
 *   - `width` / `height` / `minX` / `minY`
 *
 * Der RpgQuestTree-Aufrufer kann das Modul nahtlos austauschen — keine
 * weiteren Anpassungen noetig (Edge-Routing nutzt nur positions).
 *
 * @param {RpgGraph} graph
 * @param {{
 *   compact?: boolean;
 *   rowGap?: number;
 *   colGap?: number;
 *   padding?: number;
 *   interComponentGap?: number;
 * }} [opts]
 * @returns {{
 *   positions: Record<string, { x: number; y: number }>;
 *   width: number;
 *   height: number;
 *   minX: number;
 *   minY: number;
 * }}
 */
export function computeSugiyamaLayout(graph, opts = {}) {
  const compact = !!opts.compact;
  const rowGap = opts.rowGap ?? (compact ? 96 : 130);
  const colGap = opts.colGap ?? (compact ? 86 : 120);
  const padding = opts.padding ?? (compact ? 56 : 72);
  const interComponentGap = opts.interComponentGap ?? (compact ? 140 : 220);

  // ----- Nodes einsammeln (deckt Compat-View und V3-canonical ab) -----
  /** @type {Map<string, import('./rpg-quests-data.js').RpgNode>} */
  const allNodes = new Map();
  /** @param {import('./rpg-quests-data.js').RpgNode | null | undefined} n */
  function collect(n) {
    if (!n || typeof n.id !== 'string' || !n.id || allNodes.has(n.id)) return;
    allNodes.set(n.id, n);
    if (Array.isArray(n.children)) for (const c of n.children) collect(c);
  }
  for (const n of graph?.nodes || []) collect(n);
  const nodeIds = [...allNodes.keys()].sort();

  if (nodeIds.length === 0) {
    return { positions: {}, width: padding * 2, height: padding * 2, minX: 0, minY: 0 };
  }

  // ----- Edges sammeln + Trennung structure / dependency -----
  // Beide Typen wirken auf Layer-Assignment (dependency: B braucht A → B
  // tiefer als A) und Crossing-Minimization. Dadurch liegen abhaengige
  // Quests konsistent untereinander statt als wilde Querverbindung.
  /** @type {Array<[string, string]>} */
  const idEdges = [];
  /** @type {Array<[string, string]>} */
  const structureEdges = [];
  for (const e of graphEdges(graph)) {
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    if (!allNodes.has(e.from) || !allNodes.has(e.to)) continue;
    if (e.from === e.to) continue;
    idEdges.push([e.from, e.to]);
    const isStructure = e.relation === 'structure' || e.relation === 'parent_of'
      || e.relation === 'dependency'; // dependency aehnliche Hierarchie-Wirkung
    if (isStructure) structureEdges.push([e.from, e.to]);
  }
  // Stabile Sortierung — gleiche Eingabe → gleiches Layout
  structureEdges.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  // ----- Connected Components -----
  const components = findConnectedComponents(nodeIds, idEdges);

  // ----- Pro Component: Sugiyama -----
  const componentLayouts = components.map((compIds) => {
    const compIdSet = new Set(compIds);
    const compStructEdges = structureEdges.filter(
      ([a, b]) => compIdSet.has(a) && compIdSet.has(b)
    );

    // Schritt 2: Layer Assignment
    const layerOf = assignLayers(compIds, compStructEdges);
    // Layer-Buckets bauen
    const maxLayer = Math.max(...compIds.map((id) => layerOf.get(id) ?? 0));
    /** @type {string[][]} */
    const layerNodes = [];
    for (let L = 0; L <= maxLayer; L++) layerNodes.push([]);
    // Innerhalb der Layer initial alphabetisch sortieren — Determinismus.
    for (const id of compIds) {
      const L = layerOf.get(id) ?? 0;
      layerNodes[L].push(id);
    }
    for (const layer of layerNodes) layer.sort();

    // Schritt 3: Crossing Minimization (mutiert layerNodes)
    minimizeCrossings(layerNodes, compStructEdges);

    // Schritt 4: Coordinate Assignment
    return assignCoordinates(layerNodes, { rowGap, colGap });
  });

  // ----- Components packen -----
  return packComponents(componentLayouts, padding, interComponentGap);
}
