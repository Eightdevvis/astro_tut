import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import {
  upsertQuestInGraph,
  removeQuestFromGraph,
  graphHasCycle,
} from '../lib/rpg-quest-graph.js';
import { getQuestRewardRows, normalizeQuestRewardRows } from '../lib/rpg-quest-steps.js';
import {
  questStepsToDrafts,
  draftStepsToQuestNodes,
  aiLabelsToDraftSteps,
  aiQuestNodesToDraftSteps,
  questRewardRowsToDraftRows,
  draftRewardRowsToStoredQuestRewards,
  isDraftStepMeaningful,
  ensureStepDraftFields,
  ensureRewardRowFields,
  collectQuestmakerItemsFromDrafts,
  hydrateItemFieldsFromCatalog,
} from '../lib/rpg-quest-editor-draft.js';
import {
  collectAllItemIdsFromGraph,
  normalizeQuestmakerCatalogPayloadItem,
} from '../lib/rpg-questmaker-sync.js';
import {
  addManualQuestDraft,
  removeManualQuestDraft,
  loadManualQuestDrafts,
} from '../lib/rpg-quest-manual-drafts.js';
import { RpgQuestStepsBuilder, RpgQuestRewardsBuilder } from './RpgQuestStepsBuilder.jsx';
import RpgQuestStepsView from './RpgQuestStepsView.jsx';
import { normalizeQuestId } from '../lib/rpg-quest-form-helpers.js';

export { normalizeQuestId } from '../lib/rpg-quest-form-helpers.js';

/**
 * @param {{
 *   open: boolean;
 *   mode: 'create' | 'edit';
 *   graph: import('../lib/rpg-quest-graph.js').RpgGraph;
 *   questId: string | null;
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
  onClose,
  onApply,
  createEntry,
  editEntry,
  itemCatalog = {},
}) {
  const [id, setId] = useState('');
  const [kind, setKind] = useState(/** @type {'main' | 'side'} */ ('side'));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  /** @type {import('../lib/rpg-quest-editor-draft.js').QuestStepDraft[]} */
  const [stepDrafts, setStepDrafts] = useState([]);
  /** @type {import('../lib/rpg-quest-editor-draft.js').QuestRewardDraftRow[]} */
  const [rewardRows, setRewardRows] = useState([]);
  const [orderInLayer, setOrderInLayer] = useState(0);
  const [prereqIds, setPrereqIds] = useState(() => new Set());
  /** Nur wenn kein createEntry gesetzt (Fallback) */
  const [createMode, setCreateMode] = useState(/** @type {'manual' | 'ai'} */ ('manual'));
  /** @type {'prompt' | 'result'} */
  const [qmPhase, setQmPhase] = useState('prompt');
  const editQmBaselineRef = useRef(
    /** @type {{
     *   stepDrafts: import('../lib/rpg-quest-editor-draft.js').QuestStepDraft[];
     *   title: string;
     *   description: string;
     *   kind: 'main' | 'side';
     *   rewardRows: import('../lib/rpg-quest-editor-draft.js').QuestRewardDraftRow[];
     *   orderInLayer: number;
     * } | null} */ (null)
  );
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(/** @type {string | null} */ (null));
  const aiSeedRef = useRef('');
  /** @type {{ question: string; answer: string }[]} */
  const [clarifyHistoryPairs, setClarifyHistoryPairs] = useState([]);
  /** @type {string[] | null} */
  const [clarifyPendingQs, setClarifyPendingQs] = useState(null);
  const [clarifyAnswerBuf, setClarifyAnswerBuf] = useState(/** @type {string[]} */ ([]));
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftListTick, setDraftListTick] = useState(0);
  const itemCatalogRef = useRef(itemCatalog);
  useEffect(() => {
    itemCatalogRef.current = itemCatalog;
  }, [itemCatalog]);
  /** KI-generierte Katalog-Zeilen für neue Item-IDs (Merge mit manuellen Entwürfen beim Speichern). */
  const aiQuestmakerItemsRef = useRef(
    /** @type {{ id: string; category: string; title: string; description: string }[]} */ ([])
  );

  const resetAiSession = () => {
    aiSeedRef.current = '';
    setClarifyHistoryPairs([]);
    setClarifyPendingQs(null);
    setClarifyAnswerBuf([]);
    setAiError(null);
  };

  /** Baum setzt createEntry / editEntry; Defaults: neue Quest = manuell, Bearbeiten = Formular */
  const onlyQuestmaker =
    (mode === 'create' && createEntry === 'questmaker') ||
    (mode === 'edit' && (editEntry ?? 'form') === 'ai');
  /** Legacy: beide Modi im selben Dialog */
  const showCreateModeSwitch = mode === 'create' && createEntry === undefined;

  useEffect(() => {
    if (!open) {
      aiSeedRef.current = '';
      aiQuestmakerItemsRef.current = [];
      return;
    }
    if (mode === 'edit' && questId) {
      aiQuestmakerItemsRef.current = [];
      const q = graph.quests.find((x) => x.id === questId);
      if (!q) return;
      setId(q.id);
      setKind(q.kind === 'main' ? 'main' : 'side');
      setTitle(q.title || '');
      setDescription(q.description || '');
      const drafts = questStepsToDrafts(q.steps || []);
      const rrows = questRewardRowsToDraftRows(getQuestRewardRows(q));
      hydrateItemFieldsFromCatalog(drafts, rrows, itemCatalogRef.current);
      setStepDrafts(drafts);
      setRewardRows(rrows);
      setOrderInLayer(typeof q.orderInLayer === 'number' ? q.orderInLayer : 0);
      const preds = new Set();
      for (const e of graph.edges || []) {
        if (e.to === questId) preds.add(e.from);
      }
      setPrereqIds(preds);
      editQmBaselineRef.current = {
        stepDrafts: drafts,
        title: q.title || '',
        description: q.description || '',
        kind: q.kind === 'main' ? 'main' : 'side',
        rewardRows: rrows.map((r) => ({ ...r })),
        orderInLayer: typeof q.orderInLayer === 'number' ? q.orderInLayer : 0,
      };
      resetAiSession();
      setAiPrompt('');
      setCreateMode('manual');
      setAiLoading(false);
      setQmPhase((editEntry ?? 'form') === 'ai' ? 'prompt' : 'result');
    } else {
      setId('');
      setKind('side');
      setTitle('');
      setDescription('');
      setStepDrafts([]);
      setRewardRows([]);
      setOrderInLayer(0);
      setPrereqIds(new Set());
      editQmBaselineRef.current = null;
      const ce = createEntry ?? 'manual';
      setCreateMode(ce === 'questmaker' ? 'ai' : 'manual');
      setQmPhase(ce === 'questmaker' ? 'prompt' : 'result');
      setAiPrompt('');
      setAiError(null);
      setAiLoading(false);
      resetAiSession();
    }
  }, [open, mode, questId, graph, createEntry, editEntry]);

  useEffect(() => {
    if (open) setDraftListTick((t) => t + 1);
  }, [open]);

  const storedManualDrafts = useMemo(() => loadManualQuestDrafts(), [draftListTick, open]);

  const showManualCreateDrafts =
    mode === 'create' && (createEntry ?? 'manual') !== 'questmaker';

  const manualAbortDraftHasContent = () => {
    if ((id || '').trim().length > 0) return true;
    if ((title || '').trim().length > 0) return true;
    if ((description || '').trim().length > 0) return true;
    if (prereqIds.size > 0) return true;
    const o = Number(orderInLayer);
    if (Number.isFinite(o) && o !== 0) return true;
    if (stepDrafts.some((s) => isDraftStepMeaningful(s))) return true;
    if (
      rewardRows.some((r) =>
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

  const handleRequestClose = () => {
    const legacyManual =
      createEntry === undefined && createMode === 'manual';
    const explicitManual = createEntry === 'manual';
    if (
      mode === 'create' &&
      (createEntry ?? 'manual') !== 'questmaker' &&
      (explicitManual || legacyManual) &&
      manualAbortDraftHasContent()
    ) {
      addManualQuestDraft({
        id,
        kind,
        title,
        description,
        stepDrafts: JSON.parse(JSON.stringify(stepDrafts)),
        rewardRows: JSON.parse(JSON.stringify(rewardRows)),
        orderInLayer: Number.isFinite(Number(orderInLayer)) ? Number(orderInLayer) : 0,
        prereqIds: [...prereqIds],
      });
      setDraftListTick((t) => t + 1);
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
    setKind(p.kind === 'main' ? 'main' : 'side');
    setTitle(typeof p.title === 'string' ? p.title : '');
    setDescription(typeof p.description === 'string' ? p.description : '');
    setStepDrafts(
      Array.isArray(p.stepDrafts)
        ? JSON.parse(JSON.stringify(p.stepDrafts)).map((d) => ensureStepDraftFields(d))
        : []
    );
    setRewardRows(
      Array.isArray(p.rewardRows)
        ? JSON.parse(JSON.stringify(p.rewardRows)).map((r) => ensureRewardRowFields(r))
        : []
    );
    setOrderInLayer(typeof p.orderInLayer === 'number' ? p.orderInLayer : 0);
    setPrereqIds(new Set(Array.isArray(p.prereqIds) ? p.prereqIds.map(String) : []));
    if (createEntry === undefined) setCreateMode('manual');
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

  const normalizedCreateId = mode === 'create' ? normalizeQuestId(id) : '';
  const duplicateQuestId =
    mode === 'create' &&
    normalizedCreateId.length > 0 &&
    graph.quests.some((q) => q.id === normalizedCreateId);

  const otherQuests = graph.quests.filter((q) => (mode === 'edit' ? q.id !== questId : true));

  const previewQuest = useMemo(() => {
    const steps = draftStepsToQuestNodes(stepDrafts);
    const nid =
      mode === 'edit' && questId
        ? questId
        : normalizedCreateId || 'preview';
    return {
      id: nid,
      kind,
      title: title.trim() || nid,
      description: description.trim(),
      steps,
      questRewards: draftRewardRowsToStoredQuestRewards(rewardRows),
    };
  }, [mode, questId, normalizedCreateId, kind, title, description, stepDrafts, rewardRows]);

  const togglePrereq = (pid) => {
    setPrereqIds((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const nid = mode === 'create' ? normalizeQuestId(id) : questId;
    if (!nid) {
      window.alert('Bitte eine gültige ID angeben (Buchstaben, Zahlen, Bindestrich).');
      return;
    }
    if (mode === 'create' && graph.quests.some((q) => q.id === nid)) {
      return;
    }
    const steps = draftStepsToQuestNodes(stepDrafts);
    if (steps.length === 0) {
      window.alert('Bitte mindestens einen Schritt anlegen und speichern.');
      return;
    }
    const questRewards = draftRewardRowsToStoredQuestRewards(rewardRows);
    const quest = {
      id: nid,
      kind,
      title: title.trim() || nid,
      description: description.trim(),
      steps,
      questRewards,
      orderInLayer: Number.isFinite(Number(orderInLayer)) ? Number(orderInLayer) : 0,
    };
    const next = upsertQuestInGraph(graph, quest, [...prereqIds]);
    if (graphHasCycle(next)) {
      window.alert('Diese Vorgänger würden einen Kreis erzeugen — bitte anpassen.');
      return;
    }
    const catalogIds = new Set(Object.keys(itemCatalog));
    /** @type {Map<string, { id: string; category: string; title: string; description: string }>} */
    const mergedMap = new Map();
    for (const x of aiQuestmakerItemsRef.current) {
      const n = normalizeQuestmakerCatalogPayloadItem(x);
      if (n) mergedMap.set(n.id, n);
    }
    for (const x of collectQuestmakerItemsFromDrafts(stepDrafts, rewardRows, catalogIds)) {
      mergedMap.set(x.id, x);
    }
    const needed = collectAllItemIdsFromGraph(next);
    for (const id of needed) {
      if (!catalogIds.has(id) && !mergedMap.has(id)) {
        window.alert(
          `Für die Item-ID „${id}“ fehlt eine vollständige Katalog-Definition (Kategorie, Anzeigename/Titel, Kurzbeschreibung). Bitte im Editor ausfüllen oder die KI erneut mit gültigen questmakerItems nutzen.`
        );
        return;
      }
    }
    const toSend = [...mergedMap.values()].filter((row) => needed.has(row.id));
    aiQuestmakerItemsRef.current = [];
    onApply(next, toSend.length ? { questmakerItems: toSend } : undefined);
    setDraftsOpen(false);
    onClose();
  };

  const handleDelete = () => {
    if (mode !== 'edit' || !questId) return;
    if (!window.confirm('Quest wirklich löschen? Alle Kanten zu dieser Quest entfallen.')) return;
    onApply(removeQuestFromGraph(graph, questId));
    setDraftsOpen(false);
    onClose();
  };

  /**
   * @param {Record<string, unknown>} data
   */
  const applyGeneratedQuestPayload = (data) => {
    if (mode === 'create') {
      setId(typeof data.id === 'string' ? data.id : '');
    }
    setKind(data.kind === 'main' ? 'main' : 'side');
    setTitle(typeof data.title === 'string' ? data.title : '');
    setDescription(typeof data.description === 'string' ? data.description : '');
    if (Array.isArray(data.steps) && data.steps.length > 0) {
      setStepDrafts(aiQuestNodesToDraftSteps(/** @type {any} */ (data.steps)));
    } else {
      const labels = Array.isArray(data.stepLabels) ? data.stepLabels : [];
      setStepDrafts(labels.length ? aiLabelsToDraftSteps(labels.map((x) => String(x))) : []);
    }
    const rewardLines = Array.isArray(data.rewards) ? data.rewards.map((x) => String(x).trim()).filter(Boolean) : [];
    const qRows =
      Array.isArray(data.questRewards) && data.questRewards.length > 0
        ? normalizeQuestRewardRows(data.questRewards)
        : rewardLines.map((text) => ({ entry: { type: 'text', text } }));
    setRewardRows(questRewardRowsToDraftRows(qRows));
    const rawQm = Array.isArray(data.questmakerItems) ? data.questmakerItems : [];
    aiQuestmakerItemsRef.current = rawQm
      .map((x) => normalizeQuestmakerCatalogPayloadItem(x))
      .filter(Boolean);
  };

  /**
   * @param {{ question: string; answer: string }[]} [pairsForRequest]
   */
  const handleAiGenerate = async (pairsForRequest) => {
    const typed = aiPrompt.trim();
    if (!typed.length) {
      setAiError('Bitte eine Beschreibung eingeben.');
      return;
    }
    if (!aiSeedRef.current) aiSeedRef.current = typed;
    setAiError(null);
    setAiLoading(true);
    try {
      /** @type {{ question: string; answer: string }[]} */
      const pairs = pairsForRequest ?? clarifyHistoryPairs;
      const res = await fetch('/api/rpg/quests-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          prompt: aiSeedRef.current,
          existingQuestIds: graph.quests.map((q) => q.id),
          lockedQuestId: mode === 'edit' && questId ? questId : undefined,
          clarification: pairs.length > 0 ? { pairs } : undefined,
        }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        let msg =
          typeof data.error === 'string'
            ? data.error
            : `Generierung fehlgeschlagen (${res.status})`;
        if (typeof data.detail === 'string' && data.detail.trim()) {
          msg += `: ${data.detail.trim().slice(0, 400)}`;
        }
        setAiError(msg);
        return;
      }
      if (data.responseType === 'clarify' && Array.isArray(data.questions) && data.questions.length > 0) {
        setClarifyPendingQs(data.questions.map((x) => String(x)));
        setClarifyAnswerBuf(data.questions.map(() => ''));
        return;
      }
      resetAiSession();
      applyGeneratedQuestPayload(data);
      if (onlyQuestmaker) setQmPhase('result');
    } catch {
      setAiError('Netzwerkfehler');
    } finally {
      setAiLoading(false);
    }
  };

  const handleClarifySubmit = async () => {
    if (!clarifyPendingQs || clarifyPendingQs.length === 0) return;
    const merged = [...clarifyHistoryPairs];
    for (let i = 0; i < clarifyPendingQs.length; i++) {
      merged.push({
        question: clarifyPendingQs[i],
        answer: (clarifyAnswerBuf[i] || '').trim(),
      });
    }
    setClarifyHistoryPairs(merged);
    setClarifyPendingQs(null);
    setClarifyAnswerBuf([]);
    await handleAiGenerate(merged);
  };

  const handleQmRegenerate = () => {
    setQmPhase('prompt');
    resetAiSession();
    setAiPrompt('');
    if (mode === 'edit' && editQmBaselineRef.current) {
      const b = editQmBaselineRef.current;
      setStepDrafts(b.stepDrafts);
      setTitle(b.title);
      setDescription(b.description);
      setKind(b.kind);
      setRewardRows(b.rewardRows);
      setOrderInLayer(b.orderInLayer);
    } else {
      setStepDrafts([]);
      setTitle('');
      setDescription('');
      setId('');
      setKind('side');
      setRewardRows([]);
    }
  };

  const showQmPrompt = onlyQuestmaker && qmPhase === 'prompt';
  const showQmResult = onlyQuestmaker && qmPhase === 'result';
  const showManualFullForm =
    (mode === 'create' && (createEntry ?? 'manual') !== 'questmaker') ||
    (mode === 'edit' && (editEntry ?? 'form') === 'form');

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

  return (
    <div class="rpg-graph-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="rpg-graph-editor-title">
      <div
        class={`rpg-graph-editor rpg-graph-editor--wide${
          onlyQuestmaker ? ' rpg-graph-editor--questmaker' : ''
        }${showQmPrompt ? ' rpg-graph-editor--qm-prompt' : ''}`}
      >
        <div class="rpg-graph-editor__head">
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
              <p class="rpg-graph-editor__qm-kind">
                {kind === 'main' ? 'Main (Sechseck)' : 'Side (Kreis)'}
              </p>
              <h3 class="rpg-graph-editor__qm-title">{title.trim() || '(ohne Titel)'}</h3>
              {description.trim() ? <p class="rpg-graph-editor__qm-desc">{description}</p> : null}
              <p class="rpg-graph-editor__label">Schritte & Rewards</p>
              <RpgQuestStepsView
                quest={previewQuest}
                stepDone={{}}
                onToggleStep={noopToggle}
                interactive={false}
                stepsClass="rpg-graph-editor__qm-steps"
                rewardsClass="rpg-graph-editor__qm-rewards"
                graph={null}
                itemCatalog={itemCatalog}
              />
            </div>

            {mode === 'create' ? (
              <label class="rpg-graph-editor__field">
                <span class="rpg-graph-editor__label">ID (Kurzname)</span>
                <input
                  class={`rpg-graph-editor__input${duplicateQuestId ? ' rpg-graph-editor__input--invalid' : ''}`}
                  value={id}
                  onInput={(ev) => setId(ev.currentTarget.value)}
                  required
                  placeholder="z. B. meine-nebenquest"
                  aria-invalid={duplicateQuestId ? 'true' : undefined}
                />
                {duplicateQuestId && (
                  <p class="rpg-graph-editor__warning" role="alert">
                    Diese ID ist bereits vergeben.
                  </p>
                )}
              </label>
            ) : null}

            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Reihenfolge in der Ebene (kleiner = weiter links)</span>
              <input
                class="rpg-graph-editor__input"
                type="number"
                step={1}
                value={orderInLayer}
                onInput={(ev) => setOrderInLayer(Number(ev.currentTarget.value))}
              />
            </label>
            <fieldset class="rpg-graph-editor__fieldset">
              <legend class="rpg-graph-editor__legend">Vorgänger-Quests (müssen fertig sein)</legend>
              {otherQuests.length === 0 ? (
                <p class="rpg-graph-editor__hint">Noch keine anderen Quests im Graph.</p>
              ) : (
                <ul class="rpg-graph-editor__checks">
                  {otherQuests.map((q) => (
                    <li key={q.id}>
                      <label class="rpg-graph-editor__check">
                        <input type="checkbox" checked={prereqIds.has(q.id)} onChange={() => togglePrereq(q.id)} />
                        <span>
                          {q.title} <code class="rpg-graph-editor__code">{q.id}</code>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            <div class="rpg-graph-editor__actions">
              <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={handleQmRegenerate}>
                Neu generieren
              </button>
              {mode === 'edit' ? (
                <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--danger" onClick={handleDelete}>
                  Löschen
                </button>
              ) : null}
              <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={handleRequestClose}>
                Abbrechen
              </button>
              <button
                type="submit"
                class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
                disabled={duplicateQuestId || aiLoading}
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
              <span class="rpg-graph-editor__label">ID (Kurzname)</span>
              <input
                class={`rpg-graph-editor__input${duplicateQuestId ? ' rpg-graph-editor__input--invalid' : ''}`}
                value={id}
                onInput={(ev) => setId(ev.currentTarget.value)}
                disabled={mode === 'edit'}
                required={mode === 'create'}
                placeholder="z. B. meine-nebenquest"
                aria-invalid={duplicateQuestId ? 'true' : undefined}
                aria-describedby={duplicateQuestId ? 'rpg-graph-editor-id-dup-warn' : undefined}
              />
              {duplicateQuestId && (
                <p id="rpg-graph-editor-id-dup-warn" class="rpg-graph-editor__warning" role="alert">
                  Diese ID ist bereits vergeben (eindeutig pro Quest). Nach Normalisierung:{' '}
                  <code class="rpg-graph-editor__code">{normalizedCreateId}</code>
                </p>
              )}
            </label>
            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Typ</span>
              <select class="rpg-graph-editor__input" value={kind} onChange={(ev) => setKind(ev.currentTarget.value)}>
                <option value="main">Main (Sechseck)</option>
                <option value="side">Side (Kreis)</option>
              </select>
            </label>
            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Titel</span>
              <input
                class="rpg-graph-editor__input"
                value={title}
                onInput={(ev) => setTitle(ev.currentTarget.value)}
              />
            </label>
            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Beschreibung</span>
              <textarea class="rpg-graph-editor__textarea" rows={3} value={description} onInput={(ev) => setDescription(ev.currentTarget.value)} />
            </label>

            <RpgQuestStepsBuilder steps={stepDrafts} onStepsChange={setStepDrafts} />
            <RpgQuestRewardsBuilder rows={rewardRows} onRowsChange={setRewardRows} />

            <label class="rpg-graph-editor__field">
              <span class="rpg-graph-editor__label">Reihenfolge in der Ebene (kleiner = weiter links)</span>
              <input
                class="rpg-graph-editor__input"
                type="number"
                step={1}
                value={orderInLayer}
                onInput={(ev) => setOrderInLayer(Number(ev.currentTarget.value))}
              />
            </label>
            <fieldset class="rpg-graph-editor__fieldset">
              <legend class="rpg-graph-editor__legend">Vorgänger-Quests (müssen fertig sein)</legend>
              {otherQuests.length === 0 ? (
                <p class="rpg-graph-editor__hint">Noch keine anderen Quests im Graph.</p>
              ) : (
                <ul class="rpg-graph-editor__checks">
                  {otherQuests.map((q) => (
                    <li key={q.id}>
                      <label class="rpg-graph-editor__check">
                        <input type="checkbox" checked={prereqIds.has(q.id)} onChange={() => togglePrereq(q.id)} />
                        <span>
                          {q.title} <code class="rpg-graph-editor__code">{q.id}</code>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <div class="rpg-graph-editor__actions">
              {mode === 'edit' && (
                <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--danger" onClick={handleDelete}>
                  Löschen
                </button>
              )}
              <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={handleRequestClose}>
                Abbrechen
              </button>
              <button
                type="submit"
                class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
                disabled={duplicateQuestId || (mode === 'create' && aiLoading)}
              >
                Speichern
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
