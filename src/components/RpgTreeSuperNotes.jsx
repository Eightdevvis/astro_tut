/**
 * RpgTreeSuperNotes — Private Notizen-Modal im Quest-Baum.
 *
 * Kapselt den kompletten Notes-Lifecycle:
 * - State (open, value, history, loading, saving, error)
 * - Body-Overflow-Lock bei offenem Modal
 * - Fetch/PUT gegen /api/rpg/super-notes
 * - Modal-JSX mit Textarea + Verlaufsbereich (letzte 5 Saves)
 *
 * Die Komponente wird nur gerendert wenn canUseNotes=true.
 */

import { useState, useEffect, useCallback, useRef } from 'preact/hooks';

export function useTreeSuperNotes({ canUseNotes }) {
  const [superNotesOpen, setSuperNotesOpen] = useState(false);
  const [superNotesValue, setSuperNotesValue] = useState('');
  // History: Array von {note, savedAt} — neuester Eintrag zuerst
  const [superNotesHistory, setSuperNotesHistory] = useState([]);
  const [superNotesLoading, setSuperNotesLoading] = useState(false);
  const [superNotesSaving, setSuperNotesSaving] = useState(false);
  const [superNotesError, setSuperNotesError] = useState('');
  const abortRef = useRef(/** @type {AbortController | null} */ (null));

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!superNotesOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [superNotesOpen]);

  const openSuperNotes = useCallback(async () => {
    if (!canUseNotes) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSuperNotesOpen(true);
    setSuperNotesError('');
    setSuperNotesLoading(true);
    try {
      const res = await fetch('/api/rpg/super-notes', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: ac.signal,
      });
      if (!res.ok) {
        setSuperNotesError('Notizen konnten nicht geladen werden.');
        return;
      }
      const data = await res.json();
      setSuperNotesValue(typeof data?.note === 'string' ? data.note : '');
      setSuperNotesHistory(Array.isArray(data?.history) ? data.history : []);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setSuperNotesError('Notizen konnten nicht geladen werden.');
    } finally {
      setSuperNotesLoading(false);
    }
  }, [canUseNotes]);

  const saveSuperNotes = useCallback(async () => {
    if (!canUseNotes) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSuperNotesSaving(true);
    setSuperNotesError('');
    try {
      const res = await fetch('/api/rpg/super-notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ note: superNotesValue }),
        signal: ac.signal,
      });
      if (!res.ok) {
        setSuperNotesError('Notizen konnten nicht gespeichert werden.');
        return;
      }
      const data = await res.json();
      setSuperNotesValue(typeof data?.note === 'string' ? data.note : superNotesValue);
      setSuperNotesHistory(Array.isArray(data?.history) ? data.history : []);
      setSuperNotesOpen(false);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setSuperNotesError('Notizen konnten nicht gespeichert werden.');
    } finally {
      setSuperNotesSaving(false);
    }
  }, [canUseNotes, superNotesValue]);

  return {
    superNotesOpen,
    setSuperNotesOpen,
    openSuperNotes,
    saveSuperNotes,
    superNotesValue,
    setSuperNotesValue,
    superNotesHistory,
    superNotesLoading,
    superNotesSaving,
    superNotesError,
  };
}

/** Formatiert einen ISO-Zeitstempel leserlich, z.B. "28.04. 14:32" */
function fmtDate(iso) {
  if (!iso || iso === 'migriert') return 'migriert';
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${mon}. ${h}:${m}`;
  } catch {
    return iso;
  }
}

/**
 * Modal-Komponente fuer die privaten Notizen.
 * history: [{note, savedAt}, ...] — neuester Eintrag zuerst
 */
export default function RpgTreeSuperNotes({
  open,
  value,
  history,
  onInput,
  onClose,
  onSave,
  onRestoreHistory,
  loading,
  saving,
  error,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!open) return null;

  // Ältere Einträge = alles ab Index 1 (Index 0 ist der aktuelle Stand)
  const pastVersions = Array.isArray(history) ? history.slice(1) : [];

  return (
    <div
      class="rpg-tree__super-notes-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Private Notizen"
      onClick={() => !saving && onClose()}
    >
      <div class="rpg-tree__super-notes" onClick={(e) => e.stopPropagation()}>
        <div class="rpg-tree__super-notes-head">
          <h2>Private Notizen</h2>
          <button
            type="button"
            class="rpg-tree__super-notes-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Notizeditor schließen"
          >
            ×
          </button>
        </div>

        <textarea
          class="rpg-tree__super-notes-textarea"
          value={value}
          onInput={(e) => onInput(e.currentTarget.value)}
          placeholder="Deine privaten Notizen..."
          disabled={loading || saving}
        />

        {error ? <p class="rpg-tree__super-notes-error">{error}</p> : null}

        {/* Verlaufsbereich — nur wenn aeltere Versionen vorhanden */}
        {pastVersions.length > 0 && (
          <div class="rpg-tree__super-notes-history">
            <button
              type="button"
              class="rpg-tree__super-notes-history-toggle"
              onClick={() => setHistoryOpen((v) => !v)}
            >
              {historyOpen ? '▾' : '▸'} Verlauf ({pastVersions.length} ältere Version{pastVersions.length !== 1 ? 'en' : ''})
            </button>
            {historyOpen && (
              <ul class="rpg-tree__super-notes-history-list">
                {pastVersions.map((entry, i) => (
                  <li key={i} class="rpg-tree__super-notes-history-item">
                    <span class="rpg-tree__super-notes-history-date">{fmtDate(entry.savedAt)}</span>
                    <span class="rpg-tree__super-notes-history-preview">
                      {entry.note?.slice(0, 60)}{entry.note?.length > 60 ? '…' : ''}
                    </span>
                    <button
                      type="button"
                      class="rpg-tree__btn rpg-tree__btn--muted rpg-tree__super-notes-history-restore"
                      onClick={() => onRestoreHistory(entry.note)}
                      disabled={saving}
                    >
                      Laden
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div class="rpg-tree__super-notes-actions">
          <button
            type="button"
            class="rpg-tree__btn rpg-tree__btn--muted"
            onClick={onClose}
            disabled={saving}
          >
            Schließen
          </button>
          <button
            type="button"
            class="rpg-tree__btn rpg-tree__btn--primary"
            onClick={onSave}
            disabled={loading || saving}
          >
            {saving ? 'Speichert...' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
