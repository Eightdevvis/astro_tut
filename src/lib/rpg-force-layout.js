/**
 * rpg-force-layout.js
 * ===================
 *
 * Force-Directed Layout fuer den Quest-Graphen (DAG, V3-Schema).
 *
 * Konzept
 * ───────
 * Alle Nodes (Top-Level-Quests UND alle Sub-Nodes) werden durch ein
 * EINHEITLICHES Federsystem positioniert. Es gibt KEINE separate Behandlung
 * von "Quest-Roots" vs. "Children" — alles ist nur "Node + Edges".
 * Ersetzt die alte Kombination aus `computeLayeredLayout` (rein hierarchisch
 * fuer Quest-Roots) + `computeNodeTreeOverlay` (radialer Fan fuer Children),
 * die das Multi-Parent-Problem nicht sauber loesen konnte.
 *
 * Physik (das mentale Modell)
 * ───────────────────────────
 * - Jeder Node ist ein Magnet, der alle anderen Magnete leicht abstoesst
 *   (Coulomb-Repulsion, faellt mit 1/r^2 ab).
 * - Jede Edge ist eine Feder mit Wunschlaenge `springLength`. Zu kurz
 *   gedrueckt → Feder drueckt auseinander. Zu lang gestreckt → Feder zieht
 *   zusammen (Hookesches Gesetz).
 * - Eine sanfte Center-Gravity zieht alle Nodes leicht zum (0,0)-Mittelpunkt,
 *   damit das System nicht wegdriftet — Repulsion + Spring sind nur
 *   translation-invariant, brauchen einen globalen Anker.
 * - Daempfung: Geschwindigkeit wird pro Schritt mit `damping` < 1 multipliziert,
 *   damit das System einpendelt statt ewig zu schwingen.
 *
 * Determinismus
 * ─────────────
 * Initial-Position pro Node wird aus `hash(node.id)` ueber Mulberry32-PRNG
 * abgeleitet. Gleicher Graph = exakt gleiches Layout, immer. Wird ein neuer
 * Node hinzugefuegt, behaelt jeder andere Node seinen Init-Punkt — das System
 * pendelt nur lokal um, keine globale Umordnung.
 *
 * Multi-Parent (DAG)
 * ──────────────────
 * Ein Node mit mehreren parent_of-Edges wird automatisch zum gewichteten
 * Schwerpunkt seiner Parents gezogen (jede Edge ist eine eigene Feder).
 * Loest das ueber den ganzen Tree gespannte Multi-Parent-Problem ohne
 * Sonderlogik — einfach Federn-Mathematik.
 *
 * Performance
 * ───────────
 * Naive O(N^2)-Repulsion (jedes Paar). Bei N=50 Nodes: 1225 Paare *
 * iterations Iterationen — bleibt im einstelligen Millisekundenbereich.
 * Bei N=200 wird's spuerbar (~150ms), aber fuers User-Szenario noch OK.
 * Falls noetig: Quad-Tree (Barnes-Hut) macht das O(N log N) — spaeter.
 */

import { graphEdges } from './rpg-quests-data.js';

/** @typedef {import('./rpg-quests-data.js').RpgGraph} RpgGraph */
/** @typedef {import('./rpg-quests-data.js').RpgNode} RpgNode */

// ============================================================================
// 1. Hilfsfunktionen — deterministisches Hashing & PRNG
// ============================================================================

/**
 * FNV-1a Hash (32-bit) — wandelt einen String in eine Integer-Zahl um.
 * Schnell, deterministisch, gleichmaessig verteilt. Nehmen wir um aus einer
 * Node-ID einen reproduzierbaren Seed fuer den PRNG zu machen.
 * @param {string} s
 * @returns {number} 32-bit unsigned int
 */
function hashStringToInt(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    // Math.imul: Multiplikation mit 32-bit Wraparound (sonst wird die Zahl zu gross
    // und JS verliert Genauigkeit oberhalb von 2^53).
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0; // unsigned cast
}

/**
 * Mulberry32: kleiner, schneller, deterministischer PRNG.
 * Nimmt einen 32-bit Seed und gibt eine Funktion zurueck, die bei jedem
 * Aufruf eine Zufallszahl in [0, 1) liefert. Gleicher Seed → gleiche Sequenz.
 *
 * Warum Mulberry32 statt Math.random?
 *   Math.random ist nicht-deterministisch (kein Seed kontrollierbar). Wir
 *   wollen aber dass derselbe Graph IMMER dasselbe Layout liefert — also
 *   muessen wir den Zufallsanteil selbst kontrollieren.
 *
 * @param {number} seed — 32-bit unsigned int
 * @returns {() => number} PRNG-Funktion
 */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Initial-Position pro Node — deterministisch aus der Node-ID abgeleitet.
 *
 * Verteilt Nodes gleichmaessig auf einer Kreisscheibe mit Radius `spread`.
 * Wir nehmen Polar-Koordinaten (r, theta) statt naiver (x, y), weil naive
 * Verteilung in einem Quadrat mehr Knoten in den Ecken hat (ungewollt).
 *
 * Das `Math.sqrt(rng())` korrigiert die Radialverteilung: ohne sqrt waeren
 * mehr Punkte im Zentrum als am Rand (weil ein groesserer Radius mehr Flaeche
 * abdeckt, also mehr Punkte beherbergen sollte).
 *
 * @param {string} id
 * @param {number} spread — maximaler Radius in Pixeln
 * @returns {{ x: number; y: number }}
 */
function deterministicInitialPosition(id, spread) {
  const rng = mulberry32(hashStringToInt(id));
  const r = Math.sqrt(rng()) * spread;
  const theta = rng() * Math.PI * 2;
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
}

// ============================================================================
// 2. Node-Sammlung — flache Map ueber alle Nodes (auch nested)
// ============================================================================

/**
 * Sammelt ALLE Nodes aus dem Graphen in einer flachen Map.
 *
 * Warum nicht direkt `graph.nodes`? Weil in der Compat-View (V2-Mode) der
 * Top-Level nur die Quest-Roots enthaelt und Children nested unter
 * `node.children` haengen. Wir muessen beide Pfade abdecken, damit das
 * Layout auch in Mischformen funktioniert.
 *
 * In V3-canonical waere `graph.nodes` schon flach, aber dieser Walker
 * ist idempotent — doppelte Eintraege werden uebersprungen.
 *
 * @param {RpgGraph} graph
 * @returns {Map<string, RpgNode>}
 */
function collectAllNodes(graph) {
  /** @type {Map<string, RpgNode>} */
  const m = new Map();
  /** @param {RpgNode | null | undefined} n */
  function add(n) {
    if (!n || typeof n.id !== 'string' || !n.id) return;
    if (m.has(n.id)) return; // Schon drin (z.B. via anderen Parent in Compat-View)
    m.set(n.id, n);
    if (Array.isArray(n.children)) {
      for (const c of n.children) add(c);
    }
  }
  for (const n of graph?.nodes || []) add(n);
  return m;
}

// ============================================================================
// 3. Connected Components (BFS undirected)
// ============================================================================

/**
 * Findet alle zusammenhaengenden Komponenten im Graphen.
 *
 * Behandelt Edges als ungerichtet: zwei Nodes sind in derselben Component,
 * wenn ein beliebiger Edge-Pfad zwischen ihnen existiert (egal Richtung).
 * Beide Edge-Typen (parent_of UND dependency) werden hier als verbindend
 * gewertet — eine Quest die nur via dependency mit einer anderen verbunden
 * ist gehoert konzeptionell zur selben "Quest-Insel".
 *
 * Algorithmus: BFS/DFS Iteration ueber alle Nodes, jeder unbesuchte Node
 * startet eine neue Component, die dann durch Adjazenz-Walk gefuellt wird.
 *
 * @param {string[]} nodeIds — alle Node-IDs (sortiert fuer Determinismus)
 * @param {Array<[string, string]>} idEdges — Edge-Paare als ID-Tupel
 * @returns {string[][]} Liste von Components, jede ist ein Array von IDs
 */
function findConnectedComponents(nodeIds, idEdges) {
  /** @type {Map<string, string[]>} — Adjazenz, ungerichtet */
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  for (const [a, b] of idEdges) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
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
    // Innerhalb einer Component die IDs sortieren — stabilisiert das Layout.
    comp.sort();
    components.push(comp);
  }
  return components;
}

// ============================================================================
// 4. Lokale Force-Simulation (pro Component)
// ============================================================================

/**
 * Fuehrt die eigentliche Force-Simulation auf einer Liste von Node-IDs durch.
 * Die Component wird zentriert um (0,0) berechnet — das Packing nachher
 * verschiebt sie in die finale Position.
 *
 * @param {string[]} compNodeIds — Node-IDs DIESER Component (sortiert)
 * @param {Array<[string, string, boolean]>} allIdEdges — Edges des Graphen,
 *   drittes Tupel-Element: ist es eine `parent_of`/structure-Edge?
 *   structure-Edges bekommen den Hierarchie-Bias, dependency-Edges nicht.
 * @param {{
 *   iterations: number;
 *   springLength: number;
 *   springStrength: number;
 *   repulsion: number;
 *   centerStrength: number;
 *   damping: number;
 *   hierarchyBias: number;
 *   compact: boolean;
 * }} cfg
 * @returns {{
 *   positions: Record<string, { x: number; y: number }>;
 *   bbox: { minX: number; minY: number; maxX: number; maxY: number };
 * }}
 */
function simulateLocalForceLayout(compNodeIds, allIdEdges, cfg) {
  const N = compNodeIds.length;
  // Edge-Case: einzelner Node — keine Simulation noetig
  if (N === 1) {
    return {
      positions: { [compNodeIds[0]]: { x: 0, y: 0 } },
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  // Lookup ID → Index
  /** @type {Map<string, number>} */
  const idx = new Map(compNodeIds.map((id, i) => [id, i]));

  // Edges filtern: nur jene innerhalb dieser Component.
  // Drittes Element bleibt der isStructure-Flag fuer Hierarchie-Bias.
  /** @type {Array<[number, number, boolean]>} */
  const edges = [];
  for (const e of allIdEdges) {
    const ia = idx.get(e[0]);
    const ib = idx.get(e[1]);
    if (ia === undefined || ib === undefined) continue;
    if (ia === ib) continue; // self-edge skip
    edges.push([ia, ib, !!e[2]]);
  }
  edges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  // Initial-Spread skaliert mit sqrt(N), damit der Startbereich ungefaehr
  // mit der finalen Component-Groesse mitwaechst.
  const spread = Math.max(140, Math.sqrt(N) * (cfg.compact ? 80 : 110));

  // State-Arrays
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  const ax = new Float64Array(N);
  const ay = new Float64Array(N);

  // Init: deterministische Position aus Hash der ID
  for (let i = 0; i < N; i++) {
    const p = deterministicInitialPosition(compNodeIds[i], spread);
    px[i] = p.x;
    py[i] = p.y;
  }

  const maxForce = cfg.repulsion * 0.5;

  // Annealing-Bereich fuer Damping: am Anfang weniger gedaempft (Nodes
  // bewegen sich freier, koennen aus lokalen Minima entkommen), gegen Ende
  // staerker gedaempft (System pendelt sauber ein).
  // Konkret: Geschwister mit nur einem gemeinsamen Parent koennen so
  // tatsaechlich auf 180° relaxen statt in einem 90-120° lokalen Minimum
  // festzustecken. Klassisches simulated-annealing-Prinzip.
  const dampingStart = 0.55;
  const dampingEnd = cfg.damping; // 0.86 default

  // Adjazenz-Maps fuer Crossing-Reduction (nur structure-Edges):
  // Pro Parent eine Liste seiner Children-Indizes.
  /** @type {Map<number, number[]>} */
  const childrenOfParent = new Map();
  for (let e = 0; e < edges.length; e++) {
    if (!edges[e][2]) continue; // nur structure
    const p = edges[e][0];
    const c = edges[e][1];
    if (!childrenOfParent.has(p)) childrenOfParent.set(p, []);
    childrenOfParent.get(p).push(c);
  }

  /**
   * Sammelt alle erreichbaren Nodes ab einer Wurzel (Subtree via structure-
   * Edges). Stoppt bei Multi-Parent-Knoten die schon besucht wurden — folgt
   * nur Down-Stream-Richtung (parent → child).
   * Wird einmal pro Knoten gebraucht und gecacht.
   * @param {number} rootIdx
   * @returns {Set<number>}
   */
  function collectSubtree(rootIdx) {
    /** @type {Set<number>} */
    const out = new Set();
    out.add(rootIdx);
    const stack = [rootIdx];
    while (stack.length) {
      const cur = stack.pop();
      const kids = childrenOfParent.get(cur);
      if (!kids) continue;
      for (const k of kids) {
        if (out.has(k)) continue;
        out.add(k);
        stack.push(k);
      }
    }
    return out;
  }

  // Subtree-Memberships pro Knoten cachen. Sie haengen nur an der Struktur,
  // nicht an Positionen — koennen einmal vorab berechnet und mehrfach
  // verwendet werden. Cache-Hit-Rate ist hoch da pro Sibling-Pair beide
  // Subtrees angefragt werden, in Iter 2 nochmal.
  /** @type {Map<number, Set<number>>} */
  const subtreeCache = new Map();
  /** @param {number} idx */
  function getSubtree(idx) {
    if (subtreeCache.has(idx)) return subtreeCache.get(idx);
    const s = collectSubtree(idx);
    subtreeCache.set(idx, s);
    return s;
  }

  // Hauptschleife — Verlet/Euler-Simulation mit Annealing-Damping.
  // Damping startet niedrig (System bewegt sich frei, kann lokalen Minima
  // entkommen), endet hoch (System pendelt sauber ein).
  for (let iter = 0; iter < cfg.iterations; iter++) {
    const progress = cfg.iterations > 1 ? iter / (cfg.iterations - 1) : 1;
    const dampingThis = dampingStart + (dampingEnd - dampingStart) * progress;
    runForceStep(dampingThis);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sibling-Swap Crossing-Reduction (Post-Process)
  // ──────────────────────────────────────────────────────────────────────
  // Force-Directed minimiert Energie, NICHT Edge-Crossings. Wenn Geschwister
  // unter einem gemeinsamen Parent links/rechts vertauscht stehen, koennen
  // ihre Sub-Edges sich kreuzen — energetisch ist's egal welcher links und
  // welcher rechts ist, also "sieht" Force-Directed das nicht.
  //
  // Loesung (User-gewuenscht 2026-05-04): nach Force-Konvergenz iterativ
  // pro Geschwister-Paar pruefen ob ein X-Tausch die Anzahl Crossings im
  // Layout reduziert. Lokale Heuristik, aehnlich Sugiyama Schritt 3
  // (Median/Barycenter), aber auf Force-Output statt strikten Layern.
  //
  // Performance: pro Parent O(C^2) Paare wo C = Children-Anzahl. Pro Pair
  // O(E) Crossings-Check. Iteration bis stabil oder maxIter erreicht.
  // Bei realer Tree-Groesse (paar Quests, einstellige Children pro Parent)
  // unkritisch — dominiert von der Force-Sim selbst.

  /** @returns {number} 2D-Cross-Product (sign tells side) */
  function ccw(ax_, ay_, bx_, by_, cx_, cy_) {
    return (bx_ - ax_) * (cy_ - ay_) - (by_ - ay_) * (cx_ - ax_);
  }

  /**
   * Pruefen ob sich zwei Strecken kreuzen — strikt im Inneren beider
   * Strecken, gemeinsame Endpunkte zaehlen NICHT als Crossing (Edges die
   * denselben Knoten teilen, treffen sich erlaubterweise dort).
   */
  function segmentsCross(a, b, c, d) {
    if (a === c || a === d || b === c || b === d) return false; // shared endpoint
    const d1 = ccw(px[c], py[c], px[d], py[d], px[a], py[a]);
    const d2 = ccw(px[c], py[c], px[d], py[d], px[b], py[b]);
    const d3 = ccw(px[a], py[a], px[b], py[b], px[c], py[c]);
    const d4 = ccw(px[a], py[a], px[b], py[b], px[d], py[d]);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
        && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  /**
   * Zaehlt Crossings in denen mindestens eine Edge Knoten `nodeIdx` enthaelt.
   * Mit anderen Worten: wie viele Crossings "verschwinden" wenn man `nodeIdx`
   * neu positioniert.
   */
  function countCrossingsInvolvingNode(nodeIdx) {
    let count = 0;
    for (let i = 0; i < edges.length; i++) {
      const ai = edges[i][0];
      const bi = edges[i][1];
      if (ai !== nodeIdx && bi !== nodeIdx) continue;
      for (let j = 0; j < edges.length; j++) {
        if (i === j) continue;
        if (segmentsCross(ai, bi, edges[j][0], edges[j][1])) count++;
      }
    }
    // jedes Crossing wird doppelt gezaehlt (i,j) + (j,i) — egal, wir
    // vergleichen nur gegen sich selbst (Vorher/Nachher).
    return count;
  }

  /**
   * Zaehlt Crossings in denen mind. eine Edge einen Knoten aus subA oder
   * subB beinhaltet — also genau die Crossings die durch ein Subtree-
   * Swap potenziell betroffen waeren. Vergleichbar mit
   * `countCrossingsInvolvingNode`, aber summiert ueber alle relevanten
   * Knoten ohne Doppelzaehlung pro Crossing.
   * @param {Set<number>} subA
   * @param {Set<number>} subB
   */
  function countCrossingsInvolvingSubtrees(subA, subB) {
    let count = 0;
    for (let i = 0; i < edges.length; i++) {
      const ai = edges[i][0];
      const bi = edges[i][1];
      // Ist edge[i] involved in subA oder subB? Sonst skip.
      const aiInA = subA.has(ai), aiInB = subB.has(ai);
      const biInA = subA.has(bi), biInB = subB.has(bi);
      if (!aiInA && !aiInB && !biInA && !biInB) continue;
      for (let j = i + 1; j < edges.length; j++) {
        if (segmentsCross(ai, bi, edges[j][0], edges[j][1])) count++;
      }
    }
    return count;
  }

  /**
   * Eine einzelne Force-Sim-Iteration. Wird sowohl in der Hauptschleife
   * (mit Annealing-Damping) als auch in der Re-Settle-Phase nach den
   * Sibling-Swaps verwendet. DRY-Helper.
   * @param {number} dampingThis
   */
  function runForceStep(dampingThis) {
    ax.fill(0);
    ay.fill(0);
    // Repulsion (jedes Paar)
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = px[j] - px[i];
        const dy = py[j] - py[i];
        const dist2 = dx * dx + dy * dy + 0.01;
        const dist = Math.sqrt(dist2);
        const force = Math.min(cfg.repulsion / dist2, maxForce);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        ax[i] -= fx; ay[i] -= fy;
        ax[j] += fx; ay[j] += fy;
      }
    }
    // Spring per Edge + Hierarchie-Bias
    for (let e = 0; e < edges.length; e++) {
      const a = edges[e][0];
      const b = edges[e][1];
      const isStructure = edges[e][2];
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      const dist = Math.hypot(dx, dy) + 0.001;
      const delta = dist - cfg.springLength;
      const force = cfg.springStrength * delta;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      ax[a] += fx; ay[a] += fy;
      ax[b] -= fx; ay[b] -= fy;
      if (isStructure && cfg.hierarchyBias > 0) {
        ay[a] -= cfg.hierarchyBias;
        ay[b] += cfg.hierarchyBias;
      }
    }
    // Center-Gravity
    if (cfg.centerStrength > 0) {
      for (let i = 0; i < N; i++) {
        ax[i] -= px[i] * cfg.centerStrength;
        ay[i] -= py[i] * cfg.centerStrength;
      }
    }
    // Integrate
    for (let i = 0; i < N; i++) {
      vx[i] = (vx[i] + ax[i]) * dampingThis;
      vy[i] = (vy[i] + ay[i]) * dampingThis;
      px[i] += vx[i];
      py[i] += vy[i];
    }
  }

  // Iterativ Sibling-Pairs durchgehen — bis kein Swap mehr Crossings reduziert.
  // WICHTIG: SUBTREE-Swap, nicht Node-Swap. Wenn A und B getauscht werden,
  // wandern auch alle ihre Descendants mit. Sonst wuerden A's Children
  // links bleiben waehrend A nach rechts wandert — Edges A→A1 zogen quer
  // durch den ganzen Subtree von B. Resultat: MEHR Crossings statt weniger
  // (Bug der ersten Version, gefixt 2026-05-04).
  const maxSwapIterations = 8;
  let anySwapHappened = false;
  for (let swapIter = 0; swapIter < maxSwapIterations; swapIter++) {
    let didSwap = false;
    for (const [, kids] of childrenOfParent) {
      if (kids.length < 2) continue;
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i];
          const b = kids[j];
          const subA = getSubtree(a);
          const subB = getSubtree(b);
          // Multi-Parent-Schutz: wenn ein Knoten in BEIDEN Subtrees liegt
          // (gemeinsamer Descendant), wuerde das Shiften ihn mit beiden
          // Vorzeichen versetzen — undefiniert. Solche Pairs auslassen.
          let shared = false;
          for (const n of subA) {
            if (subB.has(n)) { shared = true; break; }
          }
          if (shared) continue;
          // Crossings VOR Swap — alle Edges die A oder B oder ihre
          // Descendants beruehren.
          const before = countCrossingsInvolvingSubtrees(subA, subB);
          if (before === 0) continue;
          // Subtree-Shift: subA bekommt +delta, subB bekommt -delta, wo
          // delta = Position-Differenz der Wurzeln. Damit landen A und B
          // exakt an den Positionen des jeweils anderen, und ihre Subtrees
          // wandern mit.
          const dx = px[b] - px[a];
          const dy = py[b] - py[a];
          for (const n of subA) { px[n] += dx; py[n] += dy; }
          for (const n of subB) { px[n] -= dx; py[n] -= dy; }
          const after = countCrossingsInvolvingSubtrees(subA, subB);
          if (after >= before) {
            // Revert — kein Gewinn
            for (const n of subA) { px[n] -= dx; py[n] -= dy; }
            for (const n of subB) { px[n] += dx; py[n] += dy; }
          } else {
            didSwap = true;
            anySwapHappened = true;
          }
        }
      }
    }
    if (!didSwap) break;
  }

  // Re-Settle-Phase: wenn Swaps stattgefunden haben, sind die Federn
  // nicht mehr im Equilibrium (Subtrees an neuen Positionen, aber alle
  // umgebenden Kraefte nicht angepasst). Eine kurze Force-Sim mit voller
  // Damping pendelt das System auf die neue Konfiguration ein. Verhindert
  // dass Subtrees aufeinander stossen oder unnatuerliche Luecken haben.
  // Velocities zuruecksetzen — sonst wuerde das System mit alter
  // Bewegungsenergie ueberschwingen.
  if (anySwapHappened) {
    vx.fill(0);
    vy.fill(0);
    const settleIterations = Math.min(80, Math.floor(cfg.iterations * 0.25));
    for (let iter = 0; iter < settleIterations; iter++) {
      runForceStep(cfg.damping);
    }
  }

  // Bounding-Box bestimmen + Component zentrieren auf (0,0)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    if (px[i] < minX) minX = px[i];
    if (py[i] < minY) minY = py[i];
    if (px[i] > maxX) maxX = px[i];
    if (py[i] > maxY) maxY = py[i];
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  /** @type {Record<string, { x: number; y: number }>} */
  const positions = {};
  for (let i = 0; i < N; i++) {
    positions[compNodeIds[i]] = { x: px[i] - cx, y: py[i] - cy };
  }

  return {
    positions,
    bbox: { minX: minX - cx, minY: minY - cy, maxX: maxX - cx, maxY: maxY - cy },
  };
}

// ============================================================================
// 5. Component-Packing
// ============================================================================

/**
 * Packt mehrere Component-Layouts in eine gemeinsame Bounding-Box.
 *
 * Algorithmus: Greedy-Row-Pack mit Wraparound.
 *   1. Components sortiert nach Hoehe (groesste zuerst → minimiert vertikale Luecken)
 *   2. Wraparound bei einer Ziel-Reihenbreite (~ sqrt(2 * Gesamtflaeche))
 *      — proportional zu sqrt(N) skaliert, damit das Layout nicht ewig
 *      breit oder hoch wird
 *   3. Jede Component wird per Offset in die finale Position verschoben
 *
 * @param {Array<{
 *   positions: Record<string, { x: number; y: number }>;
 *   bbox: { minX: number; minY: number; maxX: number; maxY: number };
 * }>} componentLayouts
 * @param {number} padding — Aussenrand
 * @param {number} interGap — Abstand zwischen Components
 * @returns {{
 *   positions: Record<string, { x: number; y: number }>;
 *   width: number;
 *   height: number;
 *   minX: number;
 *   minY: number;
 * }}
 */
function packComponents(componentLayouts, padding, interGap) {
  // Edge-Case: keine Components
  if (componentLayouts.length === 0) {
    return { positions: {}, width: padding * 2, height: padding * 2, minX: 0, minY: 0 };
  }

  // Pro Component: Groesse berechnen
  const sized = componentLayouts.map((layout, i) => ({
    layout,
    width: layout.bbox.maxX - layout.bbox.minX,
    height: layout.bbox.maxY - layout.bbox.minY,
    originalIndex: i,
  }));

  // Sortieren nach Hoehe absteigend — pack-Effizienz, weniger Reihen-Hoehen-Sprueche.
  // Bei gleicher Hoehe: nach originalIndex (Stabilitaet, Determinismus).
  sized.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    return a.originalIndex - b.originalIndex;
  });

  // Ziel-Reihenbreite: orientiert sich an der Gesamtflaeche, damit das
  // Layout in etwa quadratisch wird (statt eine Linie quer ueber den Schirm).
  const totalArea = sized.reduce((s, c) => s + c.width * c.height, 0);
  // Faktor 1.6 bevorzugt etwas breitere Layouts (passt zu landscape-orientierten
  // Quest-Trees). Mit nur einer Component degeneriert das zu deren Breite.
  const targetRowWidth = Math.max(
    sized[0].width,
    Math.sqrt(totalArea * 1.6)
  );

  // Greedy Row-Pack
  /** @type {Record<string, { x: number; y: number }>} */
  const positions = {};
  let cursorX = padding;
  let cursorY = padding;
  let rowHeight = 0;
  let totalMaxX = padding;

  for (const c of sized) {
    // Wrap wenn die Reihe zu breit wird — aber nicht beim ersten Element der Reihe.
    if (cursorX > padding && cursorX + c.width > targetRowWidth + padding) {
      cursorY += rowHeight + interGap;
      cursorX = padding;
      rowHeight = 0;
    }
    // Component-Mittelpunkt steht aktuell auf (0,0). Wir wollen ihre obere
    // linke Ecke an (cursorX, cursorY) — also Offset = cursor - bbox.min.
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

  // Gesamtmasse: letzter Cursor + letzte Zeilenhoehe + Padding
  const width = Math.ceil(totalMaxX + padding - interGap);
  const height = Math.ceil(cursorY + rowHeight + padding);

  return { positions, width, height, minX: 0, minY: 0 };
}

// ============================================================================
// 6. Hauptfunktion: computeForceLayout
// ============================================================================

/**
 * Berechnet das Force-Directed Layout fuer den gegebenen Graph.
 *
 * **Connected-Components-aware** (Stand 2026-05-04, Pass 2):
 *   1. Erst werden alle zusammenhaengenden Komponenten erkannt (BFS undirected).
 *   2. Jede Component wird einzeln per Force-Simulation positioniert (lokal
 *      um (0,0) zentriert) — verbundene Trees behalten ihre interne Dynamik.
 *   3. Components werden nebeneinander gepackt mit grossem `interComponentGap`,
 *      damit disconnected Quest-Trees klar getrennt sind statt sich zu einem
 *      Knaeuel zu ballen.
 *
 * Output ist API-kompatibel mit dem alten `computeLayeredLayout`:
 *   - `positions[nodeId] = { x, y }` fuer ALLE Nodes (Roots + Children)
 *   - `width` / `height` = Bounding-Box-Dimensionen inkl. Padding
 *   - `minX` / `minY` = nach Normalisierung 0 (Layout startet bei (padding, padding))
 *
 * @param {RpgGraph} graph
 * @param {{
 *   compact?: boolean;
 *   iterations?: number;
 *   padding?: number;
 *   springLength?: number;
 *   springStrength?: number;
 *   repulsion?: number;
 *   centerStrength?: number;
 *   damping?: number;
 *   hierarchyBias?: number;
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
export function computeForceLayout(graph, opts = {}) {
  // ----- Konstanten (handgewaehlt; ueber opts ueberschreibbar) -----
  const compact = !!opts.compact;
  const iterations = opts.iterations ?? 350;
  const padding = opts.padding ?? (compact ? 56 : 72);
  // Wunschlaenge der Federn (in Pixeln). Compact = enger.
  const springLength = opts.springLength ?? (compact ? 86 : 110);
  // Federstaerke (Hookesche Konstante).
  const springStrength = opts.springStrength ?? 0.06;
  // Repulsion-Konstante (Coulomb). Stark genug, damit Geschwister-Nodes sich
  // klar abstossen und auf 180° um den gemeinsamen Parent verteilen koennen
  // (statt im 90°-lokal-Minimum festzustecken).
  const repulsion = opts.repulsion ?? (compact ? 3400 : 5000);
  // Center-Gravity: nur sehr sanft als Anti-Drift-Stabilisator. Im Components-
  // Layout wird die Component am Ende auf (0,0) zentriert — eine starke
  // Center-Gravity wuerde nur das System in lokalen Minima festhalten.
  const centerStrength = opts.centerStrength ?? 0.0015;
  // Daempfung (= dampingEnd im Annealing-Schema in simulateLocalForceLayout).
  const damping = opts.damping ?? 0.86;
  // Hierarchie-Bias: schwache konstante Y-Force pro structure-Edge (parent_of).
  // Parent wird leicht nach oben gedrueckt, Child leicht nach unten.
  // 0 = aus (rein organisch), 0.3 default = leichte Hierarchie-Sichtbarkeit.
  // Tradeoff: zu hoher Wert dehnt structure-Edges ueber springLength hinaus.
  const hierarchyBias = opts.hierarchyBias ?? 0.3;
  // Inter-Component-Gap: Abstand zwischen disconnected Quest-Trees.
  // Deutlich groesser als das normale Padding, damit getrennte Trees auch
  // visuell als getrennt wahrnehmbar sind. User-gewuenscht (2026-05-04).
  const interComponentGap = opts.interComponentGap ?? (compact ? 140 : 220);

  // ----- Nodes einsammeln -----
  const nodeMap = collectAllNodes(graph);
  const nodeIds = [...nodeMap.keys()].sort();
  const N = nodeIds.length;

  // Edge-Case: leerer Graph
  if (N === 0) {
    return { positions: {}, width: padding * 2, height: padding * 2, minX: 0, minY: 0 };
  }

  // ----- Edges sammeln (als ID-Tupel — Component-Detection und lokales Layout) -----
  // Beide Relations (parent_of + dependency) zaehlen als verbindend.
  // Drittes Tupel-Element: ist es eine structure-Edge (parent_of)? Wird
  // fuer Hierarchie-Bias in der lokalen Simulation gebraucht.
  /** @type {Array<[string, string, boolean]>} */
  const idEdges = [];
  for (const e of graphEdges(graph)) {
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue;
    if (e.from === e.to) continue;
    const isStructure = e.relation === 'structure' || e.relation === 'parent_of';
    idEdges.push([e.from, e.to, isStructure]);
  }

  // ----- Connected Components -----
  // findConnectedComponents nutzt nur e[0] und e[1] — funktioniert auch
  // mit dem 3-Tupel (drittes Element wird einfach ignoriert).
  const components = findConnectedComponents(nodeIds, idEdges);

  // ----- Pro Component: lokales Force-Layout -----
  const cfg = {
    iterations, springLength, springStrength, repulsion,
    centerStrength, damping, hierarchyBias, compact,
  };
  const componentLayouts = components.map((compIds) =>
    simulateLocalForceLayout(compIds, idEdges, cfg)
  );

  // ----- Components packen mit grosszuegigem Inter-Component-Gap -----
  return packComponents(componentLayouts, padding, interComponentGap);
}
