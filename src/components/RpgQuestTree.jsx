import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import { graphEdges } from '../lib/rpg-quests-data.js';
import RpgBootstrapLoading from './RpgBootstrapLoading.jsx';
import {
  questMap,
  isQuestUnlocked as isNodeUnlocked,
  isQuestCompleted as isNodeCompleted,
  questProgress as nodeProgress,
  removeParentChildEdge,
  toggleEdgeLockSide,
  getEdgeLockSide,
  computeLockedNodeIds,
  leafProgressRatio,
} from '../lib/rpg-quest-graph.js';
import { LOCK_CURSOR_VALUE } from '../lib/rpg-lock-icon.jsx';
// Sugiyama-Layout (2026-05-04): klassisches DAG-Layout-Framework —
// Layer-Assignment + Crossing-Minimization + Coordinate-Assignment.
// Ersetzt das vorherige Force-Directed (verknoddelte zu oft).
import { computeSugiyamaLayout } from '../lib/rpg-sugiyama-layout.js';
// Smart Edge Routing (2026-05-04, A*-Variante): Grid-basiertes Pathfinding
// mit 8-Richtungen, Catmull-Rom-Smoothing, festen Stuetzpunkten fuer
// spaetere Animations-Faehigkeit. Fallback auf gerade Linie wenn umzingelt.
import { routeEdge } from '../lib/rpg-edge-routing-grid.js';
import {
  questHasUrgentTimeBoundLeaves,
  nodeIsLeaf,
  isNodeCompleteInQuest,
  isLockNode,
  findNodeWithAncestors,
  breakGraphCycles,
  deduplicateGraphRoots,
} from '../lib/rpg-quest-nodes.js';
import {
  reconcileRpgVitals,
  toRpgVitalsView,
  RPG_VITAL_MAX_POINTS,
} from '../lib/rpg-vitals.js';
import { normalizeRpgLocationState, normalizeRpgLocationCatalog } from '../lib/rpg-location.js';
import { deriveRpgTreeSelectionView } from '../lib/rpg-tree-selection.js';
import {
  deriveRpgTreePanelState,
  canToggleAddedForSelection,
} from '../lib/rpg-tree-panel-state.js';
import { useRpgBootstrap } from '../lib/useRpgBootstrap.js';
import {
  edgeEndpoints,
  nodeShapePath,
  maxNodeDepth,
  nodeClass,
  nodeNodeClass,
} from '../lib/rpg-tree-svg.js';
import { useTreePanZoom } from '../lib/useTreePanZoom.js';
import RpgTreeSuperNotes, { useTreeSuperNotes } from './RpgTreeSuperNotes.jsx';
import RpgQuestGraphEditor from './RpgQuestGraphEditor.jsx';
import RpgQuestNodesView from './RpgQuestNodesView.jsx';
import RpgAstrolab from './RpgAstrolab.jsx';
import RpgVessel from './RpgVessel.jsx';
import RpgQuestPanel from './RpgQuestPanel.jsx';
import RpgTreeSettings from './RpgTreeSettings.jsx';
import LiquidVessels from './LiquidVessels.jsx';
import RpgLocationStrip from './RpgLocationStrip.jsx';
import './rpg-quest-tree.css';
import './rpg-location-strip.css';

const RPG_NODEMAKER_ENABLED = false;
const PANEL_RESERVE_DESKTOP = 280;
const PANEL_RESERVE_MOBILE = 200;

// Drei visuelle Richtungen (Themes): Astrolab (dark gold), Codex (parchment), Orrery (blueprint)
const DIRECTIONS = ['astrolab', 'codex', 'orrery'];
export default function RpgQuestTree({ isSuperuser = false, canUseNotes = false }) {
  // Questmaker-Item-Batching: sammelt Items die beim naechsten Persist mitgeschickt werden
  const questmakerBatchRef = useRef(
    /** @type {{ id: string; category: string; title: string; description: string }[]} */ ([])
  );

  // Shared Bootstrap-/Sync-Hook (Bootstrap, Persist, Vitals, Event-Listener)
  const {
    graph, setGraph,
    added, setAdded,
    nodeDone, setNodeDone,
    itemCatalog, setItemCatalog,
    itemCatalogRef,
    vitals, setVitals,
    location, setLocation,
    locationCatalog, setLocationCatalog,
    locations, setLocations,
    bootstrapped,
    persistError, setPersistError,
    markDirty,
  } = useRpgBootstrap({ questmakerBatchRef });

  // -- Tree-spezifischer UI-State --
  const [selectedId, setSelectedId] = useState(/** @type {string | null} */ (null));
  const [selectedNode, setSelectedNode] = useState(
    /** @type {{ questId: string; nodeId: string | null } | null} */ (null)
  );
  const [compact, setCompact] = useState(false);
  /** Mobil: Vollbild-Overlay mit Gefaessen (Dock-Button), nicht auf dem Baum */
  const [mobileManaOpen, setMobileManaOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const {
    superNotesOpen, setSuperNotesOpen,
    openSuperNotes, saveSuperNotes,
    superNotesValue, setSuperNotesValue,
    superNotesHistory,
    superNotesLoading, superNotesSaving, superNotesError,
  } = useTreeSuperNotes({ canUseNotes });
  const [editorMode, setEditorMode] = useState(/** @type {'create' | 'edit'} */ ('create'));
  const [editorNodeId, setEditorNodeId] = useState(/** @type {string | null} */ (null));
  const [editorFocusNodeId, setEditorFocusNodeId] = useState(/** @type {string | null} */ (null));
  const [treePickParentKey, setTreePickParentKey] = useState(/** @type {string | null} */ (null));
  const [treePickNodeIds, setTreePickNodeIds] = useState(() => new Set());
  const [treePickCycleWarning, setTreePickCycleWarning] = useState(false);
  const [treePickDoneSignal, setTreePickDoneSignal] = useState(0);
  const cycleWarnTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  /** @type {'manual' | 'questmaker' | undefined} */
  const [editorCreateEntry, setEditorCreateEntry] = useState(undefined);
  /** @type {'choose' | 'form' | 'ai' | undefined} */
  const [editorEditEntry, setEditorEditEntry] = useState(undefined);
  const didCenterFocusRef = useRef(false);
  const didCenterDefaultRef = useRef(false);

  // Astrolab-Tool-State: welches Werkzeug ist aktiv?
  const [activeTool, setActiveTool] = useState('focus');
  // Visuelle Richtung (Theme): astrolab | codex | orrery
  const [direction, setDirection] = useState('astrolab');
  // Settings-Modal (Alchemie-Labor)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  // blockViewportGestures muss VOR dem Hook berechnet werden (stabil per Render)
  const blockViewportGestures = compact && !!selectedId;

  // Pan/Zoom-Hook: kapselt State, Refs und alle Viewport-Gesten (Wheel, Pinch, Drag)
  const {
    pan, setPan, scale, setScale, dragging,
    viewportRef,
    suppressClickRef: suppressNodeClickRef,
    onPointerDownViewport, onPointerMove, onPointerUp,
  } = useTreePanZoom({ blockGestures: blockViewportGestures, enabled: bootstrapped });
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
    if (!compact) setMobileToolsOpen(false);
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

  const nodeR = useCallback(() => (compact ? 19 : 17), [compact]);

  const applyGraph = useCallback((next, opts) => {
    // Zyklen und Duplikate sofort entfernen bevor der Graph in den State geht —
    // sonst würde ein Zirkelschluss (Node X → ... → X) den Render-Stack sprengen.
    const cleaned = deduplicateGraphRoots(breakGraphCycles(next));
    setGraph(cleaned);
    markDirty();
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
    setEditorFocusNodeId(null);
    setTreePickParentKey(null);
    setTreePickNodeIds(new Set());
  }, []);

  const handleLocationChange = useCallback((next) => {
    markDirty();
    setLocation(normalizeRpgLocationState(next));
  }, []);

  const handleLocationCatalogChange = useCallback((next) => {
    markDirty();
    setLocationCatalog(normalizeRpgLocationCatalog(next));
  }, []);

  const handleLocationsChange = useCallback((next) => {
    markDirty();
    setLocations(Array.isArray(next) ? next : []);
  }, []);

  /**
   * @param {'manual' | 'questmaker'} entry
   */
  const openCreateNode = useCallback((entry) => {
    setEditorMode('create');
    setEditorNodeId(null);
    setEditorFocusNodeId(null);
    setEditorCreateEntry(entry);
    setEditorEditEntry(undefined);
    setEditorOpen(true);
    setTreePickParentKey(null);
    setTreePickNodeIds(new Set());
  }, []);

  /**
   * @param {string} qid
   * @param {'choose' | 'form' | 'ai'} entry
   */
  const openEditNode = useCallback((qid, entry, focusNodeId = null) => {
    setEditorMode('edit');
    setEditorNodeId(qid);
    setEditorFocusNodeId(focusNodeId);
    setEditorEditEntry(entry);
    setEditorCreateEntry(undefined);
    setEditorOpen(true);
    setTreePickParentKey(null);
    setTreePickNodeIds(new Set());
  }, []);

  const handleToggleTreePick = useCallback((parentDraftKey) => {
    if (!parentDraftKey) return;
    setTreePickParentKey((prev) => {
      const next = prev === parentDraftKey ? null : parentDraftKey;
      setTreePickNodeIds(new Set());
      return next;
    });
  }, []);

  const treePickActive = editorOpen && !!treePickParentKey;
  const treePickIdList = useMemo(() => [...treePickNodeIds], [treePickNodeIds]);
  const mobileTreePickMode = compact && treePickActive;
  const panelRenderMode = mobileTreePickMode ? 'none' : editorOpen ? 'editor' : selectedId ? 'quest-panel' : 'none';

  // Nodes die einen Zirkelschluss erzeugen würden: die editierte Node selbst + alle ihre Vorfahren.
  // Wenn der User eine davon im Pick-Modus anklickt → Warnung statt Auswahl.
  const blockedPickIds = useMemo(() => {
    if (!treePickActive || !editorNodeId) return new Set();
    // editorNodeId kann "questId" oder "questId::nodeId" sein
    const editId = editorNodeId.includes('::') ? editorNodeId.split('::')[1] : editorNodeId;
    const found = findNodeWithAncestors(graph, editId);
    const blocked = new Set([editId]);
    if (found) {
      // Alle Vorfahren auf dem Pfad vom Root bis zur editierten Node blockieren
      for (const ancestor of found.ancestors) {
        if (ancestor?.id) blocked.add(ancestor.id);
      }
      blocked.add(found.rootQuestId);
    }
    return blocked;
  }, [treePickActive, editorNodeId, graph]);

  const showCycleWarning = useCallback(() => {
    setTreePickCycleWarning(true);
    if (cycleWarnTimerRef.current) clearTimeout(cycleWarnTimerRef.current);
    cycleWarnTimerRef.current = setTimeout(() => setTreePickCycleWarning(false), 3000);
  }, []);

  const onToggleNode = useCallback(
    // Phase 2: questId wird vom Aufrufer zwar noch uebergeben (Tree-Layout
    // braucht ihn fuer Selektion), aber nodeDone ist flach pro Node-ID.
    (questId, nodeId) => {
      markDirty();
      setNodeDone((prev) => {
        // Flach: toggle das einzelne Node-Flag global.
        const wasOn = prev[nodeId] === true;
        const next = { ...prev };
        if (wasOn) delete next[nodeId];
        else next[nodeId] = true;
        setVitals((old) => reconcileRpgVitals(graph, next, old).state);
        return next;
      });
    },
    [graph]
  );

  // Cleanup verwaister nodeDone-Eintraege: in Phase 2 entfernen wir Flags fuer
  // Node-IDs, die nicht (mehr) im Graph existieren — egal ob als Root oder Sub-Node.
  useEffect(() => {
    /** @type {Set<string>} */
    const allNodeIds = new Set();
    for (const q of graph.nodes || []) {
      allNodeIds.add(q.id);
      const stack = [...(q.children || [])];
      while (stack.length) {
        const n = stack.pop();
        if (n?.id) allNodeIds.add(n.id);
        if (Array.isArray(n?.children) && n.children.length) stack.push(...n.children);
      }
    }
    setNodeDone((prev) => {
      let changed = false;
      /** @type {typeof prev} */
      const next = { ...prev };
      for (const nid of Object.keys(next)) {
        if (!allNodeIds.has(nid)) {
          delete next[nid];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [graph]);

  const byId = useMemo(() => questMap(graph), [graph]);
  const vitalsView = useMemo(() => toRpgVitalsView(vitals), [vitals]);

  // Sugiyama-Layout: ALLE Nodes (Roots + Children) als ein DAG.
  // Liefert positions[id] = {x, y}, plus Bounding-Box (width/height/minX/minY).
  // Deterministisch — gleicher Graph = gleiches Layout, immer.
  const layout = useMemo(
    () => computeSugiyamaLayout(graph, { compact }),
    [graph, compact]
  );
  // treePositions als kurzer Alias — viele Stellen lesen das (focus, render).
  const treePositions = layout.positions;

  const dependencyEdges = useMemo(
    () => graphEdges(graph).filter((e) => e.relation !== 'structure'),
    [graph]
  );
  // structure-Edges (parent_of): die Hauptstruktur der Hierarchie.
  // Werden separat gerendert (anderer Look, Lock-Toggle, etc.).
  const structureEdges = useMemo(
    () => graphEdges(graph).filter((e) => e.relation === 'structure'),
    [graph]
  );
  // Subtree-Lock-Set: pro Graph- ODER nodeDone-Aenderung neu berechnen.
  // nodeDone wird gebraucht fuer die Sibling-Lock-Awareness (node.isLock):
  // eine done-Lock-Node sperrt ihre Geschwister NICHT mehr — konsistent mit
  // canSetNodeDoneInGraph. So passen sich gedimmte Schwestern automatisch
  // wieder ein, sobald die Lock-Node abgehakt wird.
  const lockedNodeIds = useMemo(
    () => computeLockedNodeIds(graph, nodeDone),
    [graph, nodeDone]
  );

  // Render-Liste fuer Sub-Nodes: alle Nodes die KEINE Top-Level-Quest-Roots
  // sind, aber im Graph erreichbar (z.B. via parent_of-Edges). Mit Metadaten
  // fuer die JSX (label, isLeaf, isDone, isLock, isLocked, depth, questId).
  //
  // Funktioniert in beiden Modi:
  //   - Compat-View: graph.nodes hat nur Roots, Sub-Nodes nested via children
  //   - V3-canonical: graph.nodes hat alle Nodes flach
  // Wir bauen erst eine flache Map ueber alle Nodes (deckt beide Modi ab),
  // bestimmen dann via structureEdges welche tatsaechliche Roots sind und
  // welche Sub-Nodes haben einen Parent.
  const nodeRenderList = useMemo(() => {
    // Schritt 1: flache Map ueber ALLE Nodes (egal ob top-level oder nested)
    /** @type {Map<string, import('../lib/rpg-quests-data.js').RpgNode>} */
    const allNodes = new Map();
    /** @param {import('../lib/rpg-quests-data.js').RpgNode | null | undefined} n */
    function collect(n) {
      if (!n || typeof n.id !== 'string' || !n.id || allNodes.has(n.id)) return;
      allNodes.set(n.id, n);
      if (Array.isArray(n.children)) for (const c of n.children) collect(c);
    }
    for (const n of graph.nodes || []) collect(n);

    // Schritt 2: erster Parent pro Sub-Node (fuer questId-Selection)
    // Edges sortieren (alphabetisch nach from, dann to), damit Multi-Parent-
    // Nodes immer den lexikographisch ersten Parent als questId bekommen —
    // unabhaengig von der Edge-Insertion-Reihenfolge. Verhindert Selection-
    // Drift wenn der User Edges hinzufuegt/entfernt.
    /** @type {Map<string, string>} */
    const firstParentByNode = new Map();
    const sortedEdges = [...structureEdges].sort((a, b) => {
      const fa = String(a?.from || '');
      const fb = String(b?.from || '');
      if (fa !== fb) return fa.localeCompare(fb);
      return String(a?.to || '').localeCompare(String(b?.to || ''));
    });
    for (const e of sortedEdges) {
      const to = String(e.to || '').trim();
      if (!to || firstParentByNode.has(to)) continue;
      firstParentByNode.set(to, String(e.from || '').trim());
    }

    // Schritt 3: pro Sub-Node den TOP-LEVEL-QUEST-ROOT bestimmen.
    // Wir walken via firstParentByNode rekursiv nach oben bis kein Parent mehr.
    // WICHTIG: questId muss der TOP-LEVEL-ROOT sein (das was in `byId` steht
    // und durch `selectedId` referenziert wird), nicht der direkte Parent.
    // Sonst findet `byId.get(selectedId)` beim Klick auf einen Sub-Sub-Node
    // den Quest nicht → das Panel oeffnet sich nicht. Memoisiert via Cache.
    /** @type {Map<string, string>} */
    const rootByNode = new Map();
    /** @param {string} startId */
    function findRoot(startId) {
      if (rootByNode.has(startId)) return rootByNode.get(startId);
      let current = startId;
      /** @type {Set<string>} */
      const visited = new Set();
      /** @type {string[]} */
      const path = [];
      while (firstParentByNode.has(current) && !visited.has(current)) {
        visited.add(current);
        path.push(current);
        current = firstParentByNode.get(current);
      }
      // `current` ist jetzt der Top-Level-Root (oder eine Cycle-Bruchstelle —
      // dank visited-Set kein Endlos-Loop). Cache fuer alle besuchten IDs.
      for (const id of path) rootByNode.set(id, current);
      rootByNode.set(current, current);
      return current;
    }

    // Schritt 4: Quest-Root-Map fuer isNodeCompleteInQuest-Lookup
    const qMap = new Map((graph.nodes || []).map((q) => [q.id, q]));

    // Schritt 5: Output bauen — alle Nodes die einen Parent haben sind Sub-Nodes.
    // Roots (ohne Parent) werden separat als Quest-Root gerendert, hier ueberspringen.
    /** @type {Array<{id: string; nodeId: string; questId: string; label: string; depth: number; isLeaf: boolean; isDone: boolean; isLock: boolean; isLocked: boolean}>} */
    const out = [];
    for (const [id, node] of allNodes) {
      if (!firstParentByNode.has(id)) continue; // hat keinen Parent → ist ein Root → separat gerendert
      const questId = findRoot(id);
      const leaf = nodeIsLeaf(node);
      out.push({
        id: `${questId}::${id}`,
        nodeId: id,
        questId,
        label: node.title || id,
        depth: maxNodeDepth(node),
        isLeaf: leaf,
        isDone: leaf ? isNodeCompleteInQuest(qMap.get(questId), id, nodeDone) : false,
        isLock: isLockNode(node),
        isLocked: lockedNodeIds.has(id),
      });
    }
    return out;
  }, [graph, structureEdges, nodeDone, lockedNodeIds]);

  // Hindernisse fuer Smart-Edge-Routing: alle Nodes mit Position und Radius.
  // Wird beim Rendern jeder Edge geprueft, damit kollidierende Edges
  // lokal um andere Nodes herum kurven (oder schneiden, wenn Umweg zu lang).
  const obstacles = useMemo(() => {
    const r = nodeR();
    const list = [];
    for (const id of Object.keys(treePositions)) {
      const p = treePositions[id];
      if (!p) continue;
      list.push({ id, x: p.x, y: p.y, radius: r });
    }
    return list;
  }, [treePositions, nodeR]);

  // Schneller Lookup nodeId → render-meta (fuer Sub-Node-Edge-Rendering:
  // braucht isDone/isLeaf/isLock vom Ziel-Node).
  const nodeMetaById = useMemo(() => {
    /** @type {Map<string, typeof nodeRenderList[number]>} */
    const m = new Map();
    for (const n of nodeRenderList) m.set(n.nodeId, n);
    return m;
  }, [nodeRenderList]);

  useEffect(() => {
    const m = questMap(graph);
    setAdded((prev) => {
      const next = new Set();
      for (const id of prev) {
        // Child-Nodes über findNodeWithAncestors suchen, Root-Quest für Lock/Completion-Check holen
        const found = findNodeWithAncestors(graph, id);
        if (!found) continue;
        const rootQuest = m.get(found.rootQuestId);
        if (!rootQuest) continue;
        if (isNodeCompleted(rootQuest, nodeDone)) continue;
        if (!isNodeUnlocked(found.rootQuestId, graph, nodeDone, m)) continue;
        next.add(id);
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [graph, nodeDone]);

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
    const pos = treePositions[focusIdFromUrl];
    if (!el || !pos) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const cy = Math.max(0, (vh - panelReserve) * 0.45);
    const s = scale;
    setPan({ x: vw / 2 - pos.x * s, y: cy - pos.y * s });
    didCenterFocusRef.current = true;
  }, [focusIdFromUrl, treePositions, layout.width, layout.height, scale, panelReserve]);

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

  const onGraphNodeClick = useCallback((/** @type {string} */ qid) => {
    if (suppressNodeClickRef.current) {
      suppressNodeClickRef.current = false;
      return;
    }
    if (treePickActive) {
      if (blockedPickIds.has(qid)) { showCycleWarning(); return; }
      setTreePickNodeIds((prev) => {
        const next = new Set(prev);
        if (next.has(qid)) next.delete(qid);
        else next.add(qid);
        return next;
      });
      return;
    }
    setSelectedNode({ questId: qid, nodeId: null });
    setSelectedId(qid);
  }, [treePickActive, blockedPickIds, showCycleWarning]);

  const toggleAdded = useCallback(() => {
    // Child-Node bevorzugen — wenn ein Sub-Node angeklickt ist, dessen ID tracken statt Root-Quest-ID
    const effectiveId = selectedNode?.nodeId || selectedId;
    const q = selectedId ? byId.get(selectedId) : null; // Root-Quest für Unlock/Completion-Checks
    const canToggle = canToggleAddedForSelection({
      selectedId: effectiveId,
      isSelectedKnown: !!q,
      isSelectedUnlocked: selectedId ? isNodeUnlocked(selectedId, graph, nodeDone, byId) : false,
      isSelectedCompleted: q ? isNodeCompleted(q, nodeDone) : false,
    });
    if (!canToggle || !effectiveId) return;
    markDirty();
    setAdded((prev) => {
      const next = new Set(prev);
      if (next.has(effectiveId)) next.delete(effectiveId);
      else next.add(effectiveId);
      return next;
    });
  }, [byId, graph, selectedId, selectedNode, nodeDone]);

  const { selectedQuest, selectedGraphNode, selectedNodeView } =
    deriveRpgTreeSelectionView(byId, selectedId, selectedNode);
  const selectedUnlocked = selectedQuest
    ? isNodeUnlocked(selectedQuest.id, graph, nodeDone, byId)
    : false;
  const selectedCompleted = selectedQuest ? isNodeCompleted(selectedQuest, nodeDone) : false;
  // Prüfen ob der konkret ausgewählte Node (Child oder Root) im Hub ist
  const effectiveSelectedId = selectedNode?.nodeId || selectedQuest?.id;
  const selectedAdded = effectiveSelectedId ? added.has(effectiveSelectedId) : false;
  const { panelAddLabel, addButtonDisabled, canEditSelected } = deriveRpgTreePanelState({
    selectedNodeContext: selectedQuest,
    selectedUnlocked,
    selectedCompleted,
    selectedAdded,
  });

  // Fortschritt der ausgewaehlten Quest (fuer Panel-Meter)
  const selectedProgressPct = useMemo(() => {
    if (!selectedQuest) return 0;
    return Math.round(nodeProgress(selectedQuest, nodeDone, graph));
  }, [selectedQuest, nodeDone, graph]);

  const vesselsAria = `Leben ${vitalsView.heart} von ${RPG_VITAL_MAX_POINTS} Punkten, Mana ${vitalsView.mana} von ${RPG_VITAL_MAX_POINTS}`;

  /**
   * Astrolab-Tool-Handler: leitet Aktionen an die richtige Stelle.
   * Die Armillarsphaere ersetzt die alten Top-Bar-Buttons.
   *
   * Toggle-Off fuer den Lock-Modus
   * ──────────────────────────────
   * Edge-Tools wie 'lock' bleiben aktiv bis der User explizit aussteigt.
   * Nochmal auf den schon-aktiven Lock-Button → Modus beenden (Wechsel auf
   * 'focus' als neutraler Default — zeigt keine Edge-Hit-Areas mehr und
   * bringt den normalen Cursor zurueck). Andere Tools (add/edit/note/...)
   * sind one-shot Aktionen — Toggle-Off macht dort keinen Sinn.
   */
  const handleAstrolabTool = useCallback((toolId) => {
    // Toggle-Off-Pfad: zweites Klicken auf den aktiven Lock-Button aussteigt.
    if (toolId === 'lock' && activeTool === 'lock') {
      setActiveTool('focus');
      setMobileToolsOpen(false);
      return;
    }
    setActiveTool(toolId);
    setMobileToolsOpen(false);
    switch (toolId) {
      case 'add':
        openCreateNode('manual');
        break;
      case 'edit':
        if (selectedQuest) {
          const editorEntityId = selectedNode?.nodeId
            ? `${selectedQuest.id}::${selectedNode.nodeId}`
            : selectedQuest.id;
          openEditNode(editorEntityId, 'form', selectedNode?.nodeId || null);
        }
        break;
      case 'cut':
        break;
      case 'lock':
        // Modus aktiv halten — die eigentliche Toggle-Aktion passiert beim
        // Edge-Klick (handleLockEdge), nicht hier.
        break;
      case 'note':
        if (canUseNotes) openSuperNotes();
        break;
      case 'focus': {
        // Auf aktive Quest zentrieren
        const el = viewportRef.current;
        if (el) {
          const vw = el.clientWidth;
          const vh = el.clientHeight;
          setPan({ x: vw * 0.05, y: vh * 0.04 });
          setScale(0.85);
        }
        break;
      }
      case 'settings':
        setSettingsOpen(true);
        break;
      case 'hub':
        window.location.href = '/rpg';
        break;
    }
    // activeTool muss in der Dep-Liste, weil der Toggle-Off-Pfad ihn liest.
  }, [selectedQuest, selectedNode, canUseNotes, activeTool]);

  const mobileToolItems = useMemo(() => {
    const tools = [
      { id: 'add', label: 'Quest hinzufügen' },
      { id: 'edit', label: 'Quest bearbeiten', disabled: !selectedQuest },
      { id: 'cut', label: 'Schere' },
      { id: 'lock', label: 'Sperre' },
      { id: 'focus', label: 'Fokus' },
      { id: 'settings', label: 'Alchemie-Labor' },
      { id: 'hub', label: 'Sammlung' },
    ];
    if (canUseNotes) tools.splice(2, 0, { id: 'note', label: 'Super-Notizen' });
    return tools;
  }, [canUseNotes, selectedQuest]);

  // Mobil: Dock + Overlay fuer Mana/Heart
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

  // GraphEditor-Instanz: in eigenem Panel-Slot
  const graphEditor = (
    <RpgQuestGraphEditor
      open={editorOpen}
      mode={editorMode}
      graph={graph}
      questId={editorMode === 'edit' ? editorNodeId : null}
      focusNodeId={editorMode === 'edit' ? editorFocusNodeId : null}
      createEntry={editorMode === 'create' ? editorCreateEntry : undefined}
      editEntry={editorMode === 'edit' ? editorEditEntry : undefined}
      onClose={closeEditor}
      onApply={applyGraph}
      itemCatalog={itemCatalog}
      embedded
      treePickParentKey={treePickParentKey}
      treePickNodeIds={treePickIdList}
      onToggleTreePick={handleToggleTreePick}
      treePickDoneSignal={treePickDoneSignal}
    />
  );

  const superNotesModal = canUseNotes ? (
    <RpgTreeSuperNotes
      open={superNotesOpen}
      value={superNotesValue}
      history={superNotesHistory}
      onInput={setSuperNotesValue}
      onClose={() => setSuperNotesOpen(false)}
      onSave={saveSuperNotes}
      onRestoreHistory={setSuperNotesValue}
      loading={superNotesLoading}
      saving={superNotesSaving}
      error={superNotesError}
    />
  ) : null;

  // Settings-Modal (Alchemie-Labor): Theme-Switch + Backups
  const settingsModal = (
    <RpgTreeSettings
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      direction={direction}
      onDirectionChange={setDirection}
    />
  );

  // ── Dim-/Glow-Farben fuer Kanten (passend zum neuen Design) ──
  const dimStroke = 'rgba(120,90,40,0.32)';
  const glowStroke = 'rgba(255,220,140,0.85)';
  const doneStroke = 'rgba(200,180,140,0.65)';

  // ── Bootstrap: Ladebildschirm ──
  if (!bootstrapped) {
    return (
      <div class="rpg-tree rpg-tree--bootstrap">
        <RpgBootstrapLoading />
      </div>
    );
  }

  // ── Empty State: keine Quests ──
  if (!graph.nodes?.length) {
    return (
      <div class={`rpg-tree dir-${direction}`}>
        <RpgAstrolab activeTool={activeTool} onTool={handleAstrolabTool} canUseNotes={canUseNotes} />
        <header class="rpg-tree__top">
          <p class="rpg-tree__top-title">
            Codex der Quests
            <em>· Quest-Baum</em>
          </p>
        </header>
        {superNotesModal}
        {settingsModal}
        {mobileManaDock}
        {mobileManaOverlay}
        <p class="rpg-tree__empty">
          Keine Quests im Graph. Nutze das + am Astrolab, um eine Quest anzulegen.
        </p>
        {editorOpen && (
          <aside class="qpanel qpanel--editor" aria-label="Editor">
            {graphEditor}
          </aside>
        )}
      </div>
    );
  }

  // ── Direction-Klasse auf den Root legen ──
  const rootTreeClass = [
    'rpg-tree',
    `dir-${direction}`,
    compact && selectedId && !treePickActive ? 'rpg-tree--detail-mobile' : '',
    activeTool === 'cut' ? 'rpg-tree--tool-cut' : '',
    activeTool === 'lock' ? 'rpg-tree--tool-lock' : '',
  ].filter(Boolean).join(' ');

  // CSS-Custom-Property fuer den Lock-Cursor: nur setzen wenn Lock-Modus aktiv,
  // damit das Default-Cursor-Verhalten (grab/grabbing) sonst greift. Quelle:
  // `src/lib/rpg-lock-icon.js` — eine Quelle fuer Bead-Icon UND Cursor.
  const rootTreeStyle = activeTool === 'lock'
    ? { '--rpg-lock-cursor': LOCK_CURSOR_VALUE }
    : undefined;

  const handleCutEdge = useCallback((fromNodeId, toNodeId) => {
    if (activeTool !== 'cut') return;
    const next = removeParentChildEdge(graph, fromNodeId, toNodeId);
    if (next === graph) return;
    applyGraph(next);
  }, [activeTool, graph, applyGraph]);

  /**
   * Lock-Edge-Toggle MIT SIDE-BERECHNUNG (bidirektional, Stand 2026-05-04).
   *
   * Aus dem Click-Event berechnen wir, auf welcher Haelfte der Edge der User
   * geklickt hat: Maus-Position wird in SVG-Koordinaten umgerechnet, dann auf
   * den Edge-Vektor (from→to) projiziert. Der t-Parameter zwischen 0 (am
   * Parent-Ende) und 1 (am Child-Ende) bestimmt die Side:
   *   - t < 0.5 → 'parent' (Klick naeher am Parent → Parent-Branch sperren)
   *   - t >= 0.5 → 'child' (Klick naeher am Child → Subtree sperren)
   *
   * Toggle-Semantik:
   *   - Edge ist auf gleicher Side gelockt → unlock (zweiter Klick = Aus)
   *   - Edge ist auf anderer Side gelockt → switch (Side-Wechsel)
   *   - Edge ist nicht gelockt → setze auf gewaehlte Side
   *
   * Wir nutzen die getrimmten Endpunkte (seg.x1/y1 → seg.x2/y2) als Vektor —
   * die Bezier-Kruemmung interessiert hier nicht, weil wir nur "naeher zu
   * Parent oder Child" wissen muessen, und die mittlere Hoehe der Kurve
   * stimmt fuer diese Heuristik mit der geraden Linie ueberein.
   *
   * @param {PointerEvent | MouseEvent} ev — Click-Event mit clientX/Y
   * @param {{ from: string; to: string }} edge
   * @param {{ x1: number; y1: number; x2: number; y2: number }} seg —
   *   getrimmte Endpunkte im SVG-Koordinatensystem
   */
  const handleLockEdge = useCallback((ev, edge, seg) => {
    if (activeTool !== 'lock') return;
    // Die SVG-Element-Hierarchie: das innere SVG ist Bestandteil des Trees.
    // ownerSVGElement liefert das aeusserste SVG des Hit-Elements.
    const svg = ev.currentTarget?.ownerSVGElement;
    if (!svg || typeof svg.createSVGPoint !== 'function') return;
    // Maus → SVG-Coords via aktuelle Screen-Transform-Matrix.
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const inv = ctm.inverse();
    const m = pt.matrixTransform(inv);
    // Projektion auf den Edge-Vektor (Parent→Child).
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-3) return; // entartete Edge — nichts tun
    const t = ((m.x - seg.x1) * dx + (m.y - seg.y1) * dy) / lenSq;
    /** @type {'child' | 'parent'} */
    const side = t < 0.5 ? 'parent' : 'child';
    const next = toggleEdgeLockSide(graph, edge.from, edge.to, side);
    if (next === graph) return;
    applyGraph(next);
  }, [activeTool, graph, applyGraph]);

  return (
    <div class={rootTreeClass} style={rootTreeStyle}>
      {/* Astrolab: Armillarsphaere als Navigation (oben links) */}
      <RpgAstrolab
        activeTool={activeTool}
        onTool={handleAstrolabTool}
        canUseNotes={canUseNotes}
      />

      {/* Topbar: Titel + Breadcrumb */}
      <header class="rpg-tree__top">
        {compact && (
          <div class="rpg-tree__mobile-tools">
            <button
              type="button"
              class={`rpg-tree__mobile-tools-btn${mobileToolsOpen ? ' is-open' : ''}`}
              onClick={() => setMobileToolsOpen((prev) => !prev)}
              aria-label="Quest-Werkzeuge öffnen"
              aria-expanded={mobileToolsOpen}
              aria-controls="rpg-tree-mobile-tools-menu"
            >
              <span aria-hidden="true">☰</span>
            </button>
            {mobileToolsOpen && (
              <div class="rpg-tree__mobile-tools-menu-wrap">
                <ul id="rpg-tree-mobile-tools-menu" class="rpg-tree__mobile-tools-menu" role="menu">
                  {mobileToolItems.map((tool) => (
                    <li key={tool.id} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        class="rpg-tree__mobile-tools-item"
                        onClick={() => handleAstrolabTool(tool.id)}
                        disabled={tool.disabled}
                      >
                        {tool.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <p class="rpg-tree__top-title">
          Codex der Quests
          <em>· Quest-Baum</em>
        </p>
        <div class="rpg-tree__top-breadcrumb">
          <span>{location?.city || 'Ort'}</span>
          <span class="rpg-tree__top-breadcrumb-sep">◆</span>
          <b>{location?.place || '—'}</b>
        </div>
      </header>

      {persistError && (
        <div class="rpg-persist-error" role="alert">
          <span>{persistError}</span>
          <button type="button" onClick={() => setPersistError(null)} aria-label="Schließen">×</button>
        </div>
      )}

      {superNotesModal}
      {settingsModal}
      {mobileManaDock}
      {mobileManaOverlay}

      {/* Tree-Pick-Banner: sichtbar wenn der Nutzer Nodes fuer den Editor auswaehlt */}
      {treePickActive && (
        <div class="rpg-tree__pick-banner" role="status" aria-live="polite">
          {treePickCycleWarning ? (
            <>
              <span class="rpg-tree__pick-banner-icon">⚠</span>
              <span class="rpg-tree__pick-banner-cycle">Zirkelschluss — diese Node ist ein Vorfahre des bearbeiteten Knotens</span>
            </>
          ) : (
            <>
              <span class="rpg-tree__pick-banner-icon">⊕</span>
              Auswahlmodus — klicke Nodes an
              {treePickNodeIds.size > 0 && (
                <span class="rpg-tree__pick-banner-count">{treePickNodeIds.size} ausgewählt</span>
              )}
              <span class="rpg-tree__pick-banner-hint">
                {mobileTreePickMode ? 'dann unten „Fertig“ tippen' : 'dann „Fertig" im Editor'}
              </span>
            </>
          )}
        </div>
      )}

      {mobileTreePickMode && (
        <button
          type="button"
          class="rpg-tree__mobile-pick-finish"
          onClick={() => setTreePickDoneSignal((prev) => prev + 1)}
        >
          Fertig{treePickNodeIds.size > 0 ? ` (${treePickNodeIds.size})` : ''}
        </button>
      )}

      {/* Viewport: Pan/Zoom-Canvas mit dem Quest-Graphen */}
      <div
        ref={viewportRef}
        class={`rpg-tree__viewport${dragging ? ' rpg-tree__viewport--dragging' : ''}`}
        onPointerDown={onPointerDownViewport}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Sternenfeld-Hintergrund (nur fuer Astrolab + Orrery) */}
        <div class="rpg-tree__constellation">
          <svg viewBox="0 0 1000 800" preserveAspectRatio="none">
            {Array.from({ length: 60 }).map((_, i) => {
              const x = ((i * 137.5) % 1000);
              const y = ((i * 91.3) % 800);
              const r = 0.6 + ((i * 7) % 10) / 14;
              return <circle key={i} cx={x} cy={y} r={r} class="rpg-tree__constellation-star" />;
            })}
            <path class="rpg-tree__constellation-line" d="M 100 200 L 220 280 L 340 220 L 480 320" />
            <path class="rpg-tree__constellation-line" d="M 600 600 L 720 540 L 840 600" />
          </svg>
        </div>

        <div
          class="rpg-tree__canvas"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          }}
        >
          <svg
            class="rpg-tree__svg"
            width={layout.width}
            height={layout.height}
            viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
            aria-hidden={false}
          >
            <title>Quest-Baum</title>
            <defs>
              {/* Goldener Kanten-Gradient (fuer Fortschritt) */}
              <linearGradient id="edgeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="rgba(255,220,140,0.95)" />
                <stop offset="100%" stop-color="rgba(255,160,80,0.85)" />
              </linearGradient>
              {/* Leuchten fuer aktive Knoten */}
              <radialGradient id="nodeGlow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stop-color="rgba(255,220,140,0.5)" />
                <stop offset="100%" stop-color="rgba(255,220,140,0)" />
              </radialGradient>
            </defs>

            <rect
              class="rpg-tree__hit"
              x={layout.minX}
              y={layout.minY}
              width={layout.width}
              height={layout.height}
            />

            {/* Quest-Kanten (Abhaengigkeiten zwischen Root-Nodes) */}
            <g class="rpg-tree-edges">
              {dependencyEdges.map((e, i) => {
                const qa = byId.get(e.from);
                const qb = byId.get(e.to);
                if (!qa || !qb) return null;
                const fromPos = treePositions[e.from];
                const toPos = treePositions[e.to];
                if (!fromPos || !toPos) return null;
                const r = nodeR();
                // Endpunkte am Knotenrand (statt im Zentrum) — die Kruemmung
                // beginnt damit von dort.
                const seg = edgeEndpoints(fromPos.x, fromPos.y, toPos.x, toPos.y, r, r);
                // Smart-Routing: gerade default, lokal um Hindernisse kurven,
                // schneiden wenn der Umweg zu krass waere. From/To selbst
                // werden vom Routing als Hindernisse ausgeschlossen.
                const routed = routeEdge(
                  { x: seg.x1, y: seg.y1 },
                  { x: seg.x2, y: seg.y2 },
                  obstacles,
                  { excludeIds: new Set([e.from, e.to]) }
                );
                const pct = nodeProgress(qa, nodeDone, graph);
                const doneU = isNodeCompleted(qa, nodeDone);
                const addedU = added.has(e.from);
                const unlockedU = isNodeUnlocked(e.from, graph, nodeDone, byId);
                const activeU = unlockedU && addedU && !doneU;

                let brightLen = 0;
                let showBright = false;
                if (!doneU && activeU && pct > 0) {
                  brightLen = Math.max(0, seg.len * (pct / 100));
                  showBright = true;
                }

                return (
                  <g key={`${e.from}-${e.to}-${i}`}>
                    <path
                      d={routed.d}
                      fill="none"
                      stroke={doneU ? doneStroke : dimStroke}
                      stroke-width={doneU ? 2.2 : 1.35}
                      stroke-linecap="round"
                    />
                    {showBright && brightLen > 0.5 && (
                      <path
                        d={routed.d}
                        fill="none"
                        stroke={glowStroke}
                        stroke-width={2.4}
                        stroke-linecap="round"
                        stroke-dasharray={`${brightLen} ${Math.max(seg.len, 1)}`}
                        style={{ filter: 'drop-shadow(0 0 4px rgba(255,200,120,0.7))' }}
                      />
                    )}
                  </g>
                );
              })}
            </g>

            {/* Sub-Node-Kanten (parent_of-Edges, alle structure-Relations) */}
            <g class="rpg-tree-node-edges">
              {structureEdges.map((edge, i) => {
                const fromPos = treePositions[edge.from];
                const toPos = treePositions[edge.to];
                if (!fromPos || !toPos) return null;
                const r = nodeR();
                const seg = edgeEndpoints(fromPos.x, fromPos.y, toPos.x, toPos.y, r, r);
                // Smart-Routing inkl. Hindernisvermeidung
                const routed = routeEdge(
                  { x: seg.x1, y: seg.y1 },
                  { x: seg.x2, y: seg.y2 },
                  obstacles,
                  { excludeIds: new Set([edge.from, edge.to]) }
                );
                // Subtree-Progress des CHILD (edge.to): bestimmt wie weit die
                // Edge prozentual leuchtet. Glow erklimmt von Child nach Parent —
                // dafuer routen wir einen Reverse-Pfad, damit stroke-dasharray
                // am Child-Ende startet und nach oben "klimmt".
                const glowPct = leafProgressRatio(graph, edge.to, nodeDone).percent;
                const showGlow = glowPct > 0 && glowPct < 100;
                const routedReverse = showGlow
                  ? routeEdge(
                      { x: seg.x2, y: seg.y2 },
                      { x: seg.x1, y: seg.y1 },
                      obstacles,
                      { excludeIds: new Set([edge.from, edge.to]) }
                    )
                  : null;
                const glowLen = showGlow ? Math.max(0, seg.len * (glowPct / 100)) : 0;
                // Done-Status: Ziel ist erledigter Leaf ODER 100% Subtree-Progress.
                const childMeta = nodeMetaById.get(edge.to);
                const isDone = (childMeta && childMeta.isLeaf && childMeta.isDone) || glowPct === 100;
                // Edge-Lock-Status: Side-spezifisch (child/parent/null) plus
                // Ziel-Subtree-Lock (visuelle Dim-Darstellung).
                // edge.locked kann sein: 'child' | 'parent' | 'both' | true (Legacy) | undefined
                const lockSide =
                  edge.locked === 'both' ? 'both'
                    : edge.locked === 'parent' ? 'parent'
                    : (edge.locked === 'child' || edge.locked === true) ? 'child'
                    : null;
                const isEdgeLocked = lockSide !== null;
                const isTargetLocked = lockedNodeIds.has(edge.to);
                const isSourceLocked = lockedNodeIds.has(edge.from);
                // Edge-Klassen aus mehreren Achsen zusammenbauen:
                //  1) Cuttable (im Schere-Modus, fuer roten Hover)
                //  2) Lockable (im Sperre-Modus, fuer Schloss-Cursor + Hover)
                //  3) State-Modifier:
                //     - Edge selbst gesperrt (mit Side fuer differenzierten Style)
                //     - Ziel/Quelle im Lock-Subtree (gedimmt)
                const edgeClasses = ['rpg-tree-node-edge'];
                if (activeTool === 'cut') edgeClasses.push('rpg-tree-node-edge--cuttable');
                if (activeTool === 'lock') edgeClasses.push('rpg-tree-node-edge--lockable');
                if (isEdgeLocked) edgeClasses.push('rpg-tree-node-edge--edge-locked');
                if (lockSide === 'child' || lockSide === 'both') edgeClasses.push('rpg-tree-node-edge--edge-locked-child');
                if (lockSide === 'parent' || lockSide === 'both') edgeClasses.push('rpg-tree-node-edge--edge-locked-parent');
                // treelocked: visuell gedimmt wenn ENTWEDER das Child (down-stream-Lock)
                // ODER der Parent (up-stream-Lock) im Lock-Subtree liegt.
                if (isTargetLocked || isSourceLocked) edgeClasses.push('rpg-tree-node-edge--treelocked');
                return (
                  <g key={`node-edge-${edge.from}-${edge.to}-${i}`}>
                    <path
                      class={edgeClasses.join(' ')}
                      d={routed.d}
                      fill="none"
                      stroke={isDone ? doneStroke : 'rgba(200,147,47,0.18)'}
                      stroke-width={isDone ? 2.0 : 1.05}
                      stroke-linecap="round"
                    />
                    {/* Progress-Glow: laeuft vom Child nach Parent in Hoehe des
                        Subtree-Progresses. Kommt nur wenn 0 < pct < 100 (bei
                        100 uebernimmt das `isDone`-Styling oben). */}
                    {showGlow && glowLen > 0.5 && routedReverse ? (
                      <path
                        class="rpg-tree-node-edge__progress-glow"
                        d={routedReverse.d}
                        fill="none"
                        stroke={glowStroke}
                        stroke-width={2.0}
                        stroke-linecap="round"
                        stroke-dasharray={`${glowLen} ${Math.max(seg.len, 1)}`}
                        style={{ filter: 'drop-shadow(0 0 4px rgba(255,200,120,0.7))' }}
                      />
                    ) : null}
                    {/* Hit-Path: dicker, transparenter Klick-Bereich fuer Edge-Tools.
                        Im Lock-Modus uebergeben wir zusaetzlich die getrimmten
                        Endpunkte `seg`, damit der Handler die Klick-Haelfte
                        (parent vs. child) per Vektor-Projektion bestimmen kann. */}
                    {(activeTool === 'cut' || activeTool === 'lock') ? (
                      <path
                        class="rpg-tree-node-edge-hit"
                        d={routed.d}
                        fill="none"
                        stroke="transparent"
                        stroke-width={14}
                        stroke-linecap="round"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeTool === 'cut') {
                            handleCutEdge(edge.from, edge.to);
                          } else if (activeTool === 'lock') {
                            handleLockEdge(e, edge, seg);
                          }
                        }}
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>

            {/* Quest-Root-Nodes */}
            <g class="rpg-tree-nodes">
              {graph.nodes.map((q) => {
                const p = treePositions[q.id];
                if (!p) return null;
                const unlocked = isNodeUnlocked(q.id, graph, nodeDone, byId);
                const completed = isNodeCompleted(q, nodeDone);
                const isAdded = added.has(q.id);
                // Roots koennen via parent-side-Lock im Lock-Subtree landen.
                // Dann muessen sie genauso gedimmt werden wie Sub-Nodes.
                const isRootLocked = lockedNodeIds.has(q.id);
                const cls = nodeClass(q, unlocked, isAdded, completed, isRootLocked);
                const r = nodeR();
                const label = q.title.length > 20 ? `${q.title.slice(0, 18)}\u2026` : q.title;
                const isFocus = focusIdFromUrl === q.id;
                // Nur direkt selected wenn kein Child-Node ausgewählt ist — sonst leuchtet
                // der Root immer wenn irgendein Kind angeklickt wird
                const isDirectlySelected = selectedId === q.id && !selectedNode?.nodeId;
                const timeUrgent = !completed && questHasUrgentTimeBoundLeaves(q, nodeDone);
                const isActive = unlocked && isAdded && !completed;

                return (
                  <g
                    key={q.id}
                    class={`${cls}${isDirectlySelected ? ' rpg-tree-node--selected' : ''}${treePickActive && treePickNodeIds.has(q.id) ? ' rpg-tree-node--pick-selected' : ''}`}
                    transform={`translate(${p.x},${p.y})`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onGraphNodeClick(q.id)}
                  >
                    {/* Knoten-Form (Polygon je nach Subtree-Tiefe):
                        depth 0 = Leaf = Circle, 1 = Tropfen, 2 = Linse, 3+ = Polygon */}
                    {(() => {
                      const path = nodeShapePath(maxNodeDepth(q), r);
                      if (!path) {
                        return <circle class="rpg-tree-node__shape" r={r} stroke-width={isFocus ? 2.6 : 1.8} />;
                      }
                      return <path class="rpg-tree-node__shape" d={path} stroke-width={isFocus ? 2.6 : 1.8} />;
                    })()}

                    {/* Urgent-Dot (fristgebundene Nodes) */}
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

                    {/* Label (Serif-Font, Gold) */}
                    {!isRootLocked ? (
                      <text class="rpg-tree-node__label" y={r + 16}>
                        {label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>

            {/* Sub-Nodes (Kinder der Quest-Roots) */}
            <g class="rpg-tree-node-nodes">
              {nodeRenderList.map((n) => {
                const pos = treePositions[n.nodeId];
                if (!pos) return null;
                const subR = nodeR();
                // nodeNodeClass: vierter Parameter `isLocked` ist additiver
                // CSS-Modifier `--treelocked` fuer den Tree-View-Subtree-Lock,
                // der visuell auf dem Basis-Status (done/lock/leaf/container) aufsetzt.
                const cls = nodeNodeClass(n.isDone, n.isLeaf, n.isLock, n.isLocked);
                const label = n.label.length > 20 ? `${n.label.slice(0, 18)}\u2026` : n.label;
                // Form ueber Subtree-Tiefe (depth 0 = Leaf = Circle).
                const shapePath = nodeShapePath(n.depth, subR);
                const isNodeSelected = selectedNode?.nodeId === n.nodeId && selectedNode?.questId === n.questId;
                // Hub-Status: leuchtet pulsierend wenn der Sub-Node selbst added wurde.
                const isAddedSub = added.has(n.nodeId);
                return (
                  <g
                    key={n.id}
                    class={`${cls}${isNodeSelected ? ' rpg-tree-node-node--selected' : ''}${treePickActive && treePickNodeIds.has(n.nodeId) ? ' rpg-tree-node-node--pick-selected' : ''}${isAddedSub ? ' rpg-tree-node-node--added' : ''}`}
                    transform={`translate(${pos.x},${pos.y})`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      if (suppressNodeClickRef.current) {
                        suppressNodeClickRef.current = false;
                        return;
                      }
                      if (treePickActive) {
                        if (blockedPickIds.has(n.nodeId)) { showCycleWarning(); return; }
                        setTreePickNodeIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(n.nodeId)) next.delete(n.nodeId);
                          else next.add(n.nodeId);
                          return next;
                        });
                        return;
                      }
                      setSelectedId(n.questId);
                      setSelectedNode({ questId: n.questId, nodeId: n.nodeId });
                    }}
                  >
                    {shapePath ? (
                      <path class="rpg-tree-node-node__shape" d={shapePath} />
                    ) : (
                      <circle class="rpg-tree-node-node__shape" r={subR} />
                    )}
                    {/* Schloss-Glyph auf der isLock-Node entfaellt seit 2026-05-04 —
                        die Sibling-Lock-Wirkung wird stattdessen ueber das einheitliche
                        --treelocked-Dimming der Geschwister sichtbar (siehe
                        computeLockedNodeIds: Sibling-Lock-Seed). */}
                    {/* Label nur fuer NICHT-treelocked Nodes — gesperrte Nodes
                        sollen anonym aussehen (Title verbirgt sich, im Panel
                        wird er erst beim Anklicken sichtbar als Fragezeichen). */}
                    {!n.isLocked ? (
                      <text class="rpg-tree-node-node__label" y={subR + 13}>
                        {label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Location-Strip am unteren Rand */}
        <div class="rpg-tree__location-strip">
          <span class="rpg-tree__location-strip-compass">⌖</span>
          <span>{location?.city || 'Ort'}</span>
          <span class="rpg-tree__location-strip-sep">·</span>
          <b>{location?.place || '—'}</b>
        </div>
      </div>

      {/* Vessels: Canvas-Glasgefaesse (Desktop, links unten) */}
      {!compact && (
        <div class="rpg-tree__vessels" aria-label={vesselsAria}>
          <RpgVessel kind="mana" value={vitalsView.mana} max={RPG_VITAL_MAX_POINTS} />
          <RpgVessel kind="heart" value={vitalsView.heart} max={RPG_VITAL_MAX_POINTS} />
        </div>
      )}

      {/* Rechtes Panel: Quest-Details ODER Editor */}
      {panelRenderMode === 'editor' ? (
        <aside class="qpanel qpanel--editor" aria-label="Editor">
          {graphEditor}
        </aside>
      ) : panelRenderMode === 'quest-panel' && selectedQuest ? (
        <RpgQuestPanel
          quest={selectedQuest}
          selectedNodeView={selectedNodeView}
          selectedGraphNode={selectedGraphNode}
          unlocked={selectedUnlocked}
          completed={selectedCompleted}
          added={selectedAdded}
          panelAddLabel={panelAddLabel}
          addButtonDisabled={addButtonDisabled}
          canEditSelected={canEditSelected}
          nodeDone={nodeDone}
          onToggleNode={onToggleNode}
          onToggleAdded={toggleAdded}
          onEdit={() => {
            const editorEntityId = selectedNode?.nodeId
              ? `${selectedQuest.id}::${selectedNode.nodeId}`
              : selectedQuest.id;
            openEditNode(editorEntityId, 'form', selectedNode?.nodeId || null);
          }}
          onClose={() => {
            setSelectedId(null);
            setSelectedNode(null);
          }}
          graph={graph}
          itemCatalog={itemCatalog}
          currentLocation={location}
          progressPct={selectedProgressPct}
          /* Tree-View-Subtree-Sperre: prueft ob der konkret angezeigte
             Knoten (selectedNodeView wenn Sub-Node, sonst Quest-Root) im
             gesperrten Subtree liegt. Roots sind nie locked (computeLockedNodeIds
             startet erst bei Nodes mit eingehenden Edges). */
          treeLocked={lockedNodeIds.has((selectedNodeView || selectedQuest).id)}
        />
      ) : null}
    </div>
  );
}
