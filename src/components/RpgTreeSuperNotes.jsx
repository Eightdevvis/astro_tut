/**
 * RpgTreeSuperNotes — Superuser-Notizen-Modal im Quest-Baum.
 *
 * Kapselt den kompletten Super-Notes-Lifecycle:
 * - State (open, value, loading, saving, error)
 * - Body-Overflow-Lock bei offenem Modal
 * - Fetch/PUT gegen /api/rpg/super-notes
 * - Modal-JSX mit Textarea + Save/Close
 *
 * Die Komponente wird nur gerendert wenn isSuperuser=true.
 */

import { useState, useEffect, useCallback, useRef } from 'preact/hooks';

export function useTreeSuperNotes({ isSuperuser }) {
  const [superNotesOpen, setSuperNotesOpen] = useState(false);
  const [superNotesValue, setSuperNotesValue] = useState('');
  const [superNotesLoading, setSuperNotesLoading] = useState(false);
  const [superNotesSaving, setSuperNotesSaving] = useState(false);
  const [superNotesError, setSuperNotesError] = useState('');
  // AbortController-Ref: bricht laufende Fetches ab bei Close/Unmount
  const abortRef = useRef(/** @type {AbortController | null} */ (null));

  // Laufende Fetches bei Unmount abbrechen (verhindert State-Updates auf ungemountet)
  useEffect(() => () => abortRef.current?.abort(), []);

  // Body-Overflow blockieren solange das Modal offen ist
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!superNotesOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [superNotesOpen]);

  // Notizen vom Server laden und Modal oeffnen
  const openSuperNotes = useCallback(async () => {
    if (!isSuperuser) return;
    // Vorherigen Fetch abbrechen falls noch laufend
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
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setSuperNotesError('Notizen konnten nicht geladen werden.');
    } finally {
      setSuperNotesLoading(false);
    }
  }, [isSuperuser]);

  // Notizen an den Server senden
  const saveSuperNotes = useCallback(async () => {
    if (!isSuperuser) return;
    // Vorherigen Fetch abbrechen (z.B. wenn Load noch laeuft)
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
      setSuperNotesOpen(false);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setSuperNotesError('Notizen konnten nicht gespeichert werden.');
    } finally {
      setSuperNotesSaving(false);
    }
  }, [isSuperuser, superNotesValue]);

  return {
    superNotesOpen,
    setSuperNotesOpen,
    openSuperNotes,
    saveSuperNotes,
    superNotesValue,
    setSuperNotesValue,
    superNotesLoading,
    superNotesSaving,
    superNotesError,
  };
}

/**
 * Modal-Komponente fuer die Superuser-Notizen.
 */
export default function RpgTreeSuperNotes({
  open,
  value,
  onInput,
  onClose,
  onSave,
  loading,
  saving,
  error,
}) {
  if (!open) return null;
  return (
    <div
      class="rpg-tree__super-notes-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Private Superuser-Notizen"
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
          placeholder="Nur für dich als Superuser..."
          disabled={loading || saving}
        />
        {error ? <p class="rpg-tree__super-notes-error">{error}</p> : null}
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
