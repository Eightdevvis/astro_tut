/**
 * rpg-tree-svg.js — Pure SVG-Helper-Funktionen fuer den Quest-Baum.
 *
 * Alles hier sind reine Geometrie-/Layout-Berechnungen ohne State oder Side-Effects.
 * Extrahiert aus RpgQuestTree.jsx, damit die Komponente schlanker bleibt
 * und die Funktionen unabhaengig testbar sind.
 */

import { graphEdges } from './rpg-quests-data.js';

// ============================================================
// Geometrie-Primitives
// ============================================================

/**
 * Berechnet Start-/Endpunkte einer Kante, indem die Kreisradien abgezogen werden.
 * So endet die Linie am Rand des Knotens, nicht in der Mitte.
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

/**
 * SVG-Path fuer ein regelmaessiges Polygon (Dreieck, Viereck, ...).
 * @param {number} corners
 * @param {number} r
 * @returns {string}
 */
export function regularPolygonPath(corners, r) {
  const n = Math.max(3, Math.floor(corners));
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    d += `${i === 0 ? 'M' : 'L'}${x} ${y} `;
  }
  return `${d}Z`;
}

/**
 * Node-Form basierend auf Kinderzahl:
 * 0 children => Kreis (null → <circle> nutzen)
 * 1 child => Tropfen
 * 2 children => Spitze Linse
 * >=3 => Regelmaessiges Polygon
 * @param {number} childCount
 * @param {number} r
 * @returns {string | null}
 */
export function nodeShapePath(childCount, r) {
  const c = Math.max(0, Math.floor(childCount || 0));
  if (c === 0) return null;
  if (c === 1) {
    const top = -r * 1.08;
    const bottom = r * 1.02;
    const side = r * 0.78;
    return `M0 ${top} Q ${side} ${-r * 0.2} ${side * 0.55} ${bottom} Q 0 ${r * 1.18} ${-side * 0.55} ${bottom} Q ${-side} ${-r * 0.2} 0 ${top} Z`;
  }
  if (c === 2) {
    const left = -r * 1.08;
    const right = r * 1.08;
    const bulge = r * 0.7;
    return `M${left} 0 Q 0 ${-bulge} ${right} 0 Q 0 ${bulge} ${left} 0 Z`;
  }
  return regularPolygonPath(c, r);
}

// ============================================================
// Subtree-Zaehlung und -Analyse
// ============================================================

/**
 * Blattanzahl in einem Node-Teilbaum (Leaf selbst = 1).
 * @param {import('./rpg-quests-data.js').RpgNode} node
 * @returns {number}
 */
export function countLeavesInNodeSubtree(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  if (kids.length === 0) return 1;
  let n = 0;
  for (const ch of kids) n += countLeavesInNodeSubtree(ch);
  return n;
}

/**
 * Leaf-Anzahl unterhalb eines Knotens (Leaf selbst = 0).
 * @param {import('./rpg-quests-data.js').RpgNode} node
 * @returns {number}
 */
export function countLeafDescendants(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  if (kids.length === 0) return 0;
  let n = 0;
  for (const ch of kids) n += countLeavesInNodeSubtree(ch);
  return n;
}

/**
 * Leaf-Anzahl fuer eine Quest (ueber alle Root-Node-Teilbaeume).
 * @param {import('./rpg-quests-data.js').RpgNode} q
 * @returns {number}
 */
export function countQuestLeaves(q) {
  const roots = Array.isArray(q?.children) ? q.children : [];
  let n = 0;
  for (const r of roots) n += countLeavesInNodeSubtree(r);
  return n;
}

/**
 * Maximale Tiefe eines Node-Teilbaums (Leaf = 1).
 * @param {import('./rpg-quests-data.js').RpgNode} node
 * @returns {number}
 */
export function maxNodeDepth(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  if (kids.length === 0) return 1;
  let m = 0;
  for (const ch of kids) m = Math.max(m, maxNodeDepth(ch));
  return m + 1;
}

// ============================================================
// Cluster-Radius und Spread (Quests auseinanderhalten)
// ============================================================

/**
 * Geschaetzter Radius des zusammenhaengenden Quest-Node-Konstrukts.
 * Nutzt Blattanzahl + Tiefe um zu schaetzen, wie viel Platz die Quest braucht.
 */
export function estimateQuestClusterRadius(q, compact) {
  const roots = Array.isArray(q?.children) ? q.children : [];
  if (roots.length === 0) return compact ? 76 : 92;
  let leaves = 0;
  let depth = 1;
  for (const r of roots) {
    leaves += countLeavesInNodeSubtree(r);
    depth = Math.max(depth, maxNodeDepth(r));
  }
  const base = compact ? 82 : 98;
  const byLeaves = Math.log2(leaves + 1) * (compact ? 30 : 38);
  const byDepth = Math.max(0, depth - 1) * (compact ? 20 : 26);
  return base + byLeaves + byDepth;
}

/**
 * Root-Quests mit Cluster-Radien auseinanderdruecken.
 * Iteratives Collision-Solving: Paare die zu nah sind, werden weggedrueckt.
 */
export function spreadQuestRootsByClusterRadius(basePositions, quests, compact) {
  /** @type {Record<string, { x: number; y: number }>} */
  const out = {};
  for (const q of quests) {
    const p = basePositions[q.id];
    if (p) out[q.id] = { x: p.x, y: p.y };
  }
  const ids = quests.map((q) => q.id).filter((id) => out[id]);
  if (ids.length < 2) return out;
  const radById = new Map(quests.map((q) => [q.id, estimateQuestClusterRadius(q, compact)]));
  // #region agent log
  fetch('http://127.0.0.1:7537/ingest/2b5506f3-0571-4260-a646-78a244462768',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7d7c9'},body:JSON.stringify({sessionId:'b7d7c9',runId:'shared-layout-pre',hypothesisId:'H1',location:'src/lib/rpg-tree-svg.js:172',message:'spreadQuestRoots start radii',data:{compact,rootCount:ids.length,radii:ids.map((id)=>({id,radius:Number(radById.get(id)||0),baseX:Number(out[id]?.x||0),baseY:Number(out[id]?.y||0)}))},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const pad = compact ? 34 : 46;
  const maxRadiusForSpread = compact ? 150 : 210;
  const pushStrength = 0.2;
  const maxPushPerPair = compact ? 14 : 22;
  let pushedPairs = 0;
  for (let it = 0; it < 84; it++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ia = ids[i];
        const ib = ids[j];
        const a = out[ia];
        const b = out[ib];
        if (!a || !b) continue;
        const ra = Math.min(radById.get(ia) ?? 90, maxRadiusForSpread);
        const rb = Math.min(radById.get(ib) ?? 90, maxRadiusForSpread);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const need = ra + rb + pad;
        if (d >= need) continue;
        const push = Math.min((need - d) * pushStrength, maxPushPerPair);
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        b.x += ux * push;
        // Layer-Struktur erhalten: vertikales Druecken gedaempft.
        a.y -= uy * push * 0.34;
        b.y += uy * push * 0.34;
        pushedPairs += 1;
      }
    }
  }
  // #region agent log
  fetch('http://127.0.0.1:7537/ingest/2b5506f3-0571-4260-a646-78a244462768',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7d7c9'},body:JSON.stringify({sessionId:'b7d7c9',runId:'shared-layout-pre',hypothesisId:'H5',location:'src/lib/rpg-tree-svg.js:200',message:'spreadQuestRoots result displacement',data:{compact,maxRadiusForSpread,pushStrength,maxPushPerPair,pushedPairs,displacement:ids.map((id)=>({id,dx:Number((out[id]?.x||0)-(basePositions[id]?.x||0)),dy:Number((out[id]?.y||0)-(basePositions[id]?.y||0)),finalX:Number(out[id]?.x||0),finalY:Number(out[id]?.y||0)}))},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return out;
}

// ============================================================
// Winkelverteilung (fuer Kanten-Ports und Node-Platzierung)
// ============================================================

/**
 * Gleichmaessig auf einem Winkelbereich verteilt.
 * @param {number} count
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {number[]}
 */
export function distributeAngles(count, startDeg, endDeg) {
  if (count <= 0) return [];
  if (count === 1) return [(startDeg + endDeg) * 0.5];
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    out.push(startDeg + (endDeg - startDeg) * t);
  }
  return out;
}

/**
 * Gleichmaessig um den vollen Kreis verteilen.
 * @param {number} count
 * @param {number} startDeg
 * @returns {number[]}
 */
export function distributeAroundCircle(count, startDeg = -180) {
  if (count <= 0) return [];
  const angleNode = 360 / count;
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < count; i++) out.push(startDeg + i * angleNode);
  return out;
}

/**
 * Gewichtet auf einem Winkelbereich verteilen (groesseres Gewicht = mehr Winkelraum).
 * @param {number[]} weights
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {number[]}
 */
export function distributeWeightedAngles(weights, startDeg, endDeg) {
  if (!Array.isArray(weights) || weights.length === 0) return [];
  if (weights.length === 1) return [(startDeg + endDeg) * 0.5];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
  const total = safe.reduce((a, b) => a + b, 0) || safe.length;
  const span = endDeg - startDeg;
  /** @type {number[]} */
  const out = [];
  let acc = 0;
  for (const w of safe) {
    const seg = (w / total) * span;
    out.push(startDeg + acc + seg * 0.5);
    acc += seg;
  }
  return out;
}

// ============================================================
// Edge-Ports (stabile Anschlusspunkte am Knotenrand)
// ============================================================

/**
 * Fuer jede Kante stabile Ports am Knotenrand berechnen:
 * - Outgoing bevorzugt oben
 * - Incoming bevorzugt unten
 * - bei nur einem Typ: breite Verteilung um den Knoten
 */
export function buildEdgePorts(graph, positions, radius) {
  /** @type {Map<string, number[]>} */
  const outByNode = new Map();
  /** @type {Map<string, number[]>} */
  const inByNode = new Map();
  const edges = graphEdges(graph).filter((e) => e.relation !== 'structure');
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!outByNode.has(e.from)) outByNode.set(e.from, []);
    if (!inByNode.has(e.to)) inByNode.set(e.to, []);
    outByNode.get(e.from).push(i);
    inByNode.get(e.to).push(i);
  }

  /** @type {Record<number, { x: number; y: number }>} */
  const fromPorts = {};
  /** @type {Record<number, { x: number; y: number }>} */
  const toPorts = {};

  for (const q of graph.nodes || []) {
    const id = q.id;
    const p = positions[id];
    if (!p) continue;
    const outs = [...(outByNode.get(id) || [])];
    const ins = [...(inByNode.get(id) || [])];
    outs.sort((a, b) => {
      const ea = edges[a];
      const eb = edges[b];
      return String(ea?.to || '').localeCompare(String(eb?.to || ''));
    });
    ins.sort((a, b) => {
      const ea = edges[a];
      const eb = edges[b];
      return String(ea?.from || '').localeCompare(String(eb?.from || ''));
    });

    const hasBoth = outs.length > 0 && ins.length > 0;
    const outAngles = hasBoth
      ? distributeAngles(outs.length, -155, -25)
      : distributeAroundCircle(outs.length, -180);
    const inAngles = hasBoth
      ? distributeAngles(ins.length, 25, 155)
      : distributeAroundCircle(ins.length, -180);

    outs.forEach((edgeIdx, i) => {
      const a = (outAngles[i] * Math.PI) / 180;
      fromPorts[edgeIdx] = {
        x: p.x + Math.cos(a) * radius,
        y: p.y + Math.sin(a) * radius,
      };
    });
    ins.forEach((edgeIdx, i) => {
      const a = (inAngles[i] * Math.PI) / 180;
      toPorts[edgeIdx] = {
        x: p.x + Math.cos(a) * radius,
        y: p.y + Math.sin(a) * radius,
      };
    });
  }

  return { fromPorts, toPorts };
}

// ============================================================
// CSS-Klassen-Helfer
// ============================================================

/**
 * CSS-Klasse fuer einen Quest-Knoten im Baum (Root-Level).
 */
export function nodeClass(quest, unlocked, added, completed) {
  if (completed) return 'rpg-tree-node rpg-tree-node--done';
  if (!unlocked) return 'rpg-tree-node rpg-tree-node--locked';
  if (!added) return 'rpg-tree-node rpg-tree-node--unlocked-not-added';
  return 'rpg-tree-node rpg-tree-node--active';
}

// ============================================================
// Node-Tree Overlay (rekursives Child-Layout + Bounding Box)
// ============================================================

/**
 * @typedef {{ id: string; nodeId: string; questId: string; label: string; x: number; y: number; isLeaf: boolean; isDone: boolean; isLock: boolean; leafDescendants: number; depth: number }} NodeTreeEntry
 * @typedef {{ fromNodeId: string; toNodeId: string; fromX: number; fromY: number; toX: number; toY: number; isDone: boolean }} NodeTreeEdge
 */

/**
 * Berechnet das komplette Child-Node-Overlay fuer den Quest-Baum:
 * Rekursive Platzierung aller Children + Bounding Box.
 *
 * Reine Geometrie-Funktion ohne UI-State — alle Lookup-Logik kommt ueber Callbacks rein.
 *
 * @param {{
 *   graphNodes: import('./rpg-quests-data.js').RpgNode[];
 *   treePositions: Record<string, { x: number; y: number }>;
 *   compact: boolean;
 *   questNodeRadius: number;
 *   fallbackWidth: number;
 *   fallbackHeight: number;
 *   isLeaf: (node: import('./rpg-quests-data.js').RpgNode) => boolean;
 *   isDone: (questId: string, nodeId: string) => boolean;
 *   isLock: (node: import('./rpg-quests-data.js').RpgNode) => boolean;
 *   leafCount: (node: import('./rpg-quests-data.js').RpgNode) => number;
 *   leafDescendants: (node: import('./rpg-quests-data.js').RpgNode) => number;
 * }} opts
 * @returns {{ nodeNodes: NodeTreeEntry[]; nodeEdges: NodeTreeEdge[]; nodeRadius: number; minX: number; minY: number; width: number; height: number }}
 */
export function computeNodeTreeOverlay(opts) {
  const {
    graphNodes, treePositions, compact, questNodeRadius,
    fallbackWidth, fallbackHeight,
    isLeaf, isDone, isLock, leafCount, leafDescendants,
  } = opts;

  const childGapX = compact ? 88 : 102;
  const childGapY = compact ? 84 : 96;
  const nodeRadius = compact ? 19 : 17; // gleiche Größe wie Root-Nodes (nodeR())

  /** @type {NodeTreeEntry[]} */
  const nodeNodes = [];
  /** @type {NodeTreeEdge[]} */
  const nodeEdges = [];
  /** @type {Map<string, { x: number; y: number; questId: string; isDone: boolean; isLeaf: boolean; isLock: boolean; leafDescendants: number; depth: number; label: string }>} */
  const placedByNodeId = new Map();
  /** @type {Set<string>} */
  const edgeKeySet = new Set();
  let reusedNodeHits = 0;
  /** @type {Array<{parentNodeId:string;childId:string;parentX:number;parentY:number;existingX:number;existingY:number;distance:number;existingQuestId:string;questId:string}>} */
  const reuseSamples = [];

  /**
   * Rekursive Platzierung: Children werden in einem Halbkreis unter dem Parent verteilt.
   * Gewichtung nach Subtree-Groesse sorgt fuer breitere Aeste bei tiefen Baeumen.
   * @param {import('./rpg-quests-data.js').RpgNode[]} children
   * @param {string} questId
   * @param {number} parentX
   * @param {number} parentY
   * @param {number} depth
   */
  function placeChildren(children, questId, parentNodeId, parentX, parentY, depth, visitedIds = new Set()) {
    if (!children?.length) return;
    // Cycle-Guard: Nodes die wir auf diesem Pfad schon gesehen haben überspringen
    const safeChildren = children.filter((ch) => ch?.id && !visitedIds.has(ch.id));
    if (!safeChildren.length) return;
    const weights = safeChildren.map((ch) => Math.max(1, leafCount(ch)));
    const totalWeight = weights.reduce((a, b) => a + b, 0) || safeChildren.length;
    const baseRadius =
      Math.max(childGapX, childGapY) * (0.66 + Math.min(0.9, Math.log2(totalWeight + 1) * 0.24)) +
      depth * (compact ? 4 : 5);
    const ringAngles = distributeWeightedAngles(weights, 12, 168);
    for (let i = 0; i < safeChildren.length; i++) {
      const child = safeChildren[i];
      const childId = String(child?.id || '').trim();
      if (!childId) continue;
      const existing = placedByNodeId.get(childId);
      if (existing) {
        // DAG-Render-Regel: Node visuell genau einmal, weitere Parents nur als Kante.
        reusedNodeHits += 1;
        if (reuseSamples.length < 20) {
          reuseSamples.push({
            parentNodeId,
            childId,
            parentX,
            parentY,
            existingX: existing.x,
            existingY: existing.y,
            distance: Math.round(Math.hypot(existing.x - parentX, existing.y - parentY)),
            existingQuestId: existing.questId,
            questId,
          });
        }
        const edgeKey = `${parentNodeId}->${childId}`;
        if (!edgeKeySet.has(edgeKey)) {
          edgeKeySet.add(edgeKey);
          nodeEdges.push({
            fromNodeId: parentNodeId,
            toNodeId: childId,
            fromX: parentX,
            fromY: parentY,
            toX: existing.x,
            toY: existing.y,
            isDone: existing.isLeaf && existing.isDone,
          });
        }
        continue;
      }
      const a = (ringAngles[i] * Math.PI) / 180;
      const w = weights[i];
      const radialBoost = Math.min(82, Math.log2(w + 1) * (compact ? 10 : 14));
      const radius = baseRadius + radialBoost;
      const x = parentX + Math.cos(a) * radius;
      const y = parentY + Math.sin(a) * radius;
      const leaf = isLeaf(child);
      nodeNodes.push({
        id: `${questId}::${child.id}`,
        nodeId: childId,
        questId,
        label: child.title || childId,
        x,
        y,
        isLeaf: leaf,
        isDone: leaf ? isDone(questId, childId) : false,
        isLock: isLock(child),
        leafDescendants: leafDescendants(child),
        depth,
      });
      placedByNodeId.set(childId, {
        x,
        y,
        questId,
        isDone: leaf ? isDone(questId, childId) : false,
        isLeaf: leaf,
        isLock: isLock(child),
        leafDescendants: leafDescendants(child),
        depth,
        label: child.title || childId,
      });
      const nextVisited = new Set(visitedIds);
      nextVisited.add(childId);
      const edgeKey = `${parentNodeId}->${childId}`;
      if (!edgeKeySet.has(edgeKey)) {
        edgeKeySet.add(edgeKey);
        nodeEdges.push({
          fromNodeId: parentNodeId,
          toNodeId: childId,
          fromX: parentX,
          fromY: parentY,
          toX: x,
          toY: y,
          isDone: leaf && isDone(questId, childId),
        });
      }
      placeChildren(child.children || [], questId, child.id, x, y, depth + 1, nextVisited);
    }
  }

  // Jede Quest: Children ab der Quest-Root-Position platzieren
  for (const q of graphNodes) {
    const p = treePositions[q.id];
    if (!p) continue;
    placeChildren(q.children || [], q.id, q.id, p.x, p.y, 1);
  }
  // #region agent log
  fetch('http://127.0.0.1:7537/ingest/2b5506f3-0571-4260-a646-78a244462768',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7d7c9'},body:JSON.stringify({sessionId:'b7d7c9',runId:'shared-layout-pre',hypothesisId:'H2',location:'src/lib/rpg-tree-svg.js:514',message:'computeNodeTreeOverlay reuse summary',data:{nodeCount:nodeNodes.length,edgeCount:nodeEdges.length,reusedNodeHits,reuseSamples},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  // Bounding Box: Quest-Roots + alle Children
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of graphNodes) {
    const p = treePositions[q.id];
    if (!p) continue;
    minX = Math.min(minX, p.x - questNodeRadius - 96);
    minY = Math.min(minY, p.y - questNodeRadius - 96);
    maxX = Math.max(maxX, p.x + questNodeRadius + 96);
    maxY = Math.max(maxY, p.y + questNodeRadius + 96);
  }
  for (const n of nodeNodes) {
    minX = Math.min(minX, n.x - nodeRadius - 100);
    minY = Math.min(minY, n.y - nodeRadius - 30);
    maxX = Math.max(maxX, n.x + nodeRadius + 100);
    maxY = Math.max(maxY, n.y + nodeRadius + 30);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = fallbackWidth;
    maxY = fallbackHeight;
  }
  return {
    nodeNodes,
    nodeEdges,
    nodeRadius,
    minX: Math.floor(minX),
    minY: Math.floor(minY),
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
    reusedNodeHits,
  };
}

/**
 * CSS-Klasse fuer Child-Nodes (unter einem Quest-Knoten).
 */
export function nodeNodeClass(isDone, isLeaf, isLock) {
  if (isDone) return 'rpg-tree-node-node rpg-tree-node-node--done';
  if (isLock) return 'rpg-tree-node-node rpg-tree-node-node--lock';
  if (isLeaf) return 'rpg-tree-node-node rpg-tree-node-node--leaf';
  return 'rpg-tree-node-node rpg-tree-node-node--container';
}
