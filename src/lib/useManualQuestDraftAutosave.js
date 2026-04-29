/**
 * useManualQuestDraftAutosave — Hook fuer den Manual-Draft Autosave/Restore-Flow im Graph-Editor.
 *
 * Kapselt drei Belange, die vorher inline im RpgQuestGraphEditor lebten und
 * gemeinsam ~140 LOC der Komponente belegt haben:
 * 1. **Payload-Aufbau**  — `buildPayload()` erzeugt aus den State-Feldern
 *    eine serialisierbare Snapshot-Kopie (deep clone via JSON), die der
 *    Persistenz uebergeben werden kann.
 * 2. **Content-Heuristik** — `payloadHasContent(p)` entscheidet, ob ein
 *    Snapshot ueberhaupt etwas Sinnvolles enthaelt (sonst keine Persistenz).
 *    Die Heuristik ist die einzige Stelle, an der definiert wird, was
 *    "leerer Editor" bedeutet — wichtig, weil sonst ein leeres In-Progress
 *    geschrieben wuerde, das beim naechsten Open faelschlich restored wird.
 * 3. **Autosave-Lifecycle** — kombiniert drei Effekte:
 *    - 180ms Debounce auf jede Aenderung der getrackten Felder
 *    - `pagehide`/`visibilitychange`/`beforeunload` Flush (sonst verliert
 *      man Stand, wenn der Tab abrupt geschlossen wird)
 *    - Cleanup beim Schliessen oder beim Mode-Wechsel weg von "Manual"
 *
 * Stolperstellen:
 * - Der Hook MUSS den ganzen Autosave-Effekt aufgeben, sobald `active === false`,
 *   sonst leakt der Listener.
 * - `buildPayload` muss bei jedem Field-Change neu erzeugt werden — wir cachen
 *   den letzten Snapshot in `payloadRef`, damit der Flush-Listener auf den
 *   aktuellen Stand zugreifen kann (Closure-Capture haette sonst alten Stand).
 * - Wir geben `getCurrentPayloadHasContent` als Funktion zurueck (nicht als Wert),
 *   damit der Aufrufer sie zum Zeitpunkt des Schliessens auswertet — sonst
 *   wuerde React den Wert beim Render der ButtonBar einfrieren.
 */

import { useEffect, useRef } from 'preact/hooks';
import {
  isDraftNodeMeaningful,
} from './rpg-quest-editor-draft.js';
import {
  saveManualQuestInProgressDraft,
  clearManualQuestInProgressDraft,
} from './rpg-quest-manual-drafts.js';

const AUTOSAVE_DEBOUNCE_MS = 180;

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   description: string;
 *   nodeDrafts: import('./rpg-quest-editor-draft.js').QuestNodeDraft[];
 *   rewardRows: import('./rpg-quest-editor-draft.js').QuestRewardDraftRow[];
 *   orderInLayer: number;
 * }} ManualDraftSnapshot
 */

/**
 * Erzeugt einen serialisierbaren Snapshot aus den State-Feldern.
 *
 * Wir nehmen JSON-Deep-Clone, damit die Persistenz keine lebenden
 * State-Referenzen schreibt. Das ist hier okay, weil weder NodeDrafts
 * noch RewardRows Klassen oder Funktionen enthalten — alles ist plain data.
 *
 * @param {object} fields
 * @param {string} fields.id
 * @param {string} fields.title
 * @param {string} fields.description
 * @param {import('./rpg-quest-editor-draft.js').QuestNodeDraft[]} fields.nodeDrafts
 * @param {import('./rpg-quest-editor-draft.js').QuestRewardDraftRow[]} fields.rewardRows
 * @param {number | string} fields.orderInLayer
 * @returns {ManualDraftSnapshot}
 */
export function buildManualDraftSnapshot(fields) {
  return {
    id: fields.id,
    title: fields.title,
    description: fields.description,
    nodeDrafts: JSON.parse(JSON.stringify(fields.nodeDrafts)),
    rewardRows: JSON.parse(JSON.stringify(fields.rewardRows)),
    orderInLayer: Number.isFinite(Number(fields.orderInLayer)) ? Number(fields.orderInLayer) : 0,
  };
}

/**
 * Heuristik: Hat der Snapshot ueberhaupt persistenswerten Inhalt?
 *
 * Wenn nicht, wird er nicht geschrieben (oder ein vorhandener Eintrag wird
 * geloescht), damit der naechste Open nicht mit Leer-Restore startet.
 *
 * Wichtig: `Number.isFinite(o) && o !== 0` — wir akzeptieren auch negative
 * orderInLayer-Werte als Inhalt, weil der Nutzer sie absichtlich gesetzt
 * haben koennte. Nur exakt 0 (Default) zaehlt als "leer".
 *
 * @param {ManualDraftSnapshot} payload
 * @returns {boolean}
 */
export function manualDraftSnapshotHasContent(payload) {
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
}

/**
 * Hook: kapselt Autosave, Flush-on-Hide und Snapshot-Building.
 *
 * @param {object} opts
 * @param {boolean} opts.active — Hook nur aktiv, wenn true (Editor offen + Manual-Modus).
 * @param {string} opts.id
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {import('./rpg-quest-editor-draft.js').QuestNodeDraft[]} opts.nodeDrafts
 * @param {import('./rpg-quest-editor-draft.js').QuestRewardDraftRow[]} opts.rewardRows
 * @param {number | string} opts.orderInLayer
 * @returns {{
 *   buildSnapshot: () => ManualDraftSnapshot;
 *   currentSnapshotHasContent: () => boolean;
 * }}
 */
export function useManualQuestDraftAutosave(opts) {
  const { active, id, title, description, nodeDrafts, rewardRows, orderInLayer } = opts;

  // Letzter berechneter Snapshot — zentrale Quelle fuer Debounce-Save und Flush.
  // Ref statt State, weil die Listener nicht re-rendern sollen, sobald sich der
  // Snapshot aendert (Re-Render macht der Komponenten-State).
  const snapshotRef = useRef(/** @type {ManualDraftSnapshot | null} */ (null));

  // Snapshot bei jeder Field-Aenderung neu erzeugen.
  // Wir muessen das in einem Effect machen (nicht inline), damit der Snapshot
  // wirklich auf den committed State basiert, nicht auf einer Render-Zwischenphase.
  useEffect(() => {
    if (!active) {
      snapshotRef.current = null;
      return;
    }
    snapshotRef.current = buildManualDraftSnapshot({
      id, title, description, nodeDrafts, rewardRows, orderInLayer,
    });
  }, [active, id, title, description, nodeDrafts, rewardRows, orderInLayer]);

  // Debounced Autosave: 180ms nach letzter Aenderung speichern bzw. clearen.
  // Stolperstelle: setTimeout wird beim Cleanup gecleart — sonst koennte ein
  // alter Save eine neue Aenderung ueberschreiben (Race).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const payload = snapshotRef.current;
      if (!payload) return;
      if (manualDraftSnapshotHasContent(payload)) saveManualQuestInProgressDraft(payload);
      else clearManualQuestInProgressDraft();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [active, id, title, description, nodeDrafts, rewardRows, orderInLayer]);

  // Flush auf pagehide/visibilitychange/beforeunload.
  // Notwendig, weil Debounce sonst den letzten Stand verlieren kann, wenn der
  // Tab geschlossen wird, bevor die 180ms vergangen sind.
  useEffect(() => {
    if (!active) return;
    const flush = () => {
      const payload = snapshotRef.current;
      if (!payload) return;
      if (manualDraftSnapshotHasContent(payload)) saveManualQuestInProgressDraft(payload);
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
  }, [active]);

  // API: Aufrufer erzeugt frisch (z.B. fuer addManualQuestDraft beim Close).
  // Die Funktionen schliessen NICHT ueber stale opts — sie lesen den
  // aktuellen Snapshot aus snapshotRef.
  return {
    buildSnapshot: () =>
      buildManualDraftSnapshot({ id, title, description, nodeDrafts, rewardRows, orderInLayer }),
    currentSnapshotHasContent: () => {
      const p = snapshotRef.current;
      return p ? manualDraftSnapshotHasContent(p) : false;
    },
  };
}
