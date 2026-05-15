import { useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';

const MoleculeBuilderCanvas = lazy(() => import('./MoleculeBuilderCanvas.jsx'));

export default function MoleculeBuilder() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-root">
      <div className="mb-toolbar">
        <button
          type="button"
          className="mb-launch-btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mb-editor-panel"
        >
          {open ? 'Editor schliessen' : 'Molecule Builder'}
        </button>
      </div>

      {open ? (
        <div
          id="mb-editor-panel"
          className="mb-editor-panel"
          role="region"
          aria-label="Molecule Builder"
        >
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
            <MoleculeBuilderCanvas />
          </Suspense>
        </div>
      ) : null}

      <style>{`
        .mb-root {
          /* width:100% noetig, weil body display:flex column ist und der
             astro-island-Wrapper mit display:contents keine stretch-Box hat. */
          width: 100%;
          min-width: 0;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .mb-toolbar {
          display: flex;
          gap: 0.75rem;
          align-items: center;
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

        .mb-editor-panel {
          margin: 1.2rem 0 0;
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
      `}</style>
    </section>
  );
}
