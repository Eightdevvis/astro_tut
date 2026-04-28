/**
 * RpgTreeSettings — Modal fuer RPG-Einstellungen im Zauberer-Stil.
 *
 * Inhalt:
 * 1. Theme-Wechsel (astrolab / codex / orrery) — visuelle Richtung des Quest-Baums
 * 2. Backup-Liste mit Restore — verschoben aus den allgemeinen Einstellungen
 *
 * Das Modal oeffnet sich ueber den Astrolab-Button "settings" (Retorte ⚗).
 * Styling: CSS in rpg-quest-tree.css unter `.rsettings__*`.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';

/**
 * Zeitstempel in deutsches Berlin-Format umwandeln.
 * Dieselbe Logik wie vorher in UserSettings.jsx.
 */
function formatBerlinTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '\u2014';
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const looksSqlUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw);
  const normalized = hasExplicitZone ? raw : looksSqlUtc ? `${raw.replace(' ', 'T')}Z` : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed);
}

/** Zahlen-Formatierung mit deutschem Tausendertrennzeichen */
function formatNum(n) {
  if (n == null || Number.isNaN(n)) return '\u2014';
  return new Intl.NumberFormat('de-DE').format(n);
}

/**
 * Theme-Beschreibungen fuer die drei visuellen Richtungen.
 * Werden im Theme-Switcher als Erlaeuterung angezeigt.
 */
const THEME_META = [
  {
    id: 'astrolab',
    label: 'Astrolab',
    desc: 'Dunkles Gold, Messing & Sternenhimmel',
    sigil: '\u2609', // ☉ (Sonne/Astro)
  },
  {
    id: 'codex',
    label: 'Codex',
    desc: 'Pergament & Tinte, warmer heller Stil',
    sigil: '\u270D', // ✍ (Schreibfeder)
  },
  {
    id: 'orrery',
    label: 'Orrery',
    desc: 'Blueprint / Celestial, Indigo & Cyan',
    sigil: '\u2604', // ☄ (Komet)
  },
];

/**
 * @param {{
 *   open: boolean;
 *   onClose: () => void;
 *   direction: string;
 *   onDirectionChange: (dir: string) => void;
 * }} props
 */
export default function RpgTreeSettings({ open, onClose, direction, onDirectionChange }) {
  // -- Backup-State (lazy-loaded beim Oeffnen) --
  const [backups, setBackups] = useState(/** @type {any[]} */ ([]));
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  /** Two-Step-Confirm: ID des Backups das bestaetigt werden soll, 0 = kein Confirm aktiv */
  const [confirmRestoreId, setConfirmRestoreId] = useState(0);

  // Backups laden wenn das Modal geoeffnet wird
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr('');
    setMsg('');
    (async () => {
      try {
        const res = await fetch('/api/rpg/quests-backups', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Backups konnten nicht geladen werden.');
        if (!cancelled) {
          setBackups(Array.isArray(data.backups) ? data.backups : []);
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Backups konnten nicht geladen werden.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Escape schliesst das Modal
  useEffect(() => {
    if (!open) return;
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Backup wiederherstellen: Two-Step-Confirm, dann POST + Backup-Liste neu laden
  const handleRestore = useCallback(async (backupId) => {
    // Erster Klick: Bestaetigung anfordern
    if (confirmRestoreId !== backupId) {
      setConfirmRestoreId(backupId);
      return;
    }
    // Zweiter Klick: tatsaechlich wiederherstellen
    setConfirmRestoreId(0);
    setErr('');
    setMsg('');
    setBusyId(backupId);
    try {
      const res = await fetch('/api/rpg/quests-backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ backupId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Restore fehlgeschlagen.');
      setMsg(`Backup #${backupId} wiederhergestellt. Seite wird neu geladen\u2026`);
      // Backup-Liste aktualisieren
      const listRes = await fetch('/api/rpg/quests-backups', { credentials: 'same-origin' });
      const listData = await listRes.json().catch(() => ({}));
      if (listRes.ok && Array.isArray(listData.backups)) setBackups(listData.backups);
      // Seite nach kurzem Delay neu laden damit der wiederhergestellte State geladen wird
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setErr(e?.message || 'Restore fehlgeschlagen.');
    } finally {
      setBusyId(0);
    }
  }, [confirmRestoreId]);

  if (!open) return null;

  return (
    <div class="rsettings__overlay" onClick={onClose}>
      {/* Modal-Container — Klick innerhalb stoppt Propagation */}
      <div class="rsettings" onClick={(e) => e.stopPropagation()}>
        {/* Dekorativer Rand */}
        <div class="rsettings__rim" />

        {/* Schliessen-Button */}
        <button type="button" class="rsettings__close" onClick={onClose} aria-label="Schließen">
          {'×'}
        </button>

        {/* Header mit Retorte-Sigil */}
        <header class="rsettings__header">
          <svg class="rsettings__sigil" viewBox="0 0 60 60" aria-hidden="true">
            <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5" />
            <circle cx="30" cy="30" r="20" fill="none" stroke="currentColor" stroke-width="0.6" opacity="0.35" />
            {/* Retorte-aehnliches Symbol */}
            <path d="M25 15 L25 30 L18 45 L42 45 L35 30 L35 15 Z" fill="none" stroke="currentColor"
              stroke-width="1.5" opacity="0.75" />
            <line x1="23" y1="15" x2="37" y2="15" stroke="currentColor" stroke-width="1.5" opacity="0.75" />
            <ellipse cx="30" cy="40" rx="8" ry="3" fill="currentColor" opacity="0.2" />
          </svg>
          <h2 class="rsettings__title">Alchemie-Labor</h2>
          <p class="rsettings__sub">Einstellungen &amp; Sicherungen</p>
        </header>

        {/* ===== Sektion 1: Theme-Wechsel ===== */}
        <section class="rsettings__section">
          <div class="rsettings__section-label">Visuelle Richtung</div>
          <div class="rsettings__themes">
            {THEME_META.map((tm) => (
              <button
                key={tm.id}
                type="button"
                class={`rsettings__theme-btn${direction === tm.id ? ' rsettings__theme-btn--active' : ''}`}
                onClick={() => onDirectionChange(tm.id)}
              >
                <span class="rsettings__theme-sigil">{tm.sigil}</span>
                <span class="rsettings__theme-name">{tm.label}</span>
                <span class="rsettings__theme-desc">{tm.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ===== Sektion 2: Backups ===== */}
        <section class="rsettings__section">
          <div class="rsettings__section-label">Sicherungen</div>
          <p class="rsettings__hint">
            Pro RPG-Speicheraktion wird automatisch doppelt gesichert.
            Beim Wiederherstellen wird der aktuelle Stand zuvor erneut gesichert.
          </p>

          {/* Fehlermeldung */}
          {err && <div class="rsettings__error">{err}</div>}

          {/* Erfolgsmeldung */}
          {msg && <div class="rsettings__success">{msg}</div>}

          {/* Lade-Indikator */}
          {loading && <p class="rsettings__hint">Sicherungen laden{'…'}</p>}

          {/* Leerer Zustand */}
          {!loading && backups.length === 0 && !err && (
            <p class="rsettings__hint">Noch keine Sicherungen vorhanden.</p>
          )}

          {/* Backup-Tabelle */}
          {!loading && backups.length > 0 && (
            <div class="rsettings__table-wrap">
              <table class="rsettings__table">
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Typ</th>
                    <th>Größe</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id}>
                      <td>{formatBerlinTime(b.created_at)}</td>
                      <td>{b.kind}</td>
                      <td>{formatNum(b.payload_bytes)} B</td>
                      <td>
                        <button
                          type="button"
                          class={`rsettings__restore-btn${confirmRestoreId === b.id ? ' rsettings__restore-btn--confirm' : ''}`}
                          disabled={busyId === b.id}
                          onClick={() => handleRestore(b.id)}
                        >
                          {busyId === b.id ? 'Restore…' : confirmRestoreId === b.id ? 'Wirklich?' : 'Wiederherstellen'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
