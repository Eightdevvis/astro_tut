/**
 * Schema-Version des gespeicherten RPG-Payloads (`rpg_user_state.payload`).
 *
 * Aktueller Wert: 3 (V3 = DAG-Foundation, Phase 1).
 *
 * Schema-Geschichte
 * ─────────────────
 *
 * V1 (Legacy)
 *   - `graph.quests` als Container, oft mit `nodesById` Map
 *   - Nodes mit `label`, `reward`, `questRewards` (Legacy-Felder)
 *   - Edges teils `fromNodeId`/`toNodeId` (statt `from`/`to`)
 *
 * V2
 *   - `graph.nodes` ist die Quelle (kein `quests` mehr beim Schreiben).
 *   - Nodes mit `title`, `rewards[]` (4 Reward-Typen) — Legacy-Felder werden im
 *     Lese-Pfad noch akzeptiert aber nicht mehr geschrieben.
 *   - Edges: `{ from, to, relation: 'structure' | 'dependency' }`.
 *   - Nodes haben weiterhin `parentId` (string|null) und `children` (RpgNode[])
 *     als nested Tree — eine Node kann genau einen Parent haben.
 *
 * V3 (Phase 1: Foundation für DAG-Multi-Parent)
 *   - **Datenmodell-Wende**: Parent/Child-Relationen leben jetzt in `graph.edges`
 *     als `relation: 'parent_of'` (alias zu `'structure'`, wird vom Normalizer
 *     auf den kanonischen `'structure'`-Wert abgebildet).
 *   - **Persistierte Form** (canonical): jede Node ist EIN flacher Eintrag in
 *     `graph.nodes` ohne nested `children` und ohne `parentId`. Die Hierarchie
 *     wird ausschliesslich aus `graph.edges` mit `relation === 'structure'`
 *     rekonstruiert.
 *   - **Multi-Parent möglich**: ein Node kann mehrere parent_of-Edges
 *     einkommend haben → echtes DAG.
 *   - **Compat-View** (Read-Only, nicht persistiert): `denormalizeGraphForCompat`
 *     baut eine Sicht mit `children: RpgNode[]` (rekursiv) und
 *     `parentId: string | null` (erster Parent), sodass alle bestehenden
 *     Aufrufer von `node.children` und `node.parentId` weiter funktionieren.
 *     Multi-Parent-Nodes erscheinen als kopierte Sub-Trees unter jedem Parent.
 *   - **Migration**: `migrateRpgGraphToV3` ist idempotent und akzeptiert V1/V2
 *     als Eingabe. Phase 2 baut dann die Aufrufer auf neue Helper um, Phase 3+4
 *     entfernen die Compat-Schicht.
 */
export const RPG_PAYLOAD_SCHEMA_VERSION = 3;

/**
 * @param {unknown} v
 * @returns {number}
 */
export function coerceRpgPayloadSchemaVersion(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 999999);
}

// --- V3-Migration (DAG-Flatten) ---
//
// Importe hier (nicht oben), weil die Migration ein dünner Wrapper auf
// Helpers aus rpg-quests-data.js + rpg-quest-nodes.js ist und Zirkel-Imports
// vermieden werden sollen — dieser Modul-Kopf bleibt importfrei.

import { graphNodes, makeRpgGraph, graphEdges } from './rpg-quests-data.js';
import { migrateRpgGraphToV2 } from './rpg-quest-nodes.js';

/**
 * @typedef {import('./rpg-quests-data.js').RpgGraph} RpgGraph
 * @typedef {import('./rpg-quests-data.js').RpgNode} RpgNode
 * @typedef {import('./rpg-quests-data.js').RpgEdge} RpgEdge
 */

/**
 * Plättet einen V2-Graph (mit nested children) zu einem V3-DAG.
 *
 * Algorithmus
 * ───────────
 * 1. Graph-Eingang via `migrateRpgGraphToV2` zu V2 normalisieren (idempotent).
 *    Damit ist sichergestellt: Roots in `graph.nodes`, alle nested
 *    `children` rekursiv normalisiert, Edges in kanonischem Format.
 * 2. Pre-Order-Walk durch alle Roots: jeden Node sammeln (flach), Compat-Felder
 *    `children`/`parentId` entfernen.
 * 3. Aus `parentId` und nested `children` parent_of-Edges (kanonisch
 *    `relation: 'structure'`) erzeugen — Duplikate vermeiden.
 * 4. Bestehende Nicht-structure-Edges (dependency etc.) übernehmen.
 *
 * Idempotenz: nochmaliger Aufruf auf einem V3-Graph ändert nichts, weil
 * Schritt 2 keine `children` mehr findet und Schritt 3 keine neuen Edges
 * erzeugt.
 *
 * Multi-Parent (DAG): wenn der Eingangsgraph durch externe Bearbeitung mehrere
 * `parent_of`-Edges für dieselbe child-ID hat, bleiben alle erhalten —
 * V3 unterstützt Multi-Parent explizit.
 *
 * @param {RpgGraph | Record<string, unknown> | null | undefined} graph
 * @returns {RpgGraph}
 */
export function migrateRpgGraphToV3(graph) {
  // Schritt 1: Erst V1→V2 normalisieren. migrateRpgGraphToV2 ist selbst
  // idempotent und kümmert sich um Legacy-Felder + Cycle-Break.
  const v2 = migrateRpgGraphToV2(graph);

  // Schritt 2 + 3: Flatten + Edges sammeln.
  /** @type {Map<string, RpgNode>} — alle Nodes per ID, jeder genau einmal. */
  const flatNodes = new Map();
  /** @type {Set<string>} — Edge-Key 'from→to' für Dedup. */
  const structureEdgeKeys = new Set();
  /** @type {RpgEdge[]} */
  const structureEdges = [];

  /**
   * Klont einen Node ohne `children`/`parentId` (Compat-Felder weg).
   * Behält alle anderen Felder (Title, Rewards, Description, …).
   * @param {RpgNode} src
   * @returns {RpgNode}
   */
  function stripCompatFields(src) {
    // Object-Spread + Destructure: parentId/children rauszieht und Rest behält.
    const { parentId: _pid, children: _ch, ...rest } = /** @type {any} */ (src);
    return /** @type {RpgNode} */ (rest);
  }

  /**
   * @param {RpgNode} node
   * @param {string | null} parentId — vom Caller bestimmter Parent (Edge-Quelle)
   * @param {Set<string>} visited — Cycle-Guard pro Walk-Pfad
   */
  function walk(node, parentId, visited) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string') return;
    const id = node.id;
    if (visited.has(id)) return; // Cycle: bereits gesehen, nicht erneut absteigen
    visited.add(id);

    // Node merken: erste Begegnung gewinnt (sollte nach migrateRpgGraphToV2
    // ohnehin eindeutig sein, weil deduplicateGraphRoots laeuft).
    if (!flatNodes.has(id)) {
      flatNodes.set(id, stripCompatFields(node));
    }

    // Edge zum Parent erzeugen — sowohl aus expliziter parentId als auch aus
    // der Position im nested Tree (forced Parent durch den Caller).
    const realParent = parentId
      || (typeof node.parentId === 'string' && node.parentId.trim() ? node.parentId.trim() : null);
    if (realParent && realParent !== id) {
      const key = `${realParent}→${id}`;
      if (!structureEdgeKeys.has(key)) {
        structureEdgeKeys.add(key);
        structureEdges.push({ from: realParent, to: id, relation: 'structure' });
      }
    }

    // Rekursion: Children mit aktuellem Node als Parent.
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child, id, visited);
      }
    }
  }

  for (const root of graphNodes(v2)) {
    walk(root, null, new Set());
  }

  // Schritt 4: vorhandene Edges übernehmen — Dependency-Edges direkt,
  // structure-Edges via Dedup-Set (vermeidet Doppelungen mit den aus
  // parentId/children erzeugten).
  /** @type {RpgEdge[]} */
  const finalEdges = [];
  for (const e of graphEdges(v2)) {
    if (e.relation === 'structure') {
      const key = `${e.from}→${e.to}`;
      if (!structureEdgeKeys.has(key)) {
        structureEdgeKeys.add(key);
        finalEdges.push(e);
      }
    } else {
      finalEdges.push(e);
    }
  }
  // Dann die aus dem Walk gesammelten structure-Edges (Reihenfolge: erst
  // explizit benannte, dann strukturell abgeleitete).
  for (const e of structureEdges) finalEdges.push(e);

  // makeRpgGraph mit Map (statt Array) materialisiert automatisch die
  // Compat-View: `roots` werden aus den structure-Edges rekonstruiert mit
  // korrekt gesetzten parentId/children. Das ist die V3 + Compat-Form, die
  // im State und in API-Antworten gebraucht wird.
  // V3-canonical (flach, ohne Compat-Felder) wird über
  // `stripGraphCompatFields` erzeugt — z.B. für DB-Schreibwege.
  /** @type {Record<string, RpgNode>} */
  const nodesByIdObj = {};
  for (const [id, node] of flatNodes) nodesByIdObj[id] = node;
  return makeRpgGraph(nodesByIdObj, finalEdges);
}

/**
 * Erzeugt das V3-canonical Persistenz-Format: alle Nodes flach im
 * `nodes`-Array (Roots + alle Descendants), `children`/`parentId` aus
 * jedem Eintrag entfernt. Hierarchie lebt ausschliesslich in `edges`.
 *
 * Eingabe ist typischerweise eine Compat-View (Roots mit nested children)
 * — dieser Helper sammelt rekursiv alle Knoten und entfernt die
 * Compat-Felder. Verwendet für DB-Schreibwege und API-Persistenz.
 *
 * @param {RpgGraph} graph
 * @returns {RpgGraph}
 */
export function stripGraphCompatFields(graph) {
  /** @type {Map<string, RpgNode>} — Dedup per ID (bei Multi-Parent-Kopien). */
  const flat = new Map();

  /** @param {RpgNode} node */
  function collect(node) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string') return;
    if (!flat.has(node.id)) {
      const { parentId: _pid, children: _ch, ...rest } = /** @type {any} */ (node);
      flat.set(node.id, /** @type {RpgNode} */ (rest));
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) collect(child);
    }
  }

  for (const root of graphNodes(graph)) collect(root);
  return { nodes: [...flat.values()], edges: graphEdges(graph) };
}
