import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

/**
 * VocabCardStack.jsx
 * Stack persoenlicher Vokabelkarten unten rechts auf /me. Neueste Karte liegt
 * vorn (visuell unten) und ist voll sichtbar, aeltere Karten lugen oben heraus
 * (nur das Wort sichtbar). Hover auf den Stack faechert die Karten so weit
 * auf, dass jede einzeln lesbar ist; Mouse-Leave klappt zurueck.
 *
 * `isOwner=true`: Plus-Knopf oben mittig auf der vordersten Karte oeffnet
 * Editor (Add/Edit/Delete). Strikt server-seitig per Session geschuetzt — der
 * Owner-Prop steuert nur die UI, nicht die Autorisierung.
 */

const PEEK = 38;   // px sichtbar pro aelterer Karte im Kollaps-Zustand
const GAP = 14;    // px zwischen voll aufgefaecherten Karten
const CARD_W = 280;
const CARD_H = 200;

function fetchCards() {
  return fetch('/api/user/vocab')
    .then((r) => r.json().catch(() => ({})))
    .then((d) => (Array.isArray(d.cards) ? d.cards : []));
}

/**
 * AutoFitText — schrumpft die Schriftgroesse, bis der Inhalt in den durch
 * CSS vorgegebenen Box (max-height + Breite) passt. Iterativ in 1px-Schritten
 * vom max bis zum min Wert. Greift nur, wenn das Element overflowt — sonst
 * bleibt es bei max.
 */
function AutoFitText({ text, maxPx, minPx = 9, class: className }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cancelled = false;
    function fit() {
      if (cancelled || !el.isConnected) return;
      let size = maxPx;
      el.style.fontSize = `${size}px`;
      // Sicherheits-Cap: max 60 Schritte (sollte nie nahekommen).
      for (let i = 0; i < 60; i++) {
        const overflows = el.scrollHeight > el.clientHeight + 0.5
          || el.scrollWidth > el.clientWidth + 0.5;
        if (!overflows || size <= minPx) break;
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    }

    // Doppelter rAF: einmal nachdem der initiale Layout durch ist, danach
    // koennen sich Fonts/Bilder noch laden und die Box-Hoehe veraendern.
    requestAnimationFrame(() => requestAnimationFrame(fit));

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fit()) : null;
    if (ro) ro.observe(el);

    return () => { cancelled = true; if (ro) ro.disconnect(); };
  }, [text, maxPx, minPx]);

  return <div ref={ref} class={className}>{text}</div>;
}

export default function VocabCardStack({ isOwner = false }) {
  const [cards, setCards] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchCards()
      .then((cs) => { if (!cancelled) { setCards(cs); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const reload = useCallback(() => {
    fetchCards().then((cs) => setCards(cs)).catch(() => {});
  }, []);

  // Reihenfolge: API liefert aufsteigend nach created_at. Neueste = letzte.
  // Visuell: neueste unten, voll sichtbar; aelteste oben, lugt raus.
  // index 0 = aelteste, index N-1 = neueste.
  const N = cards.length;
  // Stack-Hoehe im kollabierten Zustand:
  const collapsedHeight = CARD_H + Math.max(0, N - 1) * PEEK;
  const expandedHeight = N > 0 ? N * CARD_H + (N - 1) * GAP : CARD_H;
  const stackHeight = expanded ? expandedHeight : collapsedHeight;

  function offsetForIndex(i) {
    // i = 0 (aelteste) bis N-1 (neueste). Neueste sitzt unten (bottom: 0).
    const fromBottom = N - 1 - i;
    if (expanded) return fromBottom * (CARD_H + GAP);
    return fromBottom * PEEK;
  }

  if (!loaded) return null;

  // Wenn keine Karten und kein Owner: nichts anzeigen.
  if (N === 0 && !isOwner) return null;

  return (
    <>
      <div
        ref={containerRef}
        class={`vocab-stack ${expanded ? 'is-expanded' : ''}`}
        style={{
          width: `${CARD_W}px`,
          height: `${stackHeight}px`,
        }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {N === 0 && isOwner && (
          <div class="vocab-card vocab-card-empty" style={{ bottom: '0px', zIndex: 1 }}>
            <button
              type="button"
              class="vocab-add-btn"
              aria-label="Vokabelkarte hinzufügen"
              title="Vokabelkarte hinzufügen"
              onClick={() => setEditorOpen(true)}
            >+</button>
            <div class="vocab-empty-hint">Noch keine Karten.<br/>Klick + zum Hinzufügen.</div>
          </div>
        )}

        {cards.map((c, i) => {
          const isNewest = i === N - 1;
          return (
            <div
              key={c.id}
              class={`vocab-card ${isNewest ? 'is-newest' : ''}`}
              style={{
                bottom: `${offsetForIndex(i)}px`,
                zIndex: 100 + i, // aeltere niedriger, neueste hoechste
              }}
            >
              <AutoFitText
                class="vocab-card-word"
                text={c.word}
                maxPx={34}
                minPx={12}
              />
              {c.pronunciation && (
                <AutoFitText
                  class="vocab-card-pron"
                  text={`/${c.pronunciation}/`}
                  maxPx={15}
                  minPx={9}
                />
              )}
              {c.definition && (
                <AutoFitText
                  class="vocab-card-def"
                  text={c.definition}
                  maxPx={15}
                  minPx={9}
                />
              )}
              {isNewest && isOwner && (
                <button
                  type="button"
                  class="vocab-add-btn"
                  aria-label="Vokabelkarte hinzufügen oder bearbeiten"
                  title="Vokabelkarte hinzufügen oder bearbeiten"
                  onClick={() => setEditorOpen(true)}
                >+</button>
              )}
            </div>
          );
        })}
      </div>

      {editorOpen && isOwner && (
        <VocabEditor
          cards={cards}
          onClose={() => setEditorOpen(false)}
          onChanged={reload}
        />
      )}

      <style>{`
        .vocab-stack {
          position: fixed;
          right: max(1rem, env(safe-area-inset-right, 0px));
          bottom: max(1rem, env(safe-area-inset-bottom, 0px));
          z-index: 380;
          pointer-events: auto;
          transition: height 220ms ease;
        }
        .vocab-card {
          position: absolute;
          left: 0;
          right: 0;
          width: ${CARD_W}px;
          height: ${CARD_H}px;
          background: var(--card-bg, #fffaf2);
          color: var(--card-fg, #1d1a14);
          border: 2px solid var(--card-border, #1d1a14);
          border-radius: 14px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.1);
          padding: 1rem 1.1rem 1rem;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          gap: 0.45rem;
          text-align: center;
          pointer-events: auto;
          overflow: visible;
          transition: bottom 240ms cubic-bezier(.2,.7,.2,1), box-shadow 220ms;
        }
        .vocab-stack.is-expanded .vocab-card {
          box-shadow: 0 6px 18px rgba(0,0,0,0.22), 0 1px 3px rgba(0,0,0,0.1);
        }
        :global(html.dark) .vocab-card {
          background: var(--card-bg, #1c1a16);
          color: var(--card-fg, #f4f1ea);
          border-color: var(--card-border, #f4f1ea);
        }
        /* Alle drei Felder: feste Box-Groesse + overflow:hidden, damit
           AutoFitText scrollHeight > clientHeight zuverlaessig erkennen kann.
           Basis-Schriftgroessen sind hier in CSS, damit Re-Renders sie nicht
           ueberschreiben — JS setzt die Inline-font-size nur dann, wenn der
           Inhalt schrumpfen muss. Werte MUESSEN mit maxPx im JSX zusammen-
           passen (word=34, pron=15, def=15). KEIN display:flex hier — sonst
           wrappt der Text nicht und ueberlauft horizontal schon bei
           mittellangen Woertern. */
        .vocab-card-word {
          font-family: 'Protest Demo', var(--font-hero, 'Protest Demo'), serif;
          font-size: 34px;
          line-height: 1.05;
          margin-top: 0.15rem;
          overflow-wrap: anywhere;
          width: 100%;
          /* 2 Zeilen bei 34px*1.05 = 71.4px — Box gross genug damit zweizeilige
             Woerter nicht zu Schrumpfen fuehren. */
          max-height: 78px;
          overflow: hidden;
          text-align: center;
          align-self: center;
        }
        .vocab-card-pron {
          font-family: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace;
          font-size: 15px;
          opacity: 0.7;
          letter-spacing: 0.02em;
          line-height: 1.2;
          width: 100%;
          max-height: 22px;
          overflow: hidden;
          text-align: center;
          overflow-wrap: anywhere;
        }
        .vocab-card-def {
          font-size: 15px;
          line-height: 1.35;
          opacity: 0.88;
          margin-top: 0.15rem;
          flex: 1 1 auto;
          min-height: 0;
          width: 100%;
          overflow: hidden;
          overflow-wrap: anywhere;
          text-align: center;
        }
        .vocab-card-empty {
          align-items: center;
          justify-content: center;
        }
        .vocab-empty-hint {
          font-size: 0.92rem;
          opacity: 0.7;
          line-height: 1.4;
        }
        .vocab-add-btn {
          position: absolute;
          top: -14px;
          left: 50%;
          transform: translateX(-50%);
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 2px solid var(--card-border, #1d1a14);
          background: var(--card-bg, #fffaf2);
          color: var(--card-fg, #1d1a14);
          font-size: 1.1rem;
          font-weight: bold;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
          pointer-events: auto;
          box-shadow: 0 2px 4px rgba(0,0,0,0.18);
        }
        :global(html.dark) .vocab-add-btn {
          background: var(--card-bg, #1c1a16);
          color: var(--card-fg, #f4f1ea);
          border-color: var(--card-border, #f4f1ea);
        }
        .vocab-add-btn:hover {
          transform: translateX(-50%) scale(1.08);
        }
        @media (max-width: 480px) {
          .vocab-stack {
            right: max(0.5rem, env(safe-area-inset-right, 0px));
          }
          .vocab-card {
            width: min(${CARD_W}px, calc(100vw - 1.2rem));
          }
        }
      `}</style>
    </>
  );
}

// IPA-Tastatur: Auswahl der gaengigsten Symbole fuer DE/EN-Lautschrift,
// gruppiert in Reihen. Jeder Tastendruck fuegt das Symbol an der aktuellen
// Cursor-Position im Lautschrift-Feld ein.
const IPA_ROWS = [
  ['ˈ', 'ˌ', 'ː', '.', '̯', '̥', '̃'],
  ['ə', 'ɐ', 'ɛ', 'ɪ', 'ɔ', 'ʊ', 'œ', 'ø', 'y', 'ʏ'],
  ['æ', 'ɑ', 'ɒ', 'ʌ', 'ɜ', 'ɵ', 'ɤ', 'ɯ'],
  ['aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ', 'ɔʏ'],
  ['ʃ', 'ʒ', 'ʧ', 'ʤ', 'ŋ', 'ç', 'ʁ', 'ʔ'],
  ['θ', 'ð', 'ɣ', 'χ', 'ɲ', 'ɬ', 'ɫ', 'ɾ'],
];

function VocabEditor({ cards, onClose, onChanged }) {
  const [word, setWord] = useState('');
  const [pron, setPron] = useState('');
  const [def, setDef] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ipaOpen, setIpaOpen] = useState(false);
  const pronRef = useRef(null);

  function insertIpa(symbol) {
    const el = pronRef.current;
    if (!el) {
      setPron((p) => (p + symbol).slice(0, 120));
      return;
    }
    const start = el.selectionStart ?? pron.length;
    const end = el.selectionEnd ?? pron.length;
    const next = (pron.slice(0, start) + symbol + pron.slice(end)).slice(0, 120);
    setPron(next);
    // Cursor hinter das eingefuegte Symbol setzen (nach dem Re-Render).
    requestAnimationFrame(() => {
      if (!pronRef.current) return;
      const pos = Math.min(next.length, start + symbol.length);
      pronRef.current.focus();
      pronRef.current.setSelectionRange(pos, pos);
    });
  }

  function resetForm() {
    setWord(''); setPron(''); setDef(''); setEditingId(null); setError('');
  }

  async function save(e) {
    if (e) e.preventDefault();
    const w = word.trim();
    if (!w) { setError('Wort darf nicht leer sein.'); return; }
    setBusy(true); setError('');
    try {
      const url = editingId
        ? `/api/user/vocab/${editingId}`
        : '/api/user/vocab';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: w, pronunciation: pron.trim(), definition: def.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Fehler');
      resetForm();
      await onChanged();
    } catch (err) {
      setError(err.message || 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm('Diese Karte wirklich löschen?')) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/user/vocab/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Fehler');
      if (editingId === id) resetForm();
      await onChanged();
    } catch (err) {
      setError(err.message || 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c) {
    setEditingId(c.id);
    setWord(c.word);
    setPron(c.pronunciation || '');
    setDef(c.definition || '');
    setError('');
  }

  return (
    <div class="vocab-editor-overlay" role="dialog" aria-modal="true" aria-label="Vokabelkarten bearbeiten">
      <div class="vocab-editor-backdrop" onClick={onClose} />
      <div class="vocab-editor">
        <div class="vocab-editor-head">
          <h2>{editingId ? 'Karte bearbeiten' : 'Neue Karte'}</h2>
          <button type="button" class="vocab-editor-close" onClick={onClose} aria-label="Schließen">×</button>
        </div>
        <form class="vocab-editor-form" onSubmit={save}>
          <label>
            <span>Wort</span>
            <input
              type="text"
              maxLength={80}
              value={word}
              onInput={(e) => setWord(e.currentTarget.value)}
              autoFocus
              required
            />
          </label>
          <label>
            <span>Lautschrift (optional)</span>
            <input
              ref={pronRef}
              type="text"
              maxLength={120}
              value={pron}
              onInput={(e) => setPron(e.currentTarget.value)}
              placeholder="z. B. ˈvoː.kaː.bəl"
            />
          </label>
          <button
            type="button"
            class={`ipa-toggle ${ipaOpen ? 'is-open' : ''}`}
            onClick={() => setIpaOpen((v) => !v)}
            aria-expanded={ipaOpen}
            aria-controls="vocab-ipa-keyboard"
          >
            <span class="ipa-toggle-label">Lautschrift-Tastatur</span>
            <span class="ipa-toggle-arrow" aria-hidden="true">▾</span>
          </button>
          {ipaOpen && (
            <div id="vocab-ipa-keyboard" class="ipa-keyboard" role="group" aria-label="IPA-Symbole">
              {IPA_ROWS.map((row, ri) => (
                <div class="ipa-row" key={ri}>
                  {row.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      class="ipa-key"
                      onClick={() => insertIpa(sym)}
                      // mousedown verhindert dass das Input den Fokus verliert
                      // (sonst ist selectionStart immer am Ende)
                      onMouseDown={(e) => e.preventDefault()}
                      tabIndex={-1}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          <label>
            <span>Definition (optional)</span>
            <textarea
              maxLength={1000}
              rows={3}
              value={def}
              onInput={(e) => setDef(e.currentTarget.value)}
            />
          </label>
          {error && <div class="vocab-editor-error">{error}</div>}
          <div class="vocab-editor-actions">
            {editingId && (
              <button type="button" class="ghost" onClick={resetForm} disabled={busy}>
                Abbrechen
              </button>
            )}
            <button type="submit" disabled={busy}>
              {editingId ? 'Speichern' : 'Hinzufügen'}
            </button>
          </div>
        </form>

        {cards.length > 0 && (
          <div class="vocab-editor-list">
            <h3>Bestehende Karten</h3>
            <ul>
              {cards.slice().reverse().map((c) => (
                <li key={c.id}>
                  <div class="vocab-editor-item-text">
                    <strong>{c.word}</strong>
                    {c.pronunciation && <span class="pron">/{c.pronunciation}/</span>}
                    {c.definition && <div class="def">{c.definition}</div>}
                  </div>
                  <div class="vocab-editor-item-actions">
                    <button type="button" onClick={() => startEdit(c)} disabled={busy}>
                      Bearbeiten
                    </button>
                    <button type="button" class="danger" onClick={() => remove(c.id)} disabled={busy}>
                      Löschen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <style>{`
        .vocab-editor-overlay {
          position: fixed;
          inset: 0;
          z-index: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .vocab-editor-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.45);
        }
        .vocab-editor {
          position: relative;
          background: var(--card-bg, #fffaf2);
          color: var(--card-fg, #1d1a14);
          border: 2px solid var(--card-border, #1d1a14);
          border-radius: 14px;
          padding: 1.25rem 1.4rem;
          max-width: 520px;
          width: 100%;
          max-height: calc(100vh - 2rem);
          overflow-y: auto;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }
        :global(html.dark) .vocab-editor {
          background: #1c1a16;
          color: #f4f1ea;
          border-color: #f4f1ea;
        }
        .vocab-editor-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .vocab-editor-head h2 {
          margin: 0;
          font-size: 1.25rem;
        }
        .vocab-editor-close {
          background: none;
          border: none;
          font-size: 1.6rem;
          line-height: 1;
          cursor: pointer;
          color: inherit;
          padding: 0.25rem 0.5rem;
        }
        .vocab-editor-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-top: 0.75rem;
        }
        .vocab-editor-form label {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          font-size: 0.92rem;
        }
        .vocab-editor-form input,
        .vocab-editor-form textarea {
          font: inherit;
          padding: 0.55rem 0.7rem;
          border: 1.5px solid currentColor;
          border-radius: 8px;
          background: transparent;
          color: inherit;
        }
        .vocab-editor-form textarea {
          resize: vertical;
          font-family: inherit;
        }
        .vocab-editor-error {
          color: #b3261e;
          font-size: 0.9rem;
        }
        .ipa-toggle {
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          font: inherit;
          font-size: 0.85rem;
          padding: 0.3rem 0.65rem;
          margin-top: -0.35rem;
          border: 1px solid currentColor;
          border-radius: 999px;
          background: transparent;
          color: inherit;
          cursor: pointer;
          opacity: 0.8;
        }
        .ipa-toggle:hover { opacity: 1; }
        .ipa-toggle-arrow {
          display: inline-block;
          transition: transform 180ms ease;
          font-size: 0.9em;
          line-height: 1;
        }
        .ipa-toggle.is-open .ipa-toggle-arrow {
          transform: rotate(180deg);
        }
        .ipa-keyboard {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          padding: 0.5rem;
          border: 1px solid rgba(128,128,128,0.4);
          border-radius: 8px;
          background: rgba(128,128,128,0.08);
        }
        .ipa-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
        }
        .ipa-key {
          font: inherit;
          font-family: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace;
          font-size: 1rem;
          min-width: 2rem;
          height: 2rem;
          padding: 0 0.45rem;
          border: 1px solid currentColor;
          border-radius: 6px;
          background: var(--card-bg, #fffaf2);
          color: inherit;
          cursor: pointer;
          line-height: 1;
        }
        :global(html.dark) .ipa-key {
          background: #2a2722;
        }
        .ipa-key:hover {
          background: rgba(128,128,128,0.25);
        }
        .ipa-key:active {
          transform: scale(0.94);
        }
        .vocab-editor-actions {
          display: flex;
          gap: 0.6rem;
          justify-content: flex-end;
        }
        .vocab-editor-actions button {
          font: inherit;
          font-weight: 600;
          padding: 0.55rem 1.1rem;
          border: 1.5px solid #1d1a14;
          border-radius: 8px;
          background: #1d1a14;
          color: #fffaf2;
          cursor: pointer;
        }
        :global(html.dark) .vocab-editor-actions button {
          border-color: #f4f1ea;
          background: #f4f1ea;
          color: #1d1a14;
        }
        .vocab-editor-actions button.ghost {
          background: transparent;
          color: inherit;
          border-color: currentColor;
        }
        .vocab-editor-actions button:hover:not(:disabled) {
          opacity: 0.88;
        }
        .vocab-editor-actions button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .vocab-editor-list {
          margin-top: 1.4rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(128,128,128,0.35);
        }
        .vocab-editor-list h3 {
          margin: 0 0 0.5rem;
          font-size: 1rem;
        }
        .vocab-editor-list ul {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .vocab-editor-list li {
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
          padding: 0.6rem 0.7rem;
          border: 1px solid rgba(128,128,128,0.35);
          border-radius: 8px;
        }
        .vocab-editor-item-text {
          flex: 1;
          min-width: 0;
        }
        .vocab-editor-item-text .pron {
          margin-left: 0.4rem;
          font-family: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace;
          opacity: 0.7;
          font-size: 0.85rem;
        }
        .vocab-editor-item-text .def {
          font-size: 0.88rem;
          opacity: 0.85;
          margin-top: 0.2rem;
        }
        .vocab-editor-item-actions {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .vocab-editor-item-actions button {
          font: inherit;
          font-size: 0.85rem;
          padding: 0.3rem 0.6rem;
          border: 1px solid currentColor;
          border-radius: 6px;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .vocab-editor-item-actions button.danger {
          color: #b3261e;
          border-color: #b3261e;
        }
        .vocab-editor-item-actions button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
