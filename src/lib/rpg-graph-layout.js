/**
 * Graph-Layout: Layered Layout mit Kollisions-Aufloesung fuer den Quest-Baum.
 * Reine Geometrie-Berechnungen — importiert nur Accessoren und buildIncomingMap.
 */
import { graphNodes } from './rpg-quests-data.js';
import { buildIncomingMap } from './rpg-quest-graph.js';

/** @typedef {import('./rpg-quests-data.js').RpgNode} RpgNode */
/** @typedef {import('./rpg-quests-data.js').RpgGraph} RpgGraph */

/**
 * Shape-Radius abhaengig von compact-Modus.
 * @param {boolean} compact
 */
function layoutShapeRadius(compact) {
  return compact ? 26 : 24;
}

/**
 * Lokale AABB relativ zum Knotenmittelpunkt (SVG: Title unter dem Shape).
 * @param {RpgNode} q
 * @param {boolean} compact
 */
function layoutNodeLocalBounds(q, compact) {
  const r = layoutShapeRadius(compact);
  const titleText = typeof q.title === 'string' ? q.title : '';
  const labelText = titleText.length > 20 ? `${titleText.slice(0, 18)}\u2026` : titleText;
  const charW = compact ? 5.7 : 6.2;
  const labelHalfW = Math.min(78, (Math.max(labelText.length, 1) * charW) / 2);
  const labelBelow = 16;
  const labelH = compact ? 12 : 13;
  const sidePad = 6;
  const halfW = Math.max(r + sidePad, labelHalfW + sidePad);
  return {
    left: -halfW,
    right: halfW,
    top: -(r + sidePad),
    bottom: r + labelBelow + labelH + sidePad,
  };
}

/**
 * Iterativ ueberlappende Knoten-Huellen auseinanderdruecken (SAT-Minimum Translation).
 * @param {Record<string, { x: number; y: number }>} positions — wird mutiert
 * @param {RpgGraph} graph
 * @param {boolean} compact
 * @param {{ iterations?: number; extraSeparation?: number }} [opts]
 */
function resolveQuestNodeCollisions(positions, graph, compact, opts = {}) {
  const iterations = opts.iterations ?? 48;
  const extra = opts.extraSeparation ?? 2;
  // Lokale Map statt questMap-Import — vermeidet zirkulaere Abhaengigkeit
  const nodes = graphNodes(graph);
  const byId = new Map(nodes.map((q) => [q.id, q]));
  const ids = nodes.map((q) => q.id).filter((id) => positions[id]);
  const bounds = new Map(
    ids.map((id) => {
      const q = byId.get(id);
      return [id, q ? layoutNodeLocalBounds(q, compact) : { left: -24, right: 24, top: -28, bottom: 44 }];
    })
  );

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ia = ids[i];
        const ib = ids[j];
        const ba = bounds.get(ia);
        const bb = bounds.get(ib);
        const pa = positions[ia];
        const pb = positions[ib];
        if (!ba || !bb || !pa || !pb) continue;

        const ax0 = pa.x + ba.left;
        const ax1 = pa.x + ba.right;
        const ay0 = pa.y + ba.top;
        const ay1 = pa.y + ba.bottom;
        const bx0 = pb.x + bb.left;
        const bx1 = pb.x + bb.right;
        const by0 = pb.y + bb.top;
        const by1 = pb.y + bb.bottom;

        const overlapX = Math.min(ax1, bx1) - Math.max(ax0, bx0);
        const overlapY = Math.min(ay1, by1) - Math.max(ay0, by0);
        if (overlapX <= 0 || overlapY <= 0) continue;

        if (overlapX < overlapY) {
          const mag = overlapX * 0.5 + extra;
          const dir = pa.x < pb.x ? 1 : -1;
          const sx = dir * mag;
          pa.x -= sx;
          pb.x += sx;
        } else {
          const mag = overlapY * 0.5 + extra;
          const dir = pa.y < pb.y ? 1 : -1;
          const sy = dir * mag;
          pa.y -= sy;
          pb.y += sy;
        }
      }
    }
  }
}

/**
 * Verschiebt alle Positionen so dass die linke obere Ecke bei (padding, padding) liegt.
 * @param {Record<string, { x: number; y: number }>} positions
 * @param {RpgGraph} graph
 * @param {boolean} compact
 * @param {number} padding
 */
function normalizeLayoutOrigin(positions, graph, compact, padding) {
  const nodes = graphNodes(graph);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of nodes) {
    const p = positions[q.id];
    if (!p) continue;
    const b = layoutNodeLocalBounds(q, compact);
    minX = Math.min(minX, p.x + b.left);
    maxX = Math.max(maxX, p.x + b.right);
    minY = Math.min(minY, p.y + b.top);
    maxY = Math.max(maxY, p.y + b.bottom);
  }
  if (!Number.isFinite(minX)) return;
  const dx = padding - minX;
  const dy = padding - minY;
  for (const q of nodes) {
    const p = positions[q.id];
    if (p) {
      p.x += dx;
      p.y += dy;
    }
  }
}

/**
 * Layered Layout: Layer 0 = keine eingehenden Kanten (unten), hoehere Layer weiter oben.
 * @param {RpgGraph} graph
 * @param {{ rowGap?: number; colGap?: number; padding?: number; compact?: boolean; collisionIterations?: number }} [opts]
 */
export function computeLayeredLayout(graph, opts = {}) {
  const rowGap = opts.rowGap ?? 108;
  const colGap = opts.colGap ?? 128;
  const padding = opts.padding ?? 72;
  const compact = !!opts.compact;
  const nodes = graphNodes(graph);
  const collisionIterations =
    opts.collisionIterations ?? Math.min(120, 36 + Math.floor(nodes.length * 2.5));
  const ids = nodes.map((q) => q.id);
  const incoming = buildIncomingMap(graph);

  /** @type {Map<string, number>} */
  const level = new Map();
  /** @type {Set<string>} */
  const visiting = new Set();

  /** @param {string} id */
  function levelOf(id) {
    if (level.has(id)) return level.get(id);
    if (visiting.has(id)) {
      // Defensiv gegen fehlerhafte persistierte Zyklen
      return 0;
    }
    visiting.add(id);
    const preds = incoming.get(id) || [];
    if (preds.length === 0) {
      level.set(id, 0);
      visiting.delete(id);
      return 0;
    }
    const L = Math.max(...preds.map((p) => levelOf(p))) + 1;
    level.set(id, L);
    visiting.delete(id);
    return L;
  }

  for (const id of ids) levelOf(id);
  const maxL = ids.length ? Math.max(...ids.map((id) => level.get(id) ?? 0)) : 0;

  /** @type {Map<number, string[]>} */
  const byLevel = new Map();
  for (const id of ids) {
    const L = level.get(id) ?? 0;
    if (!byLevel.has(L)) byLevel.set(L, []);
    byLevel.get(L).push(id);
  }
  // Sortierung innerhalb jeder Ebene: orderInLayer, dann alphabetisch
  const orderOf = (id) => {
    const q = nodes.find((x) => x.id === id);
    const o = q?.orderInLayer;
    return typeof o === 'number' && !Number.isNaN(o) ? o : 0;
  };
  for (const row of byLevel.values()) {
    row.sort((a, b) => {
      const da = orderOf(a);
      const db = orderOf(b);
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });
  }

  let maxRowW = 0;
  for (let L = 0; L <= maxL; L++) {
    const row = byLevel.get(L) || [];
    const rowW = row.length > 0 ? (row.length - 1) * colGap : 0;
    maxRowW = Math.max(maxRowW, rowW);
  }

  const centerX = padding + maxRowW / 2;
  /** @type {Record<string, { x: number; y: number }>} */
  const positions = {};

  for (let L = 0; L <= maxL; L++) {
    const row = byLevel.get(L) || [];
    const rowW = row.length > 0 ? (row.length - 1) * colGap : 0;
    const startX = centerX - rowW / 2;
    row.forEach((id, i) => {
      positions[id] = {
        x: startX + i * colGap,
        y: padding + (maxL - L) * rowGap,
      };
    });
  }

  resolveQuestNodeCollisions(positions, graph, compact, { iterations: collisionIterations });
  normalizeLayoutOrigin(positions, graph, compact, padding);

  let maxR = 0;
  let maxB = 0;
  for (const q of nodes) {
    const p = positions[q.id];
    if (!p) continue;
    const b = layoutNodeLocalBounds(q, compact);
    maxR = Math.max(maxR, p.x + b.right);
    maxB = Math.max(maxB, p.y + b.bottom);
  }
  const width = Math.ceil(maxR + padding);
  const height = Math.ceil(maxB + padding);
  return { positions, width, height, maxLevel: maxL };
}
