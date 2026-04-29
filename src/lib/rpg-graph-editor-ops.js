/**
 * rpg-graph-editor-ops.js — Pure Operationen fuer den Quest-Graph-Editor.
 *
 * Enthält zustandslose Funktionen fuer Graph-Traversal, Node-Manipulation,
 * ID-Generierung und KI-Fehlermeldungs-Mapping. Extrahiert aus
 * RpgQuestGraphEditor.jsx fuer bessere Testbarkeit und schlankere Komponente.
 */

import { questNodesToDrafts } from './rpg-quest-editor-draft.js';
import { addParentChildEdge, hasDagCycle } from './rpg-quest-graph.js';
import { graphNodes } from './rpg-quests-data.js';

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
 * Privat — nur intern fuer applyNodeFieldsUpdate verwendet. Aufrufer sollen
 * den High-Level-Helper applyNodeFieldsUpdate nutzen statt direkt.
 * @param {import('./rpg-quests-data.js').RpgNode[]} nodes
 * @param {string} targetId
 * @param {(node: any) => any} mapFn
 * @returns {import('./rpg-quests-data.js').RpgNode[]}
 */
function mapNodeRecursive(nodes, targetId, mapFn) {
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
 * Wendet Node-Felder (title/description/rewards/children) auf den Target-Node
 * innerhalb eines Container-Quests an — egal ob Target == Container (Root-Edit)
 * oder ein verschachtelter Child (Sub-Node-Edit).
 *
 * Konsolidierungs-Invariante: EIN Pfad fuer Root- und Child-Edit. Der
 * Aufrufer muss nicht mehr unterscheiden — nur den richtigen targetId
 * uebergeben (= containerId fuer Root, Child-ID fuer Sub).
 *
 * Container-spezifische Felder (orderInLayer, questmakerPrompt) werden
 * separat via `containerOverlay` auf den finalen Container gelegt — nicht
 * auf den Target-Node, weil sie nur am Container-Quest leben.
 *
 * @param {import('./rpg-quests-data.js').RpgNode} container — der Container-Quest (Root des Subtrees)
 * @param {string} targetId — ID des zu aendernden Nodes (== container.id fuer Root-Edit)
 * @param {{ title: string; description: string; rewards: import('./rpg-quests-data.js').RpgRewardEntry[]; children: import('./rpg-quests-data.js').RpgNode[] }} fields — kanonische Node-Felder
 * @param {Record<string, unknown>} [containerOverlay] — Container-only Updates (orderInLayer, questmakerPrompt)
 * @returns {import('./rpg-quests-data.js').RpgNode}
 */
export function applyNodeFieldsUpdate(container, targetId, fields, containerOverlay) {
  if (!container || typeof container !== 'object') {
    throw new Error('applyNodeFieldsUpdate: container required');
  }
  const tid = String(targetId || '').trim();
  if (!tid) throw new Error('applyNodeFieldsUpdate: targetId required');

  /**
   * Erzeugt das aktualisierte Node-Objekt mit kanonischen Feldern.
   * Geteilt zwischen Root- und Child-Pfad — keine Bifurkation.
   *
   * `rewards` wird IMMER gesetzt (auch leeres Array), damit der
   * upsertQuestInGraph-Merge im Aufrufer die alten Rewards beim
   * Spread `{...prev, ...node}` ueberschreibt. Ein `delete` wuerde
   * im Root-Fall (Container-Edit) dazu fuehren, dass alte Rewards
   * unbeabsichtigt erhalten bleiben.
   *
   * Andere kanonische Node-Felder (cityLocation, placeLocation,
   * dependsOn, optional, isLock, timeDueAt, orderLinked, parentId)
   * werden NICHT angefasst — der Editor editiert sie nicht, also
   * bleiben sie via `...node` Spread erhalten.
   *
   * Legacy-Feld 'questRewards' wird entfernt, weil wir kanonisch
   * 'rewards' schreiben (Symmetrie zu upsertQuestInGraph).
   *
   * @param {import('./rpg-quests-data.js').RpgNode} node
   */
  const buildUpdated = (node) => {
    const next = {
      ...node,
      title: fields.title || tid,
      description: fields.description || '',
      children: Array.isArray(fields.children) ? fields.children : [],
      rewards: Array.isArray(fields.rewards) ? fields.rewards : [],
    };
    // Legacy-Feld nicht weiter mitschleppen — wir schreiben kanonisch
    if ('questRewards' in next) delete /** @type {any} */ (next).questRewards;
    return next;
  };

  let updatedContainer;
  if (container.id === tid) {
    // Root-Edit: Target IST der Container — Felder direkt auf den Container anwenden
    updatedContainer = buildUpdated(container);
  } else {
    // Child-Edit: Target liegt im Subtree — children rekursiv durchsuchen
    const updatedChildren = mapNodeRecursive(container.children || [], tid, (node) =>
      buildUpdated(node)
    );
    updatedContainer = { ...container, children: updatedChildren };
  }

  // Container-only Overlay (orderInLayer, questmakerPrompt) am Ende anwenden,
  // weil diese Felder nur am Container-Quest leben — nie am Sub-Node.
  if (containerOverlay && typeof containerOverlay === 'object') {
    updatedContainer = { ...updatedContainer, ...containerOverlay };
  }
  return updatedContainer;
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

/**
 * Aktualisiert einen Draft (beliebige Tiefe) anhand seines Keys rekursiv.
 * Benoetigt weil ein NodeDraftCard auch tief verschachtelt sein kann.
 * @param {import('./rpg-quest-editor-draft.js').QuestNodeDraft[]} drafts
 * @param {string} key
 * @param {(d: import('./rpg-quest-editor-draft.js').QuestNodeDraft) => import('./rpg-quest-editor-draft.js').QuestNodeDraft} updater
 * @returns {import('./rpg-quest-editor-draft.js').QuestNodeDraft[]}
 */
export function updateDraftByKeyRecursive(drafts, key, updater) {
  return (drafts || []).map((d) => {
    if (d.key === key) return updater(d);
    if (d.children?.length) return { ...d, children: updateDraftByKeyRecursive(d.children, key, updater) };
    return d;
  });
}

// ============================================================
// Tree-Pick → Edge-Operationen (Phase 3)
//
// Hintergrund: der ursprüngliche Bug war, dass beim Tree-Pick eine Draft-Kopie
// einer existierenden Graph-Node gemacht wurde. Beim Save erzeugte
// `draftNodesToQuestNodes` daraus eine **neue Node** mit eigener (label-basierter)
// ID — der Original-Node blieb stehen, daneben entstand ein Duplikat.
//
// Phase-3-Lösung: ein Tree-Pick wird beim Save NICHT mehr in einen Node
// umgewandelt. Statt dessen wird **nur eine `parent_of`-Edge** hinzugefügt:
// der Original-Node bleibt da, wo er ist (kein Move), bekommt einfach einen
// zusätzlichen Parent. Multi-Parent ist im V3-DAG legitim.
//
// Die Erkennung „Tree-Pick vs. echter neuer Draft" läuft über `stableId`:
//   - Draft mit `stableId === <existierende Graph-Node-ID>` UND die ID ist
//     NICHT Teil des aktuell editierten Subtrees → das ist ein Tree-Pick.
//   - Alle anderen Drafts sind echte neue/edited Sub-Quests.
// ============================================================

/**
 * Sammelt alle existierenden Node-IDs in einem Graph (rekursiv durch
 * nested `children`, falls Compat-View — und natürlich auch Top-Level).
 *
 * Wird gebraucht, um in den Editor-Drafts „existierender Node vs. neuer Node"
 * zu unterscheiden: nur Drafts mit `stableId` aus dieser Menge können
 * Tree-Picks sein.
 *
 * @param {import('./rpg-quests-data.js').RpgGraph | null | undefined} graph
 * @returns {Set<string>}
 */
export function collectAllNodeIds(graph) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {any} n */
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (typeof n.id === 'string' && n.id) out.add(n.id);
    if (Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
    }
  }
  for (const root of graphNodes(graph)) walk(root);
  return out;
}

/**
 * Sammelt die IDs aller Nodes IM Subtree eines bestimmten Roots (inkl. Root).
 * Nutzt nested `children` (Compat-View). Wird verwendet, um beim Tree-Pick-
 * Erkennen Selbstbezüge auszuschließen — ein Draft, der den eigenen Subtree
 * beschreibt, ist KEIN Tree-Pick, sondern der normale Bearbeitungs-Inhalt.
 *
 * @param {import('./rpg-quests-data.js').RpgNode | null | undefined} rootNode
 * @returns {Set<string>}
 */
export function collectSubtreeIds(rootNode) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {any} n */
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (typeof n.id === 'string' && n.id) out.add(n.id);
    if (Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
    }
  }
  walk(rootNode);
  return out;
}

/**
 * Ein splittbarer Draft mit zugehörigen Tree-Pick-Children-IDs.
 * @typedef {{
 *   key: string;
 *   stableId?: string;
 *   children?: any[];
 *   [k: string]: any;
 * }} SplittableDraft
 */

/**
 * Splittet einen Draft-Baum rekursiv in:
 *  - `cleanDrafts`: Drafts ohne Tree-Pick-Verweise (zur normalen
 *    `draftNodesToQuestNodes`-Verarbeitung).
 *  - `treePickEdges`: Liste von `{ parentStableId, childId }` — wo
 *    parentStableId der echte Parent-Node-im-Graph ist (nicht der Draft-Key).
 *
 * Algorithmus pro Draft:
 *  1. Wenn der Draft `stableId` hat und diese in `existingIds` ist UND nicht
 *     in `selfSubtreeIds` (= eigener Edit-Container) → **Tree-Pick-Draft**.
 *     → wird NICHT in `cleanDrafts` aufgenommen, dafür eine Edge zum
 *       (logischen) Parent-Draft erzeugt.
 *  2. Sonst: rekursiv durchgehen. Eigene Children werden via `walk` weiter
 *     gesplittet. Der Tree-Pick-Parent ist `stableId || key`-Auflösung.
 *
 * Wichtig: für die Top-Level-Drafts (Children des Container-Quests) ist
 * `parentStableIdOfContainer` der Parent (= Container-Node-ID).
 *
 * @param {SplittableDraft[]} drafts
 * @param {string} parentStableIdOfContainer — Node-ID des aktuell editierten Containers/Targets
 * @param {Set<string>} existingIds — alle Node-IDs im aktuellen Graph
 * @param {Set<string>} selfSubtreeIds — IDs im aktuell editierten Subtree (Selbstbezüge ausschließen)
 * @returns {{ cleanDrafts: SplittableDraft[]; treePickEdges: Array<{ parentId: string; childId: string }> }}
 */
export function splitDraftsForTreePick(
  drafts,
  parentStableIdOfContainer,
  existingIds,
  selfSubtreeIds
) {
  /** @type {SplittableDraft[]} */
  const cleanDrafts = [];
  /** @type {Array<{ parentId: string; childId: string }>} */
  const treePickEdges = [];

  /**
   * @param {SplittableDraft[]} list — die Geschwister
   * @param {string} parentId — der reale Node-ID des Parents im Graph (für Edges)
   * @returns {SplittableDraft[]} bereinigte Liste
   */
  function walk(list, parentId) {
    const out = [];
    for (const d of list || []) {
      if (!d || typeof d !== 'object') continue;
      const sid = typeof d.stableId === 'string' ? d.stableId.trim() : '';
      // Tree-Pick: existierender Node im Graph, NICHT Teil des eigenen Subtrees
      if (sid && existingIds.has(sid) && !selfSubtreeIds.has(sid)) {
        if (parentId && parentId !== sid) {
          treePickEdges.push({ parentId, childId: sid });
        }
        // Tree-Pick wird NICHT geklont, NICHT rekursiv weitergesplittet —
        // die Children des Originals sind ja längst über eigene Edges verbunden.
        continue;
      }
      // Normaler Draft: rekursiv kuratieren. Children-Parent ist die eigene
      // stableId (falls vorhanden) — sonst der Draft-Key. Beim Speichern
      // bekommt der Draft eine label-basierte neue ID; beim Tree-Pick auf
      // dessen Kinder kommt aber sowieso nur ein Edge raus, das später
      // korrigiert werden müsste. Deshalb: nur Drafts mit echtem stableId
      // erlauben Tree-Pick-Edges direkt; bei „neue Drafts" wird die
      // parent-Beziehung über `draftNodesToQuestNodes` (children-Array)
      // ohnehin korrekt gesetzt.
      const childParent = sid || parentId;
      const cleanedChildren = walk(d.children || [], childParent);
      out.push({ ...d, children: cleanedChildren });
    }
    return out;
  }

  const cleaned = walk(drafts || [], parentStableIdOfContainer);
  cleanDrafts.push(...cleaned);

  return { cleanDrafts, treePickEdges };
}

/**
 * Entfernt alle `parent_of`-Edges, deren `from` der Container ist UND deren
 * `to` NICHT im (neuen) Subtree des Containers liegt. So spiegelt sich ein
 * UI-Remove auf der Edge-Ebene: ein Child, das aus dem Builder entfernt wurde,
 * verliert die Edge zum Container.
 *
 * Multi-Parent-Schutz: Edges anderer Parents auf dasselbe Child bleiben
 * unberührt — nur der Container-eigene Anschluss wird gelöst.
 *
 * Diese Funktion ist NICHT idempotent gegenüber den Drafts — sie entfernt
 * exakt die Edges, die beim aktuellen Save als „nicht mehr da" gemeldet
 * werden. Aufrufer sollte `newSubtreeIds` nach dem `applyNodeFieldsUpdate`
 * berechnen (d.h. aus den `cleanDrafts` + dem Container).
 *
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @param {string} containerId — Container-Quest-ID des aktuellen Edits
 * @param {Set<string>} newSubtreeIds — alle Node-IDs im NEUEN Subtree (inkl. Container selbst)
 * @returns {import('./rpg-quests-data.js').RpgGraph}
 */
export function pruneStaleParentEdgesForContainer(graph, containerId, newSubtreeIds) {
  if (!graph || !containerId) return graph;
  const cid = String(containerId).trim();
  if (!cid) return graph;
  const oldEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const filtered = oldEdges.filter((e) => {
    if (!e) return false;
    const isStruct = e.relation === 'structure' || e.relation === 'parent_of';
    if (!isStruct) return true; // dependency etc. unverändert
    if (e.from !== cid) return true; // Edge gehört anderem Parent
    return newSubtreeIds.has(e.to); // Container-eigene Edge: nur behalten wenn `to` noch da
  });
  if (filtered.length === oldEdges.length) return graph;
  return { ...graph, edges: filtered };
}

/**
 * Wendet eine Liste von Tree-Pick-Edges idempotent auf einen Graph an
 * und prüft auf Zyklen. Bei Cycle: Graph unverändert, ok=false.
 *
 * Einsatz: nach `upsertQuestInGraph` im Editor-Save, bevor `onApply` läuft.
 * Reine Edge-Operation — nodes werden NICHT verändert.
 *
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @param {Array<{ parentId: string; childId: string }>} edges
 * @returns {{ ok: true; graph: import('./rpg-quests-data.js').RpgGraph } | { ok: false; reason: 'cycle'; conflict: { parentId: string; childId: string } }}
 */
export function applyTreePickEdges(graph, edges) {
  let next = graph;
  for (const e of edges || []) {
    const parentId = String(e?.parentId || '').trim();
    const childId = String(e?.childId || '').trim();
    if (!parentId || !childId || parentId === childId) continue;
    const candidate = addParentChildEdge(next, parentId, childId);
    // Erst Cycle prüfen, BEVOR wir die Edge übernehmen.
    if (hasDagCycle(candidate)) {
      return { ok: false, reason: 'cycle', conflict: { parentId, childId } };
    }
    next = candidate;
  }
  return { ok: true, graph: next };
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
