import { useState, useEffect, useRef } from 'preact/hooks';
import { lazy, Suspense, Component as PreactComponent } from 'preact/compat';

const MoleculeBuilderCanvas = lazy(() => {
  if (typeof window !== 'undefined') {
    window.__mbDebug?.push?.({ phase: 'lazy:start', t: Date.now() });
  }
  return import('./MoleculeBuilderCanvas.jsx')
    .then((mod) => {
      if (typeof window !== 'undefined') {
        window.__mbDebug?.push?.({ phase: 'lazy:loaded', t: Date.now() });
      }
      return mod;
    })
    .catch((err) => {
      if (typeof window !== 'undefined') {
        window.__mbDebug?.push?.({ phase: 'lazy:error', t: Date.now(), message: String(err) });
      }
      throw err;
    });
});

class CanvasErrorBoundary extends PreactComponent {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[MoleculeBuilder] ErrorBoundary fing Crash:', error, info);
    this.props.onError?.({
      message: error?.message || String(error),
      stack: error?.stack || null,
      componentStack: info?.componentStack || null,
    });
    this.setState({ error });
  }
  render(props, state) {
    if (state.error) {
      return (
        <div className="mb-editor-placeholder mb-editor-placeholder--error">
          <p className="mb-editor-placeholder-title">Editor ist abgestuerzt.</p>
          <p className="mb-editor-placeholder-hint">
            Details siehst du unten im Debug-Log und in der Browser-Konsole.
          </p>
        </div>
      );
    }
    return props.children;
  }
}

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export default function MoleculeBuilder() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState([]);
  const queueRef = useRef([]);

  // Globalen Sammler einrichten, in den auch der Lazy-Loader schreiben kann.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__mbDebug = {
      push(entry) {
        queueRef.current.push(entry);
        setLog((prev) => [...prev, entry]);
        // eslint-disable-next-line no-console
        console.log('[MoleculeBuilder]', entry.phase, entry);
      },
      clear() {
        queueRef.current = [];
        setLog([]);
      },
    };
    window.__mbDebug.push({ phase: 'mount', t: Date.now() });

    const onUnhandled = (event) => {
      window.__mbDebug.push({
        phase: 'window:error',
        t: Date.now(),
        message: event.message || String(event.error || ''),
        source: event.filename,
        line: event.lineno,
        col: event.colno,
      });
    };
    const onRejection = (event) => {
      window.__mbDebug.push({
        phase: 'window:unhandledrejection',
        t: Date.now(),
        message: String(event.reason?.message || event.reason || ''),
      });
    };
    window.addEventListener('error', onUnhandled);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onUnhandled);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const handleToggle = () => {
    setOpen((v) => {
      const next = !v;
      window.__mbDebug?.push({ phase: next ? 'toggle:open' : 'toggle:close', t: Date.now() });
      return next;
    });
  };

  const handleCanvasEvent = (entry) => {
    window.__mbDebug?.push({ ...entry, t: entry.t || Date.now() });
  };

  return (
    <section className="mb-root">
      <div className="mb-toolbar">
        <button
          type="button"
          className="mb-launch-btn"
          onClick={handleToggle}
          aria-expanded={open}
          aria-controls="mb-editor-panel"
        >
          {open ? 'Editor schliessen' : 'Molecule Builder'}
        </button>
        <span className="mb-debug-badge" title="Debug-Modus laeuft">DEBUG</span>
      </div>

      {open ? (
        <div
          id="mb-editor-panel"
          className="mb-editor-panel"
          role="region"
          aria-label="Molecule Builder"
        >
          <CanvasErrorBoundary onError={(err) => handleCanvasEvent({ phase: 'boundary:error', ...err })}>
            <Suspense
              fallback={
                <div className="mb-editor-placeholder">
                  <p className="mb-editor-placeholder-title">Editor laedt…</p>
                  <p className="mb-editor-placeholder-hint">
                    Lazy-Chunk wird geholt. Erstmal kann das einen Moment dauern.
                  </p>
                </div>
              }
            >
              <MoleculeBuilderCanvas onDebug={handleCanvasEvent} />
            </Suspense>
          </CanvasErrorBoundary>
        </div>
      ) : null}

      <details className="mb-debug-log" open>
        <summary>
          Debug-Log <span className="mb-debug-count">({log.length})</span>
        </summary>
        {log.length === 0 ? (
          <p className="mb-debug-empty">Noch nichts passiert. Klick „Molecule Builder".</p>
        ) : (
          <ol className="mb-debug-entries">
            {log.map((entry, idx) => (
              <li
                key={idx}
                className={`mb-debug-entry mb-debug-entry--${
                  entry.phase.includes('error') || entry.phase.includes('boundary')
                    ? 'err'
                    : entry.phase.includes('loaded') || entry.phase.includes('ready')
                    ? 'ok'
                    : 'info'
                }`}
              >
                <span className="mb-debug-time">{fmtTime(entry.t)}</span>
                <span className="mb-debug-phase">{entry.phase}</span>
                {entry.message ? <span className="mb-debug-msg">{entry.message}</span> : null}
                {entry.stack ? (
                  <pre className="mb-debug-stack">{entry.stack}</pre>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </details>

      <style>{`
        .mb-root {
          /* width:100% noetig, weil body display:flex column ist und der
             astro-island-Wrapper mit display:contents keine stretch-Box hat. */
          width: 100%;
          min-width: 0;
          margin: 1.5rem auto 0;
          padding: 0 1rem;
          box-sizing: border-box;
        }

        .mb-toolbar {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          max-width: 56rem;
          margin: 0 auto;
        }

        .mb-launch-btn {
          appearance: none;
          border: 1px solid var(--site-card-border);
          background: var(--site-card-bg);
          color: var(--site-body-text);
          padding: 0.6rem 1.1rem;
          font: inherit;
          font-weight: 600;
          font-size: 1rem;
          border-radius: 0.7rem;
          cursor: pointer;
          box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .mb-launch-btn:hover {
          transform: translateY(-1px);
          box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
        }

        .mb-launch-btn:focus-visible {
          outline: 2px solid var(--site-accent, #6a8caf);
          outline-offset: 2px;
        }

        .mb-debug-badge {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.7rem;
          letter-spacing: 0.08em;
          padding: 0.18rem 0.5rem;
          border-radius: 0.4rem;
          background: #d04545;
          color: #fff;
          font-weight: 700;
        }

        .mb-editor-panel {
          margin: 1.2rem auto 0;
          max-width: 100rem;
          border: 1px solid var(--site-card-border);
          background: var(--site-card-bg);
          border-radius: 1rem;
          min-height: 600px;
          display: flex;
          align-items: stretch;
          overflow: hidden;
          box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
        }

        .mb-editor-placeholder {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
          padding: 2rem;
          text-align: center;
          color: var(--site-muted);
        }

        .mb-editor-placeholder--error {
          background: rgba(208, 69, 69, 0.06);
          color: #b94b4b;
        }

        .mb-editor-placeholder-title {
          margin: 0;
          font-weight: 600;
          color: var(--site-body-text);
        }

        .mb-editor-placeholder-hint {
          margin: 0;
          max-width: 32rem;
          line-height: 1.5;
        }

        .mb-debug-log {
          margin: 1.2rem auto 0;
          max-width: 56rem;
          border: 1px solid var(--site-card-border);
          border-radius: 0.7rem;
          background: var(--site-card-bg);
          padding: 0.6rem 0.9rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.82rem;
        }

        .mb-debug-log > summary {
          cursor: pointer;
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        .mb-debug-count {
          color: var(--site-muted);
          font-weight: 400;
        }

        .mb-debug-empty {
          margin: 0.6rem 0 0;
          color: var(--site-muted);
        }

        .mb-debug-entries {
          list-style: none;
          margin: 0.6rem 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          max-height: 22rem;
          overflow: auto;
        }

        .mb-debug-entry {
          display: grid;
          grid-template-columns: 7.5rem 11rem 1fr;
          gap: 0.5rem;
          align-items: baseline;
          padding: 0.25rem 0;
          border-bottom: 1px dashed rgba(0, 0, 0, 0.08);
        }

        .mb-debug-entry--err {
          color: #b94b4b;
          background: rgba(208, 69, 69, 0.05);
        }

        .mb-debug-entry--ok {
          color: #3d8a59;
        }

        .mb-debug-time {
          color: var(--site-muted);
          font-variant-numeric: tabular-nums;
        }

        .mb-debug-phase {
          font-weight: 600;
        }

        .mb-debug-msg {
          overflow-wrap: anywhere;
        }

        .mb-debug-stack {
          grid-column: 1 / -1;
          margin: 0.25rem 0 0;
          padding: 0.4rem 0.6rem;
          background: rgba(0, 0, 0, 0.04);
          border-radius: 0.35rem;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-size: 0.75rem;
          line-height: 1.4;
        }
      `}</style>
    </section>
  );
}
