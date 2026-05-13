// Shim fuer `react-dom/client` (React-18-API), damit Bibliotheken wie Ketcher
// unter Preact laufen. preact/compat liefert `createRoot` nicht, dafuer aber
// `render`/`hydrate` — die wickeln wir hier in das React-18-Root-Interface.
import { render, hydrate } from 'preact/compat';

// Pro Container max. ein Root: React's createRoot warnt, wenn zweimal auf den
// gleichen Container aufgerufen, und gibt im Echtbetrieb dasselbe Root zurueck.
// Ohne diesen Cache initialisiert sich Ketcher unter Preact-Suspense doppelt.
const rootByContainer = new WeakMap();

function makeRoot(container) {
  return {
    render(element) {
      render(element, container);
    },
    unmount() {
      render(null, container);
      rootByContainer.delete(container);
    },
  };
}

export function createRoot(container) {
  const existing = rootByContainer.get(container);
  if (existing) return existing;
  const root = makeRoot(container);
  rootByContainer.set(container, root);
  return root;
}

export function hydrateRoot(container, initialChildren) {
  const existing = rootByContainer.get(container);
  if (existing) {
    existing.render(initialChildren);
    return existing;
  }
  hydrate(initialChildren, container);
  const root = makeRoot(container);
  rootByContainer.set(container, root);
  return root;
}

export default { createRoot, hydrateRoot };
