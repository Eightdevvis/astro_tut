import { useState, useEffect } from 'preact/hooks';
import {
  upsertQuestInGraph,
  removeQuestFromGraph,
  graphHasCycle,
} from '../lib/rpg-quest-graph.js';
import {
  getQuestRewardEntries,
  distributeQuestRewardPercents,
  normalizeQuestRewards,
} from '../lib/rpg-quest-steps.js';
import {
  questStepsToDrafts,
  draftStepsToQuestNodes,
  aiLabelsToDraftSteps,
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
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    if (!open) return;
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
      setAiPrompt('');
      setAiError(null);
      setAiLoading(false);
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

  const handleAiGenerate = async () => {
    const p = aiPrompt.trim();
    if (!p.length) {
      setAiError('Bitte eine Beschreibung eingeben.');
      return;
    }
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await fetch('/api/rpg/quests-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          prompt: p,
          existingQuestIds: graph.quests.map((q) => q.id),
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
      setId(typeof data.id === 'string' ? data.id : '');
      setKind(data.kind === 'main' ? 'main' : 'side');
      setTitle(typeof data.title === 'string' ? data.title : '');
      setDescription(typeof data.description === 'string' ? data.description : '');
      const labels = Array.isArray(data.stepLabels) ? data.stepLabels : [];
      setStepDrafts(labels.length ? aiLabelsToDraftSteps(labels) : []);
      const rewardLines = Array.isArray(data.rewards) ? data.rewards.map((x) => String(x).trim()).filter(Boolean) : [];
      const entries =
        Array.isArray(data.questRewards) && data.questRewards.length > 0
          ? normalizeQuestRewards(data.questRewards)
          : distributeQuestRewardPercents(rewardLines);
      setRewardRows(questRewardsToDraftRows(entries));
    } catch {
      setAiError('Netzwerkfehler');
    } finally {
      setAiLoading(false);
    }
  };

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
                  Manuell
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
                  KI-generiert
                </button>
              </div>
              {createMode === 'ai' && (
                <div class="rpg-graph-editor__ai-block">
                  <label class="rpg-graph-editor__field">
                    <span class="rpg-graph-editor__label">Prompt für die KI</span>
                    <textarea
                      class="rpg-graph-editor__textarea"
                      rows={4}
                      value={aiPrompt}
                      placeholder="Beschreibe die Quest: Setting, Ziel, Ton, Besonderheiten …"
                      onInput={(ev) => setAiPrompt(ev.currentTarget.value)}
                      disabled={aiLoading}
                    />
                  </label>
                  {aiError && (
                    <p class="rpg-graph-editor__warning" role="alert">
                      {aiError}
                    </p>
                  )}
                  <div class="rpg-graph-editor__ai-actions">
                    <button
                      type="button"
                      class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
                      onClick={handleAiGenerate}
                      disabled={aiLoading}
                    >
                      {aiLoading ? 'Generiert …' : 'Generieren'}
                    </button>
                  </div>
                  <p class="rpg-graph-editor__hint">
                    Nach dem Generieren kannst du Schritte und Belohnungen hier anpassen.
                  </p>
                </div>
              )}
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
      </div>
    </div>
  );
}
