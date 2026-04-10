import { useState, useEffect } from 'preact/hooks';
import {
  upsertQuestInGraph,
  removeQuestFromGraph,
  graphHasCycle,
} from '../lib/rpg-quest-graph.js';

/** @param {string} text */
function linesToSteps(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label, i) => ({ id: `s-${i}`, label }));
}

/** @param {string} text */
function parseRewards(text) {
  return text
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @param {string} raw */
export function normalizeQuestId(raw) {
  let x = raw.trim().toLowerCase().replace(/\s+/g, '-');
  x = x.replace(/[^a-z0-9-_]/g, '');
  return x.slice(0, 48);
}

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
  const [stepsText, setStepsText] = useState('');
  const [rewardsText, setRewardsText] = useState('');
  const [orderInLayer, setOrderInLayer] = useState(0);
  const [prereqIds, setPrereqIds] = useState(() => new Set());

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && questId) {
      const q = graph.quests.find((x) => x.id === questId);
      if (!q) return;
      setId(q.id);
      setKind(q.kind === 'main' ? 'main' : 'side');
      setTitle(q.title || '');
      setDescription(q.description || '');
      setStepsText((q.steps || []).map((s) => s.label).join('\n'));
      setRewardsText((q.rewards || []).join('\n'));
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
      setStepsText('');
      setRewardsText('');
      setOrderInLayer(0);
      setPrereqIds(new Set());
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
    const steps = linesToSteps(stepsText);
    if (steps.length === 0) {
      window.alert('Mindestens einen Schritt (eine Zeile) angeben.');
      return;
    }
    const quest = {
      id: nid,
      kind,
      title: title.trim() || nid,
      description: description.trim(),
      steps,
      rewards: parseRewards(rewardsText),
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

  return (
    <div class="rpg-graph-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="rpg-graph-editor-title">
      <div class="rpg-graph-editor">
        <div class="rpg-graph-editor__head">
          <h2 id="rpg-graph-editor-title" class="rpg-graph-editor__title">
            {mode === 'create' ? 'Neue Quest' : 'Quest bearbeiten'}
          </h2>
          <button type="button" class="rpg-graph-editor__close" onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </div>
        <form class="rpg-graph-editor__form" onSubmit={handleSubmit}>
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
          <label class="rpg-graph-editor__field">
            <span class="rpg-graph-editor__label">Schritte (eine Zeile pro Schritt)</span>
            <textarea class="rpg-graph-editor__textarea" rows={5} value={stepsText} onInput={(ev) => setStepsText(ev.currentTarget.value)} />
          </label>
          <label class="rpg-graph-editor__field">
            <span class="rpg-graph-editor__label">Rewards (Zeilen oder kommagetrennt)</span>
            <textarea class="rpg-graph-editor__textarea" rows={2} value={rewardsText} onInput={(ev) => setRewardsText(ev.currentTarget.value)} />
          </label>
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
              disabled={duplicateQuestId}
            >
              Speichern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
