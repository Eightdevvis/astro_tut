import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import {
  upsertQuestInGraph,
  removeQuestFromGraph,
  graphHasCycle,
} from '../lib/rpg-quest-graph.js';
import { getNodeRewardRows } from '../lib/rpg-quest-nodes.js';
import {
  questNodesToDrafts,
  draftNodesToQuestNodes,
  questRewardRowsToDraftRows,
  draftRewardRowsToStoredRewards,
  isDraftNodeMeaningful,
  ensureNodeDraftFields,
  ensureRewardRowFields,
  collectQuestmakerItemsFromDrafts,
  hydrateItemFieldsFromCatalog
} from '../lib/rpg-quest-editor-draft.js';
import {
  collectAllItemIdsFromGraph,
  normalizeQuestmakerCatalogPayloadItem,
} from '../lib/rpg-questmaker-sync.js';
import {
  addManualQuestDraft,
  removeManualQuestDraft,
  loadManualQuestDrafts,
  loadManualQuestInProgressDraft,
  saveManualQuestInProgressDraft,
  clearManualQuestInProgressDraft,
} from '../lib/rpg-quest-manual-drafts.js';
import {
  makeUniqueQuestId,
  resolveEditTarget,
  mapNodeRecursive,
  removeNodeRecursive,
  stripDependsOnReferences,
  expandDraftsToFocusedNode,
  graphNodeIdToDraft,
} from '../lib/rpg-graph-editor-ops.js';
import { useEditorAiFlow } from '../lib/useEditorAiFlow.js';
import { RpgQuestNodesBuilder } from './RpgQuestNodesBuilder.jsx';
import RpgQuestRewardsBuilder from './RpgQuestRewardsBuilder.jsx';
import RpgQuestNodesView from './RpgQuestNodesView.jsx';
import { normalizeQuestId } from '../lib/rpg-quest-form-helpers.js';
import './rpg-graph-editor.css';

export { normalizeQuestId } from '../lib/rpg-quest-form-helpers.js';
const RPG_QUESTMAKER_ENABLED = false;

/**
 * @param {{
 *   open: boolean;
 *   mode: 'create' | 'edit';
 *   graph: import('../lib/rpg-quest-graph.js').RpgGraph;
 *   questId: string | null;
 *   focusNodeId?: string | null;
 *   embedded?: boolean;
 *   treePickParentKey?: string | null;
 *   treePickNodeIds?: string[];
 *   onToggleTreePick?: (parentDraftKey: string) => void;
 *   onClose: () => void;
 *   onApply: (g: import('../lib/rpg-quest-graph.js').RpgGraph, opts?: { questmakerItems?: { id: string; category: string; title: string; description: string }[] }) => void;
 *   createEntry?: 'manual' | 'questmaker';
 *   editEntry?: 'form' | 'ai';
 *   itemCatalog?: Record<string, { title?: string }>;
 * }} props
 */
export default function RpgQuestGraphEditor({
  open,
  mode,
  graph,
  questId,
  focusNodeId = null,
  embedded = false,
  treePickParentKey = null,
  treePickNodeIds = [],
  onToggleTreePick,
  onClose,
  onApply,
  createEntry,
  editEntry,
  itemCatalog = {},
}) {
  const resolvedCreateEntry =
    !RPG_QUESTMAKER_ENABLED && createEntry === 'questmaker' ? 'manual' : createEntry;
  const resolvedEditEntry =
    !RPG_QUESTMAKER_ENABLED && editEntry === 'ai' ? 'form' : editEntry;
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  /** @type {import('../lib/rpg-quest-editor-draft.js').QuestNodeDraft[]} */
  const [nodeDrafts, setNodeDrafts] = useState([]);
  /** @type {import('../lib/rpg-quest-editor-draft.js').QuestRewardDraftRow[]} */
  const [rewardRows, setRewardRows] = useState([]);
  const [orderInLayer, setOrderInLayer] = useState(0);
  const [editContainerQuestId, setEditContainerQuestId] = useState('');
  const [editTargetNodeId, setEditTargetNodeId] = useState('');
  /** Nur wenn kein createEntry gesetzt (Fallback) */
  const [createMode, setCreateMode] = useState(/** @type {'manual' | 'ai'} */ ('manual'));
  const editQmBaselineRef = useRef(
    /** @type {{
     *   nodeDrafts: import('../lib/rpg-quest-editor-draft.js').QuestNodeDraft[];
     *   title: string;
     *   description: string;
     *   rewardRows: import('../lib/rpg-quest-editor-draft.js').QuestRewardDraftRow[];
     *   orderInLayer: number;
     * } | null} */ (null)
  );
  const [draftsOpen, setDraftsOpen] = useState(false);
  /** Inline-Fehler statt window.alert fuer Submit/Delete-Validierung */
  const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
  /** Two-Step-Delete: erster Klick setzt true, zweiter loescht tatsaechlich */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftListTick, setDraftListTick] = useState(0);
  const itemCatalogRef = useRef(itemCatalog);
  useEffect(() => {
    itemCatalogRef.current = itemCatalog;
  }, [itemCatalog]);

  /** Baum setzt createEntry / editEntry; Defaults: neue Quest = manuell, Bearbeiten = Formular */
  const onlyQuestmaker =
    RPG_QUESTMAKER_ENABLED &&
    ((mode === 'create' && resolvedCreateEntry === 'questmaker') ||
      (mode === 'edit' && (resolvedEditEntry ?? 'form') === 'ai'));

  // KI/Questmaker-Flow als Hook (State, Refs, Callbacks)
  const {
    qmPhase, setQmPhase,
    aiPrompt, setAiPrompt,
    aiLoading, setAiLoading,
    aiError, setAiError,
    clarifyHistoryPairs,
    clarifyPendingQs,
    clarifyAnswerBuf, setClarifyAnswerBuf,
    aiPackageDraft, setAiPackageDraft,
    aiPackageFocusQuestId, setAiPackageFocusQuestId,
    aiSeedRef, lastQmPromptRef, aiQuestmakerItemsRef,
    resetAiSession,
    applyGeneratedQuestPayload,
    handleAiGenerate, handleClarifySubmit, handleQmRegenerate,
  } = useEditorAiFlow({
    mode, graph, questId, editTargetNodeId, onlyQuestmaker,
    setId, setTitle, setDescription, setNodeDrafts, setRewardRows, setOrderInLayer,
    editQmBaselineRef,
  });
  /** Legacy: beide Modi im selben Dialog */
  const showCreateModeSwitch =
    RPG_QUESTMAKER_ENABLED && mode === 'create' && resolvedCreateEntry === undefined;

  useEffect(() => {
    if (!open) {
      aiSeedRef.current = '';
      lastQmPromptRef.current = '';
      aiQuestmakerItemsRef.current = [];
      setAiPackageDraft(null);
      setAiPackageFocusQuestId('');
      setSubmitError(null);
      return;
    }
    lastQmPromptRef.current = '';
    if (mode === 'edit' && questId) {
      aiQuestmakerItemsRef.current = [];
      const resolved = resolveEditTarget(graph, questId);
      if (!resolved) return;
      const containerQuest = graph.nodes.find((x) => x.id === resolved.containerQuestId);
      if (!containerQuest) return;
      setEditContainerQuestId(containerQuest.id);
      const target = resolved.targetNode;
      setId(target.id || '');
      setEditTargetNodeId(target.id || '');
      setTitle((target.title || '').trim());
      setDescription(target.description || '');
      const drafts = questNodesToDrafts(target.children || []);
      const expandedDrafts = expandDraftsToFocusedNode(drafts, focusNodeId);
      const rrows = questRewardRowsToDraftRows(getNodeRewardRows(containerQuest));
      hydrateItemFieldsFromCatalog(expandedDrafts, rrows, itemCatalogRef.current);
      setNodeDrafts(expandedDrafts);
      setRewardRows(rrows);
      setOrderInLayer(typeof containerQuest.orderInLayer === 'number' ? containerQuest.orderInLayer : 0);
      editQmBaselineRef.current = {
        nodeDrafts: expandedDrafts,
        title: (target.title || '').trim(),
        description: target.description || '',
        rewardRows: rrows.map((r) => ({ ...r })),
        orderInLayer: typeof containerQuest.orderInLayer === 'number' ? containerQuest.orderInLayer : 0,
      };
      resetAiSession();
      const storedQm = typeof containerQuest.questmakerPrompt === 'string' ? containerQuest.questmakerPrompt : '';
      setAiPrompt((resolvedEditEntry ?? 'form') === 'ai' ? storedQm : '');
      setCreateMode('manual');
      setAiLoading(false);
      setQmPhase((resolvedEditEntry ?? 'form') === 'ai' ? 'prompt' : 'result');
    } else {
      const ce = resolvedCreateEntry ?? 'manual';
      const canRestoreInProgress = mode === 'create' && ce !== 'questmaker';
      const inProgress = canRestoreInProgress ? loadManualQuestInProgressDraft() : null;
      if (inProgress?.payload) {
        const p = inProgress.payload;
        setId(typeof p.id === 'string' ? p.id : '');
        setTitle(typeof p.title === 'string' ? p.title : '');
        setDescription(typeof p.description === 'string' ? p.description : '');
        setNodeDrafts(
          Array.isArray(p.nodeDrafts)
            ? JSON.parse(JSON.stringify(p.nodeDrafts)).map((d) => ensureNodeDraftFields(d))
            : []
        );
        setRewardRows(
          Array.isArray(p.rewardRows)
            ? JSON.parse(JSON.stringify(p.rewardRows)).map((r) => ensureRewardRowFields(r))
            : []
        );
        setOrderInLayer(typeof p.orderInLayer === 'number' ? p.orderInLayer : 0);
      } else {
        setId('');
        setTitle('');
        setDescription('');
        setNodeDrafts([]);
        setRewardRows([]);
        setOrderInLayer(0);
      }
      editQmBaselineRef.current = null;
      setEditContainerQuestId('');
      setEditTargetNodeId('');
      setCreateMode(ce === 'questmaker' ? 'ai' : 'manual');
      setQmPhase(ce === 'questmaker' ? 'prompt' : 'result');
      setAiPrompt('');
      setAiError(null);
      setAiLoading(false);
      resetAiSession();
    }
  }, [open, mode, questId, focusNodeId, graph, resolvedCreateEntry, resolvedEditEntry]);

  useEffect(() => {
    if (open) setDraftListTick((t) => t + 1);
  }, [open]);

  const storedManualDrafts = useMemo(() => loadManualQuestDrafts(), [draftListTick, open]);

  const showManualCreateDrafts =
    mode === 'create' && (resolvedCreateEntry ?? 'manual') !== 'questmaker';

  const isManualCreateContext =
    mode === 'create' && (resolvedCreateEntry ?? 'manual') !== 'questmaker';

  const buildManualDraftPayload = () => ({
    id,
    title,
    description,
    nodeDrafts: JSON.parse(JSON.stringify(nodeDrafts)),
    rewardRows: JSON.parse(JSON.stringify(rewardRows)),
    orderInLayer: Number.isFinite(Number(orderInLayer)) ? Number(orderInLayer) : 0,
  });

  /**
   * @param {ReturnType<typeof buildManualDraftPayload>} payload
   */
  const manualDraftPayloadHasContent = (payload) => {
    if ((payload.id || '').trim().length > 0) return true;
    if ((payload.title || '').trim().length > 0) return true;
    if ((payload.description || '').trim().length > 0) return true;
    const o = Number(payload.orderInLayer);
    if (Number.isFinite(o) && o !== 0) return true;
    if ((payload.nodeDrafts || []).some((s) => isDraftNodeMeaningful(s))) return true;
    if (
      (payload.rewardRows || []).some((r) =>
        r.kind === 'item'
          ? (r.itemId || '').trim().length > 0
          : r.kind === 'points'
            ? (r.pointsAmount || '').trim().length > 0
            : (r.text || '').trim().length > 0
      )
    )
      return true;
    return false;
  };

  const manualAbortDraftHasContent = () => {
    return manualDraftPayloadHasContent(buildManualDraftPayload());
  };

  const manualDraftPayloadRef = useRef(/** @type {ReturnType<typeof buildManualDraftPayload> | null} */ (null));
  useEffect(() => {
    if (!open || !isManualCreateContext) {
      manualDraftPayloadRef.current = null;
      return;
    }
    manualDraftPayloadRef.current = buildManualDraftPayload();
  }, [
    open,
    isManualCreateContext,
    id,
    title,
    description,
    nodeDrafts,
    rewardRows,
    orderInLayer,
  ]);

  useEffect(() => {
    if (!open || !isManualCreateContext) return;
    const t = setTimeout(() => {
      const payload = manualDraftPayloadRef.current;
      if (!payload) return;
      if (manualDraftPayloadHasContent(payload)) saveManualQuestInProgressDraft(payload);
      else clearManualQuestInProgressDraft();
    }, 180);
    return () => clearTimeout(t);
  }, [
    open,
    isManualCreateContext,
    id,
    title,
    description,
    nodeDrafts,
    rewardRows,
    orderInLayer,
  ]);

  useEffect(() => {
    if (!open || !isManualCreateContext) return;
    const flush = () => {
      const payload = manualDraftPayloadRef.current;
      if (!payload) return;
      if (manualDraftPayloadHasContent(payload)) saveManualQuestInProgressDraft(payload);
      else clearManualQuestInProgressDraft();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', flush);
    };
  }, [open, isManualCreateContext]);

  const handleRequestClose = () => {
    const legacyManual =
      resolvedCreateEntry === undefined && createMode === 'manual';
    const explicitManual = resolvedCreateEntry === 'manual';
    if (
      mode === 'create' &&
      (resolvedCreateEntry ?? 'manual') !== 'questmaker' &&
      (explicitManual || legacyManual) &&
      manualAbortDraftHasContent()
    ) {
      addManualQuestDraft(buildManualDraftPayload());
      setDraftListTick((t) => t + 1);
      clearManualQuestInProgressDraft();
    }
    setDraftsOpen(false);
    onClose();
  };

  /**
   * @param {import('../lib/rpg-quest-manual-drafts.js').StoredManualQuestDraft} entry
   */
  const handleLoadManualDraft = (entry) => {
    const p = entry.payload;
    setId(typeof p.id === 'string' ? p.id : '');
    setTitle(typeof p.title === 'string' ? p.title : '');
    setDescription(typeof p.description === 'string' ? p.description : '');
    setNodeDrafts(
      Array.isArray(p.nodeDrafts)
        ? JSON.parse(JSON.stringify(p.nodeDrafts)).map((d) => ensureNodeDraftFields(d))
        : []
    );
    setRewardRows(
      Array.isArray(p.rewardRows)
        ? JSON.parse(JSON.stringify(p.rewardRows)).map((r) => ensureRewardRowFields(r))
        : []
    );
    setOrderInLayer(typeof p.orderInLayer === 'number' ? p.orderInLayer : 0);
    if (resolvedCreateEntry === undefined) setCreateMode('manual');
    setDraftsOpen(false);
  };

  /**
   * @param {string} key
   */
  const handleDeleteManualDraft = (key) => {
    removeManualQuestDraft(key);
    setDraftListTick((t) => t + 1);
  };

  if (!open) return null;

  const normalizedCreateId = useMemo(() => {
    if (mode !== 'create') return '';
    const baseId = normalizeQuestId(title) || normalizeQuestId(id);
    const existingIds = new Set(graph.nodes.map((q) => q.id));
    return makeUniqueQuestId(baseId, existingIds);
  }, [mode, title, id, graph.nodes]);

  const previewQuest = useMemo(() => {
    const nid =
      mode === 'edit' && questId
        ? editTargetNodeId || questId
        : normalizedCreateId || 'preview';
    const children = draftNodesToQuestNodes(nodeDrafts, nid);
    return {
      id: nid,
      title: title.trim() || nid,
      description: description.trim(),
      children,
      rewards: draftRewardRowsToStoredRewards(rewardRows),
    };
  }, [mode, questId, editTargetNodeId, normalizedCreateId, title, description, nodeDrafts, rewardRows]);

  const handleToggleTreePick = (parentDraftKey) => {
    if (!onToggleTreePick) return;
    const ROOT_PICK = '__root__';
    if (treePickParentKey === parentDraftKey) {
      const selectedIds = (treePickNodeIds || []).map((x) => String(x || '').trim()).filter(Boolean);
      const selectedDrafts = selectedIds
        .map((id) => graphNodeIdToDraft(graph, id))
        .filter(Boolean);
      if (selectedDrafts.length > 0) {
        if (parentDraftKey === ROOT_PICK) {
          setNodeDrafts((prev) => [...prev, ...selectedDrafts]);
        } else {
          setNodeDrafts((prev) =>
            prev.map((draft) =>
              draft.key === parentDraftKey
                ? {
                    ...draft,
                    children: [...(draft.children || []), ...selectedDrafts],
                    subnodesOn: true,
                    timeLimitOn: false,
                    timeDueAt: '',
                  }
                : draft
            )
          );
        }
      }
      onToggleTreePick(parentDraftKey);
      return;
    }
    onToggleTreePick(parentDraftKey);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitError(null);
    const nid = mode === 'create' ? normalizedCreateId : questId;
    if (
      mode === 'create' &&
      onlyQuestmaker &&
      qmPhase === 'result' &&
      aiPackageDraft &&
      Array.isArray(aiPackageDraft.nodes) &&
      aiPackageDraft.nodes.length > 0
    ) {
      const byId = new Map(graph.nodes.map((q) => [q.id, q]));
      const pkgQuests = aiPackageDraft.nodes.filter((q) => q && typeof q.id === 'string' && q.id.trim());
      for (const q of pkgQuests) {
        if (byId.has(q.id)) {
          setSubmitError(`Paket kann nicht gespeichert werden: Quest-ID „${q.id}” ist bereits vorhanden.`);
          return;
        }
      }
      const nextQuests = [...graph.nodes, ...pkgQuests];
      const existingEdgeKeys = new Set(
        (graph.edges || [])
          .filter((e) => (e.relation || 'dependency') === 'dependency')
          .map((e) => `${e.from}=>${e.to}`)
      );
      const pkgEdges = Array.isArray(aiPackageDraft.edges) ? aiPackageDraft.edges : [];
      const mergedEdges = [...(graph.edges || [])];
      for (const e of pkgEdges) {
        const from = String(e?.fromNodeId ?? e?.from ?? '').trim();
        const to = String(e?.toNodeId ?? e?.to ?? '').trim();
        if (!from || !to || from === to) continue;
        if (!pkgQuests.some((q) => q.id === from) || !pkgQuests.some((q) => q.id === to)) continue;
        const k = `${from}=>${to}`;
        if (existingEdgeKeys.has(k)) continue;
        existingEdgeKeys.add(k);
        mergedEdges.push({ from, to, relation: 'dependency' });
      }
      const nextGraph = { nodes: nextQuests, edges: mergedEdges };
      if (graphHasCycle(nextGraph)) {
        setSubmitError('Paket erzeugt einen Kreis in den Quest-Kanten. Bitte neu generieren.');
        return;
      }
      onApply(nextGraph);
      setDraftsOpen(false);
      onClose();
      return;
    }
    if (!nid) {
      setSubmitError('Bitte zuerst einen Titel eingeben (daraus wird die ID automatisch erzeugt).');
      return;
    }
    const children = draftNodesToQuestNodes(nodeDrafts, nid);
    const rewards = draftRewardRowsToStoredRewards(rewardRows);
    const qmSaved = lastQmPromptRef.current.trim();
    let next;
    if (mode === 'edit' && questId && editContainerQuestId && editContainerQuestId !== questId) {
      const container = graph.nodes.find((q) => q.id === editContainerQuestId);
      if (!container) {
        setSubmitError('Container-Node für diese Bearbeitung wurde nicht gefunden.');
        return;
      }
      const targetId = String(questId).trim();
      const effectiveTargetId = String(editTargetNodeId || targetId).trim();
      const updatedChildren = mapNodeRecursive(container.children || [], effectiveTargetId, (node) => ({
        ...node,
        label: title.trim() || effectiveTargetId,
        description: description.trim(),
        children: draftNodesToQuestNodes(nodeDrafts, effectiveTargetId),
      }));
      const updatedContainer = {
        ...container,
        children: updatedChildren,
        rewards,
        orderInLayer: Number.isFinite(Number(orderInLayer)) ? Number(orderInLayer) : 0,
        ...(qmSaved ? { questmakerPrompt: qmSaved } : {}),
      };
      next = upsertQuestInGraph(graph, updatedContainer, []);
    } else {
      const quest = {
        id: nid,
        parentId: null,
        title: title.trim() || nid,
        description: description.trim(),
        children,
        rewards,
        orderInLayer: Number.isFinite(Number(orderInLayer)) ? Number(orderInLayer) : 0,
        ...(qmSaved ? { questmakerPrompt: qmSaved } : {}),
      };
      next = upsertQuestInGraph(graph, quest, []);
    }
    const catalogIds = new Set(Object.keys(itemCatalog));
    /** @type {Map<string, { id: string; category: string; title: string; description: string }>} */
    const mergedMap = new Map();
    for (const x of aiQuestmakerItemsRef.current) {
      const n = normalizeQuestmakerCatalogPayloadItem(x);
      if (n) mergedMap.set(n.id, n);
    }
    for (const x of collectQuestmakerItemsFromDrafts(nodeDrafts, rewardRows, catalogIds)) {
      mergedMap.set(x.id, x);
    }
    const needed = collectAllItemIdsFromGraph(next);
    for (const id of needed) {
      if (!catalogIds.has(id) && !mergedMap.has(id)) {
        setSubmitError(
          `Für die Item-ID „${id}” fehlt eine vollständige Katalog-Definition (Kategorie, Anzeigename/Titel, Kurzbeschreibung). Bitte im Editor ausfüllen oder die KI erneut mit gültigen questmakerItems nutzen.`
        );
        return;
      }
    }
    const toSend = [...mergedMap.values()].filter((row) => needed.has(row.id));
    aiQuestmakerItemsRef.current = [];
    onApply(next, toSend.length ? { questmakerItems: toSend } : undefined);
    clearManualQuestInProgressDraft();
    setDraftsOpen(false);
    onClose();
  };

  const handleDelete = () => {
    if (mode !== 'edit' || !questId) return;
    // Two-Step: erster Klick zeigt Warnung, zweiter loescht
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    setSubmitError(null);
    if (editContainerQuestId && editContainerQuestId !== questId) {
      const container = graph.nodes.find((q) => q.id === editContainerQuestId);
      if (!container) {
        setSubmitError('Container-Node für diese Bearbeitung wurde nicht gefunden.');
        return;
      }
      const out = removeNodeRecursive(container.children || [], String(editTargetNodeId || questId).trim());
      if (!out.removed) {
        setSubmitError('Die ausgewählte Child-Node wurde nicht gefunden.');
        return;
      }
      const removedIdSet = new Set(out.removedIds.map((id) => String(id || '').trim()).filter(Boolean));
      const cleanedChildren =
        removedIdSet.size > 0 ? stripDependsOnReferences(out.nodes, removedIdSet) : out.nodes;
      onApply(
        upsertQuestInGraph(
          graph,
          {
            ...container,
            children: cleanedChildren,
          },
          []
        )
      );
      setDraftsOpen(false);
      onClose();
      return;
    }
    onApply(removeQuestFromGraph(graph, questId));
    setDraftsOpen(false);
    onClose();
  };

  const showQmPrompt = onlyQuestmaker && qmPhase === 'prompt';
  const showQmResult = onlyQuestmaker && qmPhase === 'result';
  const showManualFullForm =
    (mode === 'create' && (resolvedCreateEntry ?? 'manual') !== 'questmaker') ||
    (mode === 'edit' && (resolvedEditEntry ?? 'form') === 'form');

  const noopToggle = () => {};

  const dialogTitle = (() => {
    if (onlyQuestmaker && qmPhase === 'prompt') return 'Questmaker';
    if (onlyQuestmaker && qmPhase === 'result') return mode === 'create' ? 'Quest übernehmen' : 'Quest speichern';
    return mode === 'create' ? 'Neue Quest' : 'Quest bearbeiten';
  })();

  const aiBlock = (
    <div class="rpg-graph-editor__ai-block">
      <label class="rpg-graph-editor__field">
        <span class="rpg-graph-editor__label">Worum soll die Quest gehen?</span>
        <textarea
          class="rpg-graph-editor__textarea"
          rows={5}
          value={aiPrompt}
          placeholder="Echtes Leben: Ziel, Rahmen, Orte, Daten — je konkreter, desto besser. Die KI kann Rückfragen stellen, wenn etwas Wesentliches fehlt."
          onInput={(ev) => setAiPrompt(ev.currentTarget.value)}
          disabled={aiLoading}
        />
      </label>
      {clarifyPendingQs && clarifyPendingQs.length > 0 ? (
        <div class="rpg-graph-editor__clarify">
          <p class="rpg-graph-editor__label">Rückfragen — bitte kurz beantworten:</p>
          <ul class="rpg-graph-editor__clarify-list">
            {clarifyPendingQs.map((q, i) => (
              <li key={`cl-${i}`}>
                <p class="rpg-graph-editor__clarify-q">{q}</p>
                <input
                  type="text"
                  class="rpg-graph-editor__input"
                  value={clarifyAnswerBuf[i] || ''}
                  onInput={(ev) => {
                    const next = [...clarifyAnswerBuf];
                    next[i] = ev.currentTarget.value;
                    setClarifyAnswerBuf(next);
                  }}
                  disabled={aiLoading}
                />
              </li>
            ))}
          </ul>
          <div class="rpg-graph-editor__ai-actions">
            <button
              type="button"
              class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
              onClick={() => void handleClarifySubmit()}
              disabled={aiLoading}
            >
              {aiLoading ? 'Sendet …' : 'Antworten senden & weiter'}
            </button>
          </div>
        </div>
      ) : (
        <div class="rpg-graph-editor__ai-actions">
          <button
            type="button"
            class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
            onClick={() => void handleAiGenerate()}
            disabled={aiLoading}
          >
            {aiLoading ? 'Generiert …' : clarifyHistoryPairs.length ? 'Erneut anfragen' : 'Generieren'}
          </button>
        </div>
      )}
      {aiError && (
        <p class="rpg-graph-editor__warning" role="alert">
          {aiError}
        </p>
      )}
      <p class="rpg-graph-editor__hint">
        {onlyQuestmaker
          ? 'Alltag und echte Entscheidungen — keine Fantasy-Welt. Nach „Generieren“ siehst du die Quest und kannst sie speichern.'
          : 'Es geht um Alltag und echte Entscheidungen — keine Fantasy-Welt. Nach der Generierung kannst du alles im Editor anpassen.'}
      </p>
    </div>
  );

  const editorContent = (
    <div
      class={`rpg-graph-editor rpg-graph-editor--wide${
        embedded ? ' rpg-graph-editor--embedded' : ''
      }${onlyQuestmaker ? ' rpg-graph-editor--questmaker' : ''}${showQmPrompt ? ' rpg-graph-editor--qm-prompt' : ''}`}
    >
      <div
        class="rpg-graph-editor__head"
      >
        
          <h2 id="rpg-graph-editor-title" class="rpg-graph-editor__title">
            {dialogTitle}
          </h2>
          <div class="rpg-graph-editor__head-right">
            {showManualCreateDrafts ? (
              <div class="rpg-graph-editor__drafts-wrap">
                <button
                  type="button"
                  class="rpg-graph-editor__drafts-btn"
                  onClick={() => setDraftsOpen((o) => !o)}
                  aria-expanded={draftsOpen}
                  aria-controls="rpg-graph-editor-drafts-panel"
                >
                  drafts
                  {storedManualDrafts.length > 0 ? ` (${storedManualDrafts.length})` : ''}
                </button>
                {draftsOpen ? (
                  <div
                    id="rpg-graph-editor-drafts-panel"
                    class="rpg-graph-editor__drafts-panel"
                    role="listbox"
                    aria-label="Gespeicherte Entwürfe"
                  >
                    {storedManualDrafts.length === 0 ? (
                      <p class="rpg-graph-editor__drafts-empty">Noch keine Entwürfe.</p>
                    ) : (
                      <ul class="rpg-graph-editor__drafts-list">
                        {storedManualDrafts.map((d) => {
                          const label =
                            (d.payload.title || '').trim() ||
                            (d.payload.id || '').trim() ||
                            'Ohne Titel';
                          let when = '';
                          try {
                            when = new Date(d.savedAt).toLocaleString('de-DE', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            });
                          } catch {
                            when = '';
                          }
                          return (
                            <li key={d.key} class="rpg-graph-editor__drafts-item">
                              <div class="rpg-graph-editor__drafts-meta">
                                <span class="rpg-graph-editor__drafts-label">{label}</span>
                                {when ? (
                                  <span class="rpg-graph-editor__drafts-when">{when}</span>
                                ) : null}
                              </div>
                              <div class="rpg-graph-editor__drafts-actions">
                                <button
                                  type="button"
                                  class="rpg-graph-editor__btn rpg-graph-editor__btn--primary rpg-graph-editor__btn--tiny"
                                  onClick={() => handleLoadManualDraft(d)}
                                >
                                  Laden
                                </button>
                                <button
                                  type="button"
                                  class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost rpg-graph-editor__btn--tiny"
                                  onClick={() => handleDeleteManualDraft(d.key)}
                                >
                                  Löschen
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button type="button" class="rpg-graph-editor__close" onClick={handleRequestClose} aria-label="Schließen">
              ×
            </button>
          </div>
      </div>

        {showQmPrompt ? <div class="rpg-graph-editor__form rpg-graph-editor__qm-only">{aiBlock}</div> : null}

        {showQmResult ? (
          <form class="rpg-graph-editor__form rpg-graph-editor__qm-result" onSubmit={handleSubmit}>
            <div class="rpg-graph-editor__qm-preview">
              {aiPackageDraft && aiPackageDraft.nodes.length > 0 ? (
                <div class="rpg-graph-editor__qm-package-review">
                  <p class="rpg-graph-editor__label">Paket-Review (Unterabschnitt)</p>
                  {aiPackageDraft.title ? (
                    <p class="rpg-graph-editor__hint">{aiPackageDraft.title}</p>
                  ) : null}
                  <div class="rpg-graph-editor__qm-package-list">
                    {aiPackageDraft.nodes.map((q, i) => {
                      const qid = String(q.id || '');
                      const active = qid === aiPackageFocusQuestId;
                      return (
                        <button
                          key={`pkg-${qid || i}`}
                          type="button"
                          class={`rpg-graph-editor__btn rpg-graph-editor__btn--tiny${
                            active ? ' rpg-graph-editor__btn--primary' : ' rpg-graph-editor__btn--ghost'
                          }`}
                          onClick={() => {
                            setAiPackageFocusQuestId(qid);
                            applyGeneratedQuestPayload(q);
                          }}
                        >
                          {q.title || qid || 'Quest'}
                        </button>
                      );
                    })}
                  </div>
                  <p class="rpg-graph-editor__hint">
                    Speichern übernimmt das komplette Paket ({aiPackageDraft.nodes.length} Quests).
                  </p>
                </div>
              ) : null}
              <h3 class="rpg-graph-editor__qm-title">{title.trim() || '(ohne Titel)'}</h3>
              {description.trim() ? <p class="rpg-graph-editor__qm-desc">{description}</p> : null}
              <p class="rpg-graph-editor__label">Nodes & Rewards</p>
              <RpgQuestNodesView
                node={previewQuest}
                nodeDone={{}}
                onToggleNode={noopToggle}
                interactive={false}
                childrenClass="rpg-graph-editor__qm-nodes"
                rewardsClass="rpg-graph-editor__qm-rewards"
                graph={null}
                itemCatalog={itemCatalog}
              />
            </div>

            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Reihenfolge in der Ebene (kleiner = weiter links)</span>
              <input
                class="rpg-graph-editor__input"
                type="number"
                node={1}
                value={orderInLayer}
                onInput={(ev) => setOrderInLayer(Number(ev.currentTarget.value))}
              />
            </label>

            {submitError && (
              <p class="rpg-graph-editor__warning" role="alert">{submitError}</p>
            )}
            <div class="rpg-graph-editor__actions">
              <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={handleQmRegenerate}>
                Neu generieren
              </button>
              {mode === 'edit' ? (
                confirmingDelete ? (
                  <>
                    <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--danger" onClick={handleDelete}>
                      Endgültig löschen
                    </button>
                    <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={() => setConfirmingDelete(false)}>
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--danger" onClick={handleDelete}>
                    Löschen
                  </button>
                )
              ) : null}
              <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={handleRequestClose}>
                Abbrechen
              </button>
              <button
                type="submit"
                class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
                disabled={aiLoading}
              >
                Speichern
              </button>
            </div>
          </form>
        ) : null}

        {showManualFullForm ? (
          <form class="rpg-graph-editor__form" onSubmit={handleSubmit}>
            {showCreateModeSwitch ? (
              <>
                <div class="rpg-graph-editor__mode" role="radiogroup" aria-label="Art der Quest-Erstellung">
                  <button
                    type="button"
                    class={`rpg-graph-editor__mode-btn${createMode === 'manual' ? ' rpg-graph-editor__mode-btn--active' : ''}`}
                    aria-pressed={createMode === 'manual'}
                    onClick={() => {
                      setCreateMode('manual');
                      setAiError(null);
                    }}
                  >
                    manuell+
                  </button>
                  <button
                    type="button"
                    class={`rpg-graph-editor__mode-btn${createMode === 'ai' ? ' rpg-graph-editor__mode-btn--active' : ''}`}
                    aria-pressed={createMode === 'ai'}
                    onClick={() => {
                      setCreateMode('ai');
                      setAiError(null);
                    }}
                  >
                    questmaker+
                  </button>
                </div>
                {createMode === 'ai' ? aiBlock : null}
              </>
            ) : null}
            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Titel</span>
              <input
                class="rpg-graph-editor__input"
                value={title}
                onInput={(ev) => setTitle(ev.currentTarget.value)}
                required={mode === 'create'}
              />
            </label>
            {mode === 'create' ? (
              <div class="rpg-graph-editor__field">
                <span class="rpg-graph-editor__label">ID (automatisch, eindeutig)</span>
                <code class="rpg-graph-editor__code">
                  {normalizedCreateId || '(wird nach Eingabe des Titels erzeugt)'}
                </code>
              </div>
            ) : null}
            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Beschreibung</span>
              <textarea class="rpg-graph-editor__textarea" rows={3} value={description} onInput={(ev) => setDescription(ev.currentTarget.value)} />
            </label>

            <RpgQuestNodesBuilder
              nodes={nodeDrafts}
              onNodesChange={setNodeDrafts}
              treePickParentKey={treePickParentKey}
              onToggleTreePick={onToggleTreePick ? handleToggleTreePick : undefined}
            />
            <RpgQuestRewardsBuilder rows={rewardRows} onRowsChange={setRewardRows} />

            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Reihenfolge in der Ebene (kleiner = weiter links)</span>
              <input
                class="rpg-graph-editor__input"
                type="number"
                node={1}
                value={orderInLayer}
                onInput={(ev) => setOrderInLayer(Number(ev.currentTarget.value))}
              />
            </label>
            {submitError && (
              <p class="rpg-graph-editor__warning" role="alert">{submitError}</p>
            )}
            <div class="rpg-graph-editor__actions">
              {mode === 'edit' && (
                confirmingDelete ? (
                  <>
                    <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--danger" onClick={handleDelete}>
                      Endgültig löschen
                    </button>
                    <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={() => setConfirmingDelete(false)}>
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--danger" onClick={handleDelete}>
                    Löschen
                  </button>
                )
              )}
              <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={handleRequestClose}>
                Abbrechen
              </button>
              <button
                type="submit"
                class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
                disabled={mode === 'create' && aiLoading}
              >
                Speichern
              </button>
            </div>
          </form>
        ) : null}
    </div>
  );

  if (embedded) return editorContent;

  return (
    <div class="rpg-graph-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="rpg-graph-editor-title">
      {editorContent}
    </div>
  );
}
