import { useState, useEffect, useRef } from 'preact/hooks';
import {
  upsertQuestInGraph,
  removeQuestFromGraph,
  graphHasCycle,
} from '../lib/rpg-quest-graph.js';
import { getQuestRewardEntries, normalizeQuestRewards } from '../lib/rpg-quest-steps.js';
import {
  questStepsToDrafts,
  draftStepsToQuestNodes,
  aiLabelsToDraftSteps,
  aiQuestNodesToDraftSteps,
  questRewardsToDraftRows,
  draftRewardRowsToQuestRewards,
} from '../lib/rpg-quest-editor-draft.js';
import { RpgQuestStepsBuilder, RpgQuestRewardsBuilder } from './RpgQuestStepsBuilder.jsx';
import { normalizeQuestId } from '../lib/rpg-quest-form-helpers.js';

export { normalizeQuestId } from '../lib/rpg-quest-form-helpers.js';

/**
 * @param {{
 *   open: boolean;
 *   mode: 'create' | 'edit';
 *   graph: import('../lib/rpg-quest-graph.js').RpgGraph;
 *   questId: string | null;
 *   onClose: () => void;
 *   onApply: (g: import('../lib/rpg-quest-graph.js').RpgGraph) => void;
 * }} props
 */
export default function RpgQuestGraphEditor({ open, mode, graph, questId, onClose, onApply }) {
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
  const [createMode, setCreateMode] = useState(/** @type {'manual' | 'ai'} */ ('manual'));
  const [editSurface, setEditSurface] = useState(/** @type {'choose' | 'form' | 'ai'} */ ('form'));
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(/** @type {string | null} */ (null));
  const aiSeedRef = useRef('');
  /** @type {{ question: string; answer: string }[]} */
  const [clarifyHistoryPairs, setClarifyHistoryPairs] = useState([]);
  /** @type {string[] | null} */
  const [clarifyPendingQs, setClarifyPendingQs] = useState(null);
  const [clarifyAnswerBuf, setClarifyAnswerBuf] = useState(/** @type {string[]} */ ([]));

  const resetAiSession = () => {
    aiSeedRef.current = '';
    setClarifyHistoryPairs([]);
    setClarifyPendingQs(null);
    setClarifyAnswerBuf([]);
    setAiError(null);
  };

  useEffect(() => {
    if (!open) {
      aiSeedRef.current = '';
      return;
    }
    if (mode === 'edit' && questId) {
      const q = graph.quests.find((x) => x.id === questId);
      if (!q) return;
      setId(q.id);
      setKind(q.kind === 'main' ? 'main' : 'side');
      setTitle(q.title || '');
      setDescription(q.description || '');
      setStepDrafts(questStepsToDrafts(q.steps || []));
      setRewardRows(questRewardsToDraftRows(getQuestRewardEntries(q)));
      setOrderInLayer(typeof q.orderInLayer === 'number' ? q.orderInLayer : 0);
      const preds = new Set();
      for (const e of graph.edges || []) {
        if (e.to === questId) preds.add(e.from);
      }
      setPrereqIds(preds);
      setEditSurface('choose');
      resetAiSession();
      setAiPrompt('');
      setCreateMode('manual');
      setAiLoading(false);
    } else {
      setId('');
      setKind('side');
      setTitle('');
      setDescription('');
      setStepDrafts([]);
      setRewardRows([]);
      setOrderInLayer(0);
      setPrereqIds(new Set());
      setCreateMode('manual');
      setEditSurface('form');
      setAiPrompt('');
      setAiError(null);
      setAiLoading(false);
      resetAiSession();
    }
  }, [open, mode, questId, graph]);

  if (!open) return null;

  const normalizedCreateId = mode === 'create' ? normalizeQuestId(id) : '';
  const duplicateQuestId =
    mode === 'create' &&
    normalizedCreateId.length > 0 &&
    graph.quests.some((q) => q.id === normalizedCreateId);

  const otherQuests = graph.quests.filter((q) => (mode === 'edit' ? q.id !== questId : true));

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
    const questRewards = draftRewardRowsToQuestRewards(rewardRows);
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
    onApply(next);
    onClose();
  };

  const handleDelete = () => {
    if (mode !== 'edit' || !questId) return;
    if (!window.confirm('Quest wirklich löschen? Alle Kanten zu dieser Quest entfallen.')) return;
    onApply(removeQuestFromGraph(graph, questId));
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
    const entries =
      Array.isArray(data.questRewards) && data.questRewards.length > 0
        ? normalizeQuestRewards(data.questRewards)
        : rewardLines.map((text) => ({ text }));
    setRewardRows(questRewardsToDraftRows(entries));
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
      if (mode === 'edit') setEditSurface('form');
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

  const showEditPick = mode === 'edit' && editSurface === 'choose';
  /** Nur Bearbeiten: questmaker+ als eigenes Fenster; bei „Neue Quest“ bleibt der Block im Formular. */
  const showAiOnlyPanel = mode === 'edit' && editSurface === 'ai';
  const showFullForm =
    mode === 'create' || (mode === 'edit' && editSurface === 'form');

  const aiBlock = (
    <div class="rpg-graph-editor__ai-block">
      <label class="rpg-graph-editor__field">
        <span class="rpg-graph-editor__label">Worum soll die Quest gehen?</span>
        <textarea
          class="rpg-graph-editor__textarea"
          rows={4}
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
        Es geht um Alltag und echte Entscheidungen — keine Fantasy-Welt. Nach der Generierung kannst du alles im Editor anpassen.
      </p>
    </div>
  );

  return (
    <div class="rpg-graph-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="rpg-graph-editor-title">
      <div class="rpg-graph-editor rpg-graph-editor--wide">
        <div class="rpg-graph-editor__head">
          <h2 id="rpg-graph-editor-title" class="rpg-graph-editor__title">
            {mode === 'create' ? 'Neue Quest' : 'Quest bearbeiten'}
          </h2>
          <button type="button" class="rpg-graph-editor__close" onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </div>
        {showEditPick ? (
          <div class="rpg-graph-editor__form rpg-graph-editor__pick">
            <p class="rpg-graph-editor__pick-intro">Wie möchtest du bearbeiten?</p>
            <div class="rpg-graph-editor__mode rpg-graph-editor__mode--stack" role="group" aria-label="Bearbeitungsart">
              <button type="button" class="rpg-graph-editor__mode-btn" onClick={() => setEditSurface('form')}>
                manuell+
              </button>
              <button
                type="button"
                class="rpg-graph-editor__mode-btn"
                onClick={() => {
                  resetAiSession();
                  setAiPrompt('');
                  setEditSurface('ai');
                }}
              >
                questmaker+
              </button>
            </div>
            <div class="rpg-graph-editor__actions">
              <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={onClose}>
                Abbrechen
              </button>
            </div>
          </div>
        ) : null}
        {showAiOnlyPanel && !showEditPick ? (
          <div class="rpg-graph-editor__form rpg-graph-editor__ai-only">
            {mode === 'edit' ? (
              <button
                type="button"
                class="rpg-graph-editor__back-link"
                onClick={() => {
                  resetAiSession();
                  setAiPrompt('');
                  setEditSurface('choose');
                }}
              >
                Zurück zur Auswahl
              </button>
            ) : null}
            {aiBlock}
          </div>
        ) : null}
        {showFullForm ? (
        <form class="rpg-graph-editor__form" onSubmit={handleSubmit}>
          {mode === 'create' && (
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
          )}
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
            <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost" onClick={onClose}>
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
