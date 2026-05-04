/**
 * rpg-tree-svg.js — Pure SVG-Helper fuer den Quest-Baum.
 *
 * Stark gekuerzt im Force-Layout-Refactor (2026-05-03):
 *   - Layout-Berechnung komplett raus (lebt jetzt in rpg-sugiyama-layout.js)
 *   - computeNodeTreeOverlay raus (Render-Liste wird in der JSX gebaut)
 *   - Quest-Cluster-Radius-Spread, Edge-Ports, Distribute-Helper raus
 *     (alles waren Hilfen fuers radiale Children-Layout, nicht mehr noetig)
 *   - Form-Input umgestellt: Subtree-Tiefe statt Leaf-Anzahl
 *
 * Was bleibt sind reine, wiederverwendbare Geometrie- und CSS-Helfer.
 */

// ============================================================
// Form-Berechnung (Knoten-Shape via Subtree-Tiefe)
// ============================================================

/**
 * SVG-Path fuer ein regelmaessiges Polygon (Dreieck, Viereck, ...).
 * Zentriert um (0, 0), Spitze nach oben.
 *
 * @param {number} corners — Anzahl Ecken (mind. 3)
 * @param {number} r — Umkreisradius
 * @returns {string} SVG-Path
 */
export function regularPolygonPath(corners, r) {
  const n = Math.max(3, Math.floor(corners));
  let d = '';
  for (let i = 0; i < n; i++) {
    // -PI/2 = 12-Uhr-Position als Startwinkel (Spitze oben)
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    d += `${i === 0 ? 'M' : 'L'}${x} ${y} `;
  }
  return `${d}Z`;
}

/**
 * Maximale Subtree-Tiefe eines Nodes. Leaf = 0, parent of leafs = 1, etc.
 *
 * Convention im Force-Layout-Refactor:
 *   - Leaf-Node (keine Children) → 0
 *   - Container-Node mit nur Leaf-Kindern → 1
 *   - Tiefer geschachtelte Container → 2, 3, ...
 *
 * Wird als Eingabe fuer `nodeShapePath` benutzt — die Form eines Nodes
 * bildet damit die TIEFE seiner Hierarchie ab (statt der frueher
 * verwendeten Leaf-BREITE). Macht visuell die Komplexitaet sichtbar:
 * Leafs sind schlichte Kreise, tiefe Wurzeln werden vielzackige Polygone.
 *
 * Multi-Parent-Hinweis: Liest noch nested `node.children` (Compat-View).
 * In V3-canonical waere ein Graph-basierter Walk via getChildIds(graph, id)
 * sauberer — aber solange die Compat-View die Children korrekt
 * materialisiert, ist das Ergebnis identisch.
 *
 * @param {import('./rpg-quests-data.js').RpgNode} node
 * @returns {number}
 */
export function maxNodeDepth(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  if (kids.length === 0) return 0;
  let m = 0;
  for (const ch of kids) {
    const d = maxNodeDepth(ch);
    if (d > m) m = d;
  }
  return m + 1;
}

/**
 * Node-Form basierend auf Subtree-Tiefe:
 *   depth 0 (Leaf)              → null  (Caller rendert <circle>)
 *   depth 1 (parent of leafs)   → Tropfen
 *   depth 2 (parent of parents) → Spitze Linse
 *   depth 3+                    → Regelmaessiges Polygon mit `depth` Ecken
 *
 * Warum null bei Leaf? Damit der Caller flexibel zwischen <circle> und <path>
 * waehlen kann — ein Kreis ist via SVG-Element schoener als per Path.
 *
 * @param {number} depth — Subtree-Tiefe via maxNodeDepth
 * @param {number} r — Knotenradius
 * @returns {string | null}
 */
export function nodeShapePath(depth, r) {
  const d = Math.max(0, Math.floor(depth || 0));
  if (d === 0) return null;
  if (d === 1) {
    // Tropfen: Spitze oben, Bauch unten.
    const top = -r * 1.08;
    const bottom = r * 1.02;
    const side = r * 0.78;
    return `M0 ${top} Q ${side} ${-r * 0.2} ${side * 0.55} ${bottom} Q 0 ${r * 1.18} ${-side * 0.55} ${bottom} Q ${-side} ${-r * 0.2} 0 ${top} Z`;
  }
  if (d === 2) {
    // Linse: horizontal gestreckt, Bezier-Kuppe oben/unten.
    const left = -r * 1.08;
    const right = r * 1.08;
    const bulge = r * 0.7;
    return `M${left} 0 Q 0 ${-bulge} ${right} 0 Q 0 ${bulge} ${left} 0 Z`;
  }
  // d >= 3: Polygon mit so vielen Ecken wie die Tiefe sagt.
  return regularPolygonPath(d, r);
}

// ============================================================
// Statistik: Leaf-Anzahl in einer Quest (fuer Detail-Panel-Anzeige)
// ============================================================

/**
 * Zaehlt rekursiv alle Leaf-Nodes (Nodes ohne Children) im Subtree von `node`.
 * Self-Leaf zaehlt 1. Privater Helper fuer `countQuestLeaves`.
 * @param {import('./rpg-quests-data.js').RpgNode} node
 * @returns {number}
 */
function countLeavesInSubtree(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  if (kids.length === 0) return 1;
  let n = 0;
  for (const c of kids) n += countLeavesInSubtree(c);
  return n;
}

/**
 * Zaehlt alle Leaf-Nodes einer Quest (rekursiv ueber alle Sub-Trees).
 * Genutzt im `RpgQuestPanel` als Statistik-Anzeige ("Aufgaben: N").
 *
 * Die Quest selbst zaehlt nicht — gezaehlt werden nur Leafs unter ihr.
 * Eine Quest ohne Children gibt 0 zurueck.
 *
 * @param {import('./rpg-quests-data.js').RpgNode} quest
 * @returns {number}
 */
export function countQuestLeaves(quest) {
  const roots = Array.isArray(quest?.children) ? quest.children : [];
  let n = 0;
  for (const r of roots) n += countLeavesInSubtree(r);
  return n;
}

// ============================================================
// Edge-Endpunkte (Linien enden am Knotenrand, nicht im Zentrum)
// ============================================================

/**
 * Berechnet getrimmte Start-/End-Punkte einer Edge: zieht von beiden Enden
 * den jeweiligen Knotenradius ab, damit die Linie am Rand ankommt statt
 * im Mittelpunkt zu verschwinden.
 *
 * Wird vom Smart-Edge-Routing benutzt, damit auch bei gekruemmten Edges
 * der Tangentenpunkt am Rand sitzt — die Bezier-Kruemmung beginnt dann
 * von dort statt aus dem Zentrum.
 *
 * @param {number} x1 @param {number} y1
 * @param {number} x2 @param {number} y2
 * @param {number} r1 — Radius des Source-Knotens
 * @param {number} r2 — Radius des Target-Knotens
 * @returns {{ x1: number; y1: number; x2: number; y2: number; len: number }}
 */
export function edgeEndpoints(x1, y1, x2, y2, r1, r2) {
  const ux = x2 - x1;
  const uy = y2 - y1;
  const len = Math.hypot(ux, uy) || 1;
  const nx = ux / len;
  const ny = uy / len;
  return {
    x1: x1 + nx * r1,
    y1: y1 + ny * r1,
    x2: x2 - nx * r2,
    y2: y2 - ny * r2,
    len: len - r1 - r2,
  };
}

// ============================================================
// CSS-Klassen-Helfer
// ============================================================

/**
 * CSS-Klasse fuer einen Quest-Knoten (Top-Level-Root im aktuellen Render).
 * Mit Force-Layout-Refactor verschwindet langfristig die Trennung
 * Root vs. Child — bis dahin behalten wir die getrennten Helper.
 *
 * @param {unknown} _quest — derzeit nicht ausgewertet, fuer API-Kompatibilitaet
 * @param {boolean} unlocked
 * @param {boolean} added
 * @param {boolean} completed
 * @param {boolean} [isLocked] — Tree-View-Subtree-Sperre via Edge-Lock
 *   (bidirektional, ab 2026-05-04). Additiv: kommt als zusaetzlicher
 *   Modifier hinzu, ohne den Basis-Status (done/locked/active) zu
 *   ueberschreiben. Wirkt visuell wie `.rpg-tree-node-node--treelocked`
 *   bei Sub-Nodes — gedaempft, kaum lesbar. Wichtig fuer parent-side-Lock,
 *   wo Roots in den Lock-Subtree fallen.
 */
export function nodeClass(_quest, unlocked, added, completed, isLocked) {
  /** @type {string} */
  let base;
  if (completed) base = 'rpg-tree-node rpg-tree-node--done';
  else if (!unlocked) base = 'rpg-tree-node rpg-tree-node--locked';
  else if (!added) base = 'rpg-tree-node rpg-tree-node--unlocked-not-added';
  else base = 'rpg-tree-node rpg-tree-node--active';
  if (isLocked) base += ' rpg-tree-node--treelocked';
  return base;
}

/**
 * CSS-Klasse fuer Sub-Nodes (Kinder unter den Roots).
 *
 * @param {boolean} isDone
 * @param {boolean} isLeaf
 * @param {boolean} isLock — node.isLock (Lock-Sibling-Modifier)
 * @param {boolean} [isLocked] — Tree-View-Subtree-Sperre via Edge-Lock
 *   Additiv: kommt als zusaetzlicher Modifier hinzu, ohne den Basis-Status
 *   (done/lock/leaf/container) zu ueberschreiben.
 */
export function nodeNodeClass(isDone, isLeaf, isLock, isLocked) {
  /** @type {string} */
  let base;
  if (isDone) base = 'rpg-tree-node-node rpg-tree-node-node--done';
  else if (isLock) base = 'rpg-tree-node-node rpg-tree-node-node--lock';
  else if (isLeaf) base = 'rpg-tree-node-node rpg-tree-node-node--leaf';
  else base = 'rpg-tree-node-node rpg-tree-node-node--container';
  if (isLocked) base += ' rpg-tree-node-node--treelocked';
  return base;
}
