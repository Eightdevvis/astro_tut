import { useState, useRef, useEffect } from 'preact/hooks';

/**
 * SearchDoor.jsx
 * Tuer unten rechts auf der Hauptseite. Der Tuergriff ist eine Lupe (Such-
 * Trigger), an der Tuer haengt ein Namensschild mit Eingabefeld. Beim Klick
 * auf die Lupe wird `GET /api/search?q=...` aufgerufen. Bei Treffer schwingt
 * die Tuer auf und zeigt dahinter:
 *   - Post: zufaelliger Snippet im Hub-Stil + Link zum Post
 *   - User: User-Icon + Name + Link zum Profil
 * Bei kein Treffer: dezente "niemand da"-Meldung hinter der Tuer.
 *
 * Verkabelt vorerst nur Posts + User (Minigames etc. spaeter).
 */
export default function SearchDoor() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('idle'); // idle | searching | open | empty
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  async function doSearch() {
    const q = query.trim();
    if (!q) {
      // Anregen: Fokus aufs Namensschild + sanftes Wackeln
      inputRef.current?.focus();
      shake();
      return;
    }
    setState('searching');
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Suche fehlgeschlagen');

      const posts = Array.isArray(data.posts) ? data.posts : [];
      const users = Array.isArray(data.users) ? data.users : [];

      // Priorisierung: exakter User-Treffer > Post > erster User
      const lower = q.toLowerCase();
      const exactUser = users.find(
        (u) => (u.username || '').toLowerCase() === lower
            || (u.displayName || '').toLowerCase() === lower,
      );
      if (exactUser) {
        setResult({ kind: 'user', data: exactUser });
        setState('open');
        return;
      }
      if (posts.length > 0) {
        setResult({ kind: 'post', data: posts[0] });
        setState('open');
        return;
      }
      if (users.length > 0) {
        setResult({ kind: 'user', data: users[0] });
        setState('open');
        return;
      }
      setState('empty');
    } catch (err) {
      setError(err.message || 'Fehler');
      setState('empty');
    }
  }

  function close() {
    setState('idle');
    setResult(null);
    setError('');
  }

  function shake() {
    const el = document.querySelector('.search-door-frame');
    if (!el) return;
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
  }

  // Esc schliesst Tuer wieder
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && state !== 'idle') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  const isOpen = state === 'open' || state === 'empty';

  return (
    <div class="search-door-wrap" aria-label="Suchtür">
      <div class={`search-door-frame ${isOpen ? 'is-open' : ''} state-${state}`}>
        {/* Hinter der Tuer: Ergebnis (Post / User) oder Empty-Hinweis */}
        <div class="door-behind">
          {state === 'open' && result?.kind === 'post' && (
            <a href={result.data.url} class="behind-post" aria-label="Post öffnen">
              <span class="behind-post-snippet">{result.data.snippet}</span>
            </a>
          )}
          {state === 'open' && result?.kind === 'user' && (
            <a href={result.data.url} class="behind-user" aria-label={`Profil öffnen: ${result.data.displayName}`}>
              <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
              <span class="behind-user-name">{result.data.displayName}</span>
              {result.data.username && result.data.username !== result.data.displayName && (
                <span class="behind-user-id">@{result.data.username}</span>
              )}
            </a>
          )}
          {state === 'empty' && (
            <div class="behind-empty">
              {error ? error : 'Niemand zu Hause.'}
            </div>
          )}
        </div>

        {/* Die Tuer selbst */}
        <div class="door-panel" aria-hidden={isOpen}>
          <div class="door-panel-inner">
            {/* Tuergriff = Lupe (Such-Button) */}
            <button
              type="button"
              class="door-handle"
              onClick={doSearch}
              aria-label="Suchen"
              title="Suchen"
              disabled={state === 'searching'}
            >
              <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle cx="13" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="2.5" />
                <line x1="18.5" y1="18.5" x2="26" y2="26" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" />
              </svg>
            </button>

            {/* Namensschild — zentriert auf der Tuer */}
            <div class="name-plate">
              <input
                ref={inputRef}
                type="text"
                class="name-plate-input"
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
                }}
                placeholder="???"
                aria-label="Suchanfrage"
                maxLength={120}
                spellcheck={false}
              />
            </div>
          </div>
        </div>

        {isOpen && (
          <button type="button" class="door-close" onClick={close} aria-label="Tür schließen" title="Tür schließen">×</button>
        )}
      </div>

      <style>{`
        .search-door-wrap {
          width: 100%;
          display: flex;
          justify-content: flex-end;
          padding: 1rem max(0.75rem, env(safe-area-inset-right, 0px)) 2.5rem 1rem;
          box-sizing: border-box;
          opacity: 0.92;
        }
        .search-door-frame {
          position: relative;
          width: 240px;
          height: 360px;
          perspective: 1100px;
          transform-style: preserve-3d;
        }

        /* "Hinter der Tuer": Innenraum-Optik passend zum Site-Stil
           (schwarz/weiss, eckig, harte Kanten). */
        .door-behind {
          position: absolute;
          inset: 0;
          background: var(--home-page-bg, #ffffff);
          border: 2px solid currentColor;
          color: var(--site-body-text, #000);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0.6rem;
          box-sizing: border-box;
          font-family: var(--font-family);
          text-align: center;
          overflow: hidden;
        }
        :global(html.dark) .door-behind {
          background: var(--home-page-bg, #000);
          color: var(--site-body-text, #fff);
        }
        .behind-empty {
          font-family: ui-monospace, 'Courier New', Courier, monospace;
          font-size: 0.95rem;
          opacity: 0.7;
        }
        /* Post-Peek: wirkt wie ein zufaellig geoeffnetes Fenster auf den
           Post. Kein Datum, keine Ueberschrift, keine Innen-Padding —
           Text laeuft bis an die Tuerkante und wird dort hart abgeschnitten. */
        .behind-post {
          width: 100%; height: 100%;
          display: block;
          padding: 0.5rem 0.6rem;
          box-sizing: border-box;
          background: var(--site-card-bg);
          color: var(--site-card-text);
          text-decoration: none;
          font-size: 0.82rem;
          line-height: 1.4;
          overflow: hidden;
          word-break: break-word;
        }
        .behind-post:hover { filter: invert(0.04); }
        .behind-post-snippet { display: block; overflow: hidden; }

        .behind-user {
          width: 100%;
          display: flex; flex-direction: column;
          align-items: center; gap: 0.35rem;
          color: inherit; text-decoration: none;
          padding: 0.6rem;
          box-sizing: border-box;
        }
        .behind-user:hover { filter: invert(0.06); }
        .behind-user svg {
          width: 88px; height: 88px;
          color: inherit;
        }
        .behind-user-name {
          font-family: var(--font-hero, 'Protest Demo'), serif;
          font-size: 1.25rem;
          line-height: 1.1;
          text-align: center;
          word-break: break-word;
        }
        .behind-user-id {
          font-family: ui-monospace, 'Courier New', Courier, monospace;
          font-size: 0.72rem;
          opacity: 0.6;
          letter-spacing: 0.04em;
        }

        /* Die Tuer (3D-Rotation um linke Kante) */
        .door-panel {
          position: absolute;
          inset: 0;
          transform-origin: left center;
          transform: rotateY(0deg);
          transition: transform 700ms cubic-bezier(.4, .1, .2, 1);
          backface-visibility: hidden;
          will-change: transform;
        }
        .search-door-frame.is-open .door-panel {
          transform: rotateY(-82deg);
          pointer-events: none;
        }

        .door-panel-inner {
          position: absolute;
          inset: 0;
          background: var(--site-card-bg, #fff);
          color: var(--site-card-text, #000);
          border: 2px solid currentColor;
          box-shadow: var(--site-card-inset-strong);
          overflow: hidden;
        }
        /* Tuerpaneele: zwei rechteckige Felder, scharfkantig */
        .door-panel-inner::before,
        .door-panel-inner::after {
          content: '';
          position: absolute;
          left: 18px;
          right: 18px;
          height: 30%;
          border: 1.5px solid currentColor;
          opacity: 0.85;
        }
        .door-panel-inner::before { top: 16px; }
        .door-panel-inner::after  { bottom: 16px; }

        /* Lupengriff — klein, schwarz/weiss, eckig */
        .door-handle {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          width: 26px;
          height: 26px;
          padding: 0;
          border: 1.5px solid currentColor;
          background: var(--site-card-bg, #fff);
          color: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 0;
        }
        .door-handle svg { width: 16px; height: 16px; display: block; }
        .door-handle:hover:not(:disabled) {
          background: currentColor;
        }
        .door-handle:hover:not(:disabled) svg { color: var(--site-card-bg, #fff); }
        .door-handle:disabled { opacity: 0.5; cursor: progress; }

        /* Namensschild — zentriert auf der Tuer (horizontal + vertikal) */
        .name-plate {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 70%;
          height: 48px;
          background: var(--site-card-bg, #fff);
          color: inherit;
          border: 1.5px solid currentColor;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 0.4rem;
          box-sizing: border-box;
        }
        .name-plate-input {
          flex: 1; min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          font-family: ui-monospace, 'Courier New', Courier, monospace;
          font-size: 1rem;
          color: inherit;
          text-align: center;
          letter-spacing: 0.02em;
        }
        .name-plate-input::placeholder {
          color: inherit;
          opacity: 0.4;
          font-family: ui-monospace, 'Courier New', Courier, monospace;
        }

        /* Close-Button */
        .door-close {
          position: absolute;
          top: -12px;
          right: -12px;
          width: 24px;
          height: 24px;
          border: 1.5px solid currentColor;
          background: var(--site-card-bg, #fff);
          color: inherit;
          font-size: 1rem;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 5;
          border-radius: 0;
        }
        .door-close:hover { background: currentColor; color: var(--site-card-bg, #fff); }

        .search-door-frame.is-shaking {
          animation: door-shake 360ms ease;
        }
        @keyframes door-shake {
          0%, 100% { transform: translateX(0); }
          20%      { transform: translateX(-5px); }
          40%      { transform: translateX(5px);  }
          60%      { transform: translateX(-3px); }
          80%      { transform: translateX(3px); }
        }

        @media (max-width: 520px) {
          .search-door-frame { width: 200px; height: 300px; }
          .name-plate { height: 42px; }
          .name-plate-input { font-size: 0.9rem; }
          .door-handle { width: 22px; height: 22px; right: 10px; }
          .door-handle svg { width: 13px; height: 13px; }
          .behind-user svg { width: 70px; height: 70px; }
          .behind-user-name { font-size: 1.05rem; }
        }
      `}</style>
    </div>
  );
}
