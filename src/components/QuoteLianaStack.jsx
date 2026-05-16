import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

/**
 * QuoteLianaStack.jsx
 * Zitate des eingeloggten Users als vertikale "Lianen" oben links auf /me.
 * Jede Liane = ein schmaler Streifen, der vom oberen Rand herunterhaengt;
 * der Zitattext ist quer geschrieben (writing-mode: vertical-rl) — Kopf zur
 * Seite neigen zum Lesen.
 *
 * Layout-Garantie: keine Liane wird komplett vergraben. Mehrere Lianen
 * koennen in derselben X-Spalte landen; in dem Fall sind aeltere Lianen
 * (niedrigeres z) automatisch um EXTRA_TAIL laenger als die naechst-juengere
 * in derselben Spalte — der ueberstehende Tail unten ist immer klickbar.
 *
 * Hover ueber den Stack: alle Lianen faechern auf unique X-Spalten ohne
 * Ueberlappung. Mouse-Leave: Kollaps zurueck in den "Liana-Wirrwarr".
 *
 * Klick auf eine Liane: Modal mit vollem Zitat (horizontal lesbar) + Author.
 * Owner mit `canPost`: zusaetzlich Delete-Knopf + "+" oben auf der neusten
 * Liane fuer Add-Editor.
 */

const COLS = 8;
const COLLAPSED_BASE_X = 6;
const COLLAPSED_STEP = 22;
const EXPANDED_STEP = 46;
const LIANA_WIDTH = 36;
const MIN_LEN = 110;
const MAX_LEN_VH_PCT = 65;
const EXTRA_TAIL = 36;            // px: aelteste in einer Spalte muss um so viel laenger sein als die naechst-juengere
const PX_PER_CHAR = 8;
const BASE_PADDING = 36;
const TOP_OFFSET = 0;             // px unter Container-Top (Container sitzt schon unter der Nav)

function hashFromId(id) {
  let h = (Number(id) | 0) || 1;
  h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
  return Math.abs(h);
}

function colForIndex(idx, id) {
  // Permutation: feste Folge entlang Index plus id-Jitter, damit zwei benachbarte
  // Quotes selten in dieselbe Spalte fallen.
  return (idx * 5 + (hashFromId(id) % COLS)) % COLS;
}

function rotationForId(id) {
  // -3..+3 Grad
  const h = hashFromId(id);
  return ((h % 60) - 30) / 10;
}

function textBasedLength(text, vh) {
  const chars = (text || '').length;
  const maxLen = Math.max(MIN_LEN + 60, vh * MAX_LEN_VH_PCT / 100);
  return Math.max(MIN_LEN, Math.min(maxLen, chars * PX_PER_CHAR + BASE_PADDING));
}

function fetchQuotes() {
  return fetch('/api/quotes/mine')
    .then((r) => r.json().catch(() => ({})))
    .then((d) => (Array.isArray(d.quotes) ? d.quotes : []));
}

export default function QuoteLianaStack({ canPost = false }) {
  const [quotes, setQuotes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // Quote-Objekt im Edit-Mode
  const [vh, setVh] = useState(typeof window !== 'undefined' ? window.innerHeight : 800);

  useEffect(() => {
    let cancelled = false;
    fetchQuotes()
      .then((qs) => { if (!cancelled) { setQuotes(qs); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onResize() { setVh(window.innerHeight); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const reload = useCallback(async () => {
    const qs = await fetchQuotes().catch(() => []);
    setQuotes(qs);
  }, []);

  // API liefert DESC (neueste zuerst). Wir wollen oldest -> newest fuer Layout:
  const sortedAsc = [...quotes].sort((a, b) => {
    const at = new Date(a.created_at).getTime();
    const bt = new Date(b.created_at).getTime();
    if (at !== bt) return at - bt;
    return Number(a.id) - Number(b.id);
  });
  const N = sortedAsc.length;

  // Spalte pro Liane + Laenge pro Liane (mit Tail-Garantie pro Spalte).
  const layout = computeLayout(sortedAsc, vh);

  if (!loaded) return null;
  if (N === 0 && !canPost) return null;

  return (
    <>
      <div
        class={`liana-stack ${expanded ? 'is-expanded' : ''}`}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        aria-label="Zitate"
      >
        {N === 0 && canPost && (
          <div class="liana liana-empty" style={{ left: `${COLLAPSED_BASE_X}px`, height: '120px' }}>
            <button
              type="button"
              class="liana-add-btn"
              aria-label="Zitat hinzufügen"
              title="Zitat hinzufügen"
              onClick={() => setEditorOpen(true)}
            >+</button>
            <div class="liana-empty-hint">Noch keine Zitate.</div>
          </div>
        )}

        {sortedAsc.map((q, i) => {
          const isNewest = i === N - 1;
          const { length } = layout[i];
          const x = expanded ? (COLLAPSED_BASE_X + i * EXPANDED_STEP) : layout[i].x;
          const rot = expanded ? 0 : layout[i].rot;
          return (
            <button
              type="button"
              key={q.id}
              class={`liana ${isNewest ? 'is-newest' : ''}`}
              style={{
                left: `${x}px`,
                top: `${TOP_OFFSET}px`,
                width: `${LIANA_WIDTH}px`,
                height: `${length}px`,
                zIndex: 100 + i,
                transform: `rotate(${rot}deg)`,
                transformOrigin: 'top center',
              }}
              onClick={(e) => { e.stopPropagation(); setSelected(q); }}
              aria-label={`Zitat: ${q.text.slice(0, 60)}`}
            >
              <span class="liana-text">{q.text}</span>
              {q.author && <span class="liana-author">— {q.author}</span>}
            </button>
          );
        })}

        {N > 0 && canPost && (
          <button
            type="button"
            class="liana-add-btn liana-add-btn-anchor"
            style={{
              left: `${expanded ? (COLLAPSED_BASE_X + (N - 1) * EXPANDED_STEP) : layout[N - 1].x}px`,
              zIndex: 100 + N + 1,
            }}
            aria-label="Zitat hinzufügen"
            title="Zitat hinzufügen"
            onClick={(e) => { e.stopPropagation(); setEditorOpen(true); }}
          >+</button>
        )}
      </div>

      {selected && (
        <QuoteModal
          quote={selected}
          canEdit={canPost}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); }}
          onDeleted={async () => { setSelected(null); await reload(); }}
        />
      )}

      {(editorOpen || editing) && canPost && (
        <QuoteEditor
          existing={editing}
          onClose={() => { setEditorOpen(false); setEditing(null); }}
          onSaved={async () => { setEditorOpen(false); setEditing(null); await reload(); }}
        />
      )}

      <style>{`
        .liana-stack {
          position: fixed;
          top: calc(var(--nav-strip-h, 48px) + env(safe-area-inset-top, 0px) + 8px);
          left: max(0.4rem, env(safe-area-inset-left, 0px));
          width: ${COLLAPSED_BASE_X + COLS * COLLAPSED_STEP + LIANA_WIDTH + 60}px;
          height: ${MAX_LEN_VH_PCT}vh;
          max-height: calc(100vh - var(--nav-strip-h, 48px) - 2rem);
          z-index: 90;
          pointer-events: auto;
          transition: width 280ms ease;
        }
        .liana-stack.is-expanded {
          width: ${COLLAPSED_BASE_X + 60 * EXPANDED_STEP}px;
          max-width: calc(100vw - 1rem);
        }
        .liana {
          position: absolute;
          padding: 0.55rem 0.25rem 0.7rem;
          box-sizing: border-box;
          background: var(--liana-bg, #f6efdb);
          color: var(--liana-fg, #2d2618);
          border: 1.5px solid var(--liana-border, #6b5b2f);
          border-radius: 18px;
          box-shadow: 0 3px 8px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.1);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          overflow: hidden;
          cursor: pointer;
          font: inherit;
          text-align: left;
          transition: left 320ms cubic-bezier(.2,.7,.2,1),
                      transform 320ms cubic-bezier(.2,.7,.2,1),
                      box-shadow 220ms,
                      background 200ms;
        }
        .liana:hover {
          box-shadow: 0 6px 14px rgba(0,0,0,0.28), 0 2px 4px rgba(0,0,0,0.12);
          background: var(--liana-bg-hover, #fbf5e1);
        }
        :global(html.dark) .liana {
          background: #2c2516;
          color: #f1ebd4;
          border-color: #b59a4d;
        }
        :global(html.dark) .liana:hover { background: #36301f; }
        .liana-text {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-family: 'Protest Demo', var(--font-hero, 'Protest Demo'), serif;
          font-size: 1rem;
          line-height: 1.15;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-height: 100%;
        }
        .liana-author {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-size: 0.78rem;
          opacity: 0.7;
          margin-top: 0.3rem;
          font-style: italic;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-height: 60px;
        }
        .liana-empty {
          width: ${LIANA_WIDTH * 3}px;
          padding: 0.6rem;
          align-items: center;
          justify-content: center;
        }
        .liana-empty-hint {
          font-size: 0.8rem;
          opacity: 0.65;
          margin-top: 1.6rem;
          text-align: center;
        }
        .liana-add-btn {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: 2px solid var(--liana-border, #6b5b2f);
          background: var(--liana-bg, #f6efdb);
          color: var(--liana-fg, #2d2618);
          font-size: 1rem;
          font-weight: bold;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 4px rgba(0,0,0,0.18);
        }
        :global(html.dark) .liana-add-btn {
          background: #2c2516;
          color: #f1ebd4;
          border-color: #b59a4d;
        }
        .liana-add-btn-anchor {
          position: absolute;
          top: -13px;
          /* Horizontal mittig auf der neuesten Liane (LIANA_WIDTH = 36 -> half=18; btn=26 -> half=13) */
          transform: translateX(5px);
          transition: left 320ms cubic-bezier(.2,.7,.2,1);
        }
        .liana-add-btn:hover { transform: translateX(5px) scale(1.1); }
        .liana-empty .liana-add-btn {
          position: absolute;
          top: -13px;
          left: 50%;
          transform: translateX(-50%);
        }
        .liana-empty .liana-add-btn:hover { transform: translateX(-50%) scale(1.1); }

        @media (max-width: 480px) {
          .liana-stack {
            width: ${COLLAPSED_BASE_X + COLS * 18 + LIANA_WIDTH}px;
          }
          .liana-text { font-size: 0.9rem; }
        }
      `}</style>
    </>
  );
}

/** Layout-Compute: pro Liane (x, length, rot). Garantiert dass im selben
 * X-Spalt aeltere Lianen um >= EXTRA_TAIL laenger sind als alle juengeren
 * in derselben Spalte. */
function computeLayout(sortedAsc, vh) {
  const N = sortedAsc.length;
  const items = sortedAsc.map((q, i) => {
    const col = colForIndex(i, q.id);
    return {
      i,
      id: q.id,
      col,
      x: COLLAPSED_BASE_X + col * COLLAPSED_STEP,
      rot: rotationForId(q.id),
      baseLen: textBasedLength(q.text + (q.author ? ' — ' + q.author : ''), vh),
      length: 0,
    };
  });

  // Pro Spalte: gehe von neuester (hoechster Index) zu aeltester. Setze
  // length so dass jede aeltere >= max(textbasiert, vorherige + EXTRA_TAIL).
  for (let c = 0; c < COLS; c++) {
    const inCol = items.filter((it) => it.col === c).sort((a, b) => b.i - a.i); // neuestes zuerst
    let prevLen = 0;
    for (const it of inCol) {
      it.length = Math.max(it.baseLen, prevLen + EXTRA_TAIL);
      prevLen = it.length;
    }
  }

  // Auf Viewport begrenzen: keine Liane darf laenger sein als die maximale erlaubte.
  const hardMax = Math.max(MIN_LEN + 60, vh * 0.85);
  for (const it of items) {
    if (it.length > hardMax) it.length = hardMax;
  }

  return items.map((it) => ({ x: it.x, length: it.length, rot: it.rot }));
}

function QuoteModal({ quote, canEdit, onClose, onEdit, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (!confirm('Dieses Zitat wirklich löschen?')) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/quotes/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: quote.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Fehler');
      await onDeleted();
    } catch (err) {
      setError(err.message || 'Fehler');
      setBusy(false);
    }
  }

  return (
    <div class="quote-modal-overlay" role="dialog" aria-modal="true">
      <div class="quote-modal-backdrop" onClick={onClose} />
      <div class="quote-modal">
        <button type="button" class="quote-modal-close" onClick={onClose} aria-label="Schließen">×</button>
        <blockquote class="quote-modal-text">„{quote.text}"</blockquote>
        {quote.author && <div class="quote-modal-author">— {quote.author}</div>}
        {error && <div class="quote-modal-error">{error}</div>}
        {canEdit && (
          <div class="quote-modal-actions">
            <button type="button" class="primary" onClick={onEdit} disabled={busy}>
              Bearbeiten
            </button>
            <button type="button" class="danger" onClick={remove} disabled={busy}>
              Löschen
            </button>
          </div>
        )}
      </div>

      <style>{`
        .quote-modal-overlay {
          position: fixed; inset: 0; z-index: 620;
          display: flex; align-items: center; justify-content: center;
          padding: 1rem;
        }
        .quote-modal-backdrop {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.45);
        }
        .quote-modal {
          position: relative;
          background: var(--card-bg, #fffaf2);
          color: var(--card-fg, #1d1a14);
          border: 2px solid var(--card-border, #1d1a14);
          border-radius: 14px;
          padding: 1.6rem 1.6rem 1.2rem;
          max-width: 560px;
          width: 100%;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }
        :global(html.dark) .quote-modal {
          background: #1c1a16; color: #f4f1ea; border-color: #f4f1ea;
        }
        .quote-modal-close {
          position: absolute; top: 0.4rem; right: 0.6rem;
          background: none; border: none; font-size: 1.7rem; line-height: 1;
          cursor: pointer; color: inherit; padding: 0.25rem 0.5rem;
        }
        .quote-modal-text {
          margin: 0; padding: 0;
          font-family: 'Protest Demo', var(--font-hero, 'Protest Demo'), serif;
          font-size: 1.4rem;
          line-height: 1.35;
        }
        .quote-modal-author {
          margin-top: 0.6rem; font-style: italic; opacity: 0.8;
        }
        .quote-modal-error { color: #b3261e; font-size: 0.9rem; margin-top: 0.8rem; }
        .quote-modal-actions {
          margin-top: 1rem; display: flex; gap: 0.6rem; justify-content: flex-end;
        }
        .quote-modal-actions button {
          font: inherit; font-weight: 600; padding: 0.5rem 1rem;
          border-radius: 8px; cursor: pointer;
          border: 1.5px solid;
        }
        .quote-modal-actions .primary {
          border-color: #1d1a14; background: #1d1a14; color: #fffaf2;
        }
        :global(html.dark) .quote-modal-actions .primary {
          border-color: #f4f1ea; background: #f4f1ea; color: #1d1a14;
        }
        .quote-modal-actions .primary:hover:not(:disabled) { opacity: 0.88; }
        .quote-modal-actions .danger {
          border-color: #b3261e; background: transparent; color: #b3261e;
        }
        .quote-modal-actions .danger:hover:not(:disabled) {
          background: #b3261e; color: #fffaf2;
        }
        .quote-modal-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

function QuoteEditor({ existing, onClose, onSaved }) {
  const [text, setText] = useState(existing?.text || '');
  const [author, setAuthor] = useState(existing?.author || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    if (e) e.preventDefault();
    const t = text.trim();
    if (!t) { setError('Zitat darf nicht leer sein.'); return; }
    setBusy(true); setError('');
    try {
      const url = existing ? `/api/quotes/${existing.id}` : '/api/quotes/add';
      const method = existing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, author: author.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Fehler');
      await onSaved();
    } catch (err) {
      setError(err.message || 'Fehler');
      setBusy(false);
    }
  }

  return (
    <div class="quote-modal-overlay" role="dialog" aria-modal="true">
      <div class="quote-modal-backdrop" onClick={onClose} />
      <div class="quote-modal quote-editor">
        <div class="quote-editor-head">
          <h2>{existing ? 'Zitat bearbeiten' : 'Neues Zitat'}</h2>
          <button type="button" class="quote-modal-close" onClick={onClose} aria-label="Schließen">×</button>
        </div>
        <form onSubmit={save} class="quote-editor-form">
          <label>
            <span>Zitat</span>
            <textarea
              rows={4}
              value={text}
              onInput={(e) => setText(e.currentTarget.value)}
              autoFocus
              required
            />
          </label>
          <label>
            <span>Author (optional)</span>
            <input
              type="text"
              value={author}
              onInput={(e) => setAuthor(e.currentTarget.value)}
            />
          </label>
          {error && <div class="quote-modal-error">{error}</div>}
          <div class="quote-editor-actions">
            <button type="submit" disabled={busy}>{existing ? 'Speichern' : 'Hinzufügen'}</button>
          </div>
        </form>
      </div>

      <style>{`
        .quote-editor-head {
          display: flex; align-items: center; justify-content: space-between;
        }
        .quote-editor-head h2 { margin: 0; font-size: 1.2rem; }
        .quote-editor-form {
          display: flex; flex-direction: column; gap: 0.7rem; margin-top: 0.7rem;
        }
        .quote-editor-form label {
          display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.92rem;
        }
        .quote-editor-form input,
        .quote-editor-form textarea {
          font: inherit;
          padding: 0.55rem 0.7rem;
          border: 1.5px solid currentColor;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font-family: inherit;
        }
        .quote-editor-form textarea { resize: vertical; }
        .quote-editor-actions {
          display: flex; justify-content: flex-end; margin-top: 0.4rem;
        }
        .quote-editor-actions button {
          font: inherit; font-weight: 600;
          padding: 0.55rem 1.1rem;
          border: 1.5px solid #1d1a14;
          border-radius: 8px;
          background: #1d1a14;
          color: #fffaf2;
          cursor: pointer;
        }
        :global(html.dark) .quote-editor-actions button {
          border-color: #f4f1ea; background: #f4f1ea; color: #1d1a14;
        }
        .quote-editor-actions button:hover:not(:disabled) { opacity: 0.88; }
        .quote-editor-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
