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
            <a href={result.data.url} class="behind-post" aria-label={`Post öffnen: ${result.data.title}`}>
              <span class="behind-post-date">{result.data.date}</span>
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

            {/* Namensschild — haengt am "Nagel" */}
            <div class="name-plate">
              <span class="name-plate-nail" aria-hidden="true"></span>
              <span class="name-plate-string name-plate-string-left" aria-hidden="true"></span>
              <span class="name-plate-string name-plate-string-right" aria-hidden="true"></span>
              <input
                ref={inputRef}
                type="text"
                class="name-plate-input"
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
                }}
                placeholder="Suchen…"
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
          /* Subtiles Fade rein wie die letzten Posts */
          opacity: 0.92;
        }
        .search-door-frame {
          position: relative;
          width: 240px;
          height: 360px;
          perspective: 1100px;
          transform-style: preserve-3d;
        }

        /* Tuerrahmen-Bg (immer sichtbar als "dahinter") */
        .door-behind {
          position: absolute;
          inset: 0;
          border-radius: 14px 14px 6px 6px;
          background:
            radial-gradient(ellipse at 50% 30%, rgba(255,240,210,0.06), transparent 65%),
            linear-gradient(180deg, #2a221b 0%, #1a1310 100%);
          border: 3px solid #3b2f23;
          box-shadow: inset 0 0 24px rgba(0,0,0,0.6);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          box-sizing: border-box;
          color: #f6efdb;
          font-family: var(--font-family);
          text-align: center;
          /* Kein scrollbares Verhalten — wir wollen Wand-Feeling */
          overflow: hidden;
        }
        .behind-empty {
          font-size: 1rem;
          opacity: 0.65;
          font-style: italic;
        }
        .behind-post {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.6rem;
          box-sizing: border-box;
          background: var(--site-card-bg, #fffaf2);
          color: var(--site-card-text, #1d1a14);
          border-radius: 10px;
          text-decoration: none;
          font-size: 0.78rem;
          line-height: 1.4;
          overflow: hidden;
          transition: transform 200ms ease, box-shadow 200ms;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        }
        .behind-post:hover { transform: scale(1.02); box-shadow: 0 6px 16px rgba(0,0,0,0.32); }
        .behind-post-date {
          font-size: 0.68rem;
          letter-spacing: 0.05em;
          opacity: 0.55;
          font-family: ui-monospace, 'JetBrains Mono', monospace;
        }
        .behind-post-snippet {
          font-style: italic;
          opacity: 0.92;
          overflow: hidden;
          flex: 1;
        }

        .behind-user {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          color: #f6efdb;
          text-decoration: none;
          padding: 1rem;
          box-sizing: border-box;
          border-radius: 8px;
          transition: transform 200ms ease;
        }
        .behind-user:hover { transform: scale(1.05); }
        .behind-user svg {
          width: 90px; height: 90px;
          color: #f6efdb;
          filter: drop-shadow(0 0 8px rgba(255, 230, 170, 0.25));
        }
        .behind-user-name {
          font-family: 'Protest Demo', var(--font-hero, 'Protest Demo'), serif;
          font-size: 1.3rem;
          line-height: 1.1;
          text-align: center;
          word-break: break-word;
        }
        .behind-user-id {
          font-family: ui-monospace, 'JetBrains Mono', monospace;
          font-size: 0.75rem;
          opacity: 0.55;
          letter-spacing: 0.04em;
        }

        /* Die Tuer selbst (3D-Rotation um linke Kante) */
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
          border-radius: 14px 14px 6px 6px;
          background:
            repeating-linear-gradient(
              90deg,
              rgba(0,0,0,0.04) 0 2px,
              transparent 2px 8px
            ),
            linear-gradient(180deg, #8b6b3d 0%, #6e5128 100%);
          border: 3px solid #3b2a14;
          box-shadow:
            inset 0 0 24px rgba(0,0,0,0.32),
            inset 0 6px 0 rgba(255,255,255,0.06),
            0 10px 24px rgba(0,0,0,0.35);
          overflow: hidden;
        }
        /* Tuerpaneele: zwei "Felder" */
        .door-panel-inner::before,
        .door-panel-inner::after {
          content: '';
          position: absolute;
          left: 16px;
          right: 16px;
          height: 32%;
          border: 2px solid rgba(0,0,0,0.35);
          border-radius: 4px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07);
        }
        .door-panel-inner::before { top: 14px; }
        .door-panel-inner::after  { bottom: 80px; }

        /* Lupengriff */
        .door-handle {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          width: 50px;
          height: 50px;
          padding: 0;
          border: 3px solid #1b1108;
          border-radius: 50%;
          background:
            radial-gradient(circle at 35% 30%, #f6d77a 0%, #b9892b 60%, #6a4a14 100%);
          color: #1b1108;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow:
            inset 0 0 6px rgba(255,255,255,0.4),
            0 4px 8px rgba(0,0,0,0.4);
          transition: transform 160ms ease, box-shadow 160ms;
        }
        .door-handle svg { width: 28px; height: 28px; }
        .door-handle:hover:not(:disabled) {
          transform: translateY(-50%) scale(1.06);
          box-shadow: inset 0 0 6px rgba(255,255,255,0.5), 0 6px 12px rgba(0,0,0,0.5);
        }
        .door-handle:active:not(:disabled) { transform: translateY(-50%) scale(0.96); }
        .door-handle:disabled { opacity: 0.7; cursor: progress; }

        /* Namensschild */
        .name-plate {
          position: absolute;
          left: 14px;
          right: 80px;
          top: 22%;
          height: 56px;
          background: linear-gradient(180deg, #f6efdb 0%, #e9dfb9 100%);
          border: 2px solid #3b2a14;
          border-radius: 6px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          padding: 0 0.5rem;
        }
        .name-plate-nail {
          position: absolute;
          top: -10px;
          left: 50%;
          transform: translateX(-50%);
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #d8b367, #6f4f17);
          border: 1.5px solid #2c1f0d;
          z-index: 2;
        }
        .name-plate-string {
          position: absolute;
          top: -6px;
          width: 2px;
          background: #2c1f0d;
          height: 18px;
          transform-origin: top;
        }
        .name-plate-string-left  { left: calc(50% - 1px); transform: rotate(-32deg); }
        .name-plate-string-right { left: calc(50% - 1px); transform: rotate( 32deg); }

        .name-plate-input {
          flex: 1; min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          font: inherit;
          font-family: 'Protest Demo', var(--font-hero, 'Protest Demo'), serif;
          font-size: 1.1rem;
          color: #2a1d0c;
          text-align: center;
        }
        .name-plate-input::placeholder {
          color: #6b5a35;
          opacity: 0.6;
          font-style: italic;
        }

        /* Close-Button rechts oben am Rahmen */
        .door-close {
          position: absolute;
          top: -14px;
          right: -14px;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          border: 2px solid #1b1108;
          background: #f6efdb;
          color: #1b1108;
          font-size: 1.1rem;
          font-weight: bold;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 5;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        }
        .door-close:hover { transform: scale(1.08); }

        /* Shake-Animation wenn leeres Query */
        .search-door-frame.is-shaking {
          animation: door-shake 360ms ease;
        }
        @keyframes door-shake {
          0%, 100% { transform: translateX(0); }
          20%      { transform: translateX(-6px) rotate(-1deg); }
          40%      { transform: translateX(6px)  rotate(1deg); }
          60%      { transform: translateX(-4px); }
          80%      { transform: translateX(4px); }
        }

        @media (max-width: 520px) {
          .search-door-frame { width: 200px; height: 300px; }
          .name-plate { height: 48px; top: 20%; right: 70px; }
          .door-handle { width: 42px; height: 42px; right: 12px; }
          .door-handle svg { width: 22px; height: 22px; }
          .behind-user svg { width: 70px; height: 70px; }
          .behind-user-name { font-size: 1.1rem; }
        }

        /* Dark-Mode: Tuer bleibt holzig, Hinten leicht dunkler */
        :global(html.dark) .door-behind {
          background:
            radial-gradient(ellipse at 50% 30%, rgba(255,240,210,0.04), transparent 65%),
            linear-gradient(180deg, #150f0a 0%, #0c0805 100%);
        }
      `}</style>
    </div>
  );
}
