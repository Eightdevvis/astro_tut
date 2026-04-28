/**
 * useEditorAiFlow — Hook fuer den Questmaker-/KI-Flow im Graph-Editor.
 *
 * Kapselt den gesamten KI-Interaktions-Lifecycle:
 * - AI-Session-State (Prompt, Loading, Error, Seed, Clarify-Paare)
 * - Paket-Draft-Verwaltung (Multi-Quest-Pakete aus der KI)
 * - Generate/Clarify/Regenerate-Callbacks
 * - Error-Formatting via formatAiError
 *
 * Hinweis: Der Questmaker ist aktuell deaktiviert (RPG_QUESTMAKER_ENABLED = false),
 * dieser Hook existiert als saubere Kapselung fuer die spätere Reaktivierung.
 */

import { useState, useRef } from 'preact/hooks';
import {
  aiQuestNodesToDraftNodes,
  aiLabelsToDraftNodes,
  questRewardRowsToDraftRows,
} from './rpg-quest-editor-draft.js';
import { normalizeRewardRows } from './rpg-quest-rewards.js';
import {
  normalizeQuestmakerCatalogPayloadItem,
} from './rpg-questmaker-sync.js';
import { formatAiError } from './rpg-graph-editor-ops.js';

/**
 * @param {object} opts
 * @param {'create' | 'edit'} opts.mode
 * @param {import('./rpg-quests-data.js').RpgGraph} opts.graph
 * @param {string | null} opts.questId
 * @param {string} opts.editTargetNodeId
 * @param {boolean} opts.onlyQuestmaker — true wenn der Editor im reinen Questmaker-Modus laeuft
 * @param {(v: string) => void} opts.setId
 * @param {(v: string) => void} opts.setTitle
 * @param {(v: string) => void} opts.setDescription
 * @param {(v: import('./rpg-quest-editor-draft.js').QuestNodeDraft[]) => void} opts.setNodeDrafts
 * @param {(v: import('./rpg-quest-editor-draft.js').QuestRewardDraftRow[]) => void} opts.setRewardRows
 * @param {(v: number) => void} opts.setOrderInLayer
 * @param {{ current: { nodeDrafts: any; title: string; description: string; rewardRows: any; orderInLayer: number } | null }} opts.editQmBaselineRef
 */
export function useEditorAiFlow({
  mode,
  graph,
  questId,
  editTargetNodeId,
  onlyQuestmaker,
  setId,
  setTitle,
  setDescription,
  setNodeDrafts,
  setRewardRows,
  setOrderInLayer,
  editQmBaselineRef,
}) {
  // -- KI-Session-State --
  /** @type {'prompt' | 'result'} */
  const [qmPhase, setQmPhase] = useState('prompt');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(/** @type {string | null} */ (null));
  const aiSeedRef = useRef('');
  /** Zuletzt erfolgreich an die KI gesandter Questmaker-Prompt (Session). */
  const lastQmPromptRef = useRef('');
  /** @type {{ question: string; answer: string }[]} */
  const [clarifyHistoryPairs, setClarifyHistoryPairs] = useState([]);
  /** @type {string[] | null} */
  const [clarifyPendingQs, setClarifyPendingQs] = useState(null);
  const [clarifyAnswerBuf, setClarifyAnswerBuf] = useState(/** @type {string[]} */ ([]));
  const [aiPackageDraft, setAiPackageDraft] = useState(
    /** @type {{ title: string; description: string; quests: any[]; edges: { from: string; to: string }[] } | null} */ (null)
  );
  const [aiPackageFocusQuestId, setAiPackageFocusQuestId] = useState('');
  /** KI-generierte Katalog-Zeilen fuer neue Item-IDs. */
  const aiQuestmakerItemsRef = useRef(
    /** @type {{ id: string; category: string; title: string; description: string }[]} */ ([])
  );

  // -- Session-Reset --
  const resetAiSession = () => {
    aiSeedRef.current = '';
    setClarifyHistoryPairs([]);
    setClarifyPendingQs(null);
    setClarifyAnswerBuf([]);
    setAiError(null);
    setAiPackageDraft(null);
    setAiPackageFocusQuestId('');
  };

  /**
   * Wendet ein KI-generiertes Quest-Payload auf die Form-States an.
   * @param {Record<string, unknown>} data
   */
  const applyGeneratedQuestPayload = (data) => {
    if (mode === 'create') {
      setId(typeof data.id === 'string' ? data.id : '');
    }
    setTitle(typeof data.title === 'string' ? data.title : '');
    setDescription(typeof data.description === 'string' ? data.description : '');
    if (Array.isArray(data.children) && data.children.length > 0) {
      setNodeDrafts(aiQuestNodesToDraftNodes(/** @type {any} */ (data.children)));
    } else if (Array.isArray(data.nodes) && data.nodes.length > 0) {
      setNodeDrafts(aiQuestNodesToDraftNodes(/** @type {any} */ (data.nodes)));
    } else {
      const labels = Array.isArray(data.nodeLabels) ? data.nodeLabels : [];
      setNodeDrafts(labels.length ? aiLabelsToDraftNodes(labels.map((x) => String(x))) : []);
    }
    const rewardLines = Array.isArray(data.rewards) ? data.rewards.map((x) => String(x).trim()).filter(Boolean) : [];
    const qRows =
      Array.isArray(data.questRewards) && data.questRewards.length > 0
        ? normalizeRewardRows(data.questRewards)
        : rewardLines.map((text) => ({ entry: { type: 'text', text } }));
    setRewardRows(questRewardRowsToDraftRows(qRows));
    const rawQm = Array.isArray(data.questmakerItems) ? data.questmakerItems : [];
    aiQuestmakerItemsRef.current = rawQm
      .map((x) => normalizeQuestmakerCatalogPayloadItem(x))
      .filter(Boolean);
  };

  /**
   * Hauptgenerier-Funktion: sendet Prompt + Clarify-History an die API.
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
      const effectiveLockedId =
        mode === 'edit' ? String(editTargetNodeId || questId || '').trim() || undefined : undefined;
      const res = await fetch('/api/rpg/quests-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          prompt: aiSeedRef.current,
          existingQuestIds: graph.nodes.map((q) => q.id),
          lockedQuestId: effectiveLockedId,
          clarification: pairs.length > 0 ? { pairs } : undefined,
          responseMode: mode === 'create' && onlyQuestmaker ? 'package' : undefined,
        }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        setAiError(formatAiError(data, res.status));
        return;
      }
      // Antworttyp: Rueckfragen
      if (data.responseType === 'clarify' && Array.isArray(data.questions) && data.questions.length > 0) {
        setClarifyPendingQs(data.questions.map((x) => String(x)));
        setClarifyAnswerBuf(data.questions.map(() => ''));
        return;
      }
      // Antworttyp: Multi-Quest-Paket
      if (data.responseType === 'package' && Array.isArray(data.quests || data.nodes) && (data.quests || data.nodes).length > 0) {
        const quests = (data.nodes || data.quests).filter((q) => q && typeof q === 'object');
        const edges = Array.isArray(data.edges)
          ? data.edges
              .map((e) => ({
                from: String(e?.from ?? e?.fromNodeId ?? '').trim(),
                to: String(e?.to ?? e?.toNodeId ?? '').trim(),
                relation: 'dependency',
              }))
              .filter((e) => e.from && e.to && e.from !== e.to)
          : [];
        setAiPackageDraft({
          title: typeof data.title === 'string' ? data.title : '',
          description: typeof data.description === 'string' ? data.description : '',
          nodes: quests,
          edges,
        });
        const firstQuest = quests[0];
        if (firstQuest) {
          setAiPackageFocusQuestId(String(firstQuest.id || ''));
          applyGeneratedQuestPayload(firstQuest);
        }
        const usedPromptSnapshotPkg = aiSeedRef.current.trim();
        setClarifyHistoryPairs([]);
        setClarifyPendingQs(null);
        setClarifyAnswerBuf([]);
        setAiError(null);
        if (usedPromptSnapshotPkg) lastQmPromptRef.current = usedPromptSnapshotPkg;
        setQmPhase('result');
        return;
      }
      // Antworttyp: einzelne Quest
      const usedPromptSnapshot = aiSeedRef.current.trim();
      resetAiSession();
      setAiPackageDraft(null);
      setAiPackageFocusQuestId('');
      applyGeneratedQuestPayload(data);
      if (usedPromptSnapshot) lastQmPromptRef.current = usedPromptSnapshot;
      if (onlyQuestmaker) setQmPhase('result');
    } catch {
      setAiError('Netzwerkfehler');
    } finally {
      setAiLoading(false);
    }
  };

  /** Sendet Clarify-Antworten und generiert erneut. */
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

  /** Setzt den Editor zurueck auf Prompt-Phase fuer Regenerierung. */
  const handleQmRegenerate = () => {
    setQmPhase('prompt');
    resetAiSession();
    const qPersist =
      mode === 'edit' && questId ? graph.nodes.find((x) => x.id === questId) : null;
    const seed =
      lastQmPromptRef.current.trim() ||
      (qPersist && typeof qPersist.questmakerPrompt === 'string' ? qPersist.questmakerPrompt.trim() : '');
    setAiPrompt(seed);
    if (mode === 'edit' && editQmBaselineRef.current) {
      const b = editQmBaselineRef.current;
      setNodeDrafts(b.nodeDrafts);
      setTitle(b.title);
      setDescription(b.description);
      setRewardRows(b.rewardRows);
      setOrderInLayer(b.orderInLayer);
    } else {
      setNodeDrafts([]);
      setTitle('');
      setDescription('');
      setId('');
      setRewardRows([]);
    }
  };

  return {
    // State
    qmPhase, setQmPhase,
    aiPrompt, setAiPrompt,
    aiLoading, setAiLoading,
    aiError, setAiError,
    clarifyHistoryPairs,
    clarifyPendingQs,
    clarifyAnswerBuf, setClarifyAnswerBuf,
    aiPackageDraft, setAiPackageDraft,
    aiPackageFocusQuestId, setAiPackageFocusQuestId,
    // Refs
    aiSeedRef,
    lastQmPromptRef,
    aiQuestmakerItemsRef,
    // Callbacks
    resetAiSession,
    applyGeneratedQuestPayload,
    handleAiGenerate,
    handleClarifySubmit,
    handleQmRegenerate,
  };
}
