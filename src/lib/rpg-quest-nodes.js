/**
 * Rekursive Node-Logik: Gruppen, optionale Blaetter, dependsOn, Locks,
 * Fortschritt ueber nicht-optionale Blaetter, Migration.
 *
 * Alles ist ein RpgNode — Rolle (Root/Gruppe/Blatt) ergibt sich aus Position im Baum.
 * Reward-Logik liegt in rpg-quest-rewards.js.
 */
import { normalizeQuestCityLocation, normalizeNodePlaceLocation } from './rpg-location.js';
import { graphNodes, makeRpgGraph, graphEdges } from './rpg-quests-data.js';
import {
  normalizeRewardEntry,
  normalizeRewardEntries,
  normalizeRewardRows,
  rewardRowToStored,
  rewardEntryDisplayLabel,
  stringsToTextRewards,
} from './rpg-quest-rewards.js';

/** @typedef {import('./rpg-quests-data.js').RpgNode} RpgNode */
/** @typedef {import('./rpg-quests-data.js').RpgRewardEntry} RpgRewardEntry */
/** @typedef {import('./rpg-quests-data.js').RpgGraph} RpgGraph */
/** @typedef {import('./rpg-quest-rewards.js').RpgRewardRow} RpgRewardRow */

// --- Warn-Once Utility ---

const RPG_NODE_WARNED_KEYS = new Set();
function warnNodeAnomalyOnce(key, message, details) {
  if (RPG_NODE_WARNED_KEYS.has(key)) return;
  RPG_NODE_WARNED_KEYS.add(key);
  console.warn(`[rpg:nodes] ${message}`, details);
}

// --- Node-Normalisierung ---

/**
 * Normalisiert einen einzelnen Node aus beliebigen Rohdaten.
 * Akzeptiert sowohl neues Format (title, rewards[]) als auch Legacy (label, reward, questRewards).
 * @param {unknown} raw
 * @param {{ n: number }} next — Auto-ID-Zaehler
 * @param {string | null} parentId
 * @returns {RpgNode}
 */
function normalizeOneNode(raw, next, parentId) {
  const o = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};

  // ID: explizit oder auto-generiert
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `s-${next.n++}`;

  // Title: neues Feld bevorzugt, Legacy 'label' als Fallback
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim()
    : typeof o.label === 'string' && o.label.trim() ? o.label.trim()
    : id;

  const description = typeof o.description === 'string' && o.description.trim() ? o.description.trim() : '';
  const optional = !!o.optional;

  // DependsOn: Array von Node-IDs die vorher erledigt sein muessen
  const dependsOn = Array.isArray(o.dependsOn)
    ? o.dependsOn.map((x) => String(x).trim()).filter(Boolean)
    : [];

  // Rewards: akzeptiert rewards[] (neu), questRewards[] (Legacy-Root), reward (Legacy-Child)
  const rewardsFromArray = normalizeRewardEntries(o.rewards ?? o.questRewards);
  const singleReward = normalizeRewardEntry(o.reward);
  const rewards = singleReward ? [...rewardsFromArray, singleReward] : rewardsFromArray;

  // Location
  const cityLocation = normalizeQuestCityLocation(o.cityLocation);
  const placeLocation = normalizeNodePlaceLocation(o.placeLocation);

  // Faelligkeitsdatum (YYYY-MM-DD)
  let timeDueAt;
  const rawDue = typeof o.timeDueAt === 'string' ? o.timeDueAt.trim() : '';
  if (rawDue) {
    const ymd = rawDue.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) timeDueAt = ymd;
    else {
      const t = Date.parse(rawDue);
      if (!Number.isNaN(t)) timeDueAt = new Date(t).toISOString().slice(0, 10);
    }
  }

  // Children: rekursiv normalisieren
  const kidsRaw = Array.isArray(o.children) ? o.children : o.subnodes;

  /** @type {RpgNode} */
  let out = { id, parentId, title, optional, children: [] };
  if (description) out = { ...out, description };
  if (dependsOn.length) out = { ...out, dependsOn };
  if (rewards.length) out = { ...out, rewards };
  if (cityLocation) out = { ...out, cityLocation };
  if (placeLocation) out = { ...out, placeLocation };
  if (timeDueAt) out = { ...out, timeDueAt };
  if (o.orderLinked === true) out = { ...out, orderLinked: true };
  if (o.isLock === true) out = { ...out, isLock: true };
  if (typeof o.orderInLayer === 'number') out = { ...out, orderInLayer: o.orderInLayer };
  if (typeof o.questmakerPrompt === 'string' && o.questmakerPrompt.trim()) {
    out = { ...out, questmakerPrompt: o.questmakerPrompt.trim() };
  }

  if (Array.isArray(kidsRaw) && kidsRaw.length > 0) {
    return { ...out, children: normalizeNodesArray(kidsRaw, next, id) };
  }
  return out;
}

/**
 * @param {unknown[]} arr
 * @param {{ n: number }} next
 * @param {string | null} parentId
 * @returns {RpgNode[]}
 */
function normalizeNodesArray(arr, next, parentId) {
  return arr.map((x) => normalizeOneNode(x, next, parentId));
}

/**
 * Normalisiert einen Baum von Nodes aus beliebigen Rohdaten.
 * @param {unknown} nodes
 * @param {string | null} [parentId]
 * @returns {RpgNode[]}
 */
export function normalizeQuestNodesTree(nodes, parentId = null) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  return normalizeNodesArray(nodes, { n: 0 }, parentId);
}

/**
 * Flache Legacy-Zeilen -> normalisierte Blaetter ohne Substufen.
 * @param {{ id: string; title?: string; label?: string }[]} flat
 * @returns {RpgNode[]}
 */
export function flatLegacyNodesToNormalized(flat) {
  const next = { n: 0 };
  return flat.map((s) => normalizeOneNode(s, next, null));
}

// --- Node-Abfragen ---

/**
 * Sucht einen Node rekursiv nach ID im Baum.
 * @param {RpgNode[]} nodes
 * @param {string} id
 * @returns {RpgNode | null}
 */
export function findNodeById(nodes, id, _visited = new Set()) {
  for (const s of nodes) {
    if (!s?.id || _visited.has(s.id)) continue;
    if (s.id === id) return s;
    _visited.add(s.id);
    if (s.children?.length) {
      const f = findNodeById(s.children, id, _visited);
      if (f) return f;
    }
  }
  return null;
}

/**
 * Sucht einen Node im gesamten Graph und gibt ihn mit Root-Quest-Kontext zurück.
 *
 * Phase-2-Hinweis: Diese Funktion ist jetzt nur noch ein Compat-Wrapper für
 * alte Aufrufer, die das `rootQuestId`/`ancestors`-Format brauchten. Neuer
 * Code sollte stattdessen `findNodeAncestors(graph, nodeId)` aus
 * `rpg-quest-graph.js` verwenden — das liefert die echten DAG-Vorfahren
 * (Multi-Parent-aware) statt eines einzigen Root-Pfads.
 *
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @returns {{ node: RpgNode; rootQuestId: string; ancestors: RpgNode[] } | null}
 */
export function findNodeWithAncestors(graph, nodeId) {
  // Erst in Children suchen — tiefere Position gewinnt, weil sie mehr Kontext liefert.
  // Das behandelt auch den Fall wo ein Node (Merge-Artifact) gleichzeitig Root und Child ist:
  // dann bevorzugen wir die Child-Position mit den richtigen Ancestors.
  for (const root of graph.nodes || []) {
    const result = _walkForAncestors(root.children || [], nodeId, [root]);
    if (result) return { node: result.node, rootQuestId: root.id, ancestors: result.ancestors };
  }
  // Fallback: Node ist genuiner Root ohne Parent
  for (const root of graph.nodes || []) {
    if (root.id === nodeId) return { node: root, rootQuestId: root.id, ancestors: [] };
  }
  return null;
}

/**
 * @param {RpgNode[]} children
 * @param {string} nodeId
 * @param {RpgNode[]} ancestors
 * @returns {{ node: RpgNode; ancestors: RpgNode[] } | null}
 */
function _walkForAncestors(children, nodeId, ancestors, _visited = new Set()) {
  for (const child of children) {
    if (!child?.id || _visited.has(child.id)) continue;
    if (child.id === nodeId) return { node: child, ancestors };
    _visited.add(child.id);
    if (child.children?.length) {
      const r = _walkForAncestors(child.children, nodeId, [...ancestors, child], _visited);
      if (r) return r;
    }
  }
  return null;
}

/**
 * @param {RpgNode} node
 * @returns {boolean}
 */
export function nodeIsLeaf(node) {
  return !Array.isArray(node.children) || node.children.length === 0;
}

/**
 * @param {RpgNode | null | undefined} node
 * @returns {boolean}
 */
export function isLockNode(node) {
  return !!node?.isLock;
}

/**
 * Pre-Order Traversal ueber einen Node-Baum.
 * @param {RpgNode[]} nodes
 * @param {(s: RpgNode) => void} fn
 */
export function walkNodesPreOrder(nodes, fn) {
  if (!Array.isArray(nodes)) {
    warnNodeAnomalyOnce('walkNodesPreOrder.nonArray', 'walkNodesPreOrder received non-array nodes', {
      nodesType: typeof nodes,
    });
    return;
  }
  for (const s of nodes) {
    fn(s);
    if (s.children?.length) walkNodesPreOrder(s.children, fn);
  }
}

/**
 * Baut eine Map id -> Node fuer schnellen Zugriff.
 * @param {RpgNode[]} nodes
 * @returns {Map<string, RpgNode>}
 */
export function buildNodeIdMap(nodes) {
  /** @type {Map<string, RpgNode>} */
  const m = new Map();
  walkNodesPreOrder(nodes, (s) => m.set(s.id, s));
  return m;
}

// --- Completion-Logik ---

/**
 * Liest done-Flag aus dem flachen nodeDone-Format (Phase 2).
 *
 * Akzeptiert sowohl flach (`Record<nodeId, boolean>`) als auch verschachtelt
 * (`Record<questId, Record<nodeId, boolean>>`) als Eingabe — das verschachtelte
 * Format wird als "in IRGENDEINEM Quest done" interpretiert (Union-Semantik,
 * passend zum Multi-Parent-Modell). Damit funktioniert dieselbe Funktion
 * waehrend der Migrationsperiode mit beiden Eingangsformaten.
 *
 * @param {string} nodeId
 * @param {Record<string, unknown>} nodeDone
 * @returns {boolean}
 */
function readFlatDone(nodeId, nodeDone) {
  if (!nodeDone || typeof nodeDone !== 'object') return false;
  const direct = /** @type {any} */ (nodeDone)[nodeId];
  if (direct === true) return true;
  if (direct === false || direct === undefined) {
    // Fallback: alte verschachtelte Form? Pruefe alle Quest-Maps auf nodeId.
    for (const v of Object.values(nodeDone)) {
      if (v && typeof v === 'object' && /** @type {any} */ (v)[nodeId] === true) return true;
    }
    return false;
  }
  return false;
}

/**
 * Prueft ob ein Node (und seine Dependencies) erledigt ist.
 * Handles: Gruppen (nicht-Blaetter), optionale Blaetter, dependsOn, Locks, Zyklen.
 *
 * Phase 2: nodeDone ist FLACH (Record<nodeId, boolean>). Alte verschachtelte
 * Form wird per Compat erkannt (siehe readFlatDone).
 *
 * Der `quest`-Parameter wird nur fuer Tree-Traversal genutzt (findNodeById in
 * `quest.children`) — er ist NICHT mehr der Lookup-Key. Aufrufer koennen also
 * weiterhin den View-Wurzel-Node uebergeben (Root-Quest, Sub-Node-Wrapper, ...).
 *
 * @param {RpgNode} quest — Wurzel-Node fuer Tree-Traversal (NICHT mehr Lookup-Key)
 * @param {string} nodeId
 * @param {Record<string, unknown>} nodeDone — flach (V3) oder verschachtelt (V2-Compat)
 * @param {Set<string>} [visiting] — Zyklen-Erkennung
 */
export function isNodeCompleteInQuest(quest, nodeId, nodeDone, visiting) {
  if (!quest || typeof quest !== 'object' || typeof quest.id !== 'string') {
    warnNodeAnomalyOnce('isNodeCompleteInQuest.invalidQuest', 'Invalid quest passed to completion check', {
      nodeId,
      questType: typeof quest,
    });
    return false;
  }
  const nodes = quest.children || [];
  // Erlaube auch dass quest selbst der gesuchte Node ist (z.B. fuer Sub-Node-Wrapper)
  const node = quest.id === nodeId ? quest : findNodeById(nodes, nodeId);
  if (!node) {
    warnNodeAnomalyOnce(`isNodeCompleteInQuest.missingNode.${quest.id}.${nodeId}`, 'Completion check for missing node id', {
      questId: quest.id,
      nodeId,
    });
    return false;
  }

  // Gruppen-Node: alle nicht-optionalen, nicht-lock Kinder muessen erledigt sein
  if (!nodeIsLeaf(node)) {
    const vis = visiting ?? new Set();
    if (vis.has(nodeId)) {
      warnNodeAnomalyOnce(`isNodeCompleteInQuest.cycle.${quest.id}.${nodeId}`, 'Cycle detected during node completion traversal', {
        questId: quest.id,
        nodeId,
      });
      return false;
    }
    vis.add(nodeId);
    for (const d of node.dependsOn || []) {
      if (!isNodeCompleteInQuest(quest, d, nodeDone, vis)) {
        vis.delete(nodeId);
        return false;
      }
    }
    const kids = node.children || [];
    for (const ch of kids) {
      if (isLockNode(ch)) continue;
      if (ch.optional) continue;
      if (!isNodeCompleteInQuest(quest, ch.id, nodeDone, vis)) {
        vis.delete(nodeId);
        return false;
      }
    }
    vis.delete(nodeId);
    return true;
  }

  // Blatt-Node: muss in nodeDone markiert sein + Dependencies erfuellt
  const vis = visiting ?? new Set();
  if (vis.has(nodeId)) return false;

  if (!readFlatDone(node.id, nodeDone)) return false;
  vis.add(nodeId);
  for (const d of node.dependsOn || []) {
    if (!isNodeCompleteInQuest(quest, d, nodeDone, vis)) {
      vis.delete(nodeId);
      return false;
    }
  }
  vis.delete(nodeId);
  return true;
}

/**
 * Prueft ob ein Blatt-Node auf done/undone gesetzt werden darf.
 * Beruecksichtigt: Locks, Dependencies, Blatt-Eigenschaft.
 *
 * Phase 2: nodeDone ist FLACH (Record<nodeId, boolean>).
 *
 * @param {RpgNode} quest — Wurzel-Node fuer Tree-Traversal
 * @param {string} nodeId
 * @param {Record<string, unknown>} nodeDone — flach (V3) oder verschachtelt (V2-Compat)
 * @param {boolean} wantOn
 */
export function canSetNodeDone(quest, nodeId, nodeDone, wantOn) {
  if (!quest || typeof quest !== 'object' || typeof quest.id !== 'string') {
    warnNodeAnomalyOnce('canSetNodeDone.invalidQuest', 'Invalid quest passed to toggle guard', {
      nodeId,
      questType: typeof quest,
    });
    return false;
  }
  const node = findNodeById(quest.children || [], nodeId);
  if (!node || !nodeIsLeaf(node)) return false;
  if (!wantOn) return true;

  /** @param {RpgNode[]} arr @param {string} id @returns {RpgNode | null} */
  function findParent(arr, id) {
    for (const s of arr || []) {
      if ((s.children || []).some((c) => c.id === id)) return s;
      const sub = findParent(s.children || [], id);
      if (sub) return sub;
    }
    return null;
  }
  const parent = findParent(quest.children || [], nodeId);
  if (parent && !isLockNode(node)) {
    const lockChildren = (parent.children || []).filter((ch) => isLockNode(ch));
    if (lockChildren.length > 0) {
      const locksDone = lockChildren.every((l) => isNodeCompleteInQuest(quest, l.id, nodeDone));
      if (!locksDone) return false;
    }
  }
  for (const d of node.dependsOn || []) {
    if (!isNodeCompleteInQuest(quest, d, nodeDone)) return false;
  }
  return true;
}

// --- Fortschritt ---

/**
 * Zaehlt erledigte / gesamt nicht-optionale Blaetter (rekursiv).
 * @param {RpgNode} quest
 * @param {RpgNode[]} nodes
 * @param {Record<string, unknown>} nodeDone — flach
 */
function countLeafProgressQuest(quest, nodes, nodeDone) {
  let total = 0;
  let done = 0;
  for (const s of nodes) {
    if (isLockNode(s)) continue;
    if (!nodeIsLeaf(s)) {
      const sub = countLeafProgressQuest(quest, s.children || [], nodeDone);
      total += sub.total;
      done += sub.done;
      continue;
    }
    if (s.optional) continue;
    total += 1;
    if (isNodeCompleteInQuest(quest, s.id, nodeDone)) done += 1;
  }
  return { total, done };
}

/**
 * Fortschritt als {total, done, percent} fuer einen beliebigen Node.
 *
 * Phase 2: nodeDone ist flach. Der `scopeQuestId`-Parameter wird ignoriert
 * (Backward-Kompatibilitaet) — der Lookup ist immer global pro nodeId.
 *
 * @param {RpgNode} quest — beliebiger Node (Root oder Sub-Node)
 * @param {Record<string, unknown>} nodeDone — flach (V3) oder verschachtelt (V2-Compat)
 * @param {string} [_scopeQuestId] — ignoriert (nur fuer alte API-Kompatibilitaet)
 */
export function questLeafProgressRatio(quest, nodeDone, _scopeQuestId) {
  if (!quest || typeof quest !== 'object') return { total: 0, done: 0, percent: 100 };
  const { total, done } = countLeafProgressQuest(quest, quest.children || [], nodeDone);
  if (total === 0) return { total: 0, done: 0, percent: 100 };
  return { total, done, percent: Math.round((done / total) * 100) };
}

/**
 * Alias fuer `questLeafProgressRatio` — Phase 2 Naming-Cleanup.
 * @param {RpgNode} node
 * @param {Record<string, unknown>} nodeDone
 */
export function leafProgressRatio(node, nodeDone) {
  return questLeafProgressRatio(node, nodeDone);
}

/**
 * Fortschritt als Prozentzahl (0-100).
 * @param {RpgNode} quest
 * @param {Record<string, unknown>} nodeDone
 * @param {string} [_scopeQuestId]
 */
export function questProgressFromNodes(quest, nodeDone, _scopeQuestId) {
  return questLeafProgressRatio(quest, nodeDone).percent;
}

/**
 * Prueft ob alle nicht-optionalen Blaetter erledigt sind.
 * @param {RpgNode} quest
 * @param {Record<string, unknown>} nodeDone
 */
export function isQuestCompletedFromNodes(quest, nodeDone) {
  const { total, percent } = questLeafProgressRatio(quest, nodeDone);
  if (total === 0) return true;
  return percent >= 100;
}

// --- Zeit-basierte Abfragen ---

const MS_WEEK = 7 * 86400000;

/**
 * Gibt den Millisekunden-Timestamp fuer Ende des Tages (23:59:59.999 lokal) zurueck,
 * oder null wenn das Datum nicht geparst werden kann.
 * @param {string} isoYmd
 * @returns {number | null}
 */
function endOfLocalDayMs(isoYmd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoYmd).trim());
  if (!m) {
    const t = Date.parse(isoYmd);
    // null statt 0: Aufrufer pruefen mit `if (dueEnd == null)` statt `if (!dueEnd)`,
    // damit ein echter Timestamp von 0 (01.01.1970) nicht faelschlich uebersprungen wird.
    return Number.isNaN(t) ? null : t;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * Hat der Root-Node offene Pflichtschritte mit gesetzter Frist?
 * @param {RpgNode} quest
 * @param {Record<string, Record<string, boolean>>} nodeDone
 */
export function questHasIncompleteTimeBoundLeaves(quest, nodeDone) {
  let found = false;
  walkNodesPreOrder(quest.children || [], (s) => {
    if (isLockNode(s)) return;
    if (!nodeIsLeaf(s)) return;
    if (s.optional) return;
    if (!s.timeDueAt || !String(s.timeDueAt).trim()) return;
    if (isNodeCompleteInQuest(quest, s.id, nodeDone)) return;
    found = true;
  });
  return found;
}

/**
 * Hat der Root-Node dringende Schritte (Frist < 1 Woche oder ueberfaellig)?
 * @param {RpgNode} quest
 * @param {Record<string, Record<string, boolean>>} nodeDone
 * @param {number} [nowMs]
 */
export function questHasUrgentTimeBoundLeaves(quest, nodeDone, nowMs = Date.now()) {
  let found = false;
  walkNodesPreOrder(quest.children || [], (s) => {
    if (isLockNode(s)) return;
    if (!nodeIsLeaf(s)) return;
    if (s.optional) return;
    const dueRaw = s.timeDueAt && String(s.timeDueAt).trim();
    if (!dueRaw) return;
    if (isNodeCompleteInQuest(quest, s.id, nodeDone)) return;
    const dueEnd = endOfLocalDayMs(dueRaw);
    if (dueEnd == null) return;
    const remaining = dueEnd - nowMs;
    if (remaining < MS_WEEK) found = true;
  });
  return found;
}

// --- Reward-Display (kombiniert Node-Logik mit Reward-Modul) ---

/**
 * Sammelt alle Rewards des Nodes UND seiner Sub-Nodes mit Unlock-Status.
 *
 * Kein Subtypen-Switch (Root vs. Child): jeder Reward, egal ob auf
 * `node` selbst oder auf einem Descendant, wird identisch berechnet —
 * unlocked == "der Node, dem dieser Reward gehört, ist komplett".
 *
 * Phase 2: nodeDone ist flach (Record<nodeId, boolean>). `opts.scopeQuestId`
 * existiert nur noch fuer Backward-Kompatibilitaet und wird ignoriert.
 *
 * `opts.selfProgressPercent` erlaubt einen aggregierten Progress (z.B. aus
 * Graph-Dependencies) als Override für die Self-Unlock-Berechnung. Wenn nicht
 * angegeben, wird der lokale Progress des Nodes berechnet.
 *
 * @param {RpgNode} node — beliebiger View-Node (Root, Gruppe oder Blatt)
 * @param {Record<string, unknown>} nodeDone — flach (V3) oder verschachtelt (V2-Compat)
 * @param {{
 *   scopeQuestId?: string;
 *   selfProgressPercent?: number;
 *   itemCatalogById?: Record<string, { title?: string }>;
 * }} [opts]
 * @returns {{
 *   label: string;
 *   kind: 'text' | 'item' | 'points' | 'achievement';
 *   pointKind?: 'heart' | 'mana';
 *   amount?: number;
 *   unlocked: boolean;
 *   itemId?: string;
 *   achievementId?: string;
 *   nodeId: string;
 * }[]}
 */
export function buildRewardDisplayList(node, nodeDone, opts) {
  if (!node || typeof node !== 'object') return [];
  const itemCatalogById = opts?.itemCatalogById;

  /** @type {{ label: string; kind: 'text' | 'item' | 'points' | 'achievement'; pointKind?: 'heart' | 'mana'; amount?: number; unlocked: boolean; itemId?: string; achievementId?: string; nodeId: string }[]} */
  const rows = [];

  /** @param {RpgRewardEntry} entry @param {boolean} unlocked @param {string} originNodeId */
  const pushRow = (entry, unlocked, originNodeId) => {
    const label = rewardEntryDisplayLabel(entry, itemCatalogById);
    const kind =
      entry.type === 'item' ? 'item' :
      entry.type === 'points' ? 'points' :
      entry.type === 'achievement' ? 'achievement' : 'text';
    rows.push({
      label,
      kind,
      unlocked,
      nodeId: originNodeId,
      ...(entry.type === 'item' ? { itemId: entry.itemId } : {}),
      ...(entry.type === 'achievement' ? { achievementId: entry.achievementId } : {}),
      ...(entry.type === 'points' ? { pointKind: entry.pointKind, amount: entry.amount } : {}),
    });
  };

  // Eigene Rewards des Nodes — unlocked wenn dieser Node selbst komplett ist.
  const pct = typeof opts?.selfProgressPercent === 'number' && Number.isFinite(opts.selfProgressPercent)
    ? opts.selfProgressPercent
    : questLeafProgressRatio(node, nodeDone).percent;
  const selfUnlocked = pct >= 100;
  for (const r of getNodeRewardRows(node)) {
    pushRow(r.entry, selfUnlocked, node.id);
  }

  // Sub-Node-Rewards (rekursiv, alle Tiefen) — unlocked wenn der jeweilige
  // Sub-Node komplett ist. Identische Logik wie oben.
  walkNodesPreOrder(node.children || [], (s) => {
    if (!s || !s.rewards || s.rewards.length === 0) return;
    const unlocked = isNodeCompleteInQuest(node, s.id, nodeDone);
    for (const rawEntry of s.rewards) {
      const entry = normalizeRewardEntry(rawEntry);
      if (!entry) continue;
      pushRow(entry, unlocked, s.id);
    }
  });

  return rows;
}

/**
 * Reward-Rows eines Nodes. Akzeptiert neues 'rewards' und Legacy 'questRewards'.
 * @param {RpgNode | Record<string, unknown>} node
 * @returns {RpgRewardRow[]}
 */
export function getNodeRewardRows(node) {
  const n = /** @type {any} */ (node);
  // Neues Format bevorzugt
  if (Array.isArray(n.rewards) && n.rewards.length > 0) {
    return normalizeRewardRows(n.rewards);
  }
  // Legacy: questRewards[] auf alten Root-Nodes
  if (Array.isArray(n.questRewards) && n.questRewards.length > 0) {
    return normalizeRewardRows(n.questRewards);
  }
  return [];
}

/**
 * Reward-Entries eines Nodes (ohne Unlock-Info).
 * @param {RpgNode | Record<string, unknown>} node
 * @returns {RpgRewardEntry[]}
 */
export function getNodeRewardEntries(node) {
  return getNodeRewardRows(node).map((r) => r.entry);
}

// --- Migration (alte Formate -> V2) ---

/**
 * Migriert einen Node: label->title, reward->rewards, questRewards->rewards,
 * children normalisieren.
 * @param {Record<string, any>} q
 * @returns {RpgNode}
 */
export function migrateNodeToV2Shape(q) {
  const childrenIn = Array.isArray(q.children) ? q.children : Array.isArray(q.nodes) ? q.nodes : [];

  // Erkennung: sind das flache Legacy-Zeilen ohne Features?
  const isLegacyFlatRow = (s) =>
    s &&
    typeof s === 'object' &&
    (!Array.isArray(s.children) || s.children.length === 0) &&
    (!Array.isArray(s.subnodes) || s.subnodes.length === 0) &&
    typeof (s.title ?? s.label) === 'string' &&
    !s.dependsOn?.length &&
    !s.optional &&
    !s.reward &&
    !(s.rewards?.length) &&
    !s.timeDueAt;

  const looksLegacyFlat = childrenIn.length > 0 && childrenIn.every(isLegacyFlatRow);

  let children;
  if (looksLegacyFlat) {
    children = flatLegacyNodesToNormalized(
      childrenIn.map((s) => ({ id: s.id, title: s.title ?? s.label }))
    );
  } else {
    children = normalizeQuestNodesTree(childrenIn, q.id);
  }
  children = normalizeQuestNodesTree(children, q.id);

  // Rewards: aus rewards[] (neu), questRewards[] (Legacy), oder rewards-Strings (ganz alt)
  let rewardRows = normalizeRewardRows(q.rewards ?? q.questRewards);
  if (rewardRows.length === 0 && Array.isArray(q.rewards) && q.rewards.length > 0 && q.rewards.every((x) => typeof x === 'string')) {
    // Ganz altes Format: rewards war ein Array von Strings
    rewardRows = stringsToTextRewards(q.rewards.map((x) => String(x).trim()).filter(Boolean)).map(
      (e) => ({ entry: e })
    );
  }
  const rewards = rewardRows.map(rewardRowToStored);

  // Title: neues Feld bevorzugt, Legacy 'label' als Fallback
  const title = typeof q.title === 'string' && q.title.trim() ? q.title.trim()
    : typeof q.label === 'string' && q.label.trim() ? q.label.trim()
    : q.id || 'Untitled';

  // Alte Felder entfernen, neue setzen
  const { rewards: _r, questRewards: _qr, nodes: _st, children: _ch, label: _lb, title: _t, ...rest } = q;
  return {
    ...rest,
    parentId: null,
    title,
    children,
    rewards,
  };
}

/**
 * Migriert einen ganzen Graph von altem auf neues Format.
 * @param {RpgGraph | Record<string, unknown>} graph
 * @returns {RpgGraph}
 */
export function migrateRpgGraphToV2(graph) {
  const nodes = graphNodes(graph).map((q) => migrateNodeToV2Shape(q));
  // Erst Zyklen brechen, dann Duplikate entfernen
  return deduplicateGraphRoots(breakGraphCycles(makeRpgGraph(nodes, graphEdges(graph))));
}

/**
 * Entfernt Zyklen aus dem Baum.
 * Traversiert jeden Subtree mit einem Ancestor-Set — sobald eine Node-ID
 * bereits auf dem aktuellen Pfad liegt, wird der Child-Eintrag entfernt.
 * Verhindert Endlosrekursion in Layout, Rendering und allen Tree-Traversals.
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @returns {import('./rpg-quests-data.js').RpgGraph}
 */
export function breakGraphCycles(graph) {
  let changed = false;
  const nodes = (graph.nodes || []).map((root) => {
    const result = _breakCyclesInNode(root, new Set());
    if (result !== root) changed = true;
    return result;
  });
  return changed ? makeRpgGraph(nodes, graphEdges(graph)) : graph;
}

/**
 * @param {RpgNode} node
 * @param {Set<string>} ancestorIds — IDs aller Vorfahren auf dem aktuellen Pfad
 * @returns {RpgNode}
 */
function _breakCyclesInNode(node, ancestorIds) {
  if (!node?.id) return node;
  const nextAncestors = new Set(ancestorIds);
  nextAncestors.add(node.id);
  if (!Array.isArray(node.children) || node.children.length === 0) return node;
  let childChanged = false;
  const nextChildren = [];
  for (const child of node.children) {
    // Kind überspringen wenn seine ID bereits auf dem Pfad liegt (= Zyklus)
    if (child?.id && nextAncestors.has(child.id)) {
      childChanged = true;
      continue;
    }
    const fixed = _breakCyclesInNode(child, nextAncestors);
    if (fixed !== child) childChanged = true;
    nextChildren.push(fixed);
  }
  return childChanged ? { ...node, children: nextChildren } : node;
}

/**
 * Sammelt alle Child-IDs im Baum rekursiv (mit Cycle-Guard).
 * @param {RpgNode[]} children
 * @param {Set<string>} out
 * @param {Set<string>} [visited]
 */
function _collectChildIds(children, out, visited = new Set()) {
  for (const child of children) {
    if (!child?.id || visited.has(child.id)) continue;
    visited.add(child.id);
    out.add(child.id);
    if (child.children?.length) _collectChildIds(child.children, out, visited);
  }
}

/**
 * Entfernt Root-Nodes deren IDs bereits als Child-Nodes im Baum existieren.
 * Invariante: jede Node-ID darf nur einmal im Graph vorkommen.
 * Passiert als Cleanup nach unvollständigen Merge-Operationen.
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @returns {import('./rpg-quests-data.js').RpgGraph}
 */
export function deduplicateGraphRoots(graph) {
  const childIds = new Set();
  for (const root of graph.nodes || []) {
    _collectChildIds(root.children || [], childIds);
  }
  if (childIds.size === 0) return graph;
  const filteredRoots = (graph.nodes || []).filter((q) => !childIds.has(q.id));
  if (filteredRoots.length === (graph.nodes || []).length) return graph;
  return makeRpgGraph(filteredRoots, graphEdges(graph));
}
