/**
 * rpg-graph-editor-ops.js — Pure Operationen fuer den Quest-Graph-Editor.
 *
 * Enthält zustandslose Funktionen fuer Graph-Traversal, Node-Manipulation,
 * ID-Generierung und KI-Fehlermeldungs-Mapping. Extrahiert aus
 * RpgQuestGraphEditor.jsx fuer bessere Testbarkeit und schlankere Komponente.
 */

import { questNodesToDrafts } from './rpg-quest-editor-draft.js';

// ============================================================
// ID-Generierung
// ============================================================

/**
 * Erzeugt eine eindeutige Quest-ID basierend auf einer Basis-ID.
 * Haengt bei Kollision "-2", "-3", ... an.
 * @param {string} baseId
 * @param {Set<string>} existingIds
 * @returns {string}
 */
export function makeUniqueQuestId(baseId, existingIds) {
  const base = String(baseId || '').trim();
  if (!base) return '';
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// ============================================================
// Graph-Traversal
// ============================================================

/**
 * Findet das Edit-Target im Graph — entweder eine Top-Level Quest
 * oder eine verschachtelte Child-Node.
 *
 * Unterstuetzt zwei ID-Formate:
 * - "questId::nodeId" (Composite) → Child-Node innerhalb einer Quest
 * - "questId" oder "nodeId" (einfach) → zuerst als Quest, dann als Child gesucht
 *
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @param {string} entityId
 * @returns {{ containerQuestId: string; targetNode: any; isTopLevel: boolean } | null}
 */
export function resolveEditTarget(graph, entityId) {
  const id = String(entityId || '').trim();
  if (!id) return null;
  // Composite-ID: "questId::nodeId"
  const compositeMatch = /^(.+?)::(.+)$/.exec(id);
  if (compositeMatch) {
    const containerQuestId = compositeMatch[1];
    const nodeId = compositeMatch[2];
    const q = (graph.nodes || []).find((x) => x.id === containerQuestId);
    if (q) {
      /** @type {Array<any>} */
      const stack = Array.isArray(q.children) ? [...q.children] : [];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (cur.id === nodeId) {
          return { containerQuestId: q.id, targetNode: cur, isTopLevel: false };
        }
        if (Array.isArray(cur.children) && cur.children.length > 0) stack.push(...cur.children);
      }
    }
  }
  // Einfache ID: zuerst als Quest, dann als Child-Node
  for (const q of graph.nodes || []) {
    if (q.id === id) {
      return { containerQuestId: q.id, targetNode: q, isTopLevel: true };
    }
    /** @type {Array<any>} */
    const stack = Array.isArray(q.children) ? [...q.children] : [];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (cur.id === id) {
        return { containerQuestId: q.id, targetNode: cur, isTopLevel: false };
      }
      if (Array.isArray(cur.children) && cur.children.length > 0) stack.push(...cur.children);
    }
  }
  return null;
}

// ============================================================
// Rekursive Node-Manipulation
// ============================================================

/**
 * Wendet eine Mapping-Funktion auf eine bestimmte Node im Baum an (rekursiv).
 * @param {import('./rpg-quests-data.js').RpgNode[]} nodes
 * @param {string} targetId
 * @param {(node: any) => any} mapFn
 * @returns {import('./rpg-quests-data.js').RpgNode[]}
 */
export function mapNodeRecursive(nodes, targetId, mapFn) {
  return (nodes || []).map((node) => {
    if (!node || typeof node !== 'object') return node;
    if (node.id === targetId) return mapFn(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      return { ...node, children: mapNodeRecursive(node.children, targetId, mapFn) };
    }
    return node;
  });
}

/**
 * Entfernt eine Node rekursiv aus dem Tree und sammelt alle entfernten IDs.
 * @param {import('./rpg-quests-data.js').RpgNode[]} nodes
 * @param {string} targetId
 * @returns {{ nodes: import('./rpg-quests-data.js').RpgNode[]; removed: boolean; matchCount: number; removedIds: string[] }}
 */
export function removeNodeRecursive(nodes, targetId) {
  let removed = false;
  let matchCount = 0;
  /** @type {string[]} */
  const removedIds = [];
  const next = [];

  /**
   * @param {import('./rpg-quests-data.js').RpgNode} node
   */
  const collectIds = (node) => {
    const id = typeof node?.id === 'string' ? node.id.trim() : '';
    if (id) removedIds.push(id);
    for (const ch of node?.children || []) collectIds(ch);
  };

  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') {
      next.push(node);
      continue;
    }
    if (node.id === targetId) {
      removed = true;
      matchCount += 1;
      collectIds(node);
      continue;
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const out = removeNodeRecursive(node.children, targetId);
      if (out.removed) removed = true;
      if (out.matchCount > 0) matchCount += out.matchCount;
      if (out.removedIds.length > 0) removedIds.push(...out.removedIds);
      next.push(out.removed ? { ...node, children: out.nodes } : node);
      continue;
    }
    next.push(node);
  }
  return { nodes: next, removed, matchCount, removedIds };
}

/**
 * Entfernt Referenzen auf geloeschte Node-IDs aus dependsOn-Listen (rekursiv).
 * @param {import('./rpg-quests-data.js').RpgNode[]} nodes
 * @param {Set<string>} removedIdSet
 * @returns {import('./rpg-quests-data.js').RpgNode[]}
 */
export function stripDependsOnReferences(nodes, removedIdSet) {
  return (nodes || []).map((node) => {
    if (!node || typeof node !== 'object') return node;
    const nextChildren = Array.isArray(node.children)
      ? stripDependsOnReferences(node.children, removedIdSet)
      : [];
    const deps = Array.isArray(node.dependsOn) ? node.dependsOn : [];
    const nextDeps = deps.filter((dep) => !removedIdSet.has(String(dep || '').trim()));
    const base = nextChildren !== node.children ? { ...node, children: nextChildren } : { ...node };
    if (nextDeps.length > 0) return { ...base, dependsOn: nextDeps };
    if ('dependsOn' in base) {
      const { dependsOn: _drop, ...rest } = base;
      return rest;
    }
    return base;
  });
}

// ============================================================
// Draft-Operationen
// ============================================================

/**
 * Oeffnet im Draft-Baum den Pfad zur fokussierten Node
 * (setzt `saved: false` auf dem Pfad, damit der Bereich aufgeklappt wird).
 * @param {import('./rpg-quest-editor-draft.js').QuestNodeDraft[]} drafts
 * @param {string | null | undefined} focusNodeId
 * @returns {import('./rpg-quest-editor-draft.js').QuestNodeDraft[]}
 */
export function expandDraftsToFocusedNode(drafts, focusNodeId) {
  const focus = String(focusNodeId || '').trim();
  if (!focus) return drafts;
  /**
   * @param {import('./rpg-quest-editor-draft.js').QuestNodeDraft} draft
   * @returns {{ draft: import('./rpg-quest-editor-draft.js').QuestNodeDraft; hasFocus: boolean }}
   */
  const walk = (draft) => {
    let hasFocus = draft.stableId === focus || draft.key === focus;
    const nextChildren = (draft.children || []).map((child) => {
      const out = walk(child);
      if (out.hasFocus) hasFocus = true;
      return out.draft;
    });
    if (!hasFocus) return { draft, hasFocus: false };
    return {
      draft: {
        ...draft,
        saved: false,
        ...(nextChildren.length > 0 ? { children: nextChildren } : {}),
      },
      hasFocus: true,
    };
  };
  return drafts.map((draft) => walk(draft).draft);
}

/**
 * Wandelt eine Graph-Node-ID in ein Draft-Objekt um.
 * Nutzt resolveEditTarget um die Node im Graph zu finden und
 * konvertiert sie dann via questNodesToDrafts.
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @param {string} nodeId
 * @returns {import('./rpg-quest-editor-draft.js').QuestNodeDraft | null}
 */
export function graphNodeIdToDraft(graph, nodeId) {
  const resolved = resolveEditTarget(graph, nodeId);
  if (!resolved || !resolved.targetNode) return null;
  const entity = resolved.isTopLevel
    ? {
        id: resolved.targetNode.id,
        title: resolved.targetNode.title || resolved.targetNode.id,
        description: resolved.targetNode.description || '',
        children: Array.isArray(resolved.targetNode.children) ? resolved.targetNode.children : [],
      }
    : resolved.targetNode;
  const out = questNodesToDrafts([entity]);
  return out[0] || null;
}

// ============================================================
// KI-Fehler-Mapping
// ============================================================

/** Bekannte Questmaker-Error-Codes mit deutschsprachigen Erklaerungen. */
const AI_ERROR_CODE_MAP = {
  clarify_limit_reached:
    'Zu viele Rückfragen hintereinander. Bitte ergänze deinen Prompt mit festen Fakten (Zeit, Budget, vorhandene Ressourcen).',
  quality_placeholder_nodes:
    'Die KI hat zu generische Schritte erzeugt. Bitte gib konkrete Teilaufgaben und erwartete Ergebnisse an.',
  quality_too_flat:
    'Die Struktur ist für das Vorhaben zu flach. Bitte nenne die Hauptblöcke (z. B. Beschaffung, Setup, Implementierung, Test).',
  quality_leaf_not_concrete:
    'Mindestens ein Leaf-Node war nicht konkret genug. Bitte formuliere überprüfbare Handlungen.',
  missing_questmaker_items:
    'Für neue Item-IDs fehlen vollständige Item-Definitionen. Bitte Prompt konkretisieren oder Item-Namen angeben.',
  item_lookup_no_candidates:
    'Die Item-Suche hat keine belastbaren Treffer gefunden. Bitte Item-Name und Stichworte konkreter beschreiben.',
  item_lookup_ambiguous:
    'Die Item-Suche war mehrdeutig. Bitte den beabsichtigten Item-Typ klarer benennen.',
  item_resolution_failed:
    'Die KI konnte die Item-Treffer nicht sauber auflösen. Bitte erneut generieren oder Prompt präzisieren.',
  invalid_package_payload:
    'Das KI-Paket war unvollständig. Bitte den Unterabschnitt enger und konkreter beschreiben.',
  package_placeholder_nodes:
    'Das KI-Paket enthält Platzhalter-Nodes. Bitte konkrete Leafs und Branches angeben.',
};

/**
 * Formatiert eine KI-Fehlerantwort zu einer nutzerfreundlichen Meldung.
 * @param {{ errorCode?: unknown; error?: unknown; message?: unknown; hint?: unknown; detail?: unknown; status?: unknown }} data
 * @param {number} status
 * @returns {string}
 */
export function formatAiError(data, status) {
  const code = typeof data?.errorCode === 'string' ? data.errorCode.trim() : '';
  const msg =
    typeof data?.message === 'string'
      ? data.message.trim()
      : typeof data?.error === 'string'
        ? data.error.trim()
        : `Generierung fehlgeschlagen (${status})`;
  const hint = typeof data?.hint === 'string' ? data.hint.trim() : '';
  const detail = typeof data?.detail === 'string' ? data.detail.trim() : '';
  const mapped = code && AI_ERROR_CODE_MAP[code] ? AI_ERROR_CODE_MAP[code] : msg;
  const rest = hint || detail;
  return rest ? `${mapped}\n\nHinweis: ${rest.slice(0, 500)}` : mapped;
}
