import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import { EMPTY_RPG_GRAPH } from '../lib/rpg-quests-data.js';
import RpgBootstrapLoading from './RpgBootstrapLoading.jsx';
import {
  computeLayeredLayout,
  questMap,
  isQuestUnlocked,
  isQuestCompleted,
  questProgress,
  mergeStepDoneBase,
  buildInitialStepMapFromGraph,
} from '../lib/rpg-quest-graph.js';
import {
  fetchRpgBootstrap,
  migrateLocalRpgToServerIfNeeded,
  deriveRpgUiStateFromPayload,
  saveSessionCachedPayload,
  persistRpgState,
} from '../lib/rpg-server-sync.js';
import { questHasUrgentTimeBoundLeaves, stepIsLeaf, isStepNodeComplete, isLockNode } from '../lib/rpg-quest-steps.js';
import {
  normalizeRpgVitalsState,
  reconcileRpgVitals,
  toRpgVitalsView,
  RPG_VITAL_MAX_POINTS,
} from '../lib/rpg-vitals.js';
import { normalizeRpgLocationState, normalizeRpgLocationCatalog } from '../lib/rpg-location.js';
import RpgQuestGraphEditor from './RpgQuestGraphEditor.jsx';
import RpgQuestStepsView from './RpgQuestStepsView.jsx';
import LiquidVessels from './LiquidVessels.jsx';
import RpgLocationStrip from './RpgLocationStrip.jsx';
import './rpg-quest-tree.css';
import './rpg-location-strip.css';

const RPG_QUESTMAKER_ENABLED = false;
const PANEL_RESERVE_DESKTOP = 280;
const PANEL_RESERVE_MOBILE = 200;
/** Ab dieser Bewegung (px) zählt die Geste als Pan — Klick auf Knoten bleibt erhalten. */
const PAN_DRAG_THRESHOLD_PX = 5;

function edgeEndpoints(x1, y1, x2, y2, r1, r2) {
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
 * @param {number} corners
 * @param {number} r
 * @returns {string}
 */
function regularPolygonPath(corners, r) {
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
 * 0 children => circle
 * 1 child => droplet
 * 2 children => pointed oval/lens
 * >=3 => regular polygon
 * @param {number} childCount
 * @param {number} r
 * @returns {string | null}
 */
function nodeShapePath(childCount, r) {
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

/**
 * Blattanzahl in einem Step-Teilbaum (Leaf selbst = 1).
 * @param {import('../lib/rpg-quest-steps.js').RpgQuestStepNode} step
 * @returns {number}
 */
function countLeavesInStepSubtree(step) {
  const kids = Array.isArray(step?.children) ? step.children : [];
  if (kids.length === 0) return 1;
  let n = 0;
  for (const ch of kids) n += countLeavesInStepSubtree(ch);
  return n;
}

/**
 * Leaf-Anzahl unterhalb eines Knotens (Leaf selbst = 0).
 * @param {import('../lib/rpg-quest-steps.js').RpgQuestStepNode} step
 * @returns {number}
 */
function countLeafDescendants(step) {
  const kids = Array.isArray(step?.children) ? step.children : [];
  if (kids.length === 0) return 0;
  let n = 0;
  for (const ch of kids) n += countLeavesInStepSubtree(ch);
  return n;
}

/**
 * Leaf-Anzahl für eine Quest (über alle Root-Step-Teilbäume).
 * @param {import('../lib/rpg-quest-graph.js').RpgGraphQuest} q
 * @returns {number}
 */
function countQuestLeaves(q) {
  const roots = Array.isArray(q?.children) ? q.children : [];
  let n = 0;
  for (const r of roots) n += countLeavesInStepSubtree(r);
  return n;
}

/**
 * @param {number} count
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {number[]}
 */
function distributeAngles(count, startDeg, endDeg) {
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
 * Gleichmäßig um den vollen Kreis verteilen.
 * @param {number} count
 * @param {number} startDeg
 * @returns {number[]}
 */
function distributeAroundCircle(count, startDeg = -180) {
  if (count <= 0) return [];
  const step = 360 / count;
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < count; i++) out.push(startDeg + i * step);
  return out;
}

/**
 * Für jede Kante stabile Ports am Knotenrand berechnen:
 * - Outgoing bevorzugt oben
 * - Incoming bevorzugt unten
 * - bei nur einem Typ: breite Verteilung um den Knoten
 * @param {import('../lib/rpg-quest-graph.js').RpgGraph} graph
 * @param {Record<string, { x: number; y: number }>} positions
 * @param {number} radius
 */
function buildEdgePorts(graph, positions, radius) {
  /** @type {Map<string, number[]>} */
  const outByNode = new Map();
  /** @type {Map<string, number[]>} */
  const inByNode = new Map();
  const edges = graph.edges || [];
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

  for (const q of graph.quests || []) {
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

/**
 * @param {import('../lib/rpg-quest-graph.js').RpgGraphQuest} quest
 * @param {boolean} unlocked
 * @param {boolean} added
 * @param {boolean} completed
 */
function nodeClass(quest, unlocked, added, completed) {
  if (completed) return 'rpg-tree-node rpg-tree-node--done';
  if (!unlocked) return 'rpg-tree-node rpg-tree-node--locked';
  if (!added) return 'rpg-tree-node rpg-tree-node--unlocked-not-added';
  return 'rpg-tree-node rpg-tree-node--active';
}

function stepNodeClass(isDone, isLeaf, isLock) {
  if (isDone) return 'rpg-tree-step-node rpg-tree-step-node--done';
  if (isLock) return 'rpg-tree-step-node rpg-tree-step-node--lock';
  if (isLeaf) return 'rpg-tree-step-node rpg-tree-step-node--leaf';
  return 'rpg-tree-step-node rpg-tree-step-node--container';
}

export default function RpgQuestTree() {
  const [graph, setGraph] = useState(EMPTY_RPG_GRAPH);
  const [added, setAdded] = useState(() => new Set());
  const [stepDone, setStepDone] = useState(() =>
    mergeStepDoneBase(buildInitialStepMapFromGraph(EMPTY_RPG_GRAPH), {})
  );
  const itemCatalogRef = useRef(
    /** @type {Record<string, { title: string; category: string; description: string }>} */ ({})
  );
  const questmakerBatchRef = useRef(
    /** @type {{ id: string; category: string; title: string; description: string }[]} */ ([])
  );
  const persistFailFingerprintRef = useRef('');
  const [itemCatalog, setItemCatalog] = useState(() => ({}));
  const [vitals, setVitals] = useState(() => normalizeRpgVitalsState(null));
  const [location, setLocation] = useState(() => normalizeRpgLocationState(null));
  const [locationCatalog, setLocationCatalog] = useState(() => normalizeRpgLocationCatalog(null));
  const [locations, setLocations] = useState(() => []);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [dirtySinceBootstrap, setDirtySinceBootstrap] = useState(false);
  /** Kein Debounce-PUT, bis der erste GET abgeschlossen ist (nach Session-Cache: bis GET fertig). */
  const [canPersist, setCanPersist] = useState(true);

  const [selectedId, setSelectedId] = useState(/** @type {string | null} */ (null));
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [compact, setCompact] = useState(false);
  /** Mobil: Vollbild-Overlay mit Gefäßen (Dock-Button), nicht auf dem Baum */
  const [mobileManaOpen, setMobileManaOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState(/** @type {'create' | 'edit'} */ ('create'));
  const [editorQuestId, setEditorQuestId] = useState(/** @type {string | null} */ (null));
  /** @type {'manual' | 'questmaker' | undefined} */
  const [editorCreateEntry, setEditorCreateEntry] = useState(undefined);
  /** @type {'choose' | 'form' | 'ai' | undefined} */
  const [editorEditEntry, setEditorEditEntry] = useState(undefined);
  const dragRef = useRef(
    /** @type {{ px: number; py: number; vx: number; vy: number; moved?: boolean } | null} */ (null)
  );
  /** Nach echtem Pan: ein folgendes `click` auf einem Knoten ignorieren */
  const suppressNodeClickRef = useRef(false);
  const viewportRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const didCenterFocusRef = useRef(false);
  const didCenterDefaultRef = useRef(false);
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const pinchRef = useRef(
    /** @type {{ d0: number; s0: number; px0: number; py0: number; wx: number; wy: number } | null} */ (null)
  );

  useEffect(() => {
    itemCatalogRef.current = itemCatalog;
  }, [itemCatalog]);

  useEffect(() => {
    const onLocation = (/** @type {CustomEvent} */ e) => {
      setLocation(normalizeRpgLocationState(e.detail));
    };
    window.addEventListener('rpg-location-updated', onLocation);
    return () => window.removeEventListener('rpg-location-updated', onLocation);
  }, [graph]);

  useEffect(() => {
    const onCatalog = (/** @type {CustomEvent} */ e) => {
      const m = e.detail?.itemCatalog;
      if (!m || typeof m !== 'object') return;
      setItemCatalog(m);
      itemCatalogRef.current = m;
      saveSessionCachedPayload({
        graph,
        addedIds: [...added],
        stepDone,
        vitals,
        location,
        locationCatalog,
        locations,
        itemCatalog: m,
      });
    };
    window.addEventListener('rpg-questmaker-catalog-updated', onCatalog);
    return () => window.removeEventListener('rpg-questmaker-catalog-updated', onCatalog);
  }, [graph, added, stepDone, vitals, location, locationCatalog, locations]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 560px)');
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (selectedId) setMobileManaOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!compact) setMobileManaOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!mobileManaOpen) return;
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') setMobileManaOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileManaOpen]);

  const panelReserve = compact ? PANEL_RESERVE_MOBILE : PANEL_RESERVE_DESKTOP;
  const blockViewportGestures = compact && !!selectedId;

  const nodeR = useCallback(() => (compact ? 26 : 24), [compact]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data = await fetchRpgBootstrap();
      if (cancelled) return;
      if (!data) {
        const d = deriveRpgUiStateFromPayload(null);
        setGraph(d.graph);
        setAdded(d.added);
        setStepDone(d.stepDone);
        setVitals(d.vitals);
        setLocation(d.location);
        setLocationCatalog(d.locationCatalog);
        setLocations(d.locations);
        setItemCatalog(d.itemCatalog);
        itemCatalogRef.current = d.itemCatalog;
        setBootstrapped(true);
        setCanPersist(true);
        return;
      }
      data = await migrateLocalRpgToServerIfNeeded(data);
      if (!data || cancelled) return;
      const d = deriveRpgUiStateFromPayload(data);
      setGraph(d.graph);
      setAdded(d.added);
      setStepDone(d.stepDone);
      setVitals(d.vitals);
      setLocation(d.location);
      setLocationCatalog(d.locationCatalog);
      setLocations(d.locations);
      setItemCatalog(d.itemCatalog);
      itemCatalogRef.current = d.itemCatalog;
      saveSessionCachedPayload({
        graph: d.graph,
        addedIds: [...d.added],
        stepDone: d.stepDone,
        vitals: d.vitals,
        location: d.location,
        locationCatalog: d.locationCatalog,
        locations: d.locations,
        itemCatalog: d.itemCatalog,
      });
      setBootstrapped(true);
      setCanPersist(true);
      setDirtySinceBootstrap(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bootstrapped || !canPersist || !dirtySinceBootstrap) return;
    const t = setTimeout(() => {
      const batch = questmakerBatchRef.current;
      questmakerBatchRef.current = [];
      const payload = {
        graph,
        addedIds: [...added],
        stepDone,
        vitals,
        location,
        locationCatalog,
        locations,
        ...(batch.length ? { questmakerItems: batch } : {}),
      };
      void (async () => {
        const r = await persistRpgState(payload);
        if (r.ok) {
          persistFailFingerprintRef.current = '';
          setDirtySinceBootstrap(false);
          if (r.itemCatalog) {
            setItemCatalog(r.itemCatalog);
            itemCatalogRef.current = r.itemCatalog;
          }
          if (r.locationCatalog) setLocationCatalog(r.locationCatalog);
          if (Array.isArray(r.locations)) setLocations(r.locations);
        } else if (r.error) {
          const fp = `${r.status ?? ''}:${r.error}:${(r.missing || []).join(',')}`;
          if (persistFailFingerprintRef.current !== fp) {
            persistFailFingerprintRef.current = fp;
            let msg = r.error;
            if (r.missing?.length) msg += `\n\nFehlende Item-IDs: ${r.missing.join(', ')}`;
            window.alert(msg);
          }
        }
        saveSessionCachedPayload({
          ...payload,
          locationCatalog: r.locationCatalog ?? locationCatalog,
          locations: Array.isArray(r.locations) ? r.locations : locations,
          itemCatalog: r.itemCatalog ?? itemCatalogRef.current,
        });
      })();
    }, 450);
    return () => clearTimeout(t);
  }, [
    bootstrapped,
    canPersist,
    dirtySinceBootstrap,
    graph,
    added,
    stepDone,
    vitals,
    location,
    locationCatalog,
    locations,
  ]);

  useEffect(() => {
    setVitals((prev) => {
      const out = reconcileRpgVitals(graph, stepDone, prev);
      return out.changed ? out.state : prev;
    });
  }, [graph, stepDone]);

  const applyGraph = useCallback((next, opts) => {
    setGraph(next);
    setDirtySinceBootstrap(true);
    const extra = opts?.questmakerItems;
    if (Array.isArray(extra) && extra.length > 0) {
      const prev = questmakerBatchRef.current;
      const byId = new Map(prev.map((x) => [x.id, x]));
      for (const x of extra) {
        if (x && typeof x === 'object' && typeof x.id === 'string' && x.id.trim()) {
          byId.set(x.id.trim(), x);
        }
      }
      questmakerBatchRef.current = [...byId.values()];
    }
  }, []);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorCreateEntry(undefined);
    setEditorEditEntry(undefined);
  }, []);

  const handleLocationChange = useCallback((next) => {
    setDirtySinceBootstrap(true);
    setLocation(normalizeRpgLocationState(next));
  }, []);

  const handleLocationCatalogChange = useCallback((next) => {
    setDirtySinceBootstrap(true);
    setLocationCatalog(normalizeRpgLocationCatalog(next));
  }, []);

  const handleLocationsChange = useCallback((next) => {
    setDirtySinceBootstrap(true);
    setLocations(Array.isArray(next) ? next : []);
  }, []);

  /**
   * @param {'manual' | 'questmaker'} entry
   */
  const openCreateQuest = useCallback((entry) => {
    setEditorMode('create');
    setEditorQuestId(null);
    setEditorCreateEntry(entry);
    setEditorEditEntry(undefined);
    setEditorOpen(true);
  }, []);

  /**
   * @param {string} qid
   * @param {'choose' | 'form' | 'ai'} entry
   */
  const openEditQuest = useCallback((qid, entry) => {
    setEditorMode('edit');
    setEditorQuestId(qid);
    setEditorEditEntry(entry);
    setEditorCreateEntry(undefined);
    setEditorOpen(true);
  }, []);

  const onToggleStep = useCallback(
    (questId, stepId) => {
      setDirtySinceBootstrap(true);
      setStepDone((prev) => {
        const next = {
          ...prev,
          [questId]: { ...prev[questId], [stepId]: !prev[questId]?.[stepId] },
        };
        setVitals((old) => reconcileRpgVitals(graph, next, old).state);
        return next;
      });
    },
    [graph]
  );

  useEffect(() => {
    const ids = new Set((graph.quests || []).map((q) => q.id));
    setStepDone((prev) => {
      let changed = false;
      /** @type {typeof prev} */
      const next = { ...prev };
      for (const qid of Object.keys(next)) {
        if (!ids.has(qid)) {
          delete next[qid];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [graph]);

  const byId = useMemo(() => questMap(graph), [graph]);
  const vitalsView = useMemo(() => toRpgVitalsView(vitals), [vitals]);
  const layout = useMemo(
    () =>
      computeLayeredLayout(
        graph,
        compact
          ? { colGap: 92, rowGap: 96, padding: 56, compact: true }
          : { colGap: 128, rowGap: 108, padding: 72, compact: false }
      ),
    [graph, compact]
  );
  const questEdgePorts = useMemo(
    () => buildEdgePorts(graph, layout.positions, nodeR()),
    [graph, layout.positions, nodeR]
  );
  const stepTreeOverlay = useMemo(() => {
    const childGapX = compact ? 88 : 102;
    const childGapY = compact ? 84 : 96;
    const nodeRadius = compact ? 17 : 15;
    /** @type {{ id: string; stepId: string; questId: string; label: string; x: number; y: number; isLeaf: boolean; isDone: boolean; isLock: boolean; leafDescendants: number; depth: number }[]} */
    const stepNodes = [];
    /** @type {{ fromX: number; fromY: number; toX: number; toY: number }[]} */
    const stepEdges = [];

    const qMap = new Map((graph.quests || []).map((q) => [q.id, q]));
    /**
     * @param {import('../lib/rpg-quest-steps.js').RpgQuestStepNode[]} children
     * @param {string} questId
     * @param {number} parentX
     * @param {number} parentY
     * @param {number} depth
     */
    function placeChildren(children, questId, parentX, parentY, depth) {
      if (!children?.length) return;
      const radius = Math.max(childGapX * 0.95, childGapY * 0.95);
      const ringAngles = distributeAroundCircle(children.length, -180);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const a = (ringAngles[i] * Math.PI) / 180;
        const x = parentX + Math.cos(a) * radius;
        const y = parentY + Math.sin(a) * radius;
        const leaf = stepIsLeaf(child);
        const done = leaf ? isStepNodeComplete(qMap.get(questId), child.id, stepDone) : false;
        const lock = isLockNode(child);
        stepNodes.push({
          id: `${questId}::${child.id}`,
          stepId: child.id,
          questId,
          label: child.label || child.id,
          x,
          y,
          isLeaf: leaf,
          isDone: done,
          isLock: lock,
          leafDescendants: countLeafDescendants(child),
          depth,
        });
        stepEdges.push({ fromX: parentX, fromY: parentY, toX: x, toY: y });
        placeChildren(child.children || [], questId, x, y, depth + 1);
      }
    }

    for (const q of graph.quests || []) {
      const p = layout.positions[q.id];
      if (!p) continue;
      placeChildren(q.children || [], q.id, p.x, p.y, 1);
    }

    let minX = 0;
    let minY = 0;
    let maxX = layout.width;
    let maxY = layout.height;
    for (const n of stepNodes) {
      minX = Math.min(minX, n.x - nodeRadius - 90);
      minY = Math.min(minY, n.y - nodeRadius - 24);
      maxX = Math.max(maxX, n.x + nodeRadius + 90);
      maxY = Math.max(maxY, n.y + nodeRadius + 24);
    }
    return {
      stepNodes,
      stepEdges,
      nodeRadius,
      minX: Math.floor(minX),
      minY: Math.floor(minY),
      width: Math.ceil(maxX - minX),
      height: Math.ceil(maxY - minY),
    };
  }, [compact, graph.quests, layout.height, layout.positions, layout.width, stepDone]);

  useEffect(() => {
    const m = questMap(graph);
    setAdded((prev) => {
      const next = new Set();
      for (const id of prev) {
        const q = m.get(id);
        if (!q) continue;
        if (isQuestCompleted(q, stepDone)) continue;
        if (!isQuestUnlocked(id, graph, stepDone, m)) continue;
        next.add(id);
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [graph, stepDone]);

  const focusIdFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const p = new URLSearchParams(window.location.search);
    const id = p.get('focus');
    return id && byId.has(id) ? id : null;
  }, [byId, graph]);

  useEffect(() => {
    didCenterFocusRef.current = false;
    didCenterDefaultRef.current = false;
  }, [focusIdFromUrl, layout.width, layout.height]);

  useEffect(() => {
    if (!focusIdFromUrl || didCenterFocusRef.current) return;
    const el = viewportRef.current;
    const pos = layout.positions[focusIdFromUrl];
    if (!el || !pos) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const cy = Math.max(0, (vh - panelReserve) * 0.45);
    const s = scale;
    setPan({ x: vw / 2 - pos.x * s, y: cy - pos.y * s });
    didCenterFocusRef.current = true;
  }, [focusIdFromUrl, layout.positions, layout.width, layout.height, scale, panelReserve]);

  useEffect(() => {
    if (focusIdFromUrl || didCenterDefaultRef.current) return;
    const el = viewportRef.current;
    if (!el || !layout.width) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const cy = Math.max(0, (vh - panelReserve) * 0.45);
    const s = scale;
    const cx = layout.width / 2;
    const cyy = layout.height / 2;
    setPan({ x: vw / 2 - cx * s, y: cy - cyy * s });
    didCenterDefaultRef.current = true;
  }, [focusIdFromUrl, layout.width, layout.height, layout.positions, scale, panelReserve]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || blockViewportGestures) return;
    const onWheel = (/** @type {WheelEvent} */ e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const panC = panRef.current;
      const scaleC = scaleRef.current;
      const nextScale = Math.min(2.4, Math.max(0.38, scaleC * factor));
      const wx = (mx - panC.x) / scaleC;
      const wy = (my - panC.y) / scaleC;
      setScale(nextScale);
      setPan({ x: mx - wx * nextScale, y: my - wy * nextScale });
    };
    const touchDist = (/** @type {Touch} */ a, /** @type {Touch} */ b) =>
      Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const onTouchStart = (/** @type {TouchEvent} */ e) => {
      if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const d0 = touchDist(t0, t1);
        const mx0 = (t0.clientX + t1.clientX) / 2 - rect.left;
        const my0 = (t0.clientY + t1.clientY) / 2 - rect.top;
        const px0 = panRef.current.x;
        const py0 = panRef.current.y;
        const s0 = scaleRef.current;
        pinchRef.current = {
          d0,
          s0,
          px0,
          py0,
          wx: (mx0 - px0) / s0,
          wy: (my0 - py0) / s0,
        };
      }
    };
    const onTouchMove = (/** @type {TouchEvent} */ e) => {
      if (e.touches.length !== 2 || !pinchRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const p = pinchRef.current;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const d = touchDist(t0, t1);
      const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
      const my = (t0.clientY + t1.clientY) / 2 - rect.top;
      const ratio = d / p.d0;
      const nextScale = Math.min(2.4, Math.max(0.38, p.s0 * ratio));
      setScale(nextScale);
      setPan({ x: mx - p.wx * nextScale, y: my - p.wy * nextScale });
    };
    const onTouchEndPinch = () => {
      pinchRef.current = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEndPinch);
    el.addEventListener('touchcancel', onTouchEndPinch);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEndPinch);
      el.removeEventListener('touchcancel', onTouchEndPinch);
    };
  }, [blockViewportGestures]);

  const onPointerDownViewport = useCallback(
    (/** @type {PointerEvent} */ e) => {
      if (blockViewportGestures) return;
      if (e.button !== 0) return;
      suppressNodeClickRef.current = false;
      dragRef.current = { px: e.clientX, py: e.clientY, vx: pan.x, vy: pan.y, moved: false };
      setDragging(true);
      const el = viewportRef.current;
      if (el) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
    },
    [blockViewportGestures, pan.x, pan.y]
  );

  const onPointerMove = useCallback((/** @type {PointerEvent} */ e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) >= PAN_DRAG_THRESHOLD_PX) d.moved = true;
    setPan({
      x: d.vx + dx,
      y: d.vy + dy,
    });
  }, []);

  const onPointerUp = useCallback((/** @type {PointerEvent} */ e) => {
    const d = dragRef.current;
    if (d?.moved) suppressNodeClickRef.current = true;
    dragRef.current = null;
    setDragging(false);
    const el = viewportRef.current;
    if (el) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onQuestNodeClick = useCallback((/** @type {string} */ qid) => {
    if (suppressNodeClickRef.current) {
      suppressNodeClickRef.current = false;
      return;
    }
    setSelectedId(qid);
  }, []);

  const toggleAdded = useCallback(() => {
    if (!selectedId) return;
    const q = byId.get(selectedId);
    if (!q) return;
    const unlocked = isQuestUnlocked(selectedId, graph, stepDone, byId);
    const completed = isQuestCompleted(q, stepDone);
    if (completed) return;
    if (!unlocked) return;
    setDirtySinceBootstrap(true);
    setAdded((prev) => {
      const next = new Set(prev);
      if (next.has(selectedId)) next.delete(selectedId);
      else next.add(selectedId);
      return next;
    });
  }, [byId, graph, selectedId, stepDone]);

  const selectedQuest = selectedId ? byId.get(selectedId) : null;
  const selectedUnlocked = selectedQuest
    ? isQuestUnlocked(selectedQuest.id, graph, stepDone, byId)
    : false;
  const selectedCompleted = selectedQuest ? isQuestCompleted(selectedQuest, stepDone) : false;
  const selectedAdded = selectedQuest ? added.has(selectedQuest.id) : false;

  const panelAddLabel = selectedAdded ? 'Weg' : 'Add';
  const addButtonDisabled = selectedCompleted || !selectedUnlocked;

  const vesselsAria = `Leben ${vitalsView.heart} von ${RPG_VITAL_MAX_POINTS} Punkten, Mana ${vitalsView.mana} von ${RPG_VITAL_MAX_POINTS}`;
  const manaHeartDeko = !compact ? (
    <aside class="rpg-tree__vessels rpg-tree__vessels--desktop-only" aria-label={vesselsAria}>
      <LiquidVessels
        variant="rpg-tree"
        heartFill={vitalsView.heartFill}
        manaFill={vitalsView.manaFill}
      />
      <RpgLocationStrip
        location={location}
        onLocationChange={handleLocationChange}
        catalog={locationCatalog}
        onCatalogChange={handleLocationCatalogChange}
        locations={locations}
        onLocationsChange={handleLocationsChange}
      />
    </aside>
  ) : null;

  const mobileManaDock =
    compact && !selectedId ? (
      <nav class="rpg-tree__mobile-dock" aria-label="Deko">
        <RpgLocationStrip
          className="rpg-location-strip--mobile-dock"
          location={location}
          onLocationChange={handleLocationChange}
          catalog={locationCatalog}
          onCatalogChange={handleLocationCatalogChange}
          locations={locations}
          onLocationsChange={handleLocationsChange}
        />
        <button
          type="button"
          class="rpg-tree__mobile-dock-btn"
          onClick={() => setMobileManaOpen(true)}
          aria-label="Mana-Kugel und Lebens-Herz im Vollbild anzeigen"
        >
          <svg class="rpg-tree__mobile-dock-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.35" />
            <path
              fill="currentColor"
              d="M12 5.2l1.62 4.07 4.38.32-3.34 2.9 1.03 4.28L12 14.77 8.31 16.77l1.03-4.28-3.34-2.9 4.38-.32z"
            />
          </svg>
        </button>
      </nav>
    ) : null;

  const mobileManaOverlay =
    compact && mobileManaOpen ? (
      <div
        class="rpg-tree__vessels-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={vesselsAria}
      >
        <button
          type="button"
          class="rpg-tree__vessels-overlay-close"
          onClick={() => setMobileManaOpen(false)}
          aria-label="Schließen"
        >
          ×
        </button>
        <div class="rpg-tree__vessels-overlay-inner">
          <LiquidVessels
            variant="rpg-tree-spread"
            heartFill={vitalsView.heartFill}
            manaFill={vitalsView.manaFill}
          />
        </div>
      </div>
    ) : null;

  const topBar = (
    <header class="rpg-tree__top">
      <p class="rpg-tree__top-title">Quest-Baum</p>
      <div class="rpg-tree__top-actions">
        <button type="button" class="rpg-tree__btn" onClick={() => openCreateQuest('manual')} title="Neue Quest direkt im Formular">
          manuell+
        </button>
        {RPG_QUESTMAKER_ENABLED ? (
          <button type="button" class="rpg-tree__btn" onClick={() => openCreateQuest('questmaker')} title="Neue Quest direkt mit Questmaker (KI)">
            questmaker+
          </button>
        ) : null}
        <a href="/rpg">Zum Quest-Hub</a>
      </div>
    </header>
  );

  const graphEditor = (
    <RpgQuestGraphEditor
      open={editorOpen}
      mode={editorMode}
      graph={graph}
      questId={editorMode === 'edit' ? editorQuestId : null}
      createEntry={editorMode === 'create' ? editorCreateEntry : undefined}
      editEntry={editorMode === 'edit' ? editorEditEntry : undefined}
      onClose={closeEditor}
      onApply={applyGraph}
      itemCatalog={itemCatalog}
    />
  );

  if (!bootstrapped) {
    return (
      <div class="rpg-tree rpg-tree--bootstrap">
        <RpgBootstrapLoading />
      </div>
    );
  }

  if (!graph.quests?.length) {
    return (
      <div class="rpg-tree">
        {topBar}
        {manaHeartDeko}
        {mobileManaDock}
        {mobileManaOverlay}
        <p class="rpg-tree__empty">
          Keine Quests im Graph. Mit manuell+ eine Quest anlegen.
        </p>
        {graphEditor}
      </div>
    );
  }

  const rootTreeClass =
    compact && selectedId ? 'rpg-tree rpg-tree--detail-mobile' : 'rpg-tree';

  return (
    <div class={rootTreeClass}>
      {topBar}
      {manaHeartDeko}
      {mobileManaDock}
      {mobileManaOverlay}

      <div
        ref={viewportRef}
        class={`rpg-tree__viewport${dragging ? ' rpg-tree__viewport--dragging' : ''}`}
        onPointerDown={onPointerDownViewport}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          class="rpg-tree__canvas"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          }}
        >
          <svg
            class="rpg-tree__svg"
            width={stepTreeOverlay.width}
            height={stepTreeOverlay.height}
            viewBox={`${stepTreeOverlay.minX} ${stepTreeOverlay.minY} ${stepTreeOverlay.width} ${stepTreeOverlay.height}`}
            aria-hidden={false}
          >
            <title>Quest-Baum</title>
            <rect
              class="rpg-tree__hit"
              x={stepTreeOverlay.minX}
              y={stepTreeOverlay.minY}
              width={stepTreeOverlay.width}
              height={stepTreeOverlay.height}
            />

            <g class="rpg-tree-edges">
              {(graph.edges || []).map((e, i) => {
                const qa = byId.get(e.from);
                const qb = byId.get(e.to);
                if (!qa || !qb) return null;
                const pa = questEdgePorts.fromPorts[i];
                const pb = questEdgePorts.toPorts[i];
                if (!pa || !pb) return null;
                const seg = edgeEndpoints(pa.x, pa.y, pb.x, pb.y, 0, 0);
                const pct = questProgress(qa, stepDone, graph);
                const doneU = isQuestCompleted(qa, stepDone);
                const addedU = added.has(e.from);
                const unlockedU = isQuestUnlocked(e.from, graph, stepDone, byId);
                const activeU = unlockedU && addedU && !doneU;

                const dimStroke = 'rgba(78, 102, 126, 0.48)';
                const glowStroke = 'rgba(88, 150, 204, 0.92)';
                const doneStroke = 'rgba(126, 148, 172, 0.9)';

                let brightLen = 0;
                let strokeBright = glowStroke;
                let strokeDim = dimStroke;
                let showBright = false;

                if (doneU) {
                  strokeDim = doneStroke;
                  strokeBright = doneStroke;
                  showBright = false;
                } else if (activeU && pct > 0) {
                  brightLen = Math.max(0, seg.len * (pct / 100));
                  showBright = true;
                } else if (activeU && pct === 0) {
                  strokeDim = dimStroke;
                }

                return (
                  <g key={`${e.from}-${e.to}-${i}`}>
                    <line
                      x1={seg.x1}
                      y1={seg.y1}
                      x2={seg.x2}
                      y2={seg.y2}
                      stroke={doneU ? doneStroke : dimStroke}
                      strokeWidth={doneU ? 2.2 : 1.35}
                      strokeLinecap="round"
                    />
                    {showBright && brightLen > 0.5 && (
                      <line
                        x1={seg.x1}
                        y1={seg.y1}
                        x2={seg.x2}
                        y2={seg.y2}
                        stroke={strokeBright}
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeDasharray={`${brightLen} ${Math.max(seg.len,1)}`}
                      />
                    )}
                  </g>
                );
              })}
            </g>

            <g class="rpg-tree-step-edges">
              {stepTreeOverlay.stepEdges.map((edge, i) => {
                const seg = edgeEndpoints(
                  edge.fromX,
                  edge.fromY,
                  edge.toX,
                  edge.toY,
                  nodeR(),
                  stepTreeOverlay.nodeRadius
                );
                return (
                  <line
                    key={`step-edge-${i}`}
                    x1={seg.x1}
                    y1={seg.y1}
                    x2={seg.x2}
                    y2={seg.y2}
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth={1.05}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>

            <g class="rpg-tree-nodes">
              {graph.quests.map((q) => {
                const p = layout.positions[q.id];
                if (!p) return null;
                const unlocked = isQuestUnlocked(q.id, graph, stepDone, byId);
                const completed = isQuestCompleted(q, stepDone);
                const isAdded = added.has(q.id);
                const cls = nodeClass(q, unlocked, isAdded, completed);
                const r = nodeR();
                const label = q.title.length > 20 ? `${q.title.slice(0, 18)}…` : q.title;
                const isFocus = focusIdFromUrl === q.id;
                const timeUrgent = !completed && questHasUrgentTimeBoundLeaves(q, stepDone);

                /* pointerdown nicht zum Viewport bubble: dort setPointerCapture — sonst geht der synthetisierte click auf <g> oft verloren */
                return (
                  <g
                    key={q.id}
                    class={cls}
                    transform={`translate(${p.x},${p.y})`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onQuestNodeClick(q.id)}
                  >
                    {(() => {
                      const path = nodeShapePath(countQuestLeaves(q), r);
                      if (!path) {
                        return <circle class="rpg-tree-node__shape" r={r} strokeWidth={isFocus ? 2.6 : 1.8} />;
                      }
                      return <path class="rpg-tree-node__shape" d={path} strokeWidth={isFocus ? 2.6 : 1.8} />;
                    })()}
                    {timeUrgent ? (
                      <g class="rpg-tree-node__time-urgent" aria-hidden="true">
                        <circle
                          class="rpg-tree-node__time-urgent-dot"
                          cx={r * 0.62}
                          cy={-r * 0.72}
                          r={compact ? 5 : 5.5}
                        />
                        <title>Frist in weniger als einer Woche oder überfällig</title>
                      </g>
                    ) : null}
                    <text class="rpg-tree-node__label" y={r + 16}>
                      {label}
                    </text>
                  </g>
                );
              })}
            </g>

            <g class="rpg-tree-step-nodes">
              {stepTreeOverlay.stepNodes.map((n) => {
                const cls = stepNodeClass(n.isDone, n.isLeaf, n.isLock);
                const label = n.label.length > 20 ? `${n.label.slice(0, 18)}…` : n.label;
                const shapePath = nodeShapePath(n.leafDescendants, stepTreeOverlay.nodeRadius);
                return (
                  <g
                    key={n.id}
                    class={cls}
                    transform={`translate(${n.x},${n.y})`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setSelectedId(n.questId)}
                  >
                    {shapePath ? (
                      <path class="rpg-tree-step-node__shape" d={shapePath} />
                    ) : (
                      <circle class="rpg-tree-step-node__shape" r={stepTreeOverlay.nodeRadius} />
                    )}
                    {n.isLock ? (
                      <text class="rpg-tree-step-node__glyph" y={4}>
                        🔒
                      </text>
                    ) : null}
                    <text class="rpg-tree-step-node__label" y={stepTreeOverlay.nodeRadius + 13}>
                      {label}
                    </text>
                  </g>
                );
              })}
            </g>

          </svg>
        </div>
      </div>

      {selectedQuest && (
        <aside class="rpg-tree-panel" aria-label="Quest-Details">
          <div class="rpg-tree-panel__inner">
            <div class="rpg-tree-panel__side-actions">
              <button
                type="button"
                class={`rpg-tree-panel__add${selectedAdded ? ' rpg-tree-panel__add--remove' : ''}`}
                disabled={addButtonDisabled}
                onClick={toggleAdded}
                aria-label={selectedAdded ? 'Quest vom Hub entfernen' : 'Quest zum Hub hinzufügen'}
              >
                {selectedCompleted ? 'Fertig' : panelAddLabel}
              </button>
              <button
                type="button"
                class="rpg-tree-panel__edit-toggle"
                onClick={() => openEditQuest(selectedQuest.id, 'form')}
                aria-label="Quest manuell bearbeiten"
                title="Quest manuell bearbeiten"
              >
                ✎
              </button>
            </div>
            <div class="rpg-tree-panel__main">
              <div class="rpg-tree-panel__head">
                <h2 class="rpg-tree-panel__title">{selectedQuest.title}</h2>
                <button
                  type="button"
                  class="rpg-tree-panel__close"
                  onClick={() => setSelectedId(null)}
                  aria-label="Panel schließen"
                >
                  ×
                </button>
              </div>
              <p class="rpg-tree-panel__desc">{selectedQuest.description}</p>
              <details class="rpg-tree-panel__details" open>
                <summary>Schritte & Rewards</summary>
                <div class="rpg-tree-panel__steps-wrap">
                  <p class="rpg-tree-panel__inline-label">Schritte</p>
                  <RpgQuestStepsView
                    quest={selectedQuest}
                    stepDone={stepDone}
                    onToggleStep={onToggleStep}
                    interactive
                    stepsClass="rpg-tree-panel__steps"
                    rewardsClass="rpg-tree-panel__rewards"
                    graph={graph}
                    itemCatalog={itemCatalog}
                    currentLocation={location}
                    showLocationGuidance={false}
                  />
                </div>
              </details>
            </div>
          </div>
        </aside>
      )}
      {graphEditor}
    </div>
  );
}
